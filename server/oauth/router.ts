import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { verifyCodeChallenge } from '../utils/pkce';
import { logger } from '../middleware/auditLogger';
import { z } from 'zod';
import { db } from '../db';

const router = Router();

const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;

const ALLOWED_CLIENTS: Record<string, {
  secret_env: string;
  redirect_uris: string[];
  name: string;
}> = {
  'student-pilot': {
    secret_env: 'STUDENT_PILOT_SECRET',
    redirect_uris: [
      'https://student-pilot-jamarrlmayes.replit.app/auth/callback',
      'https://student-pilot-jamarrlmayes.replit.app/api/auth/callback',
    ],
    name: 'Student Pilot (A5)',
  },
  'provider-register': {
    secret_env: 'PROVIDER_REGISTER_SECRET',
    redirect_uris: [
      'https://provider-register-jamarrlmayes.replit.app/auth/callback',
      'https://provider-register-jamarrlmayes.replit.app/api/auth/callback',
    ],
    name: 'Provider Register (A6)',
  },
};

const ALLOWED_ORIGINS = [
  'https://student-pilot-jamarrlmayes.replit.app',
  'https://provider-register-jamarrlmayes.replit.app',
];

const authorizeSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  response_type: z.literal('code'),
  state: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256').optional().default('S256'),
  scope: z.string().optional().default('openid email profile'),
});

const tokenSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
});

function setOAuthCors(req: Request, res: Response): boolean {
  const origin = req.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return true;
  }
  return false;
}

// 🔒 RFC 6749 INPUT VALIDATION SCHEMAS
// Validates client_id and grant_type per RFC 6749 §5.2
const authorizationCodeSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
});

const refreshTokenGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

const clientCredentialsSchema = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scope: z.string().optional(),
});
router.options('/authorize', (req, res) => {
  setOAuthCors(req, res);
  res.status(204).end();
});

router.options('/token', (req, res) => {
  setOAuthCors(req, res);
  res.status(204).end();
});

router.options('/userinfo', (req, res) => {
  setOAuthCors(req, res);
  res.status(204).end();
});

router.get('/authorize', async (req: any, res: Response) => {
  const correlationId = req.correlationId || 'unknown';
  
  try {
    const parsed = authorizeSchema.safeParse(req.query);
    
    if (!parsed.success) {
      logger.warn('OAuth authorize: Invalid parameters', {
        correlationId,
        errors: parsed.error.flatten(),
      });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing or invalid parameters',
        details: parsed.error.flatten(),
      });
    }
    
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = parsed.data;
    
    const clientConfig = ALLOWED_CLIENTS[client_id];
    if (!clientConfig) {
      logger.warn('OAuth authorize: Unknown client', { correlationId, client_id });
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Unknown client_id',
      });
    }
    
    if (!clientConfig.redirect_uris.includes(redirect_uri)) {
      logger.warn('OAuth authorize: Invalid redirect_uri', {
        correlationId,
        client_id,
        redirect_uri,
        allowed: clientConfig.redirect_uris,
      });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'redirect_uri not registered for this client',
      });
    }
    
    const user = req.user;
    if (!user) {
      const loginUrl = new URL('/login', `https://${req.get('host')}`);
      const nextUrl = new URL(req.originalUrl, `https://${req.get('host')}`);
      loginUrl.searchParams.set('next', nextUrl.toString());
      
      logger.info('OAuth authorize: User not authenticated, redirecting to login', {
        correlationId,
        client_id,
        nextUrl: nextUrl.toString(),
      });
      
      return res.redirect(loginUrl.toString());
    }
    
    const code = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + OAUTH_CODE_TTL_MS);
    
    await storage.createOauthCode({
      code,
      clientId: client_id,
      userId: user.id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      scope,
      state,
      expiresAt,
    });
    
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('state', state);
    
    logger.info('OAuth authorize: Code issued', {
      correlationId,
      client_id,
      userId: user.id,
      redirect_uri,
    });
    
    logger.info('OAUTH_CODE_ISSUED', {
      correlationId,
      client_id,
      userId: user.id,
      action: 'oauth_authorize',
    });
    
    return res.redirect(callbackUrl.toString());
    
  } catch (error) {
    logger.error('OAuth authorize error', error as Error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});


