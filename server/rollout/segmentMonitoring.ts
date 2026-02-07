// 📊 SEGMENT-LEVEL HEALTH MONITORING
// Track precision, CSAT, and fairness by geo, device, traffic source

export interface SegmentMetrics {
  segmentId: string;
  segmentType: 'GEO' | 'DEVICE' | 'TRAFFIC_SOURCE' | 'USER_TYPE' | 'PROTECTED_GROUP';
  segmentName: string;
  
  // Core metrics
  precision: number;
  precisionDelta24h: number; // Change vs yesterday
  csat: number;
  csatDelta24h: number;
  
  // Volume and coverage
  userCount: number;
  queryCount: number;
  completionRate: number;
  
  // Fairness metrics (for protected groups)
  fairnessGap: number; // Percentage point gap vs overall
  
  // Performance
  p95Latency: number;
  errorRate: number;
  
  // Status
  healthStatus: 'HEALTHY' | 'WATCH' | 'CRITICAL';
  alertTriggers: string[];
  
  // Trend analysis
  trend7Days: 'IMPROVING' | 'STABLE' | 'DEGRADING';
  confidenceInterval: {
    precisionLower: number;
    precisionUpper: number;
  };
}

export interface SegmentAlert {
  segmentId: string;
  alertType: 'PRECISION_DRIFT' | 'FAIRNESS_BREACH' | 'VOLUME_DROP' | 'LATENCY_SPIKE' | 'ERROR_SPIKE';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  timestamp: string;
  currentValue: number;
  thresholdValue: number;
  recommendedActions: string[];
}

export class SegmentMonitoring {
  
  /**
   * Collect comprehensive segment metrics for all monitored segments
   */
  async collectSegmentMetrics(): Promise<SegmentMetrics[]> {
    const segments: SegmentMetrics[] = [];
    
    // Geographic segments
    segments.push(...this.generateGeoSegments());
    
    // Device segments  
    segments.push(...this.generateDeviceSegments());
    
    // Traffic source segments
    segments.push(...this.generateTrafficSegments());
    
    // User type segments
    segments.push(...this.generateUserTypeSegments());
    
    // Protected group segments (fairness monitoring)
    segments.push(...this.generateProtectedGroupSegments());
    
    return segments;
  }

  /**
   * Detect segment drift >2pp vs yesterday
   */
  async detectSegmentDrift(): Promise<SegmentAlert[]> {
    const segments = await this.collectSegmentMetrics();
    const alerts: SegmentAlert[] = [];
    
    for (const segment of segments) {
      // Precision drift detection
      if (Math.abs(segment.precisionDelta24h) > 2.0) {
        alerts.push({
          segmentId: segment.segmentId,
          alertType: 'PRECISION_DRIFT',
          severity: Math.abs(segment.precisionDelta24h) > 5.0 ? 'CRITICAL' : 'WARNING',
          message: `Precision ${segment.precisionDelta24h > 0 ? 'increased' : 'decreased'} by ${Math.abs(segment.precisionDelta24h).toFixed(1)}pp in ${segment.segmentName}`,
          timestamp: new Date().toISOString(),
          currentValue: segment.precision,
          thresholdValue: 2.0,
          recommendedActions: [
            'Investigate query pattern changes in segment',
            'Review recent model updates affecting this segment',
            'Check for data quality issues in segment training data'
          ]
        });
      }

      // Fairness breach detection (>5pp gap)
      if (segment.segmentType === 'PROTECTED_GROUP' && segment.fairnessGap > 5.0) {
        alerts.push({
          segmentId: segment.segmentId,
          alertType: 'FAIRNESS_BREACH',
          severity: 'CRITICAL',
          message: `Fairness gap of ${segment.fairnessGap.toFixed(1)}pp detected for ${segment.segmentName}`,
          timestamp: new Date().toISOString(),
          currentValue: segment.fairnessGap,
          thresholdValue: 5.0,
          recommendedActions: [
            'IMMEDIATE: Implement bias mitigation for this group',
            'Review training data representation',
            'Consider segment-specific prompt adjustments',
            'Escalate to Legal/Compliance team'
          ]
        });
      }

      // Volume drop detection
      if (segment.userCount < 100 && segment.segmentType !== 'PROTECTED_GROUP') {
        alerts.push({
          segmentId: segment.segmentId,
          alertType: 'VOLUME_DROP',
          severity: 'WARNING',
          message: `Low user volume (${segment.userCount}) in ${segment.segmentName} may affect metric reliability`,
          timestamp: new Date().toISOString(),
          currentValue: segment.userCount,
          thresholdValue: 100,
          recommendedActions: [
            'Monitor for statistical significance',
            'Consider segment consolidation if volume remains low',
            'Validate segment definition accuracy'
          ]
        });
      }

      // Performance alerts
      if (segment.p95Latency > 120) {
        alerts.push({
          segmentId: segment.segmentId,
          alertType: 'LATENCY_SPIKE',
          severity: segment.p95Latency > 150 ? 'CRITICAL' : 'WARNING',
          message: `High latency ${segment.p95Latency.toFixed(1)}ms in ${segment.segmentName}`,
          timestamp: new Date().toISOString(),
          currentValue: segment.p95Latency,
          thresholdValue: 120,
          recommendedActions: [
            'Check region-specific infrastructure',
            'Review caching effectiveness for segment',
            'Investigate model inference bottlenecks'
          ]
        });
      }
    }
    
    return alerts;
  }

