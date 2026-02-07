/**
 * WAF Middleware - Web Application Firewall with Trust-by-Secret Bypass
 * CEO Directive: Gate-2 Stabilization - Clean Observability
 * 
 * Implements:
 * - Trust-by-Secret bypass for authenticated S2S telemetry requests
 * - CIDR-based trust for internal services
 * - SQLi detection (strong patterns only, no false positives)
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';

// Trusted CIDR ranges for Replit/GCP internal services
const TRUSTED_CIDRS = [
  { network: '35.184.0.0', mask: 13 },    // 35.184.0.0/13 (GCP us-central1)
  { network: '35.192.0.0', mask: 12 },    // 35.192.0.0/12 (GCP us-central1)
  { network: '10.0.0.0', mask: 8 },       // 10.0.0.0/8 (Internal)
];

// Telemetry paths that can bypass WAF with valid secret
const TELEMETRY_BYPASS_PATHS = [
  '/api/telemetry/ingest',
  '/telemetry/ingest',
  '/api/events',
];

// Strong SQLi patterns (high confidence, low false positive rate)
const SQLI_PATTERNS = [
  /\b(UNION\s+(ALL\s+)?SELECT)\b/i,           // UNION SELECT injection
  /\b(OR|AND)\s+['"]?1['"]?\s*=\s*['"]?1/i,   // OR 1=1 / AND 1=1
  /\b(OR|AND)\s+['"]?[a-z]+['"]?\s*=\s*['"]?[a-z]+['"]?\s*(--|\#|\/\*)/i, // OR x=x with comment
  /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE)\s/i, // Chained destructive statements
  /\b(sp_|xp_)\w+/i,                          // SQL Server stored procedures
  /(LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i, // File operations
  /\bWAITFOR\s+DELAY\b/i,                     // Time-based injection (SQL Server)
  /\bSLEEP\s*\(\s*\d+\s*\)/i,                 // Time-based injection (MySQL)
  /\bBENCHMARK\s*\(/i,                        // Time-based injection (MySQL)
  /\bPG_SLEEP\s*\(/i,                         // Time-based injection (PostgreSQL)
];

// NOTE: Deliberately NOT including encoded quote patterns (\x27|\x22|\x27|\x22)
// as these cause false positives with legitimate JSON payloads in telemetry

interface WafResult {
  allowed: boolean;
  reason: string;
  bypassType?: 'trust_by_secret' | 'cidr_trusted' | 'normal_flow';
}

/**
 * Convert IP address to 32-bit integer
 */
function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return 0;
  }
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

/**
 * Check if IP is within a CIDR range
 */
function isIpInCidr(ip: string, network: string, mask: number): boolean {
  const ipInt = ipToInt(ip);
  const networkInt = ipToInt(network);
  const maskBits = ~((1 << (32 - mask)) - 1);
  return (ipInt & maskBits) === (networkInt & maskBits);
}

/**
 * Check if IP is in any trusted CIDR
 */
function isIpTrusted(ip: string): boolean {
  if (!ip) return false;
  
  // Handle IPv6 localhost
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return true;
  }
  
  // Strip IPv6 prefix if present
  const cleanIp = ip.replace(/^::ffff:/, '');
  
  return TRUSTED_CIDRS.some(cidr => isIpInCidr(cleanIp, cidr.network, cidr.mask));
}

/**
 * Get client IP from request (respects trust proxy setting)
 */
