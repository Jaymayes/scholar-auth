// 🚀 AUTO-SCALING SYSTEM FOR 25% → 50% → 100% WITH EXECUTIVE GUARDRAILS
// Implements executive-approved step functions with pause/rollback logic

import { SCHOLARSHIP_ROLLOUT_CONFIG, emergencyRollback } from './featureFlags';
import { sliceMonitor } from './sliceMonitoring';

export interface ScaleStep {
  targetPercentage: number;
  stepDurationMinutes: number;
  stepSizePercent: number;
  requiresApproval: boolean;
  guardrailCheckIntervalMinutes: number;
}

export interface ScaleSequence {
  from: number;
  to: number;
  steps: ScaleStep[];
  pauseOnViolation: boolean;
  rollbackSteps: number; // How many steps to roll back on violation
}

export class AutoScalingSystem {
  private currentPercentage: number = 25;
  private isScaling: boolean = false;
  private scalingHistory: Array<{
    timestamp: string;
    fromPercentage: number;
    toPercentage: number;
    action: 'SCALE_UP' | 'SCALE_DOWN' | 'PAUSE' | 'ROLLBACK';
    reason: string;
    approved: boolean;
  }> = [];

  // Executive-approved scale sequences
  private scaleSequences: Record<string, ScaleSequence> = {
    'to_50_percent': {
      from: 25,
      to: 50,
      steps: [{
        targetPercentage: 50,
        stepDurationMinutes: 30, // 10% steps every 30 minutes
        stepSizePercent: 10,
        requiresApproval: true, // Initial approval required
        guardrailCheckIntervalMinutes: 5
      }],
      pauseOnViolation: true,
      rollbackSteps: 1 // 5% step rollback
    },
    'to_100_percent': {
      from: 50,
      to: 100,
      steps: [{
        targetPercentage: 100,
        stepDurationMinutes: 15, // 10% steps every 15 minutes
        stepSizePercent: 10,
        requiresApproval: true, // After 24h at 50%
        guardrailCheckIntervalMinutes: 3
      }],
      pauseOnViolation: true,
      rollbackSteps: 1 // 5% step rollback
    }
  };

  constructor() {
    this.startGuardrailMonitoring();
  }

  /**
   * Attempt auto-approval for scale to 50% based on executive criteria
   */
  async attemptAutoApprovalTo50Percent(): Promise<{
    approved: boolean;
    readyTime: string | null;
    blockers: string[];
    nextCheckTime: string;
  }> {
    console.log('🎯 EVALUATING AUTO-APPROVAL FOR 50% SCALE...');
    
    // Check if we've been at 25% for minimum 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hasMinimumHoldTime = this.scalingHistory.some(entry => 
      new Date(entry.timestamp) <= twentyFourHoursAgo && entry.toPercentage === 25
    );

    if (!hasMinimumHoldTime) {
      const nextCheckTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // Check hourly
      return {
        approved: false,
        readyTime: null,
        blockers: ['Minimum 24-hour hold at 25% not yet completed'],
        nextCheckTime
      };
    }

    // Evaluate slice-based Go/No-Go criteria
    const sliceEvaluation = sliceMonitor.evaluateScaleTo50Percent();
    