  /**
   * Generate executive segment health summary
   */
  async generateSegmentHealthSummary(): Promise<{
    overallHealth: 'HEALTHY' | 'MIXED' | 'CRITICAL';
    segmentCount: number;
    healthySegments: number;
    watchSegments: number;
    criticalSegments: number;
    activeAlerts: SegmentAlert[];
    topRisks: string[];
    fairnessStatus: 'COMPLIANT' | 'WATCH' | 'BREACH';
    precisionConsistency: 'CONSISTENT' | 'VARIABLE' | 'INCONSISTENT';
  }> {
    const segments = await this.collectSegmentMetrics();
    const alerts = await this.detectSegmentDrift();
    
    const healthyCount = segments.filter(s => s.healthStatus === 'HEALTHY').length;
    const watchCount = segments.filter(s => s.healthStatus === 'WATCH').length;
    const criticalCount = segments.filter(s => s.healthStatus === 'CRITICAL').length;
    
    const overallHealth = criticalCount > 0 ? 'CRITICAL' : 
                         watchCount > 0 ? 'MIXED' : 'HEALTHY';
    
    // Check fairness compliance
    const protectedGroups = segments.filter(s => s.segmentType === 'PROTECTED_GROUP');
    const fairnessBreach = protectedGroups.some(g => g.fairnessGap > 5.0);
    const fairnessWatch = protectedGroups.some(g => g.fairnessGap > 3.0);
    const fairnessStatus = fairnessBreach ? 'BREACH' : fairnessWatch ? 'WATCH' : 'COMPLIANT';
    
    // Check precision consistency
    const precisionRange = Math.max(...segments.map(s => s.precision)) - 
                           Math.min(...segments.map(s => s.precision));
    const precisionConsistency = precisionRange > 10 ? 'INCONSISTENT' :
                                precisionRange > 5 ? 'VARIABLE' : 'CONSISTENT';
    
    // Identify top risks
    const topRisks = this.identifyTopRisks(segments, alerts);
    
    return {
      overallHealth,
      segmentCount: segments.length,
      healthySegments: healthyCount,
      watchSegments: watchCount,
      criticalSegments: criticalCount,
      activeAlerts: alerts,
      topRisks,
      fairnessStatus,
      precisionConsistency
    };
  }

  // Private helper methods for generating segment data

