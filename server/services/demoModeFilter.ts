/**
 * Demo Mode Filter Service
 * Issue D Implementation: Safe simulation without analytics pollution
 * 
 * Design:
 * - Feature-flagged "Demo Mode" toggle
 * - When ON: Render simulated revenue (namespace=simulated_audit OR stripe_mode=test)
 * - When OFF: Filter these out so they never pollute live analytics
 * - Visible badge and tile scoping in UI
 */

import { isFeatureEnabled } from '../config/featureFlags';

interface AnalyticsEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  namespace?: string;
  stripe_mode?: 'live' | 'test';
  amount?: number;
  currency?: string;
  [key: string]: unknown;
}

interface DemoModeConfig {
  enabled: boolean;
  namespacePatterns: string[];
  stripeModeFilters: ('test' | 'live')[];
  badgeLabel: string;
}

class DemoModeFilter {
  private config: DemoModeConfig;

  constructor() {
    this.config = {
      enabled: isFeatureEnabled('DEMO_MODE_ANALYTICS'),
      namespacePatterns: [
        'simulated_audit',  // Exact match or prefix
        'demo_',            // Prefix match only
        'test_namespace',   // Exact match for test namespaces
        'staging_audit',    // Exact match for staging audits
      ],
      stripeModeFilters: ['test'],
      badgeLabel: 'Simulated Data',
    };
  }

  /**
   * Check if Demo Mode is currently active
   */
  isDemoModeActive(): boolean {
    return this.config.enabled && isFeatureEnabled('DEMO_MODE_ANALYTICS');
  }

  /**
   * Check if an event is simulated/demo data
   * Uses strict prefix matching to avoid false positives on production namespaces
   */
  isSimulatedEvent(event: AnalyticsEvent): boolean {
    // Check namespace patterns - use STRICT PREFIX matching only
    if (event.namespace) {
      const ns = event.namespace.toLowerCase();
      
      // Exact matches for known simulation namespaces
      if (ns === 'simulated_audit' || ns.startsWith('simulated_audit_')) {
        return true;
      }
      
      // Prefix matches for demo/staging namespaces (must be at start)
      if (ns.startsWith('demo_') || ns.startsWith('demo-')) {
        return true;
      }
      
      // Prefix match for explicit test namespaces (not substring match)
      if (ns.startsWith('test_namespace') || ns.startsWith('staging_audit')) {
        return true;
      }
    }

    // Check Stripe mode - test mode is always simulated
    if (event.stripe_mode && this.config.stripeModeFilters.includes(event.stripe_mode)) {
      return true;
    }

    return false;
  }

  /**
   * Filter events based on Demo Mode state
   * - Demo Mode ON: Include simulated events
   * - Demo Mode OFF: Exclude simulated events
   */
  filterEvents(events: AnalyticsEvent[]): AnalyticsEvent[] {
    const demoModeActive = this.isDemoModeActive();

    return events.filter(event => {
      const isSimulated = this.isSimulatedEvent(event);
      
      if (demoModeActive) {
        // Demo Mode ON: Show ONLY simulated data
        return isSimulated;
      } else {
        // Demo Mode OFF: Show ONLY live data (filter out simulated)
        return !isSimulated;
      }
    });
  }

  /**
   * Annotate events with demo mode metadata
   */
  annotateEvents(events: AnalyticsEvent[]): (AnalyticsEvent & { _demo_mode: boolean; _badge?: string })[] {
    return events.map(event => ({
      ...event,
      _demo_mode: this.isSimulatedEvent(event),
      _badge: this.isSimulatedEvent(event) ? this.config.badgeLabel : undefined,
    }));
  }

  /**
   * Get revenue summary with demo mode awareness
   */
  getRevenueSummary(events: AnalyticsEvent[]): {
    liveRevenue: number;
    simulatedRevenue: number;
    displayRevenue: number;
    demoModeActive: boolean;
    currency: string;
  } {
    let liveRevenue = 0;
    let simulatedRevenue = 0;

    for (const event of events) {
      if (event.event_type === 'PaymentSuccess' && event.amount) {
        if (this.isSimulatedEvent(event)) {
          simulatedRevenue += event.amount;
        } else {
          liveRevenue += event.amount;
        }
      }
    }

    const demoModeActive = this.isDemoModeActive();

    return {
      liveRevenue,
      simulatedRevenue,
      displayRevenue: demoModeActive ? simulatedRevenue : liveRevenue,
      demoModeActive,
      currency: 'USD',
    };
  }

  /**
   * Get demo mode status for API response
   */
  getStatus(): {
    demoModeActive: boolean;
    badgeLabel: string;
    namespaceFilters: string[];
    stripeModeFilters: string[];
  } {
    return {
      demoModeActive: this.isDemoModeActive(),
      badgeLabel: this.config.badgeLabel,
      namespaceFilters: this.config.namespacePatterns,
      stripeModeFilters: this.config.stripeModeFilters,
    };
  }

  /**
   * Toggle demo mode (for admin UI)
   * Note: This only works if the feature flag is enabled
   */
  setDemoMode(enabled: boolean): boolean {
    if (!isFeatureEnabled('DEMO_MODE_ANALYTICS')) {
      console.warn('[DemoModeFilter] Cannot toggle - feature flag is disabled');
      return false;
    }
    
    this.config.enabled = enabled;
    console.log(`[DemoModeFilter] Demo mode ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }
}

export const demoModeFilter = new DemoModeFilter();
export default demoModeFilter;
