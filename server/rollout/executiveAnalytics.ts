// 📊 EXECUTIVE ANALYTICS - MDE/POWER, LTV, FUNNEL IMPACT, FAIRNESS ANALYSIS
// Advanced statistical analysis for executive decision-making

export interface MDEPowerAnalysis {
  metric: string;
  sampleSize: number;
  effect: number; // Observed effect
  mde: number; // Minimum Detectable Effect
  power: number; // Statistical power (0-1)
  significance: number; // p-value
  confidenceInterval: [number, number];
  recommendation: 'SUFFICIENT' | 'NEEDS_MORE_DATA' | 'INCONCLUSIVE';
}

export interface LTVCohortAnalysis {
  cohort: 'treatment' | 'control';
  acquisitionSource: 'organic' | 'direct' | 'social' | 'paid' | 'referral';
  ltv: {
    projected30Day: number;
    projected90Day: number;
    projected365Day: number;
  };
  paybackPeriod: {
    days: number;
    vsCAC: number; // LTV/CAC ratio
  };
  conversionFunnel: {
    signupToActive: number;
    activeToTrial: number;
    trialToPaid: number;
    paidToRetained: number;
  };
  churnRisk: {
    score: number; // 0-1
    primaryFactors: string[];
  };
}

export interface FunnelImpactMetrics {
  stage: string;
  treatmentRate: number;
  controlRate: number;
  absoluteLift: number;
  relativeLift: number;
  significance: number;
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  projectedRevenue: number;
}

export interface AdvancedFairnessAnalysis {
  segment: string;
  attribute: string;
  treatmentPrecision: number;
  controlPrecision: number;
  disparityRatio: number; // treatment/control
  significance: number;
  complianceStatus: 'COMPLIANT' | 'WARNING' | 'VIOLATION';
  recommendedActions: string[];
}

export class ExecutiveAnalyticsEngine {
  
  /**
   * Calculate MDE and statistical power for key metrics
   */
  calculateMDEPowerAnalysis(cohortData: any[]): MDEPowerAnalysis[] {
    const analyses: MDEPowerAnalysis[] = [];
    
    const metrics = [
      { name: 'ARPU_UPLIFT', key: 'arpuUplift' },
      { name: 'PRECISION', key: 'precision' },
      { name: 'CONVERSION_RATE', key: 'conversionRate' },
      { name: 'CSAT', key: 'csat' }
    ];

    metrics.forEach(metric => {
      const treatmentData = cohortData.filter(d => d.cohort === 'treatment');
      const controlData = cohortData.filter(d => d.cohort === 'control');
      
      if (treatmentData.length < 100 || controlData.length < 100) {
        analyses.push({
          metric: metric.name,
          sampleSize: treatmentData.length + controlData.length,
          effect: 0,
          mde: 0.05, // 5% MDE default
          power: 0,
          significance: 1.0,
          confidenceInterval: [0, 0],
          recommendation: 'NEEDS_MORE_DATA'
        });
        return;
      }

      const treatmentValues = treatmentData.map(d => d.metrics[metric.key] || 0);
      const controlValues = controlData.map(d => d.metrics[metric.key] || 0);
      
      const treatmentMean = treatmentValues.reduce((a, b) => a + b, 0) / treatmentValues.length;
      const controlMean = controlValues.reduce((a, b) => a + b, 0) / controlValues.length;
      
      const effect = (treatmentMean - controlMean) / controlMean;
      const pooledStdDev = this.calculatePooledStdDev(treatmentValues, controlValues);
      
      // Calculate statistical power and MDE
      const power = this.calculateStatisticalPower(
        treatmentValues.length,
        controlValues.length,
        effect,
        pooledStdDev
      );
      
      const mde = this.calculateMDE(
        treatmentValues.length,
        controlValues.length,
        pooledStdDev,
        0.8 // Target 80% power
      );
      
      const significance = this.calculateTTestPValue(treatmentValues, controlValues);
      const ci = this.calculateConfidenceInterval(treatmentMean, controlMean, pooledStdDev, treatmentValues.length, controlValues.length);

      analyses.push({
        metric: metric.name,
        sampleSize: treatmentValues.length + controlValues.length,
        effect,
        mde,
        power,
        significance,
        confidenceInterval: ci,
        recommendation: power >= 0.8 && significance <= 0.1 ? 'SUFFICIENT' : 
                      power >= 0.6 ? 'NEEDS_MORE_DATA' : 'INCONCLUSIVE'
      });
    });

    return analyses;
  }

