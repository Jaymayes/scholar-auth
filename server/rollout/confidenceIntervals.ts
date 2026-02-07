// 📊 CONFIDENCE INTERVALS FOR ARPU UPLIFT AND MDE REPORTING
// Statistical confidence intervals for executive decision-making

export interface ConfidenceInterval {
  metric: string;
  pointEstimate: number;
  lowerBound: number;
  upperBound: number;
  confidenceLevel: number; // e.g., 0.95 for 95%
  standardError: number;
  sampleSize: number;
  degreeOfFreedom: number;
  marginOfError: number;
  interpretation: string;
}

export interface ARPUConfidenceAnalysis {
  currentARPUUplift: number;
  confidenceIntervals: {
    ci90: ConfidenceInterval;
    ci95: ConfidenceInterval;
    ci99: ConfidenceInterval;
  };
  projectedAnnualRevenue: {
    conservative: number; // Lower bound
    expected: number; // Point estimate
    optimistic: number; // Upper bound
  };
  statisticalSignificance: {
    pValue: number;
    isSignificant: boolean;
    confidenceInUplift: string; // "HIGH" | "MEDIUM" | "LOW"
  };
}

export interface MDEConfidenceReporting {
  metric: string;
  observedEffect: number;
  minimumDetectableEffect: number;
  confidenceInterval: ConfidenceInterval;
  powerAnalysis: {
    currentPower: number;
    requiredSampleSize: number;
    daysToSufficientPower: number;
  };
  executiveRecommendation: "SUFFICIENT_EVIDENCE" | "CONTINUE_MONITORING" | "EXTEND_EXPERIMENT";
}

export class ConfidenceIntervalEngine {

  /**
   * Calculate confidence intervals for ARPU uplift with multiple confidence levels
   */
  calculateARPUConfidenceIntervals(
    treatmentRevenue: number[], 
    controlRevenue: number[]
  ): ARPUConfidenceAnalysis {
    
    const treatmentMean = treatmentRevenue.reduce((a, b) => a + b, 0) / treatmentRevenue.length;
    const controlMean = controlRevenue.reduce((a, b) => a + b, 0) / controlRevenue.length;
    const arpuUplift = (treatmentMean - controlMean) / controlMean;
    
    // Calculate pooled standard error for difference in means
    const treatmentVar = this.calculateVariance(treatmentRevenue, treatmentMean);
    const controlVar = this.calculateVariance(controlRevenue, controlMean);
    const pooledSE = Math.sqrt(treatmentVar / treatmentRevenue.length + controlVar / controlRevenue.length);
    
    // Degrees of freedom for Welch's t-test
    const df = this.calculateWelchDF(
      treatmentVar, treatmentRevenue.length,
      controlVar, controlRevenue.length
    );

    // Calculate confidence intervals at different levels
    const ci90 = this.calculateCI(arpuUplift, pooledSE, df, 0.90);
    const ci95 = this.calculateCI(arpuUplift, pooledSE, df, 0.95);
    const ci99 = this.calculateCI(arpuUplift, pooledSE, df, 0.99);

    // Project annual revenue impact
    const avgUserValue = 300; // Annual revenue per user
    const totalUsers = 1000000; // Projected user base
    const rolloutPercentage = 0.50; // Current 50% rollout
    
    const projectedUsers = totalUsers * rolloutPercentage;
    const baselineRevenue = projectedUsers * avgUserValue;

    return {
      currentARPUUplift: arpuUplift,
      confidenceIntervals: {
        ci90: {
          ...ci90,
          metric: "ARPU_UPLIFT",
          interpretation: this.interpretCI(ci90, "ARPU uplift")
        },
        ci95: {
          ...ci95,
          metric: "ARPU_UPLIFT", 
          interpretation: this.interpretCI(ci95, "ARPU uplift")
        },
        ci99: {
          ...ci99,
          metric: "ARPU_UPLIFT",
          interpretation: this.interpretCI(ci99, "ARPU uplift")
        }
      },
      projectedAnnualRevenue: {
        conservative: baselineRevenue * ci95.lowerBound,
        expected: baselineRevenue * ci95.pointEstimate,
        optimistic: baselineRevenue * ci95.upperBound
      },
      statisticalSignificance: {
        pValue: this.calculateTTestPValue(treatmentRevenue, controlRevenue),
        isSignificant: ci95.lowerBound > 0, // Significant if lower bound > 0
        confidenceInUplift: this.assessConfidenceLevel(ci95)
      }
    };
  }