// RFC 6749 §5.2: Token Endpoint with RFC 6749 Compliant Input Validation
// Validates client_id (REQUIRED) and grant_type (REQUIRED)
router.post('/token', async (req: any, res: Response) => {
  const correlationId = req.correlationId || 'unknown';
  setOAuthCors(req, res);
  
  try {
    // STEP 1: RFC 6749 §5.2 - Validate client_id is present (REQUIRED)
    const client_id = req.body?.client_id;
    if (!client_id || typeof client_id !== 'string' || client_id.trim() === '') {
      logger.warn('OAuth token: Missing client_id', { correlationId });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id is required',
      });
    }

    // STEP 2: RFC 6749 §5.2 - Validate grant_type is present (REQUIRED)
    const grant_type = req.body?.grant_type;
    if (!grant_type || typeof grant_type !== 'string' || grant_type.trim() === '') {
      logger.warn('OAuth token: Missing grant_type', { correlationId, client_id });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'grant_type is required',
      });
    }

    // STEP 3: RFC 6749 §5.2 - Validate grant_type is in allowed set
    const ALLOWED_GRANT_TYPES = ['authorization_code', 'refresh_token', 'client_credentials'];
    if (!ALLOWED_GRANT_TYPES.includes(grant_type)) {
      logger.warn('OAuth token: Unsupported grant_type', { correlationId, client_id, grant_type });
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'grant_type must be one of: authorization_code, refresh_token, client_credentials',
      });
    }

    // STEP 4: Route to appropriate handler based on grant_type
    if (grant_type === 'authorization_code') {
      // Validate authorization_code specific parameters
      const parsed = authorizationCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn('OAuth token: Invalid parameters for authorization_code', { correlationId, errors: parsed.error.flatten() });
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing or invalid parameters',
        });
      }

      const { code, redirect_uri, client_secret, code_verifier } = parsed.data;

      const clientConfig = ALLOWED_CLIENTS[client_id];
      if (!clientConfig) {
        logger.warn('OAuth token: Unknown client', { correlationId, client_id });
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Unknown client_id',
        });
      }

      const expectedSecret = process.env[clientConfig.secret_env];
      if (!expectedSecret || client_secret !== expectedSecret) {
        logger.warn('OAUTH_INVALID_SECRET', { correlationId, client_id, action: 'oauth_token_invalid_secret' });
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        });
      }

      const oauthCode = await storage.consumeOauthCode(code);
      if (!oauthCode) {
        logger.warn('OAuth token: Invalid or expired code', { correlationId, client_id });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid, expired, or already used authorization code',
        });
      }

      if (new Date() > new Date(oauthCode.expiresAt)) {
        logger.warn('OAUTH_CODE_EXPIRED', { correlationId, client_id, action: 'oauth_token_code_expired', severity: 'security' });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code has expired',
        });
      }

      if (oauthCode.clientId !== client_id) {
        logger.warn('OAUTH_CLIENT_MISMATCH', { correlationId, expected: oauthCode.clientId, provided: client_id, action: 'oauth_token_client_mismatch', severity: 'security' });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Code was not issued to this client',
        });
      }

      if (oauthCode.redirectUri !== redirect_uri) {
        logger.warn('OAUTH_REDIRECT_MISMATCH', { correlationId, client_id, action: 'oauth_token_redirect_mismatch', severity: 'security' });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'redirect_uri does not match',
        });
      }

      if (!verifyCodeChallenge(code_verifier, oauthCode.codeChallenge)) {
        logger.warn('OAUTH_PKCE_FAILED', { correlationId, client_id, action: 'oauth_token_pkce_failed', severity: 'security' });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'PKCE code_verifier validation failed',
        });
      }

      const user = await storage.getUser(oauthCode.userId);
      if (!user) {
        logger.error('OAuth token: User not found', undefined, { correlationId, userId: oauthCode.userId });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'User not found',
        });
      }

      const { SignJWT } = await import('jose');

      const privateKeyParams = {
        kty: 'RSA' as const,
        n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
        e: process.env.OIDC_RSA_PUBLIC_KEY_E!,
        d: process.env.OIDC_RSA_PRIVATE_KEY_D!,
        p: process.env.OIDC_RSA_PRIVATE_KEY_P!,
        q: process.env.OIDC_RSA_PRIVATE_KEY_Q!,
        dp: process.env.OIDC_RSA_PRIVATE_KEY_DP!,
        dq: process.env.OIDC_RSA_PRIVATE_KEY_DQ!,
        qi: process.env.OIDC_RSA_PRIVATE_KEY_QI!,
      };

      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateKeyParams,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const issuer = process.env.ISSUER_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
      const now = Math.floor(Date.now() / 1000);

      const accessToken = await new SignJWT({
        sub: user.id,
        email: user.email,
        email_verified: user.isEmailVerified,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        scope: oauthCode.scope,
        client_id: client_id,
      })
        .setProtectedHeader({ alg: 'RS256', kid: process.env.OIDC_SIGNING_KID })
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .setIssuer(issuer)
        .setAudience(client_id)
        .sign(privateKey);

      const idToken = await new SignJWT({
        sub: user.id,
        email: user.email,
        email_verified: user.isEmailVerified,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        profile_image_url: user.profileImageUrl,
        role: user.role,
        auth_time: now,
        nonce: oauthCode.state,
      })
        .setProtectedHeader({ alg: 'RS256', kid: process.env.OIDC_SIGNING_KID })
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .setIssuer(issuer)
        .setAudience(client_id)
        .sign(privateKey);

      const refreshToken = randomBytes(32).toString('hex');

      const { createHash } = await import('crypto');
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const { restRefreshTokens } = await import('@shared/schema');
      await db.insert(restRefreshTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt: refreshExpiresAt,
        revoked: false,
      });

      logger.info('OAuth token: Tokens issued', { correlationId, client_id, userId: user.id, scope: oauthCode.scope });

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken,
        id_token: idToken,
        scope: oauthCode.scope,
      });

    } else if (grant_type === 'refresh_token') {
      // Validate refresh_token specific parameters
      const parsed = refreshTokenGrantSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn('OAuth token: Invalid parameters for refresh_token', { correlationId, errors: parsed.error.flatten() });
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing or invalid parameters',
        });
      }

      const { refresh_token, client_secret } = parsed.data;

      const clientConfig = ALLOWED_CLIENTS[client_id];
      if (!clientConfig) {
        logger.warn('OAuth token: Unknown client for refresh', { correlationId, client_id });
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Unknown client_id',
        });
      }

      const expectedSecret = process.env[clientConfig.secret_env];
      if (!expectedSecret || client_secret !== expectedSecret) {
        logger.warn('OAUTH_REFRESH_INVALID_SECRET', { correlationId, client_id, action: 'oauth_refresh_invalid_secret' });
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        });
      }

      const { createHash } = await import('crypto');
      const tokenHash = createHash('sha256').update(refresh_token).digest('hex');

      const { restRefreshTokens } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');

      const storedToken = await db
        .select()
        .from(restRefreshTokens)
        .where(
          and(
            eq(restRefreshTokens.tokenHash, tokenHash),
            eq(restRefreshTokens.revoked, false)
          )
        )
        .limit(1);

      if (storedToken.length === 0) {
        logger.warn('OAuth token: Invalid or revoked refresh token', { correlationId, client_id });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid, expired, or revoked refresh token',
        });
      }

      const tokenRecord = storedToken[0];

      if (new Date() > new Date(tokenRecord.expiresAt)) {
        logger.warn('OAuth token: Refresh token expired', { correlationId, client_id });
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Refresh token has expired',
        });
      }

      await db
        .update(restRefreshTokens)
        .set({ revoked: true, revokedAt: new Date() })
        .where(eq(restRefreshTokens.id, tokenRecord.id));

      const user = await storage.getUser(tokenRecord.userId);
      if (!user) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'User not found',
        });
      }

      const { SignJWT } = await import('jose');

      const privateKeyParams = {
        kty: 'RSA' as const,
        n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
        e: process.env.OIDC_RSA_PUBLIC_KEY_E!,
        d: process.env.OIDC_RSA_PRIVATE_KEY_D!,
        p: process.env.OIDC_RSA_PRIVATE_KEY_P!,
        q: process.env.OIDC_RSA_PRIVATE_KEY_Q!,
        dp: process.env.OIDC_RSA_PRIVATE_KEY_DP!,
        dq: process.env.OIDC_RSA_PRIVATE_KEY_DQ!,
        qi: process.env.OIDC_RSA_PRIVATE_KEY_QI!,
      };

      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateKeyParams,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const issuer = process.env.ISSUER_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
      const now = Math.floor(Date.now() / 1000);

      const accessToken = await new SignJWT({
        sub: user.id,
        email: user.email,
        email_verified: user.isEmailVerified,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        scope: 'openid email profile',
        client_id: client_id,
      })
        .setProtectedHeader({ alg: 'RS256', kid: process.env.OIDC_SIGNING_KID })
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .setIssuer(issuer)
        .setAudience(client_id)
        .sign(privateKey);

      const newRefreshToken = randomBytes(32).toString('hex');
      const newTokenHash = createHash('sha256').update(newRefreshToken).digest('hex');
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.insert(restRefreshTokens).values({
        userId: user.id,
        tokenHash: newTokenHash,
        expiresAt: refreshExpiresAt,
        revoked: false,
      });

      logger.info('OAuth token: Tokens refreshed', { correlationId, client_id, userId: user.id, action: 'oauth_refresh_success' });

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: newRefreshToken,
        scope: 'openid email profile',
      });

    } else if (grant_type === 'client_credentials') {
      // Validate client_credentials specific parameters
      const parsed = clientCredentialsSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn('OAuth token: Invalid parameters for client_credentials', { correlationId, errors: parsed.error.flatten() });
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing or invalid parameters',
        });
      }

      const { client_secret, scope } = parsed.data;

      const clientConfig = ALLOWED_CLIENTS[client_id];
      if (!clientConfig) {
        logger.warn('OAuth token: Unknown client for M2M', { correlationId, client_id });
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Unknown client_id',
        });
      }

      const expectedSecret = process.env[clientConfig.secret_env];
      if (!expectedSecret || client_secret !== expectedSecret) {
        logger.warn('OAUTH_M2M_INVALID_SECRET', { correlationId, client_id, action: 'oauth_m2m_invalid_secret' });
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        });
      }

      const { SignJWT } = await import('jose');

      const privateKeyParams = {
        kty: 'RSA' as const,
        n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
        e: process.env.OIDC_RSA_PUBLIC_KEY_E!,
        d: process.env.OIDC_RSA_PRIVATE_KEY_D!,
        p: process.env.OIDC_RSA_PRIVATE_KEY_P!,
        q: process.env.OIDC_RSA_PRIVATE_KEY_Q!,
        dp: process.env.OIDC_RSA_PRIVATE_KEY_DP!,
        dq: process.env.OIDC_RSA_PRIVATE_KEY_DQ!,
        qi: process.env.OIDC_RSA_PRIVATE_KEY_QI!,
      };

      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateKeyParams,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const issuer = process.env.ISSUER_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
      const now = Math.floor(Date.now() / 1000);

      const accessToken = await new SignJWT({
        sub: client_id,
        client_id: client_id,
        scope: scope || '',
      })
        .setProtectedHeader({ alg: 'RS256', kid: process.env.OIDC_SIGNING_KID })
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .setIssuer(issuer)
        .setAudience(client_id)
        .sign(privateKey);

      logger.info('OAuth token: M2M access token issued', { correlationId, client_id, scope, action: 'oauth_m2m_success' });

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: scope || '',
      });
    }

  } catch (error) {
    logger.error('OAuth token error', error as Error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

router.get('/userinfo', async (req: any, res: Response) => {
  const correlationId = req.correlationId || 'unknown';
  setOAuthCors(req, res);
  
  try {
    const authHeader = req.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing or invalid Authorization header',
      });
    }
    
    const token = authHeader.substring(7);
    
    const { jwtVerify, createRemoteJWKSet } = await import('jose');
    
    const issuer = process.env.ISSUER_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
    const jwksUrl = new URL('/.well-known/jwks.json', issuer);
    
    let JWKS: ReturnType<typeof createRemoteJWKSet>;
    try {
      JWKS = createRemoteJWKSet(jwksUrl);
    } catch {
      const publicKeyParams = {
        kty: 'RSA' as const,
        n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
        e: process.env.OIDC_RSA_PUBLIC_KEY_E!,
        alg: 'RS256',
        use: 'sig',
        kid: process.env.OIDC_SIGNING_KID!,
      };
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyParams,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true,
        ['verify']
      );
      JWKS = (() => publicKey) as any;
    }
    
    // SECURITY FIX (LOGIC-03): Validate audience claim to prevent cross-client token reuse
    // Allowed audiences: any registered client_id or the ecosystem audience
    const allowedAudiences = Object.keys(ALLOWED_CLIENTS);
    allowedAudiences.push('scholarai-ecosystem'); // Internal JWT audience
    
    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience: allowedAudiences,  // SECURITY: Validate aud claim
    });
    
    // Additional check: log the client_id from token for audit trail
    const tokenClientId = payload.client_id as string | undefined;
    const tokenAudience = payload.aud;
    
    logger.info('OAuth userinfo: Token validated with audience check', {
      correlationId,
      tokenClientId,
      tokenAudience,
      action: 'userinfo_audience_validated',
    });
    
    const userId = payload.sub as string;
    const user = await storage.getUser(userId);
    
    if (!user) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'User not found',
      });
    }
    
    logger.info('OAuth userinfo: User info retrieved', {
      correlationId,
      userId: user.id,
    });
    
    return res.json({
      sub: user.id,
      email: user.email,
      email_verified: user.isEmailVerified,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      given_name: user.firstName,
      family_name: user.lastName,
      picture: user.profileImageUrl,
      role: user.role,
      updated_at: user.updatedAt ? Math.floor(new Date(user.updatedAt).getTime() / 1000) : undefined,
    });
    
  } catch (error) {
    if ((error as any)?.code === 'ERR_JWT_EXPIRED') {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token has expired',
      });
    }
    
    logger.error('OAuth userinfo error', error as Error);
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Token validation failed',
    });
  }
});

