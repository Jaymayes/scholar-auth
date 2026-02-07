import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';
import { storage } from '../storage';
import { requireMfaForPrivilegedRoles } from './mfaEnforcement';

/**
 * Middleware to check if user has admin role
 * Requires isAuthenticated middleware to run first
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    logger.warn('Role check attempted without authentication', { path: req.path });
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const userId = (req.user as any).userId || (req.user as any).claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Invalid user session' });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'admin') {
      await logger.audit('UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT', {
        attemptedPath: req.path,
        attemptedMethod: req.method,
        userRole: user.role,
      }, req, userId).catch((err: Error) => {
        logger.error('Failed to log unauthorized access attempt', err);
      });

      return res.status(403).json({ 
        message: 'Forbidden: Admin access required',
        requiredRole: 'admin',
        currentRole: user.role
      });
    }

    // 🚨 CEO GATE 0 DIRECTIVE: Check MFA enforcement for admin role
    // Attach user to request for MFA middleware
    req.user = user;
    
    // CRITICAL: Use callback pattern to prevent execution after MFA denial
    let mfaCheckComplete = false;
    await requireMfaForPrivilegedRoles(req, res, (err?: any) => {
      mfaCheckComplete = true;
      if (err) {
        return next(err);
      }
      // MFA check passed - allow through
      next();
    });
    
    // If response was already sent (403 from MFA denial), stop here
    if (!mfaCheckComplete || res.headersSent) {
      return;
    }
  } catch (error) {
    logger.error('Error in role check middleware', error as Error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Middleware to check if user has reviewer role (or admin)
 */
export async function requireReviewer(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    logger.warn('Role check attempted without authentication', { path: req.path });
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const userId = (req.user as any).userId || (req.user as any).claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Invalid user session' });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'reviewer' && user.role !== 'admin') {
      await logger.audit('UNAUTHORIZED_REVIEWER_ACCESS_ATTEMPT', {
        attemptedPath: req.path,
        attemptedMethod: req.method,
        userRole: user.role,
      }, req, userId).catch((err: Error) => {
        logger.error('Failed to log unauthorized access attempt', err);
      });

      return res.status(403).json({ 
        message: 'Forbidden: Reviewer or Admin access required',
        requiredRole: 'reviewer or admin',
        currentRole: user.role
      });
    }

    next();
  } catch (error) {
    logger.error('Error in role check middleware', error as Error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Middleware to check if user has any of the specified roles
 */
export function requireRoles(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      logger.warn('Role check attempted without authentication', { path: req.path });
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      const userId = (req.user as any).userId || (req.user as any).claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: 'Invalid user session' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (!user.role || !roles.includes(user.role)) {
        await logger.audit('UNAUTHORIZED_ROLE_ACCESS_ATTEMPT', {
          attemptedPath: req.path,
          attemptedMethod: req.method,
          userRole: user.role,
          requiredRoles: roles,
        }, req, userId).catch((err: Error) => {
          logger.error('Failed to log unauthorized access attempt', err);
        });

        return res.status(403).json({ 
          message: 'Forbidden: Insufficient permissions',
          requiredRoles: roles,
          currentRole: user.role
        });
      }

      // 🚨 CEO GATE 0 DIRECTIVE: Check MFA enforcement for privileged roles
      // Applies to admin, provider_admin, and any other privileged role
      req.user = user;
      
      // CRITICAL: Use callback pattern to prevent execution after MFA denial
      // requireMfaForPrivilegedRoles will call next() only if MFA check passes
      // If it sends 403, we must NOT call next() again
      let mfaCheckComplete = false;
      await requireMfaForPrivilegedRoles(req, res, (err?: any) => {
        mfaCheckComplete = true;
        if (err) {
          return next(err);
        }
        // MFA check passed - allow through
        next();
      });
      
      // If response was already sent (403 from MFA denial), stop here
      if (!mfaCheckComplete || res.headersSent) {
        return;
      }
    } catch (error) {
      logger.error('Error in role check middleware', error as Error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  };
}
