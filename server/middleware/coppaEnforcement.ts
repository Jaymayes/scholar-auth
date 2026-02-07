import { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logger } from './auditLogger';

/**
 * P0 COPPA ENFORCEMENT MIDDLEWARE
 * 
 * Blocks unconsented under-13 users from accessing data collection features.
 * Implements FTC COPPA Rule compliance for verifiable parental consent.
 * 
 * @compliance COPPA 15 U.S.C. §§ 6501–6506
 * @risk Up to $43,792 per violation without enforcement
 * 
 * Usage:
 *   app.post('/api/profile', isAuthenticated, requireParentalConsent, handler);
 */
export async function requireParentalConsent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Step 1: Check if user is authenticated
    // IMPORTANT: For public routes (like scholarship browsing), allow anonymous access
    // COPPA only applies to authenticated users who might be under 13
    if (!req.user) {
      // User is not authenticated - allow access (public routes)
      // COPPA doesn't restrict anonymous browsing
      next();
      return;
    }

    // Step 2: Extract user ID from session (use canonical database ID)
    const userId = (req.user as any).userId ?? (req.user as any).claims?.sub;
    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid session: user ID not found.',
      });
      return;
    }

    // Step 3: Fetch user from database
    const user = await storage.getUser(userId);
    if (!user) {
      logger.warn('COPPA enforcement: User not found', { userId });
      res.status(404).json({
        error: 'User not found',
        message: 'The requested user account does not exist.',
      });
      return;
    }

    // Step 4: Check if user is under 13 and restricted
    if (user.ageGateStatus === 'under_13_restricted') {
      // Step 5: Check for valid parental consent
      const hasConsent = await storage.hasValidParentalConsent(userId);

      if (!hasConsent) {
        // 🚨 COPPA VIOLATION: Block access and return 403
        logger.audit('COPPA_ACCESS_BLOCKED', {
          userId,
          endpoint: req.path,
          method: req.method,
          reason: 'no_parental_consent',
        }, req, userId);

        res.status(403).json({
          error: 'Parental consent required',
          message: 'This feature requires parental consent for users under 13 years old.',
          coppaCompliance: {
            userAge: 'under_13',
            consentStatus: 'not_granted',
            nextStep: 'parental_consent_required',
            redirectTo: '/parent-consent',
          },
          learnMore: 'https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa',
        });
        return;
      }

      // User has valid consent - log access and proceed
      logger.info('COPPA consent verified', {
        userId,
        endpoint: req.path,
        consentStatus: 'valid',
      });
    }

    // Step 6: Allow access
    next();
  } catch (error) {
    logger.error('COPPA enforcement middleware error', error as Error, {
      userId: (req.user as any)?.userId ?? (req.user as any)?.claims?.sub,
      path: req.path,
    });

    // Fail closed: deny access on error
    res.status(500).json({
      error: 'Internal server error',
      message: 'Unable to verify COPPA compliance. Please try again.',
    });
  }
}

/**
 * Optional: Check if user requires parental consent (without blocking)
 * Used for displaying warnings or conditional UI
 */
export async function checkParentalConsentStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      next();
      return;
    }

    const userId = (req.user as any).userId ?? (req.user as any).claims?.sub;
    if (!userId) {
      next();
      return;
    }

    const user = await storage.getUser(userId);
    if (!user) {
      next();
      return;
    }

    // Attach consent status to request for downstream use
    if (user.ageGateStatus === 'under_13_restricted') {
      const hasConsent = await storage.hasValidParentalConsent(userId);
      (req as any).coppaStatus = {
        requiresConsent: true,
        hasConsent,
        userAge: 'under_13',
      };
    } else {
      (req as any).coppaStatus = {
        requiresConsent: false,
        hasConsent: true,
        userAge: 'over_13',
      };
    }

    next();
  } catch (error) {
    logger.error('COPPA status check error', error as Error);
    // Non-blocking: proceed on error
    next();
  }
}