  /**
   * Generate MDE confidence reporting for executive review
   */
  generateMDEConfidenceReporting(
    metricName: string,
    treatmentData: number[],
    controlData: number[],
    targetMDE: number
  ): MDEConfidenceReporting {
    
    const treatmentMean = treatmentData.reduce((a, b) => a + b, 0) / treatmentData.length;
    const controlMean = controlData.reduce((a, b) => a + b, 0) / controlData.length;
    const observedEffect = (treatmentMean - controlMean) / controlMean;
    
    // Calculate standard error and confidence interval
    const treatmentVar = this.calculateVariance(treatmentData, treatmentMean);
    const controlVar = this.calculateVariance(controlData, controlMean);
    const pooledSE = Math.sqrt(treatmentVar / treatmentData.length + controlVar / controlData.length);
    const df = this.calculateWelchDF(treatmentVar, treatmentData.length, controlVar, controlData.length);
    
    const ci95 = this.calculateCI(observedEffect, pooledSE, df, 0.95);
    
    // Power analysis
    const currentPower = this.calculatePower(observedEffect, pooledSE, targetMDE);
    const requiredSampleSize = this.calculateRequiredSampleSize(targetMDE, pooledSE, 0.8); // 80% power
    const daysToSufficient = Math.max(0, (requiredSampleSize - treatmentData.length) / 100); // Assume 100 users/day

    // Executive recommendation
    let recommendation: "SUFFICIENT_EVIDENCE" | "CONTINUE_MONITORING" | "EXTEND_EXPERIMENT";
    if (currentPower >= 0.8 && ci95.lowerBound > targetMDE) {
      recommendation = "SUFFICIENT_EVIDENCE";
    } else if (currentPower >= 0.6 && Math.abs(observedEffect) >= targetMDE) {
      recommendation = "CONTINUE_MONITORING";
    } else {
      recommendation = "EXTEND_EXPERIMENT";
    }

    return {
      metric: metricName,
      observedEffect,
      minimumDetectableEffect: targetMDE,
      confidenceInterval: {
        ...ci95,
        metric: metricName,
        interpretation: this.interpretMDECI(ci95, observedEffect, targetMDE)
      },
      powerAnalysis: {
        currentPower,
        requiredSampleSize: Math.round(requiredSampleSize),
        daysToSufficientPower: Math.round(daysToSufficient)
      },
      executiveRecommendation: recommendation
    };
  }

  /**
   * Generate comprehensive executive confidence report
   */
  generateExecutiveConfidenceReport(): any {
    // Simulate current rollout data
    const treatmentARPU = Array.from({ length: 500000 }, () => 
      52 + Math.random() * 15 // $52-67 monthly ARPU for treatment
    );
    const controlARPU = Array.from({ length: 500000 }, () => 
      50 + Math.random() * 12 // $50-62 monthly ARPU for control
    );

    const arpuAnalysis = this.calculateARPUConfidenceIntervals(treatmentARPU, controlARPU);

    // Generate MDE reports for key metrics
    const precisionMDE = this.generateMDEConfidenceReporting(
      "Precision",
      Array.from({ length: 1000 }, () => 0.70 + Math.random() * 0.1), // Treatment precision
      Array.from({ length: 1000 }, () => 0.65 + Math.random() * 0.1), // Control precision
      0.02 // 2% MDE
    );

    const conversionMDE = this.generateMDEConfidenceReporting(
      "Conversion Rate",
      Array.from({ length: 1000 }, () => 0.085 + Math.random() * 0.02), // Treatment conversion
      Array.from({ length: 1000 }, () => 0.080 + Math.random() * 0.02), // Control conversion
      0.01 // 1% MDE
    );

    return {
      reportTimestamp: new Date().toISOString(),
      rolloutPercentage: 50,
      executiveSummary: {
        arpuUpliftSignificant: arpuAnalysis.statisticalSignificance.isSignificant,
        confidenceInResults: arpuAnalysis.statisticalSignificance.confidenceInUplift,
        projectedAnnualImpact: `$${(arpuAnalysis.projectedAnnualRevenue.expected / 1000000).toFixed(1)}M`,
        recommendationReadiness: precisionMDE.executiveRecommendation
      },
      arpuAnalysis,
      mdeReporting: [precisionMDE, conversionMDE],
      keyTakeaways: [
        arpuAnalysis.statisticalSignificance.isSignificant ? 
          `✅ ARPU uplift is statistically significant with 95% confidence` :
          `⚠️  ARPU uplift not yet statistically significant`,
        `📊 95% confident ARPU uplift is between ${(arpuAnalysis.confidenceIntervals.ci95.lowerBound * 100).toFixed(1)}% and ${(arpuAnalysis.confidenceIntervals.ci95.upperBound * 100).toFixed(1)}%`,
        `💰 Projected annual revenue impact: $${(arpuAnalysis.projectedAnnualRevenue.conservative / 1000000).toFixed(1)}M - $${(arpuAnalysis.projectedAnnualRevenue.optimistic / 1000000).toFixed(1)}M`,
        precisionMDE.executiveRecommendation === "SUFFICIENT_EVIDENCE" ? 
          `✅ Sufficient evidence for precision improvements` :
          `📈 Continue monitoring precision metrics for ${precisionMDE.powerAnalysis.daysToSufficientPower} more days`
      ]
    };
  }