  private generateGeoSegments(): SegmentMetrics[] {
    return [
      {
        segmentId: 'geo_us',
        segmentType: 'GEO',
        segmentName: 'United States',
        precision: 70.2,
        precisionDelta24h: 0.3,
        csat: 4.8,
        csatDelta24h: 0.1,
        userCount: 150000,
        queryCount: 450000,
        completionRate: 87.5,
        fairnessGap: 0,
        p95Latency: 98.5,
        errorRate: 0.25,
        healthStatus: 'HEALTHY',
        alertTriggers: [],
        trend7Days: 'STABLE',
        confidenceInterval: { precisionLower: 69.8, precisionUpper: 70.6 }
      },
      {
        segmentId: 'geo_international',
        segmentType: 'GEO',
        segmentName: 'International',
        precision: 69.8,
        precisionDelta24h: -0.4,
        csat: 4.7,
        csatDelta24h: -0.1,
        userCount: 100000,
        queryCount: 300000,
        completionRate: 85.2,
        fairnessGap: 0,
        p95Latency: 125.8,
        errorRate: 0.35,
        healthStatus: 'WATCH',
        alertTriggers: ['P95 latency elevated'],
        trend7Days: 'STABLE',
        confidenceInterval: { precisionLower: 69.3, precisionUpper: 70.3 }
      }
    ];
  }

  private generateDeviceSegments(): SegmentMetrics[] {
    return [
      {
        segmentId: 'device_mobile',
        segmentType: 'DEVICE',
        segmentName: 'Mobile',
        precision: 69.5,
        precisionDelta24h: -0.2,
        csat: 4.7,
        csatDelta24h: 0,
        userCount: 180000,
        queryCount: 540000,
        completionRate: 86.1,
        fairnessGap: 0,
        p95Latency: 110.2,
        errorRate: 0.32,
        healthStatus: 'HEALTHY',
        alertTriggers: [],
        trend7Days: 'STABLE',
        confidenceInterval: { precisionLower: 69.0, precisionUpper: 70.0 }
      },
      {
        segmentId: 'device_desktop',
        segmentType: 'DEVICE',
        segmentName: 'Desktop',
        precision: 70.8,
        precisionDelta24h: 0.5,
        csat: 4.9,
        csatDelta24h: 0.2,
        userCount: 70000,
        queryCount: 210000,
        completionRate: 88.9,
        fairnessGap: 0,
        p95Latency: 95.1,
        errorRate: 0.22,
        healthStatus: 'HEALTHY',
        alertTriggers: [],
        trend7Days: 'IMPROVING',
        confidenceInterval: { precisionLower: 70.2, precisionUpper: 71.4 }
      }
    ];
  }

  private generateTrafficSegments(): SegmentMetrics[] {
    return [
      {
        segmentId: 'traffic_seo',
        segmentType: 'TRAFFIC_SOURCE',
        segmentName: 'Organic Search',
        precision: 71.0,
        precisionDelta24h: 0.8,
        csat: 4.8,
        csatDelta24h: 0.1,
        userCount: 120000,
        queryCount: 360000,
        completionRate: 88.2,
        fairnessGap: 0,
        p95Latency: 102.3,
        errorRate: 0.28,
        healthStatus: 'HEALTHY',
        alertTriggers: [],
        trend7Days: 'IMPROVING',
        confidenceInterval: { precisionLower: 70.5, precisionUpper: 71.5 }
      },
      {
        segmentId: 'traffic_paid',
        segmentType: 'TRAFFIC_SOURCE',
        segmentName: 'Paid Search',
        precision: 68.9,
        precisionDelta24h: -1.1,
        csat: 4.7,
        csatDelta24h: -0.2,
        userCount: 80000,
        queryCount: 240000,
        completionRate: 85.7,
        fairnessGap: 0,
        p95Latency: 107.8,
        errorRate: 0.31,
        healthStatus: 'WATCH',
        alertTriggers: ['Precision decline >1pp'],
        trend7Days: 'DEGRADING',
        confidenceInterval: { precisionLower: 68.3, precisionUpper: 69.5 }
      }
    ];
  }

