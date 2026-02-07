import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { totpService } from './totpService';
import { webauthnService } from './webauthnService';
import { enrollmentService } from './enrollmentService';
import type { User } from '@shared/schema';
import { z } from 'zod';
import { storage } from '../../storage';

const router = Router();

const mfaRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many MFA requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

async function requireAuth(req: Request, res: Response, next: Function) {
  // ARCHITECT FIX (Nov 10, 23:30 UTC): Use stateless JWT auth (not session-based)
  // Production stack disabled passport sessions on Nov 9, now relies on jwtAuthMiddleware
  // jwtAuthMiddleware attaches decoded user directly to req.user (includes claims)
  // Simply verify req.user exists and has required user ID (from claims.sub)
  
  const user = req.user as any;
  
  if (!user) {
    console.error('[MFA] Authentication required: no req.user', {
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Extract user ID from JWT claims (sub) or database user object (id)
  const userId = user.userId || user.claims?.sub || user.id;
  
  if (!userId) {
    console.error('[MFA] Invalid user object: missing user ID', {
      hasUserId: !!user.userId,
      hasClaims: !!user.claims,
      hasClaimsSub: !!user.claims?.sub,
      hasId: !!user.id,
      path: req.path,
    });
    return res.status(401).json({ error: 'Invalid authentication. Please log in again.' });
  }
  
  // Ensure consistent user object structure for MFA endpoints
  // If user doesn't have .id field, fetch from database using the extracted userId
  if (!user.id) {
    try {
      const dbUser = await storage.getUser(userId);
      
      if (!dbUser) {
        console.error('[MFA] User not found in database', {
          userId,
          path: req.path,
        });
        return res.status(401).json({ error: 'User not found. Please log in again.' });
      }
      
      // Replace req.user with full database User object
      req.user = dbUser;
      console.log('[MFA] User hydrated from JWT claims', {
        userId: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
      });
    } catch (error) {
      console.error('[MFA] Failed to fetch user from database', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: 'Failed to load user data' });
    }
  }
  
  next();
}

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const status = await enrollmentService.getEnrollmentStatus(user.id);

    return res.json({
      success: true,
      status: {
        enrolled: status.hasAnyFactor,
        hasTotp: status.hasTotp,
        hasWebAuthn: status.hasWebAuthn,
        factors: status.factors,
        shouldPrompt: enrollmentService.shouldShowEnrollmentPrompt(user, status),
        enforcementRequired: enrollmentService.isEnforcementRequired(user),
      },
    });
  } catch (error) {
    console.error('Error getting MFA status:', error);
    return res.status(500).json({ error: 'Failed to get MFA status' });
  }
});

router.post('/enrollment/start', requireAuth, mfaRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    await enrollmentService.logEnrollmentStart(user, req);

    return res.json({
      success: true,
      message: 'Enrollment started',
      availableFactors: ['totp', 'webauthn'],
    });
  } catch (error) {
    console.error('Error starting enrollment:', error);
    return res.status(500).json({ error: 'Failed to start enrollment' });
  }
});

const generateTotpSchema = z.object({
  label: z.string().min(1).max(255).optional().default('Authenticator App'),
});

router.post('/totp/generate', requireAuth, mfaRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const validation = generateTotpSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request', details: validation.error });
    }

    const { label } = validation.data;
    const result = await totpService.generateSecret(user, label);

    return res.json({
      success: true,
      data: {
        secret: result.secret,
        qrCode: result.qrCode,
        otpauthUrl: result.otpauthUrl,
        label: result.label,
      },
    });
  } catch (error) {
    console.error('Error generating TOTP secret:', error);
    return res.status(500).json({ error: 'Failed to generate authenticator setup' });
  }
});

const verifyTotpSchema = z.object({
  secret: z.string().min(1),
  token: z.string().length(6),
  label: z.string().min(1).max(255).optional().default('Authenticator App'),
});

router.post('/totp/verify', requireAuth, mfaRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const validation = verifyTotpSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request', details: validation.error });
    }

    const { secret, token, label } = validation.data;
    const result = await totpService.enrollFactor(user.id, secret, token, label);

    if (!result.success) {
      await enrollmentService.logEnrollmentFailure(user.id, 'totp', result.error || 'Unknown error', req);
      return res.status(400).json({ error: result.error });
    }

    const metadata = enrollmentService.extractRequestMetadata(req);
    await enrollmentService.logDecision({
      userId: user.id,
      decisionType: 'enroll',
      factorType: 'totp',
      role: user.role || 'student',
      ...metadata,
    });

    return res.json({
      success: true,
      factorId: result.factorId,
      message: 'Authenticator app successfully enrolled',
    });
  } catch (error) {
    console.error('Error verifying TOTP:', error);
    return res.status(500).json({ error: 'Failed to verify code' });
  }
});

const generateWebAuthnSchema = z.object({
  label: z.string().min(1).max(255).optional().default('Security Key'),
});

router.post('/webauthn/generate-options', requireAuth, mfaRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const validation = generateWebAuthnSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request', details: validation.error });
    }

    const { label } = validation.data;
    const result = await webauthnService.generateRegistrationOptions(user, label);

    return res.json({
      success: true,
      options: result.options,
      challengeId: result.challengeId,
    });
  } catch (error) {
    console.error('Error generating WebAuthn options:', error);
    return res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

const verifyWebAuthnSchema = z.object({
  challengeId: z.string().uuid(),
  response: z.any(),
  label: z.string().min(1).max(255).optional().default('Security Key'),
});

router.post('/webauthn/verify', requireAuth, mfaRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const validation = verifyWebAuthnSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request', details: validation.error });
    }

    const { challengeId, response, label } = validation.data;
    const result = await webauthnService.verifyRegistration(
      user.id,
      challengeId,
      response,
      label
    );

    if (!result.success) {
      await enrollmentService.logEnrollmentFailure(user.id, 'webauthn', result.error || 'Unknown error', req);
      return res.status(400).json({ error: result.error });
    }

    const metadata = enrollmentService.extractRequestMetadata(req);
    await enrollmentService.logDecision({
      userId: user.id,
      decisionType: 'enroll',
      factorType: 'webauthn',
      role: user.role || 'student',
      ...metadata,
    });

    return res.json({
      success: true,
      factorId: result.factorId,
      message: 'Security key successfully enrolled',
    });
  } catch (error) {
    console.error('Error verifying WebAuthn:', error);
    return res.status(500).json({ error: 'Failed to verify credential' });
  }
});

const skipDecisionSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

router.post('/decisions/skip', requireAuth, mfaRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const validation = skipDecisionSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request', details: validation.error });
    }

    const { reason } = validation.data;
    const metadata = enrollmentService.extractRequestMetadata(req);

    await enrollmentService.logDecision({
      userId: user.id,
      decisionType: 'skip',
      reason: reason || 'User chose to skip enrollment',
      role: user.role || 'student',
      ...metadata,
    });

    return res.json({
      success: true,
      message: 'Enrollment skipped',
    });
  } catch (error) {
    console.error('Error logging skip decision:', error);
    return res.status(500).json({ error: 'Failed to log decision' });
  }
});

export default router;