  /**
   * Generate LTV analysis by acquisition cohort
   */
  generateLTVCohortAnalysis(userData: any[]): LTVCohortAnalysis[] {
    const cohorts: LTVCohortAnalysis[] = [];
    
    const cohortGroups = this.groupBy(userData, user => `${user.cohort}-${user.acquisitionSource}`);
    
    Object.entries(cohortGroups).forEach(([key, users]) => {
      const [cohort, source] = key.split('-') as ['treatment' | 'control', string];
      
      // Calculate LTV based on revenue patterns
      const avgMonthlyRevenue = users.reduce((sum, user) => sum + (user.monthlyRevenue || 0), 0) / users.length;
      const retentionRate = this.calculateRetentionRate(users);
      const churnRate = 1 - retentionRate;
      
      // LTV = ARPU / Churn Rate (simplified)
      const ltv30Day = avgMonthlyRevenue * retentionRate;
      const ltv90Day = avgMonthlyRevenue * Math.pow(retentionRate, 3);
      const ltv365Day = avgMonthlyRevenue * (retentionRate / churnRate) * 12; // Customer lifetime

      // Calculate acquisition cost and payback
      const estimatedCAC = source === 'paid' ? 50 : source === 'organic' ? 10 : 25; // Simplified
      const paybackDays = estimatedCAC / (avgMonthlyRevenue / 30);
      
      // Funnel conversion rates
      const conversionFunnel = this.calculateConversionFunnel(users);
      
      // Churn risk analysis
      const churnRisk = this.calculateChurnRisk(users);

      cohorts.push({
        cohort,
        acquisitionSource: source as any,
        ltv: {
          projected30Day: ltv30Day,
          projected90Day: ltv90Day,
          projected365Day: ltv365Day
        },
        paybackPeriod: {
          days: Math.ceil(paybackDays),
          vsCAC: ltv365Day / estimatedCAC
        },
        conversionFunnel,
        churnRisk
      });
    });

    return cohorts;
  }

  /**
   * Analyze funnel impact across stages
   */
  analyzeFunnelImpact(userData: any[]): FunnelImpactMetrics[] {
    const funnelStages = [
      { name: 'Free_to_Paid_Conversion', treatment: 'paidConversionRate', control: 'paidConversionRate' },
      { name: 'Scholarship_Matches_Per_User', treatment: 'matchesPerUser', control: 'matchesPerUser' },
      { name: 'Time_to_First_Application', treatment: 'timeToFirstApp', control: 'timeToFirstApp' },
      { name: 'Application_Completion_Rate', treatment: 'appCompletionRate', control: 'appCompletionRate' },
      { name: 'Provider_Response_Rate', treatment: 'providerResponseRate', control: 'providerResponseRate' }
    ];

    const metrics: FunnelImpactMetrics[] = [];

    funnelStages.forEach(stage => {
      const treatmentUsers = userData.filter(u => u.cohort === 'treatment');
      const controlUsers = userData.filter(u => u.cohort === 'control');

      const treatmentRate = treatmentUsers.reduce((sum, u) => sum + (u[stage.treatment] || 0), 0) / treatmentUsers.length;
      const controlRate = controlUsers.reduce((sum, u) => sum + (u[stage.control] || 0), 0) / controlUsers.length;

      const absoluteLift = treatmentRate - controlRate;
      const relativeLift = controlRate > 0 ? absoluteLift / controlRate : 0;
      
      // Calculate significance using t-test
      const treatmentValues = treatmentUsers.map(u => u[stage.treatment] || 0);
      const controlValues = controlUsers.map(u => u[stage.control] || 0);
      const significance = this.calculateTTestPValue(treatmentValues, controlValues);

      // Project revenue impact
      const avgUserValue = 25; // Simplified: $25 per user annually
      const projectedRevenue = absoluteLift * treatmentUsers.length * avgUserValue;

      metrics.push({
        stage: stage.name,
        treatmentRate,
        controlRate,
        absoluteLift,
        relativeLift,
        significance,
        impact: absoluteLift > 0 ? 'POSITIVE' : absoluteLift < 0 ? 'NEGATIVE' : 'NEUTRAL',
        projectedRevenue
      });
    });

    return metrics;
  }

