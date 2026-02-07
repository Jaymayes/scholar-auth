import { db } from '../db';
import { users, consents } from '@shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '../middleware/auditLogger';

export interface FerpaPolicyResult {
  allowed: boolean;
  reason?: string;
  code?: 'FERPA_CONSENT_REQUIRED' | 'USER_NOT_FOUND' | 'ALLOWED';
}

export async function canProcessMatching(userId: string): Promise<FerpaPolicyResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  
  if (!user) {
    logger.warn(`[FERPA] User not found for FERPA check: ${userId}`);
    return { allowed: false, reason: 'user_not_found', code: 'USER_NOT_FOUND' };
  }

  if (!user.ferpaProtected) {
    return { allowed: true, code: 'ALLOWED' };
  }

  const activeConsent = await db.select().from(consents)
    .where(
      and(
        eq(consents.userId, userId),
        eq(consents.consentType, 'ferpa_educational'),
        eq(consents.consentStatus, 'granted'),
        isNull(consents.revokedDate)
      )
    )
    .limit(1);

  if (activeConsent.length > 0) {
    logger.info(`[FERPA] User ${userId} has active FERPA matching consent`);
    return { allowed: true, code: 'ALLOWED' };
  }

  logger.warn(`[FERPA] Blocked matching for FERPA-protected user ${userId}: no consent`);
  return { 
    allowed: false, 
    reason: 'FERPA-protected user requires explicit consent for matching',
    code: 'FERPA_CONSENT_REQUIRED'
  };
}

export async function hasFerpaMatchingConsent(userId: string): Promise<boolean> {
  const result = await canProcessMatching(userId);
  return result.allowed;
}

export async function logFerpaBlockEvent(userId: string, action: string): Promise<void> {
  logger.audit('FERPA_ACCESS_BLOCKED', {
    userId,
    action,
    timestamp: new Date().toISOString(),
  });
}
