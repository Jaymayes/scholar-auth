import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { storage } from "../../storage";
import { logger } from "../../middleware/auditLogger";
import { sendUserRegisteredEvent } from "../../notifications/webhookClient";
import { generateJWT, verifyJWT } from "./jwtUtils";
import { z } from "zod";
import { db } from "../../db";
import { users, emailVerificationTokens, restRefreshTokens, type EmailVerificationToken } from "@shared/schema";
import { eq, and, sql as drizzleSql } from "drizzle-orm";

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_TTL = 3600; // 1 hour
const REFRESH_TOKEN_TTL = 604800; // 7 days

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(['student', 'provider', 'admin']).default('student'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refresh_token: z.string(),
});

const verifyEmailSchema = z.object({
  token: z.string(),
});

const introspectSchema = z.object({
  token: z.string(),
});

export async function handleRegister(req: Request, res: Response) {
  try {
    const body = registerSchema.parse(req.body);
    
    const existingUser = await storage.getUserByEmail(body.email);
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    
    const user = await storage.upsertUser({
      email: body.email,
      passwordHash,
      firstName: body.firstName || null,
      lastName: body.lastName || null,
      role: body.role,
      isEmailVerified: false,
    });

    const verificationToken = randomBytes(32).toString('hex');
    await storage.createEmailVerificationToken({
      userId: user.id,
      code: verificationToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    try {
      await sendUserRegisteredEvent({
        user_id: user.id,
        email: user.email!,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
        verification_token: verificationToken,
      });
    } catch (webhookError) {
      logger.warn(`[REST Auth] Webhook to auto_com_center failed: ${webhookError}`);
    }

    logger.info(`[REST Auth] User registered: ${user.id}`, { userId: user.id });

    res.status(201).json({
      message: "Registration successful. Please check your email to verify your account.",
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request body", details: error.errors });
    }
    logger.error(`[REST Auth] Registration error: ${error}`);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function handleLogin(req: Request, res: Response) {
  try {
    const body = loginSchema.parse(req.body);
    
    const user = await storage.getUserByEmail(body.email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(body.password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({ error: "Email not verified. Please check your email." });
    }

    const accessToken = await generateJWT(user, ACCESS_TOKEN_TTL);
    const refreshToken = await generateJWT(user, REFRESH_TOKEN_TTL, true);

    // Store refresh token hash for rotation tracking
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await db.insert(restRefreshTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
    });

    logger.info(`[REST Auth] User logged in: ${user.id}`, { userId: user.id });

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request body", details: error.errors });
    }
    logger.error(`[REST Auth] Login error: ${error}`);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function handleRefresh(req: Request, res: Response) {
  try {
    const body = refreshSchema.parse(req.body);
    
    const payload = await verifyJWT(body.refresh_token);
    if (!payload || !payload.isRefreshToken) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const tokenHash = createHash('sha256').update(body.refresh_token).digest('hex');

    // Cleanup expired tokens before processing (prevent unbounded growth)
    await db.delete(restRefreshTokens).where(drizzleSql`expires_at < NOW()`);

    const user = await storage.getUser(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Atomic revocation with race condition guard (revoked = false)
    const revokedCount = await db.update(restRefreshTokens).set({
      revoked: true,
      revokedAt: new Date(),
    }).where(
      and(
        eq(restRefreshTokens.tokenHash, tokenHash),
        eq(restRefreshTokens.revoked, false)
      )
    );

    // Verify exactly one token was revoked (prevents race conditions)
    if (revokedCount.rowCount === 0) {
      return res.status(401).json({ error: "Refresh token revoked, expired, or not found" });
    }

    // Generate new tokens
    const accessToken = await generateJWT(user, ACCESS_TOKEN_TTL);
    const newRefreshToken = await generateJWT(user, REFRESH_TOKEN_TTL, true);

    // Store new refresh token hash
    const newTokenHash = createHash('sha256').update(newRefreshToken).digest('hex');
    await db.insert(restRefreshTokens).values({
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
    });

    logger.info(`[REST Auth] Token refreshed: ${user.id}`, { userId: user.id });

    res.json({
      access_token: accessToken,
      refresh_token: newRefreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request body", details: error.errors });
    }
    logger.error(`[REST Auth] Refresh error: ${error}`);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function handleVerifyEmail(req: Request, res: Response) {
  try {
    const body = verifyEmailSchema.parse(req.body);
    
    // Atomic select and delete to prevent token reuse
    const tokens = await db.select().from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.code, body.token))
      .limit(1);
    
    if (tokens.length === 0 || tokens[0].expiresAt < new Date()) {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    const validToken = tokens[0];

    // Delete token atomically by primary key (prevents reuse)
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, validToken.id));

    // Update user after token deletion to ensure token is one-time use
    await storage.updateUser(validToken.userId, { isEmailVerified: true });

    logger.info(`[REST Auth] Email verified: ${validToken.userId}`, { userId: validToken.userId });

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request body", details: error.errors });
    }
    logger.error(`[REST Auth] Verify email error: ${error}`);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function handleIntrospect(req: Request, res: Response) {
  try {
    const body = introspectSchema.parse(req.body);
    
    const payload = await verifyJWT(body.token);
    if (!payload) {
      return res.json({ active: false });
    }

    const user = await storage.getUser(payload.sub);
    if (!user) {
      return res.json({ active: false });
    }

    res.json({
      active: true,
      sub: payload.sub,
      email: user.email,
      role: user.role,
      scope: payload.scope || '',
      iss: payload.iss,
      aud: payload.aud,
      exp: payload.exp,
      iat: payload.iat,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request body", details: error.errors });
    }
    logger.error(`[REST Auth] Introspect error: ${error}`);
    res.status(500).json({ error: "Internal server error" });
  }
}
