import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';

interface ProbeSuppressionConfig {
  suppressMetricsP95: boolean;
  suppressLocalhostChecks: boolean;
  allowedSyntheticIPs: string[];
  wafSitemapBlockActive: boolean;
}

const config: ProbeSuppressionConfig = {
  suppressMetricsP95: process.env.SUPPRESS_METRICS_P95 !== 'false',
  suppressLocalhostChecks: process.env.SUPPRESS_LOCALHOST_CHECKS !== 'false',
  allowedSyntheticIPs: (process.env.SYNTHETIC_IPS_ALLOWLIST || '').split(',').filter(Boolean),
  wafSitemapBlockActive: process.env.WAF_SITEMAP_BLOCK !== 'false',
};

let metricsP95Blocked = 0;
let localhostBlocked = 0;
let sitemapBlocked = 0;

export function probeSuppression(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;
  const ip = req.ip || req.socket.remoteAddress || '';
  
  // 📊 METRICS ENDPOINT: /metrics/p95 is now ALLOWED for SEV-1 Phase 3 performance monitoring
  // This is the official metrics endpoint, not a probe, so we don't suppress it
  // if (config.suppressMetricsP95 && path === '/metrics/p95') {
  //   metricsP95Blocked++;
  //   res.status(410).json({
  //     error: 'endpoint_disabled',
  //     message: 'Compute p95 in A8 instead',
  //     timestamp: new Date().toISOString(),
  //   });
  //   return;
  // }
  
  if (config.suppressLocalhostChecks && (ip === '127.0.0.1' || ip === '::1' || ip.includes('localhost'))) {
    // 🎯 TASK 2: Allow internal warmup requests to bypass suppression
    const isWarmupRequest = req.get('X-Warmup-Request') === 'true';
    if (isWarmupRequest) {
      // Internal warmup - allow through
      next();
      return;
    }
    
    // 📊 METRICS ENDPOINT: /metrics/p95 is ALLOWED for localhost (development and internal testing)
    // Only block /health probes from localhost
    if (path.startsWith('/health')) {
      localhostBlocked++;
      res.status(410).json({
        error: 'localhost_probe_disabled',
        message: 'External monitoring only during SEV-1',
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }
  
  if (config.wafSitemapBlockActive && path === '/sitemap.xml') {
    const isAllowedSynthetic = config.allowedSyntheticIPs.includes(ip);
    if (!isAllowedSynthetic) {
      sitemapBlocked++;
      res.status(429).json({
        error: 'too_many_requests',
        message: 'Sitemap access rate limited during SEV-1',
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }
  
  next();
}

export function getProbeSuppressionStats(): {
  metricsP95Blocked: number;
  localhostBlocked: number;
  sitemapBlocked: number;
  config: ProbeSuppressionConfig;
} {
  return {
    metricsP95Blocked,
    localhostBlocked,
    sitemapBlocked,
    config,
  };
}

export function isProbeSuppressionActive(): boolean {
  return config.suppressMetricsP95 || config.suppressLocalhostChecks || config.wafSitemapBlockActive;
}