  /**
   * Advanced fairness analysis across sensitive-adjacent proxies
   */
  generateAdvancedFairnessAnalysis(sliceData: any[]): AdvancedFairnessAnalysis[] {
    const analyses: AdvancedFairnessAnalysis[] = [];
    
    const sensitiveProxies = [
      { segment: 'Geographic', attribute: 'region', threshold: 0.85 },
      { segment: 'Economic', attribute: 'userTier', threshold: 0.90 },
      { segment: 'Technology', attribute: 'deviceType', threshold: 0.95 },
      { segment: 'Education', attribute: 'schoolTier', threshold: 0.90 }
    ];

    sensitiveProxies.forEach(proxy => {
      const groupedData = this.groupBy(sliceData, slice => slice.slice[proxy.attribute] || 'unknown');

      Object.entries(groupedData).forEach(([attributeValue, slices]) => {
        const treatmentSlices = slices.filter(s => s.cohort === 'treatment');
        const controlSlices = slices.filter(s => s.cohort === 'control');

        if (treatmentSlices.length === 0 || controlSlices.length === 0) return;

        const treatmentPrecision = treatmentSlices.reduce((sum, s) => sum + s.metrics.precision, 0) / treatmentSlices.length;
        const controlPrecision = controlSlices.reduce((sum, s) => sum + s.metrics.precision, 0) / controlSlices.length;

        const disparityRatio = controlPrecision > 0 ? treatmentPrecision / controlPrecision : 1;

        // Statistical significance of disparity
        const treatmentValues = treatmentSlices.map(s => s.metrics.precision);
        const controlValues = controlSlices.map(s => s.metrics.precision);
        const significance = this.calculateTTestPValue(treatmentValues, controlValues);

        // Compliance assessment
        let complianceStatus: 'COMPLIANT' | 'WARNING' | 'VIOLATION' = 'COMPLIANT';
        const recommendations: string[] = [];

        if (disparityRatio < proxy.threshold) {
          complianceStatus = 'VIOLATION';
          recommendations.push(`Immediate review of ${proxy.segment.toLowerCase()} matching algorithms required`);
          recommendations.push(`Consider ${proxy.segment.toLowerCase()}-specific precision boosters`);
        } else if (disparityRatio < (proxy.threshold + 0.05)) {
          complianceStatus = 'WARNING';
          recommendations.push(`Monitor ${proxy.segment.toLowerCase()} disparities closely`);
        }

        if (significance <= 0.05 && disparityRatio < 0.95) {
          recommendations.push(`Statistically significant disparity detected - prioritize mitigation`);
        }

        analyses.push({
          segment: proxy.segment,
          attribute: `${proxy.attribute}:${attributeValue}`,
          treatmentPrecision,
          controlPrecision,
          disparityRatio,
          significance,
          complianceStatus,
          recommendedActions: recommendations
        });
      });
    });

    return analyses;
  }

  // Helper methods for statistical calculations

  private calculatePooledStdDev(sample1: number[], sample2: number[]): number {
    const mean1 = sample1.reduce((a, b) => a + b, 0) / sample1.length;
    const mean2 = sample2.reduce((a, b) => a + b, 0) / sample2.length;
    
    const var1 = sample1.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (sample1.length - 1);
    const var2 = sample2.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (sample2.length - 1);
    
    return Math.sqrt(((sample1.length - 1) * var1 + (sample2.length - 1) * var2) / (sample1.length + sample2.length - 2));
  }

