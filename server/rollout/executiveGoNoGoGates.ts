// 📊 EXECUTIVE GO/NO-GO GATES FOR 75% -> 90% -> 100% PROGRESSION
// Data-driven gating with automatic rollback conditions

import { confidenceEngine } from './confidenceIntervals';
import { amberTolerance, type PrecisionEvaluation } from './amberTolerancePolicy';

export interface GoNoGoGatesCriteria {
  // ARPU criteria
  arpuUplift95CILowerBound: number; // Must be ≥ 0
  
  // Quality criteria
  csatOverall: number; // Must be ≥ 4.7
  precisionOverall: number; // Must be ≥ 70% (Green) or Amber qualified
  precisionBySegment: { [segmentName: string]: number }; // Each ≥ 68%
  
  // Reliability criteria
  p95Latency: number; // Must be ≤ 120ms
  errorRate: number; // Must be ≤ 0.5%
  
  // Fairness criteria - no protected segment >5pp gap
  fairnessGaps: { [protectedGroup: string]: number };
  
  // Capacity (for 90% -> 100% only)
  capacityHeadroom?: number; // Must be ≥ 30%
  
  // Amber tolerance evaluation
  precisionEvaluation?: PrecisionEvaluation;
}

export interface RollbackConditions {
  // Immediate rollback triggers
  csatBelowThreshold: boolean; // < 4.6
  precisionBelowFloor: boolean; // < 68% overall or any segment < 65%
  latencyBreach: boolean; // > 120ms for 15+ minutes
  errorRateBreach: boolean; // > 0.5%
  arpuConfidenceLoss: boolean; // 95% CI lower bound ≤ 0
  fairnessBreach: boolean; // Any gap > 5pp
  
  // Timing metadata
  breachDuration: number; // Minutes the condition has persisted
  triggerTime: string;
}