  private generateUserTypeSegments(): SegmentMetrics[] {
    return [
      {
        segmentId: 'user_returning',
        segmentType: 'USER_TYPE',
        segmentName: 'Returning Users',
        precision: 71.5,
        precisionDelta24h: 0.3,
        csat: 4.9,
        csatDelta24h: 0.1,
        userCount: 90000,
        queryCount: 360000,
        completionRate: 91.2,
        fairnessGap: 0,
        p95Latency: 98.7,
        errorRate: 0.24,
        healthStatus: 'HEALTHY',
        alertTriggers: [],
        trend7Days: 'STABLE',
        confidenceInterval: { precisionLower: 70.9, precisionUpper: 72.1 }
      },
      {
        segmentId: 'user_first_time',
        segmentType: 'USER_TYPE',
        segmentName: 'First-time Users',
        precision: 69.1,
        precisionDelta24h: -0.8,
        csat: 4.6,
        csatDelta24h: -0.3,
        userCount: 160000,
        queryCount: 390000,
        completionRate: 83.4,
        fairnessGap: 0,
        p95Latency: 112.5,
        errorRate: 0.35,
        healthStatus: 'WATCH',
        alertTriggers: ['CSAT near threshold'],
        trend7Days: 'STABLE',
        confidenceInterval: { precisionLower: 68.5, precisionUpper: 69.7 }
      }
    ];
  }

  private generateProtectedGroupSegments(): SegmentMetrics[] {
    return [
      {
        segmentId: 'protected_age_18_24',
        segmentType: 'PROTECTED_GROUP',
        segmentName: 'Age 18-24',
        precision: 67.9, // 2.1pp below overall 70%
        precisionDelta24h: -0.3,
        csat: 4.7,
        csatDelta24h: 0,
        userCount: 45000,
        queryCount: 135000,
        completionRate: 84.8,
        fairnessGap: 2.1, // Within 5pp threshold
        p95Latency: 108.2,
        errorRate: 0.29,
        healthStatus: 'HEALTHY',
        alertTriggers: [],
        trend7Days: 'STABLE',
        confidenceInterval: { precisionLower: 67.2, precisionUpper: 68.6 }
      },
      {
        segmentId: 'protected_gender_female',
        segmentType: 'PROTECTED_GROUP',
        segmentName: 'Female Users',
        precision: 68.2, // 1.8pp below overall
        precisionDelta24h: 0.1,
        csat: 4.8,
        csatDelta24h: 0.1,
        userCount: 125000,
        queryCount: 375000,
        completionRate: 86.9,
        fairnessGap: 1.8, // Within threshold
        p95Latency: 103.7,
        errorRate: 0.27,
        healthStatus: 'HEALTHY',
        alertTriggers: [],
        trend7Days: 'STABLE',
        confidenceInterval: { precisionLower: 67.7, precisionUpper: 68.7 }
      }
    ];
  }

  private identifyTopRisks(segments: SegmentMetrics[], alerts: SegmentAlert[]): string[] {
    const risks = [];
    
    // Critical alerts become top risks
    const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL');
    risks.push(...criticalAlerts.map(a => a.message));
    
    // Segments near thresholds
    const nearThresholds = segments.filter(s => 
      s.precision < 69 || // Near 68% floor
      s.csat < 4.7 || // Near 4.6 threshold
      s.p95Latency > 115 // Near 120ms threshold
    );
    
    if (nearThresholds.length > 0) {
      risks.push(`${nearThresholds.length} segments approaching threshold limits`);
    }
    
    // Trending risks
    const degradingSegments = segments.filter(s => s.trend7Days === 'DEGRADING');
    if (degradingSegments.length > 2) {
      risks.push(`${degradingSegments.length} segments showing degrading 7-day trends`);
    }

    return risks.slice(0, 5); // Top 5 risks
  }
}

// Global instance
export const segmentMonitor = new SegmentMonitoring();