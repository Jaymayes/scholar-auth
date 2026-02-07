/**
 * Banner Manager Service
 * Issue C Implementation: Auto-clear incident banners after recovery
 * 
 * Design:
 * - Banners have TTL and auto-clear after 10 minutes of green health
 * - Admin clear endpoint for manual dismissal
 * - State persisted in memory (production should use Redis/PostgreSQL)
 */

import { isFeatureEnabled } from '../config/featureFlags';

interface Banner {
  id: string;
  type: 'incident' | 'warning' | 'info' | 'success';
  message: string;
  createdAt: Date;
  expiresAt: Date | null;
  autoCleared: boolean;
  healthyStartTime: Date | null;
  source: string;
}

interface BannerManagerConfig {
  defaultTtlMs: number;
  autoClearAfterGreenMs: number;
  maxBanners: number;
}

class BannerManager {
  private banners: Map<string, Banner> = new Map();
  private config: BannerManagerConfig = {
    defaultTtlMs: 24 * 60 * 60 * 1000, // 24 hours default TTL
    autoClearAfterGreenMs: 10 * 60 * 1000, // 10 minutes of green = auto-clear
    maxBanners: 10,
  };
  private healthyStartTime: Date | null = null;
  private lastHealthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start auto-clear checker if feature is enabled
    if (isFeatureEnabled('BANNER_AUTO_CLEAR')) {
      this.startAutoClearChecker();
    }
  }

  /**
   * Create or update a banner
   */
  createBanner(
    id: string,
    type: Banner['type'],
    message: string,
    options?: {
      ttlMs?: number;
      source?: string;
    }
  ): Banner {
    const ttlMs = options?.ttlMs ?? this.config.defaultTtlMs;
    
    const banner: Banner = {
      id,
      type,
      message,
      createdAt: new Date(),
      expiresAt: ttlMs > 0 ? new Date(Date.now() + ttlMs) : null,
      autoCleared: false,
      healthyStartTime: null,
      source: options?.source || 'system',
    };

    this.banners.set(id, banner);
    
    // Enforce max banners
    if (this.banners.size > this.config.maxBanners) {
      const oldestKey = this.banners.keys().next().value;
      if (oldestKey) this.banners.delete(oldestKey);
    }

    console.log(`[BannerManager] Created banner: ${id} (${type})`);
    return banner;
  }

  /**
   * Clear a specific banner
   */
  clearBanner(id: string, reason: 'manual' | 'auto_clear' | 'expired' = 'manual'): boolean {
    const banner = this.banners.get(id);
    if (!banner) return false;

    if (reason === 'auto_clear') {
      banner.autoCleared = true;
    }

    this.banners.delete(id);
    console.log(`[BannerManager] Cleared banner: ${id} (${reason})`);
    return true;
  }

  /**
   * Clear all banners by type
   */
  clearBannersByType(type: Banner['type'], reason: 'manual' | 'auto_clear' = 'manual'): number {
    let cleared = 0;
    for (const [id, banner] of Array.from(this.banners.entries())) {
      if (banner.type === type) {
        this.clearBanner(id, reason);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Clear all incident banners (admin action)
   */
  clearAllIncidentBanners(): number {
    return this.clearBannersByType('incident', 'manual');
  }

  /**
   * Get all active banners
   */
  getActiveBanners(): Banner[] {
    const now = new Date();
    const active: Banner[] = [];

    for (const [id, banner] of Array.from(this.banners.entries())) {
      // Check TTL expiration
      if (banner.expiresAt && banner.expiresAt < now) {
        this.clearBanner(id, 'expired');
        continue;
      }
      active.push(banner);
    }

    return active;
  }

  /**
   * Get incident banners only
   */
  getIncidentBanners(): Banner[] {
    return this.getActiveBanners().filter(b => b.type === 'incident');
  }

  /**
   * Update health status for auto-clear tracking
   * Call this on every health check
   */
  updateHealthStatus(status: 'healthy' | 'degraded' | 'unhealthy'): void {
    if (!isFeatureEnabled('BANNER_AUTO_CLEAR')) return;

    const previousStatus = this.lastHealthStatus;
    this.lastHealthStatus = status;

    if (status === 'healthy') {
      // Start tracking healthy time if transitioning to healthy
      if (previousStatus !== 'healthy') {
        this.healthyStartTime = new Date();
        console.log('[BannerManager] Health status: healthy - starting recovery timer');
      }
    } else {
      // Reset healthy timer on any non-healthy status
      if (this.healthyStartTime) {
        console.log(`[BannerManager] Health status: ${status} - reset recovery timer`);
      }
      this.healthyStartTime = null;
    }
  }

  /**
   * Start background checker for auto-clear
   */
  private startAutoClearChecker(): void {
    if (this.checkInterval) return;

    console.log('[BannerManager] Auto-clear checker started');
    this.checkInterval = setInterval(() => {
      this.checkAutoClear();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop background checker
   */
  stopAutoClearChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check if auto-clear conditions are met
   */
  private checkAutoClear(): void {
    if (!this.healthyStartTime) return;

    const healthyDuration = Date.now() - this.healthyStartTime.getTime();
    
    if (healthyDuration >= this.config.autoClearAfterGreenMs) {
      const incidentBanners = this.getIncidentBanners();
      
      if (incidentBanners.length > 0) {
        console.log(`[BannerManager] Auto-clearing ${incidentBanners.length} incident banners after ${Math.round(healthyDuration / 60000)} minutes of healthy status`);
        
        for (const banner of incidentBanners) {
          this.clearBanner(banner.id, 'auto_clear');
        }
      }
    }
  }

  /**
   * Get banner manager status for monitoring
   */
  getStatus(): {
    activeBanners: number;
    incidentBanners: number;
    lastHealthStatus: string;
    healthyDurationMs: number | null;
    autoClearEnabled: boolean;
    autoClearThresholdMs: number;
  } {
    return {
      activeBanners: this.banners.size,
      incidentBanners: this.getIncidentBanners().length,
      lastHealthStatus: this.lastHealthStatus,
      healthyDurationMs: this.healthyStartTime 
        ? Date.now() - this.healthyStartTime.getTime() 
        : null,
      autoClearEnabled: isFeatureEnabled('BANNER_AUTO_CLEAR'),
      autoClearThresholdMs: this.config.autoClearAfterGreenMs,
    };
  }
}

export const bannerManager = new BannerManager();
export default bannerManager;
