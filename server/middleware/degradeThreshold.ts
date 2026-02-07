/**
 * Degrade Threshold Middleware
 * 
 * CEO Directive: P95 > 180ms sustained for 10 minutes triggers degraded mode
 * Auto-enable caching/feature flags before rollback triggers
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';

interface PerformanceWindow {
  p95: number[];
  timestamp: number[];
}

class DegradeThresholdMonitor {
  private performanceWindow: PerformanceWindow = {
    p95: [],
    timestamp: [],
  };
  
  private isDegraded = false;
  private breachStartTime: number | null = null; // Track when breach started
  private readonly P95_DEGRADE_THRESHOLD = 180; // ms
  private readonly WINDOW_DURATION = 10 * 60 * 1000; // 10 minutes
  private readonly SAMPLE_INTERVAL = 30 * 1000; // 30 seconds
  
  /**
   * Record P95 latency sample
   */
  recordP95(latency: number) {
    const now = Date.now();
    
    // Add new sample
    this.performanceWindow.p95.push(latency);
    this.performanceWindow.timestamp.push(now);
    
    // Remove samples outside the 10-minute window
    const cutoff = now - this.WINDOW_DURATION;
    const validIndices = this.performanceWindow.timestamp
      .map((ts, idx) => ts >= cutoff ? idx : -1)
      .filter(idx => idx !== -1);
    
    this.performanceWindow.p95 = validIndices.map(idx => this.performanceWindow.p95[idx]);
    this.performanceWindow.timestamp = validIndices.map(idx => this.performanceWindow.timestamp[idx]);
    
    // Check if we should enter degraded mode
    this.checkDegradeThreshold();
  }
  
  /**
   * Calculate P95 from latency samples
   */
  private calculateP95(samples: number[]): number {
    if (samples.length === 0) return 0;
    
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
  
  /**
   * Check if P95 > 180ms sustained for 10 minutes
   * CEO DIRECTIVE: Use actual P95 calculation and track breach duration
   */
  private checkDegradeThreshold() {
    if (this.performanceWindow.p95.length === 0) return;
    
    // CEO DIRECTIVE: Calculate TRUE P95 from rolling window
    const actualP95 = this.calculateP95(this.performanceWindow.p95);
    const now = Date.now();
    
    // Track breach start time
    if (actualP95 > this.P95_DEGRADE_THRESHOLD) {
      if (this.breachStartTime === null) {
        this.breachStartTime = now;
      }
      
      // Check if sustained for 10 minutes
      const breachDuration = now - this.breachStartTime;
      const isSustained = breachDuration >= this.WINDOW_DURATION;
      
      if (isSustained && !this.isDegraded) {
        this.enterDegradedMode(actualP95);
      }
    } else {
      // P95 dropped below threshold - reset breach tracking
      this.breachStartTime = null;
      
      if (this.isDegraded) {
        this.exitDegradedMode(actualP95);
      }
    }
  }
  
  /**
   * Enter degraded mode: enable caching, feature flags
   */
  private enterDegradedMode(avgP95: number) {
    this.isDegraded = true;
    
    logger.warn('ENTERING DEGRADED MODE', {
      avgP95,
      threshold: this.P95_DEGRADE_THRESHOLD,
      windowDuration: this.WINDOW_DURATION / 1000,
      sampleCount: this.performanceWindow.p95.length,
    });
    
    // CEO DIRECTIVE: Enable aggressive caching
    process.env.AGGRESSIVE_CACHE = 'true';
    
    // CEO DIRECTIVE: Disable expensive features
    process.env.DISABLE_EXPENSIVE_FEATURES = 'true';
    
    // CEO DIRECTIVE: Increase cache TTLs
    process.env.CACHE_TTL_MULTIPLIER = '3'; // 3x normal TTL
    
    // CEO DIRECTIVE: Enable response compression
    process.env.ENABLE_COMPRESSION = 'true';
    
    // Alert SRE team
    console.error('🚨 DEGRADED MODE ACTIVE - P95 THRESHOLD EXCEEDED');
    console.error('   Actions: Aggressive caching enabled, expensive features disabled');
  }
  
  /**
   * Exit degraded mode: restore normal operation
   */
  private exitDegradedMode(avgP95: number) {
    this.isDegraded = false;
    
    logger.info('EXITING DEGRADED MODE', {
      avgP95,
      threshold: this.P95_DEGRADE_THRESHOLD,
    });
    
    // CEO DIRECTIVE: Restore normal caching
    delete process.env.AGGRESSIVE_CACHE;
    
    // CEO DIRECTIVE: Re-enable features
    delete process.env.DISABLE_EXPENSIVE_FEATURES;
    
    // CEO DIRECTIVE: Restore normal cache TTLs
    delete process.env.CACHE_TTL_MULTIPLIER;
    
    // CEO DIRECTIVE: Restore normal compression
    delete process.env.ENABLE_COMPRESSION;
    
    console.log('✅ DEGRADED MODE CLEARED - NORMAL OPERATION RESUMED');
  }
  
  /**
   * Get current degraded mode status
   */
  getStatus() {
    return {
      isDegraded: this.isDegraded,
      currentP95: this.performanceWindow.p95[this.performanceWindow.p95.length - 1] || 0,
      avgP95: this.performanceWindow.p95.length > 0
        ? this.performanceWindow.p95.reduce((a, b) => a + b, 0) / this.performanceWindow.p95.length
        : 0,
      sampleCount: this.performanceWindow.p95.length,
    };
  }
}

// Singleton instance
export const degradeMonitor = new DegradeThresholdMonitor();

/**
 * Middleware to track request latency and update degrade threshold
 * CEO DIRECTIVE: Feed real latency samples every 30 seconds
 */
export function degradeThresholdMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const latency = Date.now() - startTime;
    
    // CEO DIRECTIVE: Record all API request latencies for accurate P95
    // Sample strategically: all auth/OIDC requests, 50% of other API requests
    const isAuthRequest = req.path.includes('/oidc') || 
                          req.path.includes('/auth') || 
                          req.path.includes('/api/health');
    
    if (isAuthRequest || Math.random() < 0.5) {
      degradeMonitor.recordP95(latency);
    }
  });
  
  next();
}

/**
 * Health check endpoint for degrade status
 */
export function getDegradeStatus() {
  return degradeMonitor.getStatus();
}