  // Statistical helper methods

  private calculateVariance(data: number[], mean: number): number {
    return data.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (data.length - 1);
  }

  private calculateWelchDF(var1: number, n1: number, var2: number, n2: number): number {
    const se1 = var1 / n1;
    const se2 = var2 / n2;
    return Math.pow(se1 + se2, 2) / (Math.pow(se1, 2) / (n1 - 1) + Math.pow(se2, 2) / (n2 - 1));
  }

  private calculateCI(estimate: number, se: number, df: number, level: number): ConfidenceInterval {
    const alpha = 1 - level;
    const tValue = this.getTValue(alpha / 2, df); // Two-tailed
    const marginOfError = tValue * se;
    
    return {
      metric: "",
      pointEstimate: estimate,
      lowerBound: estimate - marginOfError,
      upperBound: estimate + marginOfError,
      confidenceLevel: level,
      standardError: se,
      sampleSize: df + 1, // Approximation
      degreeOfFreedom: df,
      marginOfError,
      interpretation: ""
    };
  }

  private getTValue(alpha: number, df: number): number {
    // Simplified t-value lookup for common cases
    const tTable: Record<string, number> = {
      "0.05": 1.96,  // 90% CI (approximate for large df)
      "0.025": 2.00, // 95% CI (approximate for large df)
      "0.005": 2.58  // 99% CI (approximate for large df)
    };
    
    return tTable[alpha.toFixed(3)] || 2.00;
  }

  private calculatePower(effect: number, se: number, targetEffect: number): number {
    const zScore = Math.abs(effect - targetEffect) / se;
    return this.normalCDF(zScore - 1.96) + (1 - this.normalCDF(zScore + 1.96));
  }

  private calculateRequiredSampleSize(targetEffect: number, se: number, targetPower: number): number {
    // Simplified sample size calculation
    const zAlpha = 1.96; // 95% confidence
    const zBeta = 0.84;  // 80% power
    return Math.pow((zAlpha + zBeta) / targetEffect, 2) * Math.pow(se, 2);
  }

  private calculateTTestPValue(sample1: number[], sample2: number[]): number {
    const mean1 = sample1.reduce((a, b) => a + b, 0) / sample1.length;
    const mean2 = sample2.reduce((a, b) => a + b, 0) / sample2.length;
    const var1 = this.calculateVariance(sample1, mean1);
    const var2 = this.calculateVariance(sample2, mean2);
    
    const pooledSE = Math.sqrt(var1 / sample1.length + var2 / sample2.length);
    const tStat = Math.abs(mean1 - mean2) / pooledSE;
    
    // Simplified p-value approximation
    return 2 * (1 - this.normalCDF(tStat));
  }

  private normalCDF(z: number): number {
    // Simplified normal CDF approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    
    return z > 0 ? 1 - prob : prob;
  }

  private interpretCI(ci: ConfidenceInterval, metricName: string): string {
    if (ci.lowerBound > 0) {
      return `Strong evidence of positive ${metricName} - all plausible values are positive`;
    } else if (ci.upperBound < 0) {
      return `Strong evidence of negative ${metricName} - all plausible values are negative`;
    } else if (Math.abs(ci.pointEstimate) > ci.marginOfError) {
      return `Moderate evidence of ${metricName} effect - confidence interval includes zero but estimate is substantial`;
    } else {
      return `Inconclusive ${metricName} effect - confidence interval is wide and includes zero`;
    }
  }

  private interpretMDECI(ci: ConfidenceInterval, observed: number, targetMDE: number): string {
    if (ci.lowerBound > targetMDE) {
      return `Observed effect exceeds MDE with high confidence - sufficient evidence for decision`;
    } else if (observed > targetMDE && ci.lowerBound > 0) {
      return `Observed effect exceeds MDE but confidence interval is wide - continue monitoring`;
    } else {
      return `Observed effect below MDE or not statistically significant - extend experiment`;
    }
  }

  private assessConfidenceLevel(ci: ConfidenceInterval): "HIGH" | "MEDIUM" | "LOW" {
    const relativeMargin = ci.marginOfError / Math.abs(ci.pointEstimate);
    
    if (relativeMargin < 0.1) return "HIGH";    // Margin < 10% of estimate
    if (relativeMargin < 0.25) return "MEDIUM"; // Margin < 25% of estimate
    return "LOW";
  }
}

// Global instance
export const confidenceEngine = new ConfidenceIntervalEngine();