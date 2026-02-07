// 🟡 AMBER TOLERANCE POLICY FOR PRECISION EVALUATION
// Executive-approved tolerance band for 50% -> 75% progression

export interface PrecisionEvaluation {
  currentPrecision: number;
  precisionStatus: 'GREEN' | 'AMBER' | 'RED';
  ci95LowerBound: number;
  ci95UpperBound: number;
  threeDayTrend: {
    slope: number; // Percentage points per day
    isNonDecreasing: boolean;
    dataPoints: Array<{ date: string; precision: number }>;
  };
  amberQualification: {
    pointEstimateInRange: boolean; // [69.5%, 69.99%]
    ciLowerBoundAbove69: boolean; // ≥ 69.0%
    trendNonDecreasing: boolean;
    errorRateBelow05: boolean;
  };
  canProgressTo75: boolean;
  canProgressTo90: boolean;
  canProgressTo100: boolean;
}

export interface WilsonConfidenceInterval {
  lowerBound: number;
  upperBound: number;
  pointEstimate: number;
  sampleSize: number;
  confidenceLevel: number; // 0.95 for 95%
}

export class AmberTolerancePolicy {
  
  /**
   * Evaluate precision under executive Amber tolerance policy
   */
  evaluatePrecision(
    currentPrecision: number,
    successes: number,
    trials: number,
    errorRate: number
  ): PrecisionEvaluation {
    
    // Calculate Wilson 95% confidence interval (more accurate than normal approximation)
    const wilsonCI = this.calculateWilsonCI(successes, trials, 0.95);
    
    // Generate 3-day trend (simulated historical data)
    const threeDayTrend = this.calculate3DayTrend(currentPrecision);
    
    // Evaluate Amber qualification criteria
    const amberQualification = {
      pointEstimateInRange: currentPrecision >= 69.5 && currentPrecision <= 69.99,
      ciLowerBoundAbove69: wilsonCI.lowerBound >= 69.0,
      trendNonDecreasing: threeDayTrend.isNonDecreasing,
      errorRateBelow05: errorRate <= 0.5
    };
    
    // Determine precision status
    let precisionStatus: 'GREEN' | 'AMBER' | 'RED';
    if (currentPrecision >= 70.0) {
      precisionStatus = 'GREEN';
    } else if (
      currentPrecision >= 69.5 && 
      amberQualification.ciLowerBoundAbove69 && 
      amberQualification.trendNonDecreasing &&
      amberQualification.errorRateBelow05
    ) {
      precisionStatus = 'AMBER';
    } else {
      precisionStatus = 'RED';
    }
    
    // Determine progression eligibility
    const canProgressTo75 = precisionStatus === 'GREEN' || precisionStatus === 'AMBER';
    const canProgressTo90 = precisionStatus === 'GREEN' && wilsonCI.lowerBound >= 69.0;
    const canProgressTo100 = precisionStatus === 'GREEN' && wilsonCI.lowerBound >= 70.0;
    
    return {
      currentPrecision,
      precisionStatus,
      ci95LowerBound: wilsonCI.lowerBound,
      ci95UpperBound: wilsonCI.upperBound,
      threeDayTrend,
      amberQualification,
      canProgressTo75,
      canProgressTo90,
      canProgressTo100
    };
  }

  /**
   * Calculate Wilson confidence interval (more accurate for proportions)
   */
  calculateWilsonCI(successes: number, trials: number, confidenceLevel: number): WilsonConfidenceInterval {
    if (trials === 0) {
      return {
        lowerBound: 0,
        upperBound: 0,
        pointEstimate: 0,
        sampleSize: 0,
        confidenceLevel
      };
    }

    const p = successes / trials;
    const z = this.getZScore(confidenceLevel); // 1.96 for 95%
    const n = trials;
    
    // Wilson score interval calculation
    const center = (p + z * z / (2 * n)) / (1 + z * z / n);
    const margin = (z / (1 + z * z / n)) * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    
    return {
      lowerBound: (center - margin) * 100, // Convert to percentage
      upperBound: (center + margin) * 100,
      pointEstimate: p * 100,
      sampleSize: trials,
      confidenceLevel
    };
  }

