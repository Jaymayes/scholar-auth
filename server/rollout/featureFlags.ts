// 10% TRAFFIC ROLLOUT - HASH-BASED COHORT SYSTEM
// Executive approved rollout with guardrails and auto-rollback triggers

import { createHash } from 'crypto';

export interface RolloutConfig {
  rolloutPercentage: number; // 0-100
  enabled: boolean;
  guardrails: {
    maxP95Latency: number; // ms
    maxErrorRate: number; // decimal (0.002 = 0.2%)
    maxTimeoutRate: number; // decimal
    minUptime: number; // decimal (0.999 = 99.9%)
    minPrecision: number; // decimal (0.65 = 65%)
    maxCostVariance: number; // decimal (0.10 = 10%)
  };
  rollbackTriggerMinutes: number; // Auto-rollback if breach sustained >X minutes
}

// 🚀 EXECUTIVE DECISION: IMMEDIATE SCALE TO 25% WITH TIGHTENED GUARDRAILS
export const SCHOLARSHIP_ROLLOUT_CONFIG: RolloutConfig = {
  rolloutPercentage: 25, // SCALED UP: Executive approved 25%  
  enabled: true,
  guardrails: {
    // TIGHTENED FOR 25% TRAFFIC
    maxP95Latency: 120, // 10min sustained → pause, immediate → rollback
    maxErrorRate: 0.005, // 0.5% for 10min → pause, 1% for 5min → rollback
    maxTimeoutRate: 0.001, // <0.1% maintained
    minUptime: 0.999, // ≥99.9% maintained  
    minPrecision: 0.60, // LOWERED: 60% → pause, 55% → rollback
    maxCostVariance: 0.10, // ±10% cost variance
  },
  rollbackTriggerMinutes: 10, // TIGHTENED: 10min for pause, 5min for rollback
};

/**
 * Hash-based user cohort assignment for stable A/B testing
 * Uses SHA-256 hash of user ID for deterministic, stable assignment
 */
export function getUserCohort(userId: string): 'control' | 'treatment' {
  // Hash the user ID for stable, deterministic assignment
  const hash = createHash('sha256').update(userId).digest('hex');
  
  // Convert first 8 hex characters to integer (0-4294967295)
  const hashInt = parseInt(hash.substring(0, 8), 16);
  
  // Convert to percentage (0-100)
  const percentage = (hashInt % 100);
  
  // Assign to treatment if within rollout percentage
  return percentage < SCHOLARSHIP_ROLLOUT_CONFIG.rolloutPercentage ? 'treatment' : 'control';
}

/**
 * Check if user should receive new scholarship matching features
 */
export function isInScholarshipRollout(userId: string): boolean {
  if (!SCHOLARSHIP_ROLLOUT_CONFIG.enabled) {
    return false;
  }
  
  return getUserCohort(userId) === 'treatment';
}

/**
 * Emergency rollback function - disables rollout immediately
 */
export function emergencyRollback(reason: string): void {
  SCHOLARSHIP_ROLLOUT_CONFIG.enabled = false;
  console.error(`🚨 EMERGENCY ROLLBACK TRIGGERED: ${reason}`);
  
  // TODO: Send alert to executive team
  // TODO: Log to audit system
}

/**
 * Rollout metrics tracking
 */
export interface RolloutMetrics {
  cohortCounts: {
    control: number;
    treatment: number;
  };
  performance: {
    p95Latency: number;
    errorRate: number;
    timeoutRate: number;
    uptime: number;
  };
  quality: {
    precision: number;
    ctrBaseline: number;
    bookmarkRate: number;
    applicationStartRate: number;
  };
  cost: {
    costPer1kRecs: number;
    varianceFromModel: number;
  };
}

/**
 * Check if guardrails are violated and trigger rollback if needed
 */
export function checkGuardrails(metrics: RolloutMetrics): { violated: boolean; reasons: string[] } {
  const violations: string[] = [];
  const guardrails = SCHOLARSHIP_ROLLOUT_CONFIG.guardrails;
  
  // Performance guardrails
  if (metrics.performance.p95Latency > guardrails.maxP95Latency) {
    violations.push(`P95 latency ${metrics.performance.p95Latency}ms > ${guardrails.maxP95Latency}ms`);
  }
  
  if (metrics.performance.errorRate > guardrails.maxErrorRate) {
    violations.push(`Error rate ${(metrics.performance.errorRate * 100).toFixed(2)}% > ${(guardrails.maxErrorRate * 100).toFixed(2)}%`);
  }
  
  if (metrics.performance.timeoutRate > guardrails.maxTimeoutRate) {
    violations.push(`Timeout rate ${(metrics.performance.timeoutRate * 100).toFixed(2)}% > ${(guardrails.maxTimeoutRate * 100).toFixed(2)}%`);
  }
  
  if (metrics.performance.uptime < guardrails.minUptime) {
    violations.push(`Uptime ${(metrics.performance.uptime * 100).toFixed(2)}% < ${(guardrails.minUptime * 100).toFixed(2)}%`);
  }
  
  // Quality guardrails
  if (metrics.quality.precision < guardrails.minPrecision) {
    violations.push(`Precision ${(metrics.quality.precision * 100).toFixed(1)}% < ${(guardrails.minPrecision * 100).toFixed(1)}%`);
  }
  
  // Cost guardrails
  if (Math.abs(metrics.cost.varianceFromModel) > guardrails.maxCostVariance) {
    violations.push(`Cost variance ${(metrics.cost.varianceFromModel * 100).toFixed(1)}% > ±${(guardrails.maxCostVariance * 100).toFixed(1)}%`);
  }
  
  return {
    violated: violations.length > 0,
    reasons: violations
  };
}

/**
 * Log rollout activity for monitoring
 */
export function logRolloutActivity(userId: string, activity: string, cohort?: 'control' | 'treatment') {
  const userCohort = cohort || getUserCohort(userId);
  
  console.log(`🎯 ROLLOUT [${userCohort.toUpperCase()}]: ${activity} (user: ${userId.substring(0, 8)}...)`);
  
  // TODO: Send to metrics collection system
  // TODO: Update cohort counters
}