  private calculateStatisticalPower(n1: number, n2: number, effect: number, stdDev: number): number {
    // Simplified power calculation for two-sample t-test
    const standardError = stdDev * Math.sqrt(1/n1 + 1/n2);
    const zScore = Math.abs(effect) / standardError;
    
    // Approximate power using normal distribution
    return this.normalCDF(zScore - 1.96) + (1 - this.normalCDF(zScore + 1.96));
  }

  private calculateMDE(n1: number, n2: number, stdDev: number, targetPower: number): number {
    // Simplified MDE calculation for 80% power, 95% confidence
    const standardError = stdDev * Math.sqrt(1/n1 + 1/n2);
    const zAlpha = 1.96; // 95% confidence
    const zBeta = 0.84;  // 80% power
    
    return (zAlpha + zBeta) * standardError;
  }

  private calculateTTestPValue(sample1: number[], sample2: number[]): number {
    const mean1 = sample1.reduce((a, b) => a + b, 0) / sample1.length;
    const mean2 = sample2.reduce((a, b) => a + b, 0) / sample2.length;
    const pooledStdDev = this.calculatePooledStdDev(sample1, sample2);
    
    const standardError = pooledStdDev * Math.sqrt(1/sample1.length + 1/sample2.length);
    const tStat = Math.abs(mean1 - mean2) / standardError;
    
    // Simplified p-value approximation
    return 2 * (1 - this.normalCDF(tStat));
  }

  private calculateConfidenceInterval(mean1: number, mean2: number, stdDev: number, n1: number, n2: number): [number, number] {
    const diff = mean1 - mean2;
    const standardError = stdDev * Math.sqrt(1/n1 + 1/n2);
    const margin = 1.96 * standardError; // 95% confidence
    
    return [diff - margin, diff + margin];
  }

  private calculateRetentionRate(users: any[]): number {
    // Simplified retention calculation
    const activeUsers = users.filter(u => u.lastActiveDate && 
      (new Date().getTime() - new Date(u.lastActiveDate).getTime()) < (30 * 24 * 60 * 60 * 1000)
    );
    return users.length > 0 ? activeUsers.length / users.length : 0;
  }

  private calculateConversionFunnel(users: any[]): any {
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.isActive).length;
    const trialUsers = users.filter(u => u.hasTrial).length;
    const paidUsers = users.filter(u => u.isPaid).length;
    const retainedUsers = users.filter(u => u.isRetained).length;

    return {
      signupToActive: totalUsers > 0 ? activeUsers / totalUsers : 0,
      activeToTrial: activeUsers > 0 ? trialUsers / activeUsers : 0,
      trialToPaid: trialUsers > 0 ? paidUsers / trialUsers : 0,
      paidToRetained: paidUsers > 0 ? retainedUsers / paidUsers : 0
    };
  }

  private calculateChurnRisk(users: any[]): any {
    // Simplified churn risk scoring
    const avgDaysSinceLastActive = users.reduce((sum, u) => {
      const daysSince = u.lastActiveDate ? 
        (new Date().getTime() - new Date(u.lastActiveDate).getTime()) / (24 * 60 * 60 * 1000) : 30;
      return sum + daysSince;
    }, 0) / users.length;

    const score = Math.min(1, avgDaysSinceLastActive / 30); // 0-1 scale
    const factors = [];
    
    if (avgDaysSinceLastActive > 14) factors.push('Low recent activity');
    if (users.filter(u => u.supportTickets > 2).length / users.length > 0.1) factors.push('High support burden');
    if (users.filter(u => u.conversionRate < 0.05).length / users.length > 0.2) factors.push('Low conversion performance');

    return { score, primaryFactors: factors };
  }

  private normalCDF(z: number): number {
    // Simplified normal CDF approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    
    return z > 0 ? 1 - prob : prob;
  }

  private groupBy<T, K extends string | number | symbol>(
    array: T[], 
    keyFn: (item: T) => K
  ): Record<K, T[]> {
    return array.reduce((groups, item) => {
      const key = keyFn(item);
      groups[key] = groups[key] || [];
      groups[key].push(item);
      return groups;
    }, {} as Record<K, T[]>);
  }
}

// Global instance
export const executiveAnalytics = new ExecutiveAnalyticsEngine();