// PHASE 2 FIX (LOGIC-02): OAuth Refresh Token Endpoint
// Validates and rotates refresh tokens for cross-domain OAuth flow
const refreshTokenSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

router.options('/refresh', (req, res) => {
  setOAuthCors(req, res);
  res.status(204).end();
});

router.post('/refresh', async (req: any, res: Response) => {
  const correlationId = req.correlationId || 'unknown';
  setOAuthCors(req, res);
  
  try {
    const parsed = refreshTokenSchema.safeParse(req.body);
    
    if (!parsed.success) {
      logger.warn('OAuth refresh: Invalid parameters', {
        correlationId,
        errors: parsed.error.flatten(),
      });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing or invalid parameters',
      });
    }
    
    const { refresh_token, client_id, client_secret } = parsed.data;
    
    // Validate client credentials
    const clientConfig = ALLOWED_CLIENTS[client_id];
    if (!clientConfig) {
      logger.warn('OAuth refresh: Unknown client', { correlationId, client_id });
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Unknown client_id',
      });
    }
    
    const expectedSecret = process.env[clientConfig.secret_env];
    if (!expectedSecret || client_secret !== expectedSecret) {
      logger.warn('OAUTH_REFRESH_INVALID_SECRET', {
        correlationId,
        client_id,
        action: 'oauth_refresh_invalid_secret',
      });
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
    }
    
    // Validate refresh token against stored tokens
    // For now, we look up the token in userTokenStore by refresh_token value
    const { createHash } = await import('crypto');
    const tokenHash = createHash('sha256').update(refresh_token).digest('hex');
    
    // Query restRefreshTokens table for the token
    const { db } = await import('../db');
    const { restRefreshTokens } = await import('@shared/schema');
    const { eq, and, isNull } = await import('drizzle-orm');
    
    const storedToken = await db
      .select()
      .from(restRefreshTokens)
      .where(
        and(
          eq(restRefreshTokens.tokenHash, tokenHash),
          eq(restRefreshTokens.revoked, false)
        )
      )
      .limit(1);
    
    if (storedToken.length === 0) {
      logger.warn('OAuth refresh: Invalid or revoked refresh token', { correlationId, client_id });
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid, expired, or revoked refresh token',
      });
    }
    
    const tokenRecord = storedToken[0];
    
    // Check expiration
    if (new Date() > new Date(tokenRecord.expiresAt)) {
      logger.warn('OAuth refresh: Refresh token expired', { correlationId, client_id });
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Refresh token has expired',
      });
    }
    
    // Revoke old refresh token (rotation)
    await db
      .update(restRefreshTokens)
      .set({ revoked: true, revokedAt: new Date() })
      .where(eq(restRefreshTokens.id, tokenRecord.id));
    
    // Get user for new tokens
    const user = await storage.getUser(tokenRecord.userId);
    if (!user) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'User not found',
      });
    }
    
    // Issue new tokens
    const { SignJWT } = await import('jose');
    
    const privateKeyParams = {
      kty: 'RSA' as const,
      n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
      e: process.env.OIDC_RSA_PUBLIC_KEY_E!,
      d: process.env.OIDC_RSA_PRIVATE_KEY_D!,
      p: process.env.OIDC_RSA_PRIVATE_KEY_P!,
      q: process.env.OIDC_RSA_PRIVATE_KEY_Q!,
      dp: process.env.OIDC_RSA_PRIVATE_KEY_DP!,
      dq: process.env.OIDC_RSA_PRIVATE_KEY_DQ!,
      qi: process.env.OIDC_RSA_PRIVATE_KEY_QI!,
    };
    
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      privateKeyParams,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const issuer = process.env.ISSUER_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
    const now = Math.floor(Date.now() / 1000);
    
    const accessToken = await new SignJWT({
      sub: user.id,
      email: user.email,
      email_verified: user.isEmailVerified,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      role: user.role,
      scope: 'openid email profile',
      client_id: client_id,
    })
      .setProtectedHeader({ alg: 'RS256', kid: process.env.OIDC_SIGNING_KID })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setIssuer(issuer)
      .setAudience(client_id)
      .sign(privateKey);
    
    // Generate new refresh token
    const newRefreshToken = randomBytes(32).toString('hex');
    const newTokenHash = createHash('sha256').update(newRefreshToken).digest('hex');
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    
    // Store new refresh token
    await db.insert(restRefreshTokens).values({
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt: refreshExpiresAt,
      revoked: false,
    });
    
    logger.info('OAuth refresh: Tokens refreshed', {
      correlationId,
      client_id,
      userId: user.id,
      action: 'oauth_refresh_success',
    });
    
    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: 'openid email profile',
    });
    
  } catch (error) {
    logger.error('OAuth refresh error', error as Error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error',
    });
  }
});

export default router;