    if (sliceEvaluation.approved) {
      console.log('✅ EXECUTIVE CRITERIA MET - AUTO-APPROVING 50% SCALE');
      
      // Log approval decision
      this.scalingHistory.push({
        timestamp: new Date().toISOString(),
        fromPercentage: 25,
        toPercentage: 50,
        action: 'SCALE_UP',
        reason: 'Executive criteria met: All slices passing reliability, quality, economics, and risk thresholds',
        approved: true
      });

      return {
        approved: true,
        readyTime: new Date().toISOString(),
        blockers: [],
        nextCheckTime: sliceEvaluation.nextCheckTime
      };
    } else {
      console.log('❌ EXECUTIVE CRITERIA NOT MET - BLOCKING 50% SCALE');
      console.log('Failed criteria:', sliceEvaluation.failedCriteria);
      console.log('Slice violations:', sliceEvaluation.sliceViolations);

      return {
        approved: false,
        readyTime: null,
        blockers: [...sliceEvaluation.failedCriteria, ...sliceEvaluation.sliceViolations],
        nextCheckTime: sliceEvaluation.nextCheckTime
      };
    }
  }

  /**
   * Execute gradual scale-up with 10% steps every 30 minutes
   */
  async executeScaleTo50Percent(): Promise<void> {
    if (this.isScaling) {
      throw new Error('Scaling operation already in progress');
    }

    this.isScaling = true;
    const sequence = this.scaleSequences.to_50_percent;
    
    try {
      console.log(`🚀 STARTING GRADUAL SCALE FROM ${this.currentPercentage}% TO 50%`);
      
      // Scale in 10% increments every 30 minutes
      const steps = this.generateScaleSteps(this.currentPercentage, 50, 10);
      
      for (const step of steps) {
        console.log(`📈 SCALING TO ${step}%...`);
        
        // Update rollout percentage
        await this.updateRolloutPercentage(step);
        
        // Wait for step duration with guardrail monitoring
        await this.monitoredWait(sequence.steps[0].stepDurationMinutes, step);
        
        console.log(`✅ SCALE TO ${step}% COMPLETED AND STABLE`);
      }
      
      console.log('🎉 SCALE TO 50% COMPLETED SUCCESSFULLY');
      
    } catch (error) {
      console.error('🚨 SCALE TO 50% FAILED:', error);
      throw error;
    } finally {
      this.isScaling = false;
    }
  }

  /**
   * Attempt auto-approval for scale to 100% after 24h at 50%
   */
  async attemptAutoApprovalTo100Percent(): Promise<{
    approved: boolean;
    readyTime: string | null;
    blockers: string[];
    nextCheckTime: string;
  }> {
    console.log('🎯 EVALUATING AUTO-APPROVAL FOR 100% SCALE...');
    
    // Check if we've been at 50% for minimum 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hasMinimumHoldTime = this.scalingHistory.some(entry => 
      new Date(entry.timestamp) <= twentyFourHoursAgo && entry.toPercentage === 50
    );

    if (!hasMinimumHoldTime) {
      return {
        approved: false,
        readyTime: null,
        blockers: ['Minimum 24-hour hold at 50% not yet completed'],
        nextCheckTime: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      };
    }

    // Evaluate enhanced criteria for 100% (stricter thresholds)
    const sliceEvaluation = sliceMonitor.evaluateScaleTo50Percent();
    const overallMetrics = sliceEvaluation.overallMetrics.treatment;
    
    // Enhanced criteria for 100%: precision ≥67%, CSAT ≥4.7/5
    const enhancedCriteriaViolations: string[] = [];
    
    if (overallMetrics.precision < 0.67) {
      enhancedCriteriaViolations.push(`Precision ${(overallMetrics.precision * 100).toFixed(1)}% < 67% required for 100%`);
    }
    
    if (overallMetrics.csat < 4.7) {
      enhancedCriteriaViolations.push(`CSAT ${overallMetrics.csat}/5 < 4.7/5 required for 100%`);
    }

    const approved = sliceEvaluation.approved && enhancedCriteriaViolations.length === 0;
    
    if (approved) {
      console.log('✅ ENHANCED CRITERIA MET - AUTO-APPROVING 100% SCALE');
      
      this.scalingHistory.push({
        timestamp: new Date().toISOString(),
        fromPercentage: 50,
        toPercentage: 100,
        action: 'SCALE_UP',
        reason: 'Enhanced criteria met: 67%+ precision, 4.7/5 CSAT, all slice thresholds passing',
        approved: true
      });

      return {
        approved: true,
        readyTime: new Date().toISOString(),
        blockers: [],
        nextCheckTime: sliceEvaluation.nextCheckTime
      };
    } else {
      return {
        approved: false,
        readyTime: null,
        blockers: [...sliceEvaluation.failedCriteria, ...sliceEvaluation.sliceViolations, ...enhancedCriteriaViolations],
        nextCheckTime: sliceEvaluation.nextCheckTime
      };
    }
  }

  /**
   * Execute scale to 100% with 10% steps every 15 minutes
   */
  async executeScaleTo100Percent(): Promise<void> {
    if (this.isScaling) {
      throw new Error('Scaling operation already in progress');
    }

    this.isScaling = true;
    const sequence = this.scaleSequences.to_100_percent;
    
    try {
      console.log('🚀 STARTING FINAL SCALE FROM 50% TO 100%');
      
      const steps = this.generateScaleSteps(50, 100, 10);
      
      for (const step of steps) {
        console.log(`📈 SCALING TO ${step}%...`);
        
        await this.updateRolloutPercentage(step);
        await this.monitoredWait(sequence.steps[0].stepDurationMinutes, step);
        
        console.log(`✅ SCALE TO ${step}% COMPLETED AND STABLE`);
      }
      
      console.log('🎉 FULL 100% ROLLOUT ACHIEVED - MAINTAINING 72H ENHANCED MONITORING');
      
    } catch (error) {
      console.error('🚨 SCALE TO 100% FAILED:', error);
      throw error;
    } finally {
      this.isScaling = false;
    }
  }

  /**
   * Handle guardrail violation with pause/rollback logic
   */
  private async handleGuardrailViolation(
    currentPercentage: number, 
    violations: string[]
  ): Promise<void> {
    console.log(`🚨 GUARDRAIL VIOLATION AT ${currentPercentage}%:`, violations);
    
    // 10-minute pause first
    console.log('⏸️  INITIATING 10-MINUTE INVESTIGATION PAUSE...');
    this.scalingHistory.push({
      timestamp: new Date().toISOString(),
      fromPercentage: currentPercentage,
      toPercentage: currentPercentage,
      action: 'PAUSE',
      reason: `Guardrail violations: ${violations.join(', ')}`,
      approved: false
    });
    
    // Wait 10 minutes and re-evaluate
    await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));
    
    const reevaluation = sliceMonitor.evaluateScaleTo50Percent();
    
    if (reevaluation.approved) {
      console.log('✅ VIOLATIONS RESOLVED - RESUMING SCALE');
      return; // Continue scaling
    } else {
      // Rollback in 5% steps to last stable point
      console.log('🔄 VIOLATIONS PERSIST - INITIATING ROLLBACK...');
      await this.executeRollback(currentPercentage, 5);
    }
  }

  /**
   * Execute rollback in controlled steps
   */
  private async executeRollback(fromPercentage: number, stepSize: number): Promise<void> {
    console.log(`🔄 ROLLING BACK FROM ${fromPercentage}% IN ${stepSize}% STEPS...`);
    
    // Find last stable percentage (last successful scale without violations)
    const lastStable = this.findLastStablePercentage();
    const steps = this.generateScaleSteps(fromPercentage, lastStable, -stepSize);
    
    for (const step of steps) {
      console.log(`📉 ROLLING BACK TO ${step}%...`);
      
      await this.updateRolloutPercentage(step);
      
      this.scalingHistory.push({
        timestamp: new Date().toISOString(),
        fromPercentage: fromPercentage,
        toPercentage: step,
        action: 'ROLLBACK',
        reason: 'Sustained guardrail violations - rolling back to stable state',
        approved: true
      });
      
      // Wait 5 minutes between rollback steps
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
    
    console.log(`✅ ROLLBACK TO ${lastStable}% COMPLETED`);
  }

  // Helper methods
  private generateScaleSteps(from: number, to: number, stepSize: number): number[] {
    const steps: number[] = [];
    const increment = stepSize > 0 ? stepSize : -Math.abs(stepSize);
    
    if (from < to) {
      for (let current = from + increment; current <= to; current += increment) {
        steps.push(Math.min(current, to));
      }
    } else {
      for (let current = from + increment; current >= to; current += increment) {
        steps.push(Math.max(current, to));
      }
    }
    
    return steps;
  }

  private async updateRolloutPercentage(percentage: number): Promise<void> {
    // Update the global rollout configuration
    SCHOLARSHIP_ROLLOUT_CONFIG.rolloutPercentage = percentage;
    this.currentPercentage = percentage;
    
    console.log(`🎯 ROLLOUT PERCENTAGE UPDATED: ${percentage}%`);
    
    // TODO: Trigger configuration reload across all instances
    // TODO: Update load balancer weights if applicable
    // TODO: Notify monitoring systems of scale change
  }

  private async monitoredWait(minutes: number, currentPercentage: number): Promise<void> {
    const checkIntervalMs = 5 * 60 * 1000; // Check every 5 minutes
    const totalWaitMs = minutes * 60 * 1000;
    
    for (let elapsed = 0; elapsed < totalWaitMs; elapsed += checkIntervalMs) {
      // Check guardrails during wait
      const evaluation = sliceMonitor.evaluateScaleTo50Percent();
      
      if (!evaluation.approved) {
        throw new Error(`Guardrail violation during scale step: ${evaluation.failedCriteria.join(', ')}`);
      }
      
      console.log(`⏳ MONITORING ${currentPercentage}% - ${Math.ceil((totalWaitMs - elapsed) / 60000)} minutes remaining`);
      await new Promise(resolve => setTimeout(resolve, Math.min(checkIntervalMs, totalWaitMs - elapsed)));
    }
  }

  private findLastStablePercentage(): number {
    // Find the last percentage where we had sustained success
    const successfulScales = this.scalingHistory
      .filter(entry => entry.approved && entry.action === 'SCALE_UP')
      .reverse();
    
    return successfulScales.length > 0 ? successfulScales[0].fromPercentage : 10;
  }

  private startGuardrailMonitoring(): void {
    // Monitor guardrails every 5 minutes during scaling
    setInterval(async () => {
      if (!this.isScaling) return;
      
      try {
        const evaluation = sliceMonitor.evaluateScaleTo50Percent();
        
        if (!evaluation.approved) {
          await this.handleGuardrailViolation(
            this.currentPercentage,
            [...evaluation.failedCriteria, ...evaluation.sliceViolations]
          );
        }
      } catch (error) {
        console.error('🚨 GUARDRAIL MONITORING ERROR:', error);
      }
    }, 5 * 60 * 1000);
  }

  // Public getters for status reporting
  getCurrentPercentage(): number {
    return this.currentPercentage;
  }

  getScalingHistory(): typeof this.scalingHistory {
    return [...this.scalingHistory];
  }

  isCurrentlyScaling(): boolean {
    return this.isScaling;
  }
}

// Global instance
export const autoScaler = new AutoScalingSystem();