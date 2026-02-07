/**
 * Feature Flags Configuration
 * Phase 2 Implementation: Centralized feature flag management for safe rollouts
 * All Issues A-D are gated behind feature flags for instant rollback capability
 */

interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  rolloutPercent: number;
  createdAt: string;
  issue: 'A' | 'B' | 'C' | 'D' | null;
}

interface FeatureFlagsConfig {
  [key: string]: FeatureFlag;
}

const parseEnvBoolean = (envVar: string | undefined, defaultValue: boolean): boolean => {
  if (envVar === undefined) return defaultValue;
  return envVar.toLowerCase() === 'true' || envVar === '1';
};

const parseEnvNumber = (envVar: string | undefined, defaultValue: number): number => {
  if (envVar === undefined) return defaultValue;
  const parsed = parseInt(envVar, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

/**
 * Feature Flags Registry
 * All new features are gated behind flags for safe deployment
 */
export const featureFlags: FeatureFlagsConfig = {
  // Issue A: Enhanced /ready endpoint with upstream dependency checks
  READY_ENDPOINT_V2: {
    name: 'READY_ENDPOINT_V2',
    enabled: parseEnvBoolean(process.env.FF_READY_ENDPOINT_V2, false),
    description: 'Enhanced /ready endpoint with upstream dependency validation (DB, queues, upstreams)',
    rolloutPercent: parseEnvNumber(process.env.FF_READY_ENDPOINT_V2_ROLLOUT, 0),
    createdAt: '2026-01-05',
    issue: 'A',
  },

  // Issue B: Async email/third-party processing
  ASYNC_EMAIL_PROCESSING: {
    name: 'ASYNC_EMAIL_PROCESSING',
    enabled: parseEnvBoolean(process.env.FF_ASYNC_EMAIL_PROCESSING, false),
    description: 'Move third-party calls (email, SendGrid) off hot path using 202-Accepted + worker pattern',
    rolloutPercent: parseEnvNumber(process.env.FF_ASYNC_EMAIL_PROCESSING_ROLLOUT, 0),
    createdAt: '2026-01-05',
    issue: 'B',
  },

  // Issue C: Stale banner auto-clear
  BANNER_AUTO_CLEAR: {
    name: 'BANNER_AUTO_CLEAR',
    enabled: parseEnvBoolean(process.env.FF_BANNER_AUTO_CLEAR, false),
    description: 'Auto-clear incident banners after 10 minutes of green health status',
    rolloutPercent: parseEnvNumber(process.env.FF_BANNER_AUTO_CLEAR_ROLLOUT, 0),
    createdAt: '2026-01-05',
    issue: 'C',
  },

  // Issue D: Demo mode for analytics
  DEMO_MODE_ANALYTICS: {
    name: 'DEMO_MODE_ANALYTICS',
    enabled: parseEnvBoolean(process.env.FF_DEMO_MODE_ANALYTICS, false),
    description: 'Demo Mode toggle to render simulated revenue with namespace filtering',
    rolloutPercent: parseEnvNumber(process.env.FF_DEMO_MODE_ANALYTICS_ROLLOUT, 0),
    createdAt: '2026-01-05',
    issue: 'D',
  },

  // Cross-cutting: Enhanced monitoring with noise reduction
  MONITORING_V2: {
    name: 'MONITORING_V2',
    enabled: parseEnvBoolean(process.env.FF_MONITORING_V2, true),
    description: 'Enhanced monitoring with deduplication and threshold tuning per monitoring_rule_pr.md',
    rolloutPercent: 100,
    createdAt: '2026-01-05',
    issue: null,
  },

  // A3→A6 Circuit Breaker (CEO Directive Jan 15, 2026)
  A6_CIRCUIT_BREAKER: {
    name: 'A6_CIRCUIT_BREAKER',
    enabled: parseEnvBoolean(process.env.FF_A6_CIRCUIT_BREAKER, true),
    description: 'Circuit breaker for A3→A6 provider calls with backlog queue and exponential retry',
    rolloutPercent: 100,
    createdAt: '2026-01-15',
    issue: null,
  },

  // B2C Pilot Controls (CEO Executive Order SAA-EO-2026-01-19-01)
  B2C_CAPTURE: {
    name: 'B2C_CAPTURE',
    enabled: parseEnvBoolean(process.env.FF_B2C_CAPTURE, true),
    description: 'B2C payment capture mode: pilot_only, enabled, disabled',
    rolloutPercent: parseEnvNumber(process.env.FF_B2C_CAPTURE_ROLLOUT, 2),
    createdAt: '2026-01-19',
    issue: null,
  },

  TRAFFIC_CAP_B2C_PILOT: {
    name: 'TRAFFIC_CAP_B2C_PILOT',
    enabled: true,
    description: 'Traffic cap for B2C pilot: 2% of eligible users',
    rolloutPercent: 2,
    createdAt: '2026-01-19',
    issue: null,
  },

  MICROCHARGE_REFUND: {
    name: 'MICROCHARGE_REFUND',
    enabled: parseEnvBoolean(process.env.FF_MICROCHARGE_REFUND, true),
    description: '$0.50 microcharge with automatic immediate refund',
    rolloutPercent: 100,
    createdAt: '2026-01-19',
    issue: null,
  },

  SAFETY_LOCK: {
    name: 'SAFETY_LOCK',
    enabled: parseEnvBoolean(process.env.FF_SAFETY_LOCK, true),
    description: 'Safety lock for B2C capture - requires CEO override to disable',
    rolloutPercent: 100,
    createdAt: '2026-01-19',
    issue: null,
  },

  // B2B Fee Capture (CEO Executive Order SAA-EO-2026-01-19-01)
  B2B_FEE_CAPTURE: {
    name: 'B2B_FEE_CAPTURE',
    enabled: parseEnvBoolean(process.env.FF_B2B_FEE_CAPTURE, true),
    description: '3% platform fee capture on AwardDisbursed events',
    rolloutPercent: 100,
    createdAt: '2026-01-19',
    issue: null,
  },

  // Golden Path Enforcement (CEO Executive Order SAA-EO-2026-01-19-01)
  GOLDEN_PATH_ENFORCEMENT: {
    name: 'GOLDEN_PATH_ENFORCEMENT',
    enabled: parseEnvBoolean(process.env.FF_GOLDEN_PATH_ENFORCEMENT, true),
    description: 'DaaS hard rule: No local state in A5/A7, all reads/writes via Core API',
    rolloutPercent: 100,
    createdAt: '2026-01-19',
    issue: null,
  },

  // Drift Sentinel (CEO Executive Order SAA-EO-2026-01-19-01)
  DRIFT_SENTINEL: {
    name: 'DRIFT_SENTINEL',
    enabled: parseEnvBoolean(process.env.FF_DRIFT_SENTINEL, true),
    description: 'A8 Watchtower manifest/build digest tracking and auto-block on mismatch',
    rolloutPercent: 100,
    createdAt: '2026-01-19',
    issue: null,
  },
};

/**
 * Check if a feature flag is enabled
 * Supports percentage-based rollout using user/request ID hash
 * DETERMINISTIC: Always returns same result for same inputs
 */
export function isFeatureEnabled(flagName: string, rolloutId?: string | number): boolean {
  // Re-evaluate from environment for runtime toggles
  const flag = getFeatureFlagState(flagName);
  if (!flag) return false;
  if (!flag.enabled) return false;
  
  // If rollout is 100%, always enabled
  if (flag.rolloutPercent >= 100) return true;
  
  // If rollout is 0%, always disabled
  if (flag.rolloutPercent <= 0) return false;
  
  // Percentage-based rollout REQUIRES a rolloutId for deterministic bucketing
  if (rolloutId === undefined) {
    // Without rolloutId, use server instance ID for consistent behavior within a deployment
    const instanceId = process.env.REPL_ID || process.env.HOSTNAME || 'default-instance';
    const instanceHash = hashString(`${flagName}:${instanceId}`);
    return (instanceHash % 100) < flag.rolloutPercent;
  }
  
  // Deterministic rollout using provided ID
  const hash = typeof rolloutId === 'string' 
    ? hashString(`${flagName}:${rolloutId}`) 
    : rolloutId;
  return (Math.abs(hash) % 100) < flag.rolloutPercent;
}

/**
 * Get current flag state (re-reads from environment for runtime toggles)
 */
function getFeatureFlagState(flagName: string): FeatureFlag | null {
  const baseFlagDef = featureFlags[flagName];
  if (!baseFlagDef) return null;
  
  // Re-read from environment to support runtime toggles
  const envEnabled = process.env[`FF_${flagName}`];
  const envRollout = process.env[`FF_${flagName}_ROLLOUT`];
  
  return {
    ...baseFlagDef,
    enabled: envEnabled !== undefined ? parseEnvBoolean(envEnabled, baseFlagDef.enabled) : baseFlagDef.enabled,
    rolloutPercent: envRollout !== undefined ? parseEnvNumber(envRollout, baseFlagDef.rolloutPercent) : baseFlagDef.rolloutPercent,
  };
}

/**
 * Simple string hash for consistent rollout bucketing
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Get all feature flags status for monitoring/debugging
 */
export function getAllFeatureFlags(): Record<string, { enabled: boolean; rolloutPercent: number }> {
  const status: Record<string, { enabled: boolean; rolloutPercent: number }> = {};
  for (const [key, flag] of Object.entries(featureFlags)) {
    status[key] = {
      enabled: flag.enabled,
      rolloutPercent: flag.rolloutPercent,
    };
  }
  return status;
}

/**
 * Get feature flags by issue
 */
export function getFeatureFlagsByIssue(issue: 'A' | 'B' | 'C' | 'D'): FeatureFlag[] {
  return Object.values(featureFlags).filter(flag => flag.issue === issue);
}

export default featureFlags;