function getClientIp(req: Request): string {
  // Express populates req.ip when trust proxy is enabled
  const ip = req.ip || 
             (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
             req.socket?.remoteAddress ||
             '';
  return ip;
}

/**
 * Check if request should bypass WAF (Trust-by-Secret)
 */
function shouldBypassWaf(req: Request): WafResult {
  const path = req.path;
  const isTelemetryPath = TELEMETRY_BYPASS_PATHS.some(p => path === p || path.startsWith(p));
  
  if (!isTelemetryPath) {
    return { allowed: true, reason: 'Not a telemetry path, normal WAF flow', bypassType: 'normal_flow' };
  }
  
  const sharedSecret = req.headers['x-scholar-shared-secret'] as string;
  const expectedSecret = process.env.SHARED_SECRET || process.env.AUTO_COM_CENTER_SERVICE_SECRET;
  const clientIp = getClientIp(req);
  const ipTrusted = isIpTrusted(clientIp);
  
  // SECURITY: All three conditions must be met for bypass:
  // 1. Header x-scholar-shared-secret matches expected secret
  // 2. IP is in trusted CIDR
  // 3. Path is allowed telemetry path
  // 
  // Per architect review: NO fallback paths that weaken the shared secret requirement
  
  if (!expectedSecret) {
    // No shared secret configured - cannot bypass, proceed to normal WAF inspection
    logger.warn('[WAF] No shared secret configured, cannot grant bypass', {
      path,
      ip: clientIp,
      timestamp: new Date().toISOString()
    });
    return { allowed: true, reason: 'No shared secret configured, proceeding to WAF inspection', bypassType: 'normal_flow' };
  }
  
  if (!sharedSecret) {
    // Request missing shared secret header - no bypass
    return { allowed: true, reason: 'Missing shared secret header, proceeding to WAF inspection', bypassType: 'normal_flow' };
  }
  
  if (sharedSecret !== expectedSecret) {
    // Invalid secret - log security event and proceed to WAF inspection
    logger.warn('[WAF] Invalid shared secret provided', {
      path,
      ip: clientIp,
      timestamp: new Date().toISOString()
    });
    return { allowed: true, reason: 'Invalid shared secret, proceeding to WAF inspection', bypassType: 'normal_flow' };
  }
  
  if (!ipTrusted) {
    // Secret valid but IP not trusted - no bypass
    logger.warn('[WAF] Valid secret but IP not in trusted CIDR', {
      path,
      ip: clientIp,
      timestamp: new Date().toISOString()
    });
    return { allowed: true, reason: 'IP not trusted, proceeding to WAF inspection', bypassType: 'normal_flow' };
  }
  
  // All conditions met: valid secret + trusted IP + telemetry path
  logger.info('[WAF] BYPASS S2S for allowed telemetry', {
    path,
    ip: clientIp,
    ipTrusted,
    timestamp: new Date().toISOString()
  });
  return { allowed: true, reason: 'Trust-by-Secret bypass granted', bypassType: 'trust_by_secret' };
}

/**
 * Check request body for SQLi patterns
 */
function detectSqli(value: unknown, path: string = ''): { detected: boolean; pattern?: string; path?: string } {
  if (typeof value === 'string') {
    for (const pattern of SQLI_PATTERNS) {
      if (pattern.test(value)) {
        return { detected: true, pattern: pattern.source.substring(0, 30), path };
      }
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = detectSqli(value[i], `${path}[${i}]`);
      if (result.detected) return result;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      const result = detectSqli(val, path ? `${path}.${key}` : key);
      if (result.detected) return result;
    }
  }
  
  return { detected: false };
}

/**
 * WAF Middleware - Main entry point
 */
export function wafMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check for Trust-by-Secret bypass first
  const bypassResult = shouldBypassWaf(req);
  
  if (bypassResult.bypassType === 'trust_by_secret') {
    // Trusted S2S request - skip SQLi inspection
    return next();
  }
  
  // Non-telemetry or non-trusted telemetry - perform SQLi inspection
  const bodyCheck = detectSqli(req.body);
  const queryCheck = detectSqli(req.query);
  
  if (bodyCheck.detected) {
    logger.warn('[WAF] BLOCK - SQLi detected in body', {
      path: req.path,
      method: req.method,
      pattern: bodyCheck.pattern,
      location: bodyCheck.path,
      ip: getClientIp(req),
      timestamp: new Date().toISOString(),
      correlationId: req.get('x-correlation-id')
    });
    
    return res.status(403).json({
      error: 'Request blocked by Web Application Firewall',
      code: 'WAF_SQLI_001',
      status: 403,
      timestamp: Math.floor(Date.now() / 1000),
      trace_id: `waf-${Date.now()}`
    });
  }
  
  if (queryCheck.detected) {
    logger.warn('[WAF] BLOCK - SQLi detected in query', {
      path: req.path,
      method: req.method,
      pattern: queryCheck.pattern,
      location: queryCheck.path,
      ip: getClientIp(req),
      timestamp: new Date().toISOString(),
      correlationId: req.get('x-correlation-id')
    });
    
    return res.status(403).json({
      error: 'Request blocked by Web Application Firewall',
      code: 'WAF_SQLI_002',
      status: 403,
      timestamp: Math.floor(Date.now() / 1000),
      trace_id: `waf-${Date.now()}`
    });
  }
  
  // Request passed WAF inspection
  next();
}

/**
 * Get WAF configuration (for monitoring/debugging)
 */
export function getWafConfig() {
  return {
    trusted_cidrs: TRUSTED_CIDRS.map(c => `${c.network}/${c.mask}`),
    telemetry_bypass_paths: TELEMETRY_BYPASS_PATHS,
    sqli_pattern_count: SQLI_PATTERNS.length,
    secret_configured: !!(process.env.SHARED_SECRET || process.env.AUTO_COM_CENTER_SERVICE_SECRET)
  };
}

export default wafMiddleware;