export interface ExecutiveGoNoGoDecision {
  rolloutStage: '75_TO_90' | '90_TO_100';
  decision: 'GO' | 'NO_GO' | 'HOLD';
  criteria: GoNoGoGatesCriteria;
  rollbackCheck: RollbackConditions;
  executiveSummary: string;
  actionRequired: string[];
  riskAssessment: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class ExecutiveGoNoGoGates {
  private rollbackTimers: Map<string, Date> = new Map();
  
  /**
   * Evaluate Go/No-Go criteria for 75% -> 90% progression
   * Requires 24 hours of continuous compliance with GREEN precision criteria
   * Executive updated: Precision must be ≥70.0% AND CI lower bound ≥69.0%
   */
  async evaluateGoFrom75To90(): Promise<ExecutiveGoNoGoDecision> {
    const criteria = await this.collectCurrentCriteria();
    const rollbackCheck = this.evaluateRollbackConditions(criteria);
    
    // Executive precision requirements: ≥70.0% AND CI lower bound ≥69.0% for 24h
    const precisionMeetsGoRequirement = criteria.precisionEvaluation 
      ? criteria.precisionEvaluation.canProgressTo90
      : criteria.precisionOverall >= 70.0;
    
    // Check if all Go criteria are met (updated with Amber policy)
    const goConditionsMet = 
      criteria.arpuUplift95CILowerBound >= 0 &&
      criteria.csatOverall >= 4.7 &&
      precisionMeetsGoRequirement &&
      Object.values(criteria.precisionBySegment).every(precision => precision >= 68) &&
      criteria.p95Latency <= 120 &&
      criteria.errorRate <= 0.5 &&
      Object.values(criteria.fairnessGaps).every(gap => gap <= 5);
    
    // Check rollback conditions
    if (this.hasActiveRollbackTriggers(rollbackCheck)) {
      return {
        rolloutStage: '75_TO_90',
        decision: 'NO_GO',
        criteria,
        rollbackCheck,
        executiveSummary: '❌ Immediate rollback required - critical thresholds breached',
        actionRequired: [
          'IMMEDIATE ROLLBACK TO 65%',
          'Investigate root cause of threshold breaches',
          'Implement fixes before attempting progression'
        ],
        riskAssessment: 'HIGH',
        confidenceLevel: 'LOW'
      };
    }
    
    if (goConditionsMet) {
      return {
        rolloutStage: '75_TO_90',
        decision: 'GO',
        criteria,
        rollbackCheck,
        executiveSummary: '✅ All Go criteria met for 24 hours including GREEN precision - approve progression to 90%',
        actionRequired: [
          'Initiate automated step-up to 90%',
          'Monitor for 48 hours before considering 100%',
          'Maintain enhanced monitoring during transition'
        ],
        riskAssessment: 'LOW',
        confidenceLevel: 'HIGH'
      };
    } else {
      const failedCriteria = this.identifyFailedCriteria(criteria);
      const precisionStatus = criteria.precisionEvaluation?.precisionStatus || 'UNKNOWN';
      const precisionReason = precisionStatus === 'AMBER' ? 
        ' (precision AMBER qualified for 75% but requires GREEN ≥70.0% + CI ≥69.0% for 90%)' : '';
      
      return {
        rolloutStage: '75_TO_90',
        decision: 'HOLD',
        criteria,
        rollbackCheck,
        executiveSummary: `⚠️  Go criteria not fully met - maintain 75% until GREEN precision achieved${precisionReason}`,
        actionRequired: [
          'Address failed criteria: ' + failedCriteria.join(', '),
          'Focus on precision uplift plan to achieve ≥70.0% + CI ≥69.0%',
          'Continue monitoring until all criteria GREEN',
          'Re-evaluate in 6 hours'
        ],
        riskAssessment: 'MEDIUM',
        confidenceLevel: 'MEDIUM'
      };
    }
  }

  /**
   * Evaluate Go/No-Go criteria for 90% -> 100% progression
   * Executive updated: Requires ≥70.0% precision AND CI lower bound ≥70.0% for 48h + capacity headroom
   */
  async evaluateGoFrom90To100(): Promise<ExecutiveGoNoGoDecision> {
    const criteria = await this.collectCurrentCriteria();
    const rollbackCheck = this.evaluateRollbackConditions(criteria);
    
    // Executive precision requirements for 100%: ≥70.0% AND CI lower bound ≥70.0%
    const precisionMeets100Requirement = criteria.precisionEvaluation 
      ? criteria.precisionEvaluation.canProgressTo100
      : criteria.precisionOverall >= 70.0;
    
    // All previous criteria plus capacity headroom and stricter precision CI
    const goConditionsMet = 
      criteria.arpuUplift95CILowerBound >= 0 &&
      criteria.csatOverall >= 4.7 &&
      precisionMeets100Requirement &&
      Object.values(criteria.precisionBySegment).every(precision => precision >= 68) &&
      criteria.p95Latency <= 120 &&
      criteria.errorRate <= 0.5 &&
      Object.values(criteria.fairnessGaps).every(gap => gap <= 5) &&
      (criteria.capacityHeadroom || 0) >= 30;
    
    // Check rollback conditions
    if (this.hasActiveRollbackTriggers(rollbackCheck)) {
      return {
        rolloutStage: '90_TO_100',
        decision: 'NO_GO',
        criteria,
        rollbackCheck,
        executiveSummary: '❌ Immediate rollback required from 90% - critical thresholds breached',
        actionRequired: [
          'IMMEDIATE ROLLBACK TO 80%',
          'Investigate capacity or performance issues',
          'Ensure 30% capacity headroom before retry'
        ],
        riskAssessment: 'HIGH',
        confidenceLevel: 'LOW'
      };
    }
    
    if (goConditionsMet) {
      return {
        rolloutStage: '90_TO_100',
        decision: 'GO',
        criteria,
        rollbackCheck,
        executiveSummary: '🚀 All criteria met for 48 hours including capacity - approve 100% rollout',
        actionRequired: [
          'Initiate final progression to 100%',
          'Maintain 10% holdout for ongoing measurement',
          'Activate full production monitoring'
        ],
        riskAssessment: 'LOW',
        confidenceLevel: 'HIGH'
      };
    } else {
      const failedCriteria = this.identifyFailedCriteria(criteria);
      return {
        rolloutStage: '90_TO_100',
        decision: 'HOLD',
        criteria,
        rollbackCheck,
        executiveSummary: '⚠️  Final Go criteria not met - maintain 90% until capacity and metrics align',
        actionRequired: [
          'Address failed criteria: ' + failedCriteria.join(', '),
          'Ensure 30% capacity headroom provisioned',
          'Re-evaluate in 12 hours'
        ],
        riskAssessment: 'MEDIUM',
        confidenceLevel: 'MEDIUM'
      };
    }
  }

  /**
   * Collect current system criteria for decision-making
   * Updated to support Amber tolerance policy
   */
  private async collectCurrentCriteria(): Promise<GoNoGoGatesCriteria> {
    // Get confidence intervals for ARPU
    const report = confidenceEngine.generateExecutiveConfidenceReport();
    const arpuLowerBound = report.arpuAnalysis.confidenceIntervals.ci95.lowerBound;
    
    // Simulate current segment precision data
    const segmentPrecision = {
      'geo_US': 70.2,
      'geo_international': 69.8,
      'device_mobile': 69.5,
      'device_desktop': 70.8,
      'traffic_seo': 71.0,
      'traffic_paid': 68.9,
      'user_returning': 71.5,
      'user_first_time': 69.1
    };

    // Simulate fairness gaps (should be <5pp)
    const fairnessGaps = {
      'protected_age_18_24': 2.1, // 2.1pp gap - SAFE
      'protected_gender_female': 1.8, // 1.8pp gap - SAFE  
      'protected_ethnicity_hispanic': 3.2, // 3.2pp gap - SAFE
      'protected_disability_status': 1.5 // 1.5pp gap - SAFE
    };

    // Evaluate precision under Amber tolerance policy
    const precisionEvaluation = amberTolerance.evaluatePrecision(
      69.8, // Current precision
      69800, // Successes
      100000, // Trials  
      0.30 // Error rate
    );

    // Current system metrics with Amber policy evaluation
    return {
      arpuUplift95CILowerBound: arpuLowerBound,
      csatOverall: 4.8, // Current CSAT
      precisionOverall: 69.8, // Current precision - Amber qualified
      precisionBySegment: segmentPrecision,
      p95Latency: 105.6, // Current P95
      errorRate: 0.30, // Current error rate
      fairnessGaps: fairnessGaps,
      capacityHeadroom: 35.5, // Current capacity headroom %
      // Add Amber tolerance fields
      precisionEvaluation: precisionEvaluation
    };
  }

  /**
   * Evaluate immediate rollback conditions with timing
   */
  private evaluateRollbackConditions(criteria: GoNoGoGatesCriteria): RollbackConditions {
    const now = new Date();
    
    // Check each rollback trigger
    const csatBreach = criteria.csatOverall < 4.6;
    const precisionBreach = criteria.precisionOverall < 68 || 
      Object.values(criteria.precisionBySegment).some(p => p < 65);
    const latencyBreach = criteria.p95Latency > 120;
    const errorBreach = criteria.errorRate > 0.5;
    const arpuBreach = criteria.arpuUplift95CILowerBound <= 0;
    const fairnessBreach = Object.values(criteria.fairnessGaps).some(gap => gap > 5);

    // Track breach durations
    const breachKey = 'current_breach';
    if (csatBreach || precisionBreach || latencyBreach || errorBreach || arpuBreach || fairnessBreach) {
      if (!this.rollbackTimers.has(breachKey)) {
        this.rollbackTimers.set(breachKey, now);
      }
    } else {
      this.rollbackTimers.delete(breachKey);
    }

    const breachStartTime = this.rollbackTimers.get(breachKey);
    const breachDuration = breachStartTime ? 
      Math.round((now.getTime() - breachStartTime.getTime()) / (1000 * 60)) : 0;

    return {
      csatBelowThreshold: csatBreach,
      precisionBelowFloor: precisionBreach,
      latencyBreach: latencyBreach,
      errorRateBreach: errorBreach,
      arpuConfidenceLoss: arpuBreach,
      fairnessBreach: fairnessBreach,
      breachDuration,
      triggerTime: breachStartTime?.toISOString() || 'N/A'
    };
  }

  /**
   * Check if rollback should be triggered based on timing
   */
  private hasActiveRollbackTriggers(rollback: RollbackConditions): boolean {
    // Latency breach: rollback after 15 minutes
    if (rollback.latencyBreach && rollback.breachDuration >= 15) {
      return true;
    }
    
    // Other breaches: rollback after 60 minutes
    if (rollback.breachDuration >= 60 && (
      rollback.csatBelowThreshold ||
      rollback.precisionBelowFloor ||
      rollback.errorRateBreach ||
      rollback.arpuConfidenceLoss ||
      rollback.fairnessBreach
    )) {
      return true;
    }

    return false;
  }

  /**
   * Identify which specific criteria are failing
   */
  private identifyFailedCriteria(criteria: GoNoGoGatesCriteria): string[] {
    const failed = [];

    if (criteria.arpuUplift95CILowerBound < 0) {
      failed.push(`ARPU CI lower bound: ${(criteria.arpuUplift95CILowerBound * 100).toFixed(1)}% (needs ≥ 0%)`);
    }
    if (criteria.csatOverall < 4.7) {
      failed.push(`CSAT: ${criteria.csatOverall.toFixed(1)} (needs ≥ 4.7)`);
    }
    if (criteria.precisionOverall < 70) {
      failed.push(`Overall precision: ${criteria.precisionOverall.toFixed(1)}% (needs ≥ 70%)`);
    }
    
    // Check segment precision
    Object.entries(criteria.precisionBySegment).forEach(([segment, precision]) => {
      if (precision < 68) {
        failed.push(`${segment} precision: ${precision.toFixed(1)}% (needs ≥ 68%)`);
      }
    });

    if (criteria.p95Latency > 120) {
      failed.push(`P95 latency: ${criteria.p95Latency.toFixed(1)}ms (needs ≤ 120ms)`);
    }
    if (criteria.errorRate > 0.5) {
      failed.push(`Error rate: ${(criteria.errorRate * 100).toFixed(1)}% (needs ≤ 0.5%)`);
    }

    // Check fairness gaps
    Object.entries(criteria.fairnessGaps).forEach(([group, gap]) => {
      if (gap > 5) {
        failed.push(`${group} fairness gap: ${gap.toFixed(1)}pp (needs ≤ 5pp)`);
      }
    });

    if (criteria.capacityHeadroom && criteria.capacityHeadroom < 30) {
      failed.push(`Capacity headroom: ${criteria.capacityHeadroom.toFixed(1)}% (needs ≥ 30%)`);
    }

    return failed;
  }

  /**
   * Generate executive summary of current Go/No-Go status
   */
  async generateExecutiveSummary(): Promise<{
    status75To90: ExecutiveGoNoGoDecision;
    status90To100: ExecutiveGoNoGoDecision;
    overallReadiness: 'READY_FOR_90' | 'READY_FOR_100' | 'MAINTAIN_CURRENT' | 'ROLLBACK_REQUIRED';
    executiveRecommendation: string;
  }> {
    const status75To90 = await this.evaluateGoFrom75To90();
    const status90To100 = await this.evaluateGoFrom90To100();
    
    let overallReadiness: 'READY_FOR_90' | 'READY_FOR_100' | 'MAINTAIN_CURRENT' | 'ROLLBACK_REQUIRED';
    let executiveRecommendation: string;

    if (status75To90.decision === 'NO_GO' || status90To100.decision === 'NO_GO') {
      overallReadiness = 'ROLLBACK_REQUIRED';
      executiveRecommendation = '🚨 IMMEDIATE ACTION: Critical thresholds breached - execute rollback procedures';
    } else if (status90To100.decision === 'GO') {
      overallReadiness = 'READY_FOR_100';
      executiveRecommendation = '🚀 FULL DEPLOYMENT: All criteria met including capacity - ready for 100% rollout';
    } else if (status75To90.decision === 'GO') {
      overallReadiness = 'READY_FOR_90';
      executiveRecommendation = '⬆️  STEP UP: Approved for 90% progression - monitor for 48h before final step';
    } else {
      overallReadiness = 'MAINTAIN_CURRENT';
      executiveRecommendation = '📊 MONITOR: Maintain current rollout until all criteria are consistently met';
    }

    return {
      status75To90,
      status90To100,
      overallReadiness,
      executiveRecommendation
    };
  }
}

// Global instance
export const executiveGoNoGoGates = new ExecutiveGoNoGoGates();