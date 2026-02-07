/**
 * Containment Middleware - SEV-2 Truth Reconciliation
 * CEO Authorization: 2026-01-19
 * 
 * Wires auth hygiene and DB latency tracking to actual request paths
 * Enforces Fleet SEO pause and scheduler caps
 */

import { Request, Response, NextFunction } from 'express';
import authHygiene from '../config/authHygiene';
import truthReconciliation from '../config/truthReconciliation';
import { telemetryEmitter } from '../monitoring/telemetryEmitter';

const BLOCKED_SEO_PATHS = [
  '/api/seo/',
  '/api/sitemap',
  '/api/indexnow',
  '/api/fleet/',
  '/api/etl/',
  '/api/bulk-analytics',
];

const BLOCKED_CRON_PATHS = [
  '/api/cron/',
  '/api/scheduler/',
  '/api/jobs/',
];

const ALLOWED_ESSENTIAL_PATHS = [
  '/api/auth/',
  '/api/oauth/',
  '/api/oidc/',
  '/api/payments/',
  '/api/watchtower/',
  '/api/containment/',
  '/api/telemetry/',
  '/api/health',
  '/health',
  '/readyz',
  '/livez',
];

export function containmentEnforcer(req: Request, res: Response, next: NextFunction) {
  const state = truthReconciliation.getTelemetryState();
  
  if (state.fleet_seo_paused) {
    const isBlockedSEO = BLOCKED_SEO_PATHS.some(path => req.path.startsWith(path));
    if (isBlockedSEO) {
      console.log(`[CONTAINMENT] BLOCKED SEO request: ${req.method} ${req.path}`);
      return res.status(503).json({
        error: 'service_unavailable',
        reason: 'fleet_seo_paused_sev2_containment',
        message: 'SEO services paused during SEV-2 containment',
      });
    }
  }
  
  if (state.schedulers_capped) {
    const isBlockedCron = BLOCKED_CRON_PATHS.some(path => req.path.startsWith(path));
    const isEssential = ALLOWED_ESSENTIAL_PATHS.some(path => req.path.startsWith(path));
    
    if (isBlockedCron && !isEssential) {
      console.log(`[CONTAINMENT] BLOCKED cron request: ${req.method} ${req.path}`);
      return res.status(503).json({
        error: 'service_unavailable',
        reason: 'schedulers_capped_sev2_containment',
        message: 'Non-essential schedulers paused during SEV-2 containment',
      });
    }
  }
  
  next();
}

export function authHygieneMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  const originalSend = res.send.bind(res);
  res.send = function(body: any) {
    const latencyMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    const isAuthPath = req.path.includes('/auth/') || 
                       req.path.includes('/login') || 
                       req.path.includes('/oauth/') ||
                       req.path.includes('/oidc/');
    
    if (isAuthPath) {
      authHygiene.recordAuthRequest(statusCode, latencyMs);
    }
    
    authHygiene.recordAppLatency(latencyMs);
    
    return originalSend(body);
  };
  
  next();
}

export function dbLatencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const dbQueryStart = process.hrtime.bigint();
  
  const originalJson = res.json.bind(res);
  res.json = function(body: any) {
    if (body && (body.query_time_ms || body._db_latency_ms)) {
      const dbLatency = body.query_time_ms || body._db_latency_ms;
      authHygiene.recordDBLatency(dbLatency);
    }
    return originalJson(body);
  };
  
  next();
}

export async function autoPageOnEventLoopLag(): Promise<void> {
  const state = truthReconciliation.getEventLoopLagState();
  
  if (state.alert_triggered) {
    const alertPayload = {
      kind: 'auto_page_event_loop_lag',
      source: 'scholar_auth_a1',
      event_type: 'sev1_auto_page',
      severity: 'SEV-1',
      metric: {
        event_loop_lag_p95_ms: state.p95_ms,
        threshold_ms: state.auto_page_threshold_ms,
        duration_seconds: state.auto_page_duration_seconds,
      },
      action: 'on_call_paged',
      timestamp: new Date().toISOString(),
    };
    
    console.log('[AUTO-PAGE] SEV-1: Event loop lag breach', alertPayload);
    
    try {
      await fetch('https://auto-com-center-jamarrlmayes.replit.app/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alertPayload),
      });
    } catch (error) {
      console.error('[AUTO-PAGE] Failed to post event to A8:', error);
    }
    
    telemetryEmitter.emit('sev1_auto_page', alertPayload);
  }
}

setInterval(autoPageOnEventLoopLag, 5000);

export function syntheticBaseUrlFix(): string {
  return process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
}

export function telemetryBackpressureMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/telemetry/')) {
    const emitterSource = (req.headers['x-emitter-source'] as string) || req.ip || 'unknown';
    const eventType = (req.body?.event_type as string) || 'unknown';
    
    if (!truthReconciliation.shouldSampleEvent(eventType)) {
      return res.status(202).json({
        accepted: true,
        sampled: false,
        reason: 'downsampled_due_to_backlog',
      });
    }
  }
  
  next();
}

export default {
  containmentEnforcer,
  authHygieneMiddleware,
  dbLatencyMiddleware,
  autoPageOnEventLoopLag,
  syntheticBaseUrlFix,
  telemetryBackpressureMiddleware,
};
