// 🚨 ENHANCED GUARDRAILS FOR 25% TRAFFIC - Executive Approved
// Tightened thresholds with multi-tier pause/rollback logic

export interface EnhancedGuardrails {
  // Reliability (TIGHTENED)
  reliability: {
    p95LatencyPauseThresholdMs: 120; // 10 consecutive minutes → pause
    p95LatencyRollbackThresholdMs: 120; // >120ms for 5 minutes → rollback to 10%
    errorRatePauseThreshold: 0.005; // 0.5% for 10 minutes → pause
    errorRateRollbackThreshold: 0.01; // 1% for 5 minutes → rollback
    pauseDurationMinutes: 10;
    rollbackDurationMinutes: 5;
  };
  
  // Quality (TIGHTENED)  
  quality: {
    csatPauseFloor: 4.6; // Below 4.6/5 for 60 minutes → pause
    csatRollbackFloor: 4.3; // Below 4.3/5 → rollback
    precisionPauseFloor: 0.60; // 60% → pause (was 65%)
    precisionRollbackFloor: 0.55; // 55% → rollback
    recallPauseFloor: 0.35; // 35% → pause
    qualityWindowMinutes: 60;
  };
  
  // Economics (TIGHTENED)
  economics: {
    costPerUserPauseThreshold: 0.035; // $0.035/user for 60min → pause
    costPerUserRollbackThreshold: 0.04; // $0.04/user → rollback
    arpuUpliftPauseThreshold: 0.02; // +2% for 24h → pause (vs +3% target)
    arpuUpliftRollbackThreshold: -0.01; // Negative for 12h → rollback
    economicsWindowMinutes: 60;
    arpuWindowHours: 24;
  };
  
  // Fairness (MAINTAINED)
  fairness: {
    parityRangePauseMin: 0.85; // Outside 0.85-1.15 for 60min → pause
    parityRangePauseMax: 1.15;
    parityRangeRollbackMin: 0.80; // Outside 0.80-1.20 for 15min → rollback
    parityRangeRollbackMax: 1.20;
    fairnessWindowMinutes: 60;
    rollbackWindowMinutes: 15;
  };
  
  // Sample size minimums for 50% decision
  sampleSizes: {
    minUsersPerCohort: 5000;
    minCompletedApplications: 500; 
    minCSATResponses: 200;
  };
}

// EXECUTIVE-APPROVED ENHANCED THRESHOLDS
export const ENHANCED_GUARDRAILS_25_PERCENT: EnhancedGuardrails = {
  reliability: {
    p95LatencyPauseThresholdMs: 120,
    p95LatencyRollbackThresholdMs: 120,
    errorRatePauseThreshold: 0.005, // 0.5%
    errorRateRollbackThreshold: 0.01, // 1%
    pauseDurationMinutes: 10,
    rollbackDurationMinutes: 5
  },
  quality: {
    csatPauseFloor: 4.6,
    csatRollbackFloor: 4.3,
    precisionPauseFloor: 0.60,
    precisionRollbackFloor: 0.55,
    recallPauseFloor: 0.35,
    qualityWindowMinutes: 60
  },
  economics: {
    costPerUserPauseThreshold: 0.035,
    costPerUserRollbackThreshold: 0.04,
    arpuUpliftPauseThreshold: 0.02,
    arpuUpliftRollbackThreshold: -0.01,
    economicsWindowMinutes: 60,
    arpuWindowHours: 24
  },
  fairness: {
    parityRangePauseMin: 0.85,
    parityRangePauseMax: 1.15,
    parityRangeRollbackMin: 0.80,
    parityRangeRollbackMax: 1.20,
    fairnessWindowMinutes: 60,
    rollbackWindowMinutes: 15
  },
  sampleSizes: {
    minUsersPerCohort: 5000,
    minCompletedApplications: 500,
    minCSATResponses: 200
  }
};

/**
 * Enhanced guardrail checker with pause/rollback logic
 */
export function checkEnhancedGuardrails25Percent(
  metrics: any, 
  executiveMetrics: any,
  violationHistory: any[]
): {
  action: 'CONTINUE' | 'PAUSE' | 'ROLLBACK';
  violations: string[];
  reasons: string[];
} {
  const violations: string[] = [];
  const guardrails = ENHANCED_GUARDRAILS_25_PERCENT;

  // Reliability checks
  if (metrics.performance.p95Latency > guardrails.reliability.p95LatencyPauseThresholdMs) {
    violations.push(`P95 latency ${metrics.performance.p95Latency}ms > ${guardrails.reliability.p95LatencyPauseThresholdMs}ms`);
  }

  if (metrics.performance.errorRate > guardrails.reliability.errorRatePauseThreshold) {
    violations.push(`Error rate ${(metrics.performance.errorRate * 100).toFixed(2)}% > ${(guardrails.reliability.errorRatePauseThreshold * 100).toFixed(1)}%`);
  }

  // Quality checks  
  if (executiveMetrics.postMatchCSAT < guardrails.quality.csatPauseFloor) {
    violations.push(`CSAT ${executiveMetrics.postMatchCSAT}/5 < ${guardrails.quality.csatPauseFloor}/5 floor`);
  }

  if (metrics.quality.precision < guardrails.quality.precisionPauseFloor) {
    violations.push(`Precision ${(metrics.quality.precision * 100).toFixed(1)}% < ${(guardrails.quality.precisionPauseFloor * 100).toFixed(0)}%`);
  }

  // Economics checks
  if (executiveMetrics.costPerTreatedUser > guardrails.economics.costPerUserPauseThreshold) {
    violations.push(`Cost/user $${executiveMetrics.costPerTreatedUser.toFixed(3)} > $${guardrails.economics.costPerUserPauseThreshold.toFixed(3)}`);
  }

  // Fairness checks
  const fairnessViolations = Object.entries(executiveMetrics.fairnessParityRatios || {}).filter(
    ([segment, ratio]: [string, any]) => 
      ratio < guardrails.fairness.parityRangePauseMin || ratio > guardrails.fairness.parityRangePauseMax
  );

  fairnessViolations.forEach(([segment, ratio]) => {
    violations.push(`Fairness ${segment} ratio ${(ratio as number).toFixed(2)} outside ${guardrails.fairness.parityRangePauseMin}-${guardrails.fairness.parityRangePauseMax}`);
  });

  // Determine action based on violation severity and duration
  let action: 'CONTINUE' | 'PAUSE' | 'ROLLBACK' = 'CONTINUE';
  
  if (violations.length > 0) {
    // Check for immediate rollback conditions
    const immediateRollback = 
      metrics.performance.errorRate > guardrails.reliability.errorRateRollbackThreshold ||
      executiveMetrics.postMatchCSAT < guardrails.quality.csatRollbackFloor ||
      metrics.quality.precision < guardrails.quality.precisionRollbackFloor ||
      executiveMetrics.costPerTreatedUser > guardrails.economics.costPerUserRollbackThreshold;

    action = immediateRollback ? 'ROLLBACK' : 'PAUSE';
  }

  return {
    action,
    violations,
    reasons: violations
  };
}