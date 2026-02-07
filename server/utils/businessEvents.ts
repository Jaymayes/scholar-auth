import { db } from '../db';
import { businessEvents, insertBusinessEventSchema, type InsertBusinessEvent } from '@shared/schema';
import { v4 as uuidv4 } from 'uuid';

/**
 * Fire-and-forget business event emission for KPI tracking
 * This function is synchronous and launches async DB insertion in the background.
 * Callers don't need to await or catch - errors are logged internally.
 * 
 * Usage:
 * ```ts
 * import { emitBusinessEvent } from './utils/businessEvents';
 * 
 * emitBusinessEvent({
 *   ...createEventContext(req, userId, 'student'),
 *   app: 'scholar-auth',
 *   eventName: 'login_succeeded',
 *   properties: { method: 'replit_oidc' }
 * });
 * ```
 */
export function emitBusinessEvent(event: Omit<InsertBusinessEvent, 'env'>): void {
  // Launch async work without blocking caller
  (async () => {
    try {
      // Add environment from NODE_ENV
      const env = (process.env.NODE_ENV || 'development') as 'development' | 'staging' | 'production';
      
      const fullEvent: InsertBusinessEvent = {
        ...event,
        env,
        requestId: event.requestId || uuidv4(), // Fallback if no requestId provided
      };

      // Validate with Zod schema
      const validated = insertBusinessEventSchema.parse(fullEvent);

      // Insert into DB asynchronously
      await db.insert(businessEvents).values(validated);
      
      console.log(`[BUSINESS_EVENT] ${validated.eventName}`, {
        app: validated.app,
        userId: validated.userId,
        actorId: validated.actorId,
        actorType: validated.actorType,
        requestId: validated.requestId,
      });
    } catch (error) {
      // Never throw - log error and continue
      console.error('[BUSINESS_EVENT_ERROR] Failed to emit event:', {
        eventName: event.eventName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}


/**
 * Helper to extract requestId from Express request
 */
export function getRequestId(req: any): string {
  return req.correlationId || req.headers['x-request-id'] || uuidv4();
}

/**
 * Helper to extract sessionId from Express request
 */
export function getSessionId(req: any): string | undefined {
  return req.sessionID || req.session?.id;
}

/**
 * Helper to create a business event context from Express request
 * @param req Express request object
 * @param userId Subject user ID (who the event is about)
 * @param actorId Actor user ID (who performed the action) - defaults to request user
 * @param actorType Type of actor performing the action
 */
export function createEventContext(
  req: any, 
  userId?: string,
  actorId?: string,
  actorType?: InsertBusinessEvent['actorType']
) {
  const defaultUserId = req.user?.userId || req.user?.id || req.user?.claims?.sub;
  
  return {
    requestId: getRequestId(req),
    sessionId: getSessionId(req),
    userId: userId || defaultUserId,
    actorId: actorId || defaultUserId, // Actor defaults to request user if not specified
    actorType: actorType || (req.user?.role as InsertBusinessEvent['actorType']),
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get?.('user-agent') || req.headers?.['user-agent'] || null,
    ts: new Date(),
  };
}

// Pre-defined event names for Scholar-Auth (type safety)
export const ScholarAuthEvents = {
  EMAIL_VERIFIED: 'email_verified',
  CONSENT_RECORDED: 'consent_recorded',
  LOGIN_SUCCEEDED: 'login_succeeded',
  LOGIN_FAILED: 'login_failed',
  SIGNUP_STARTED: 'signup_started',
  EMAIL_SENT: 'email_sent',
  SMS_SENT: 'sms_sent',
} as const;

// Pre-defined event names for Executive Command Center
export const ExecutiveEvents = {
  SCHEDULER_JOB_RUN: 'scheduler_job_run',
  KPI_MISSING_DATA: 'kpi_missing_data',
  KPI_SLO_BREACH: 'kpi_slo_breach',
  KPI_DATA_INTEGRITY_RISK: 'kpi_data_integrity_risk',
} as const;

// Pre-defined event names for Student Pilot (B2C)
export const StudentPilotEvents = {
  STUDENT_SIGNUP: 'student_signup',
  PROFILE_COMPLETED: 'profile_completed',
  MATCH_VIEWED: 'match_viewed',
  CREDIT_PURCHASED: 'credit_purchased',
  CREDIT_SPENT: 'credit_spent',
  APPLICATION_SUBMITTED: 'application_submitted',
} as const;

// Pre-defined event names for Provider Register (B2B)
export const ProviderRegisterEvents = {
  PROVIDER_REGISTERED: 'provider_registered',
  PROVIDER_VERIFIED: 'provider_verified',
  PROVIDER_ACTIVE: 'provider_active',
  SCHOLARSHIP_POSTED: 'scholarship_posted',
  PROVIDER_CHURNED: 'provider_churned',
} as const;

// Pre-defined event names for Scholarship API
export const ScholarshipApiEvents = {
  SCHOLARSHIP_VIEWED: 'scholarship_viewed',
  SCHOLARSHIP_SAVED: 'scholarship_saved',
  MATCH_GENERATED: 'match_generated',
  APPLICATION_STARTED: 'application_started',
  APPLICATION_SUBMITTED: 'application_submitted',
} as const;

// Pre-defined event names for Auto Page Maker (SEO)
export const AutoPageMakerEvents = {
  PAGE_PUBLISHED: 'page_published',
  SITEMAP_SUBMITTED: 'sitemap_submitted',
  INDEXNOW_SUBMITTED: 'indexnow_submitted',
} as const;

// Pre-defined event names for Scholarship Agent (Marketing)
export const ScholarshipAgentEvents = {
  CAMPAIGN_LAUNCHED: 'campaign_launched',
  LEAD_ACQUIRED: 'lead_acquired',
  CONVERSION_ATTRIBUTED: 'conversion_attributed',
} as const;

// Pre-defined event names for Scholarship Sage (AI Advisor)
export const ScholarshipSageEvents = {
  RECOMMENDATION_SHOWN: 'recommendation_shown',
  RECOMMENDATION_ACCEPTED: 'recommendation_accepted',
  CHECKLIST_CREATED: 'checklist_created',
  CHECKLIST_COMPLETED: 'checklist_completed',
} as const;
