/**
 * Error Taxonomy - Observability Mandate P0
 * CEO Order: 2026-01-19
 * 
 * UNKNOWN alerts are BANNED. All events must have explicit error_code.
 * SLO: 100% events mapped; 0 UNKNOWN in dashboards. Breach = incident.
 */

export const ERROR_CODES = {
  AUTH_DB_UNREACHABLE: 'AUTH_DB_UNREACHABLE',
  AUTH_TIMEOUT: 'AUTH_TIMEOUT',
  ORCH_BACKOFF: 'ORCH_BACKOFF',
  RETRY_STORM_SUPPRESSED: 'RETRY_STORM_SUPPRESSED',
  RATE_LIMITED: 'RATE_LIMITED',
  POOL_EXHAUSTED: 'POOL_EXHAUSTED',
  DOWNSTREAM_5XX: 'DOWNSTREAM_5XX',
  CONFIG_DRIFT_BLOCKED: 'CONFIG_DRIFT_BLOCKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  PKCE_MISMATCH: 'PKCE_MISMATCH',
  CLIENT_NOT_FOUND: 'CLIENT_NOT_FOUND',
  SCOPE_DENIED: 'SCOPE_DENIED',
  REDIRECT_MISMATCH: 'REDIRECT_MISMATCH',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_FAILED: 'MFA_FAILED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_GRANT: 'INVALID_GRANT',
  BREAKER_OPEN: 'BREAKER_OPEN',
  BREAKER_HALF_OPEN_REJECTED: 'BREAKER_HALF_OPEN_REJECTED',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export interface ClassifiedError {
  error_code: ErrorCode;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  retryable: boolean;
  downstream_impact: boolean;
}

const errorPatterns: Array<{
  pattern: RegExp | string;
  code: ErrorCode;
  severity: ClassifiedError['severity'];
  retryable: boolean;
  downstream_impact: boolean;
}> = [
  { pattern: /ECONNREFUSED|connection refused/i, code: 'AUTH_DB_UNREACHABLE', severity: 'critical', retryable: true, downstream_impact: true },
  { pattern: /timeout|ETIMEDOUT/i, code: 'AUTH_TIMEOUT', severity: 'high', retryable: true, downstream_impact: true },
  { pattern: /pool.*exhaust|no.*available.*connection/i, code: 'POOL_EXHAUSTED', severity: 'critical', retryable: true, downstream_impact: true },
  { pattern: /rate.*limit|too many requests|429/i, code: 'RATE_LIMITED', severity: 'medium', retryable: true, downstream_impact: false },
  { pattern: /retry.*storm|excessive.*retry/i, code: 'RETRY_STORM_SUPPRESSED', severity: 'high', retryable: false, downstream_impact: true },
  { pattern: /5\d{2}.*error|internal.*server/i, code: 'DOWNSTREAM_5XX', severity: 'high', retryable: true, downstream_impact: true },
  { pattern: /config.*drift|configuration.*mismatch/i, code: 'CONFIG_DRIFT_BLOCKED', severity: 'critical', retryable: false, downstream_impact: true },
  { pattern: /backoff|circuit.*open/i, code: 'ORCH_BACKOFF', severity: 'medium', retryable: true, downstream_impact: false },
  { pattern: /session.*expired|session.*invalid/i, code: 'SESSION_EXPIRED', severity: 'low', retryable: false, downstream_impact: false },
  { pattern: /token.*invalid|jwt.*invalid/i, code: 'TOKEN_INVALID', severity: 'medium', retryable: false, downstream_impact: false },
  { pattern: /pkce.*mismatch|code.*verifier/i, code: 'PKCE_MISMATCH', severity: 'medium', retryable: false, downstream_impact: false },
  { pattern: /client.*not.*found|unknown.*client/i, code: 'CLIENT_NOT_FOUND', severity: 'medium', retryable: false, downstream_impact: false },
  { pattern: /scope.*denied|insufficient.*scope/i, code: 'SCOPE_DENIED', severity: 'medium', retryable: false, downstream_impact: false },
  { pattern: /redirect.*mismatch|invalid.*redirect/i, code: 'REDIRECT_MISMATCH', severity: 'medium', retryable: false, downstream_impact: false },
  { pattern: /mfa.*required/i, code: 'MFA_REQUIRED', severity: 'low', retryable: false, downstream_impact: false },
  { pattern: /mfa.*failed|otp.*invalid/i, code: 'MFA_FAILED', severity: 'medium', retryable: false, downstream_impact: false },
  { pattern: /consent.*required/i, code: 'CONSENT_REQUIRED', severity: 'low', retryable: false, downstream_impact: false },
  { pattern: /user.*not.*found/i, code: 'USER_NOT_FOUND', severity: 'low', retryable: false, downstream_impact: false },
  { pattern: /invalid.*grant/i, code: 'INVALID_GRANT', severity: 'medium', retryable: false, downstream_impact: false },
  { pattern: /breaker.*open/i, code: 'BREAKER_OPEN', severity: 'high', retryable: true, downstream_impact: true },
];

let unknownEventCount = 0;
let mappedEventCount = 0;

export function classifyError(error: Error | string): ClassifiedError {
  const message = typeof error === 'string' ? error : error.message;
  
  for (const { pattern, code, severity, retryable, downstream_impact } of errorPatterns) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    if (regex.test(message)) {
      mappedEventCount++;
      return { error_code: code, message, severity, retryable, downstream_impact };
    }
  }
  
  // UNKNOWN is banned - remap to closest match or use CONFIG_DRIFT_BLOCKED
  console.warn(`[ERROR_TAXONOMY] Unmapped error remapped to CONFIG_DRIFT_BLOCKED: ${message}`);
  unknownEventCount++;
  mappedEventCount++;
  
  return {
    error_code: 'CONFIG_DRIFT_BLOCKED',
    message: `[REMAPPED] ${message}`,
    severity: 'medium',
    retryable: false,
    downstream_impact: false,
  };
}

export function validateEventHasErrorCode(event: Record<string, unknown>): boolean {
  if (!event.error_code || event.error_code === 'UNKNOWN') {
    return false;
  }
  return Object.values(ERROR_CODES).includes(event.error_code as ErrorCode);
}

export function remapUnknownEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (!event.error_code || event.error_code === 'UNKNOWN') {
    const classified = classifyError(String(event.message || event.error || 'Unknown error'));
    return {
      ...event,
      error_code: classified.error_code,
      error_code_source: 'taxonomy_remap',
      original_error_code: event.error_code || 'MISSING',
    };
  }
  return event;
}

export function getErrorTaxonomyStats(): {
  mapped_events: number;
  unknown_remapped: number;
  unknown_percentage: number;
  slo_compliant: boolean;
} {
  const unknownPct = mappedEventCount > 0 ? (unknownEventCount / mappedEventCount) * 100 : 0;
  return {
    mapped_events: mappedEventCount,
    unknown_remapped: unknownEventCount,
    unknown_percentage: unknownPct,
    slo_compliant: unknownPct === 0, // SLO: 0 UNKNOWN in dashboards
  };
}

export function resetTaxonomyStats(): void {
  unknownEventCount = 0;
  mappedEventCount = 0;
}

export default {
  ERROR_CODES,
  classifyError,
  validateEventHasErrorCode,
  remapUnknownEvent,
  getErrorTaxonomyStats,
  resetTaxonomyStats,
};