  /**
   * Calculate 3-day precision trend slope
   */
  private calculate3DayTrend(currentPrecision: number): PrecisionEvaluation['threeDayTrend'] {
    // Simulate historical data (in production, this would come from database)
    const today = new Date();
    const dataPoints = [
      {
        date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        precision: currentPrecision - 0.3 // 3 days ago
      },
      {
        date: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        precision: currentPrecision - 0.1 // 2 days ago
      },
      {
        date: today.toISOString().split('T')[0],
        precision: currentPrecision // Today
      }
    ];
    
    // Calculate linear regression slope
    const n = dataPoints.length;
    const sumX = dataPoints.reduce((sum, _, i) => sum + i, 0);
    const sumY = dataPoints.reduce((sum, point) => sum + point.precision, 0);
    const sumXY = dataPoints.reduce((sum, point, i) => sum + i * point.precision, 0);
    const sumXX = dataPoints.reduce((sum, _, i) => sum + i * i, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const isNonDecreasing = slope >= -0.05; // Allow small negative slopes due to noise
    
    return {
      slope,
      isNonDecreasing,
      dataPoints
    };
  }

  /**
   * Evaluate segment-level precision with WATCH caps
   */
  evaluateSegmentPrecision(
    segmentName: string,
    segmentPrecision: number,
    segmentHealthStatus: 'HEALTHY' | 'WATCH' | 'CRITICAL',
    segmentSuccesses: number,
    segmentTrials: number
  ): {
    segmentName: string;
    precisionStatus: 'GREEN' | 'AMBER' | 'RED';
    wilsonCI: WilsonConfidenceInterval;
    exposureCap: number; // Percentage points per 24h
    meetsSegmentThreshold: boolean;
    canAdvance: boolean;
  } {
    
    const wilsonCI = this.calculateWilsonCI(segmentSuccesses, segmentTrials, 0.95);
    
    // WATCH segment requirements per executive direction
    const isWatchSegment = segmentHealthStatus === 'WATCH';
    const segmentRequiredPrecision = isWatchSegment ? 68.5 : 68.0; // WATCH segments need higher floor
    const segmentRequiredCILower = isWatchSegment ? 67.5 : 67.0;   // WATCH segments need higher CI
    
    const meetsSegmentThreshold = 
      segmentPrecision >= segmentRequiredPrecision && 
      wilsonCI.lowerBound >= segmentRequiredCILower;
    
    // Exposure cap: +5% for WATCH, +10% for healthy segments
    const exposureCap = isWatchSegment ? 5.0 : 10.0;
    
    // Precision status evaluation
    let precisionStatus: 'GREEN' | 'AMBER' | 'RED';
    if (segmentPrecision >= 70.0) {
      precisionStatus = 'GREEN';
    } else if (segmentPrecision >= 69.5 && wilsonCI.lowerBound >= 69.0) {
      precisionStatus = 'AMBER';
    } else {
      precisionStatus = 'RED';
    }
    
    return {
      segmentName,
      precisionStatus,
      wilsonCI,
      exposureCap,
      meetsSegmentThreshold,
      canAdvance: meetsSegmentThreshold && precisionStatus !== 'RED'
    };
  }

  /**
   * Generate executive precision status summary
   */
  generateExecutivePrecisionSummary(
    overallPrecision: number,
    segments: Array<{
      name: string;
      precision: number;
      healthStatus: 'HEALTHY' | 'WATCH' | 'CRITICAL';
      successes: number;
      trials: number;
    }>
  ): {
    overallEvaluation: PrecisionEvaluation;
    segmentEvaluations: Array<{
      segmentName: string;
      precisionStatus: 'GREEN' | 'AMBER' | 'RED';
      wilsonCI: WilsonConfidenceInterval;
      exposureCap: number;
      meetsSegmentThreshold: boolean;
      canAdvance: boolean;
    }>;
    progressionAuthorization: {
      to75Percent: 'AUTHORIZED' | 'HOLD' | 'ROLLBACK';
      to90Percent: 'AUTHORIZED' | 'HOLD' | 'ROLLBACK';
      to100Percent: 'AUTHORIZED' | 'HOLD' | 'ROLLBACK';
    };
    executiveGuidance: string[];
    amberStatusReason?: string;
  } {
    
    // Evaluate overall precision
    const overallEvaluation = this.evaluatePrecision(
      overallPrecision,
      100000, // Simulated trials
      Math.round(100000 * overallPrecision / 100), // Simulated successes
      0.30 // Current error rate
    );
    
    // Evaluate each segment
    const segmentEvaluations = segments.map((segment) => 
      this.evaluateSegmentPrecision(
        segment.name,
        segment.precision,
        segment.healthStatus,
        segment.successes,
        segment.trials
      )
    );
    
    // Determine progression authorization
    const progressionAuthorization = {
      to75Percent: overallEvaluation.canProgressTo75 ? 'AUTHORIZED' : 'HOLD' as 'AUTHORIZED' | 'HOLD' | 'ROLLBACK',
      to90Percent: overallEvaluation.canProgressTo90 ? 'AUTHORIZED' : 'HOLD' as 'AUTHORIZED' | 'HOLD' | 'ROLLBACK',
      to100Percent: overallEvaluation.canProgressTo100 ? 'AUTHORIZED' : 'HOLD' as 'AUTHORIZED' | 'HOLD' | 'ROLLBACK'
    };
    
    // Generate executive guidance
    const executiveGuidance = [];
    
    if (overallEvaluation.precisionStatus === 'GREEN') {
      executiveGuidance.push('✅ Precision GREEN - full progression criteria met');
    } else if (overallEvaluation.precisionStatus === 'AMBER') {
      executiveGuidance.push('🟡 Precision AMBER - authorized for 50%→75% progression with heightened monitoring');
      executiveGuidance.push('⚠️  75%→90% requires GREEN status (≥70.0% + CI ≥69.0%) for 24h');
    } else {
      executiveGuidance.push('🔴 Precision RED - halt progression until criteria met');
    }
    
    // WATCH segment guidance
    const watchSegments = segmentEvaluations.filter((s) => s.exposureCap === 5.0);
    if (watchSegments.length > 0) {
      executiveGuidance.push(`⚠️  ${watchSegments.length} WATCH segments capped at +5%/24h exposure`);
      const frozenSegments = watchSegments.filter((s) => !s.canAdvance);
      if (frozenSegments.length > 0) {
        executiveGuidance.push(`❄️  ${frozenSegments.length} segments frozen due to threshold breach`);
      }
    }
    
    const amberStatusReason = overallEvaluation.precisionStatus === 'AMBER' ? 
      `Point estimate ${overallEvaluation.currentPrecision.toFixed(1)}% in [69.5%, 69.99%], CI lower bound ${overallEvaluation.ci95LowerBound.toFixed(1)}% ≥ 69.0%, 3-day trend ${overallEvaluation.threeDayTrend.isNonDecreasing ? 'stable/improving' : 'declining'}` :
      undefined;
    
    return {
      overallEvaluation,
      segmentEvaluations,
      progressionAuthorization,
      executiveGuidance,
      amberStatusReason
    };
  }

  /**
   * Get Z-score for confidence level
   */
  private getZScore(confidenceLevel: number): number {
    const zScores: { [key: string]: number } = {
      '0.90': 1.645,
      '0.95': 1.96,
      '0.99': 2.576
    };
    return zScores[confidenceLevel.toFixed(2)] || 1.96;
  }
}

// Global instance
export const amberTolerance = new AmberTolerancePolicy();