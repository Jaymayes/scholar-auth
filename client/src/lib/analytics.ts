/**
 * PostHog Analytics Event Taxonomy
 * 
 * Centralized event tracking definitions for ScholarshipAI
 * PostHog Cloud configuration with first-party proxy to reduce adblock loss
 * 
 * IMPORTANT: Server-side relay required for purchase/conversion events
 */

export interface AnalyticsEvent {
  event: string;
  properties: Record<string, any>;
}

// Standard properties included with every event
export interface BaseProperties {
  user_id?: string;
  session_id?: string;
  user_type?: 'student' | 'admin' | 'reviewer' | 'anonymous';
  locale?: string;
  device_type?: 'desktop' | 'mobile' | 'tablet';
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  release_version?: string;
}

// Event Type Definitions

export interface SignupStartedProps extends BaseProperties {
  source?: 'landing' | 'auth_page' | 'referral';
}

export interface SignupCompletedProps extends BaseProperties {
  user_type: 'student' | 'admin' | 'reviewer';
  source: 'replit_auth' | 'email' | 'google' | 'other';
}

export interface ProfileStartedProps extends BaseProperties {
  education_level?: string; // e.g., 'high_school', 'undergraduate', 'graduate'
  locale?: string;
}

export interface ProfileCompletedProps extends BaseProperties {
  education_level: string;
  has_gpa?: boolean;
  has_major?: boolean;
  locale: string;
}

export interface ScholarshipsMatchedProps extends BaseProperties {
  count: number;
  filters_applied?: string[]; // e.g., ['deadline', 'amount', 'major']
}

export interface MatchesViewedProps extends BaseProperties {
  count: number;
  scroll_depth_percent?: number;
}

export interface ScholarshipViewedProps extends BaseProperties {
  scholarship_id: string;
  provider_id?: string;
  award_amount?: number; // in cents to avoid decimal issues
  deadline?: string; // ISO8601 format
}

export interface ScholarshipSavedProps extends BaseProperties {
  scholarship_id: string;
  provider_id?: string;
}

export interface ApplicationStartedProps extends BaseProperties {
  scholarship_id: string;
  provider_id?: string;
}

export interface ApplicationSubmittedProps extends BaseProperties {
  scholarship_id: string;
  provider_id?: string;
  time_to_submit_seconds?: number;
}

export interface CreditPurchasedProps extends BaseProperties {
  product_sku: string;
  amount: number; // in cents
  currency: string; // ISO 4217 code
  payment_method?: string;
}

export interface EmailOptInProps extends BaseProperties {
  email_type: 'marketing' | 'alerts' | 'weekly_digest';
}

export interface OnboardingChecklistCompletedProps extends BaseProperties {
  steps_completed: number;
  time_to_complete_seconds?: number;
}

/**
 * Track analytics event
 * 
 * NOTE: Replace this with actual PostHog initialization when ready
 * For now, this is a stub that logs to console in development
 */
export function trackEvent<T extends BaseProperties>(
  eventName: string,
  properties: T
): void {
  if (typeof window === 'undefined') return;
  
  const enrichedProperties = {
    ...properties,
    user_id: properties.user_id || window.localStorage.getItem('posthog_user_id'),
    session_id: properties.session_id || window.sessionStorage.getItem('posthog_session_id'),
    release_version: import.meta.env.VITE_BUILD_SHA || 'dev-local',
    timestamp: new Date().toISOString(),
  };
  
  // Development: log to console
  if (import.meta.env.DEV) {
    console.log(`[Analytics] ${eventName}`, enrichedProperties);
  }
  
  // TODO: Initialize PostHog and replace this with actual tracking
  // Example:
  // if (window.posthog) {
  //   window.posthog.capture(eventName, enrichedProperties);
  // }
}

// Convenience functions for common events

export const analytics = {
  signupStarted: (props: Omit<SignupStartedProps, keyof BaseProperties>) =>
    trackEvent('signup_started', props as SignupStartedProps),
  
  signupCompleted: (props: Omit<SignupCompletedProps, keyof BaseProperties>) =>
    trackEvent('signup_completed', props as SignupCompletedProps),
  
  profileStarted: (props: Omit<ProfileStartedProps, keyof BaseProperties>) =>
    trackEvent('profile_started', props as ProfileStartedProps),
  
  profileCompleted: (props: Omit<ProfileCompletedProps, keyof BaseProperties>) =>
    trackEvent('profile_completed', props as ProfileCompletedProps),
  
  scholarshipsMatched: (props: Omit<ScholarshipsMatchedProps, keyof BaseProperties>) =>
    trackEvent('scholarships_matched', props as ScholarshipsMatchedProps),
  
  matchesViewed: (props: Omit<MatchesViewedProps, keyof BaseProperties>) =>
    trackEvent('matches_viewed', props as MatchesViewedProps),
  
  scholarshipViewed: (props: Omit<ScholarshipViewedProps, keyof BaseProperties>) =>
    trackEvent('scholarship_viewed', props as ScholarshipViewedProps),
  
  scholarshipSaved: (props: Omit<ScholarshipSavedProps, keyof BaseProperties>) =>
    trackEvent('scholarship_saved', props as ScholarshipSavedProps),
  
  applicationStarted: (props: Omit<ApplicationStartedProps, keyof BaseProperties>) =>
    trackEvent('application_started', props as ApplicationStartedProps),
  
  applicationSubmitted: (props: Omit<ApplicationSubmittedProps, keyof BaseProperties>) =>
    trackEvent('application_submitted', props as ApplicationSubmittedProps),
  
  creditPurchased: (props: Omit<CreditPurchasedProps, keyof BaseProperties>) =>
    trackEvent('credit_purchased', props as CreditPurchasedProps),
  
  emailOptIn: (props: Omit<EmailOptInProps, keyof BaseProperties>) =>
    trackEvent('email_opt_in', props as EmailOptInProps),
  
  onboardingChecklistCompleted: (props: Omit<OnboardingChecklistCompletedProps, keyof BaseProperties>) =>
    trackEvent('onboarding_checklist_completed', props as OnboardingChecklistCompletedProps),
};

/**
 * Initialize PostHog (stub - to be implemented)
 * 
 * Configuration:
 * - First-party proxy path: /ingest
 * - Server-side relay for conversion events
 * - Privacy-friendly: respect DNT, no cross-site tracking
 */
export function initializeAnalytics() {
  if (typeof window === 'undefined') return;
  
  // TODO: Add PostHog initialization
  // Example:
  // posthog.init('YOUR_PROJECT_API_KEY', {
  //   api_host: window.location.origin + '/ingest',
  //   autocapture: false, // Manual tracking only
  //   capture_pageview: true,
  //   persistence: 'localStorage',
  //   sanitize_properties: (properties) => {
  //     // Remove sensitive PII
  //     const { email, phone, ssn, ...safe } = properties;
  //     return safe;
  //   }
  // });
  
  console.log('[Analytics] PostHog initialization stub - ready for configuration');
}
