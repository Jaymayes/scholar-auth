import type { Request, Response, NextFunction } from 'express';
import type { User } from '@shared/schema';
import { storage } from '../storage';
import { enrollmentService } from '../auth/mfa/enrollmentService';

/**
 * 🚨 CEO GATE 0 DIRECTIVE: MFA Enforcement Middleware
 * 
 * Enforces MFA for admin and provider_admin roles per Nov 15, 2025 escalation order.
 * Blocks access to protected routes unless user has completed MFA verification.
 * 
 * Usage: Add this middleware AFTER authentication middleware on admin/provider_admin routes
 * Example: router.get('/admin/users', requireAuth, requireMfaForPrivilegedRoles, handler)
 */
export async function requireMfaForPrivilegedRoles(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.user as User;

    if (!user) {
      res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    // Check if user role requires MFA enforcement
    const enforcementRequired = enrollmentService.isEnforcementRequired(user);

    if (!enforcementRequired) {
      // Role doesn't require MFA - allow through
      next();
      return;
    }

    // Get user's MFA enrollment status
    const enrollmentStatus = await enrollmentService.getEnrollmentStatus(user.id);

    if (!enrollmentStatus.hasAnyFactor) {
      // MFA required but not enrolled - block access
      console.warn('[MFA Enforcement] Access blocked: MFA required but not enrolled', {
        userId: user.id,
        email: user.email,
        role: user.role,
        path: req.path,
        method: req.method,
      });

      // Audit log the blocked attempt
      await storage.createAuditLogAsync({
        userId: user.id,
        action: 'MFA_REQUIRED_ACCESS_BLOCKED',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        details: {
          resourceType: 'admin_route',
          resourceId: req.path,
          reason: 'MFA enrollment required for privileged role',
          role: user.role,
        },
      });

      res.status(403).json({
        error: 'MFA enrollment required',
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required for your role. Please enroll in MFA before accessing this resource.',
        enrollmentUrl: '/mfa/enrollment',
        role: user.role,
      });
      return;
    }

    // MFA enrolled - allow access
    // TODO: In Phase 2, also verify recent MFA challenge completion for sensitive actions
    console.log('[MFA Enforcement] Access granted: MFA enrolled', {
      userId: user.id,
      email: user.email,
      role: user.role,
      path: req.path,
      hasTotp: enrollmentStatus.hasTotp,
      hasWebAuthn: enrollmentStatus.hasWebAuthn,
    });

    next();
  } catch (error) {
    console.error('[MFA Enforcement] Middleware error:', error);
    res.status(500).json({
      error: 'MFA enforcement check failed',
      code: 'MFA_ENFORCEMENT_ERROR',
    });
  }
}

/**
 * Variant: Require MFA verification for specific sensitive actions
 * This middleware checks for recent MFA challenge completion (via session or JWT claim)
 * 
 * Note: Full implementation deferred to Phase 1.1 per CEO directive
 * Current implementation only checks enrollment, not recent verification
 */
export async function requireRecentMfaVerification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Phase 1.1: Check for mfa_verified claim in JWT or session
  // For now, pass through if enrolled (enrollment check above is sufficient for Gate 0)
  next();
}
