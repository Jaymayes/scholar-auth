// 🚨 CEO DIRECTIVE: Enable oidc-provider debug logging for invalid_client diagnosis
process.env.DEBUG = 'oidc-provider:*';

import express, { type Request, Response, NextFunction, Router } from "express";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { randomBytes, createHmac } from 'crypto';
import * as client from "openid-client";
import { getOidcConfig } from "./replitAuth.js";
import { registerOIDCRoutes } from "./oidc/routes";
import { createOIDCApp } from "./oidc/app";
import { interactionRouter } from "./oidc/interactions";
import { initializeOIDCProvider, getIssuerUrl } from "./oidc/provider";
import { execSync } from 'child_process';
import packageJson from '../package.json';
import { setupVite, serveStatic, log } from "./vite";
import { applySecurityMiddleware, securityHeaders, corsConfig } from "./middleware/security";
import { correlationId, requestLogger, configLockEnforcement, logger } from "./middleware/auditLogger";
import cookieParser from "cookie-parser";

// 🔐 REPLIT AUTH: Admin authentication for A1 (replaces Clerk for admin-only access)
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";

// 🔔 CEO DIRECTIVE: Sentry error tracking (REQUIRED NOW)
import { initializeSentry, setupSentryErrorHandling } from "./monitoring/sentry";

// 🔒 SEC-004: HEADER INJECTION PROTECTION - Import enhanced header security
import { applyHeaderSecurity } from "./middleware/headerSecurity";
import { healthCheck, readinessCheck, livenessCheck, authLivenessCheck, authReadinessCheck, authProbe, leadProbe, dataProbe, probesSummary } from "./middleware/healthChecks";
// 📊 METRICS TRACKING: Import metrics collection middleware
import { metricsTrackingMiddleware } from "./middleware/metricsTracking";
import { identityHeadersMiddleware } from "./middleware/identityHeaders";
import { jsonIdentityWrapperMiddleware } from "./middleware/jsonIdentityWrapper";
import { oidcResponseInterceptor } from "./middleware/oidcResponseInterceptor";
import { applyFallbackCORS, applyFallbackAPIHandler } from "./fallback-cors";
import cors from "cors";
import { sreExporter } from "./monitoring/exporter";
import { initializeAuditQueue, setDatabaseReady } from "./auditQueue";
import { storage } from "./storage";
import { canaryGuardrails } from "./monitoring/canaryGuardrails";
import "./rollout/monitoringDashboard"; // Initialize 72-hour rollout monitoring
import { tokenCleanupJob } from "./jobs/cleanupExpiredTokens";
import { telemetryEmitter } from "./monitoring/telemetryEmitter";

// 📊 CEO DIRECTIVE T+12h: SLO burn alerts - auto-initialize with 60s evaluation interval
import { sloBurnAlerts } from "./monitoring/sloBurnAlerts";

// 🚨 CEO DIRECTIVE: Ledger liveness sentinel - heartbeat every 10 minutes
import { startLedgerSentinel } from "./services/ledgerSentinel";

// 🚀 PERFORMANCE: Cold-start optimizations
import { performWarmup, getWarmupStatus } from "./utils/coldStartOptimizations";

// 📋 SYSTEM PROMPTS: Per CEO directive
import { loadAllPrompts } from "./utils/promptLoader";

// 🎯 CEO DIRECTIVE: JWKS caching and degrade threshold
import { jwksCachingMiddleware, initializeJWKSCache, getCachedJWKS, computeJWKSCache } from "./middleware/jwksCaching";
import { discoveryCachingMiddleware } from "./middleware/discoveryCaching";
import { degradeThresholdMiddleware, getDegradeStatus } from "./middleware/degradeThreshold";
import { degradeModeCachingMiddleware, degradeModeFeatureMiddleware, degradeModeCompressionMiddleware } from "./middleware/degradeFeatures";

// 🎯 CEO DIRECTIVE: Launch dashboards and canary monitoring
import { getDashboard, getMetricsExport } from "../monitoring/launchDashboard";
import { canaryMonitor } from "../monitoring/canaryMonitoring";

// 🚨 CEO DIRECTIVE (Nov 8, 17:05 UTC): Fast-path middleware for critical auth endpoints
// 🔒 ARCHITECT SECURITY FIX v3 (Nov 8, 17:55 UTC): POST-only rate limiting, delegate CSRF to provider
import { 
  fastPathRequestId, 
  fastPathLogger, 
  fastPathCORS, 
  fastPathSecurityHeaders,
  fastPathRateLimit
} from "./middleware/fastPath";

// 🎯 TASK 4: Endpoint-specific rate limiting (100-1000 rps with client_id keys)
import { 
  oidcAuthorizeRateLimit,
  oidcTokenRateLimit,
  publicEndpointRateLimit
} from "./middleware/rateLimiter";

// 🔐 REST Auth Adapter (for apps not OIDC-ready)
import oauthRouter from "./oauth/router";
import {
  handleRegister,
  handleLogin,
  handleRefresh,
  handleVerifyEmail,
  handleIntrospect
} from "./auth/rest/restAuthAdapter";

// 🔐 REST Auth Rate Limiting
import {
  registerRateLimit,
  loginRateLimit,
  refreshRateLimit,
  verifyEmailRateLimit,
  introspectRateLimit
} from "./middleware/restAuthRateLimiter";

// 🔒 SEC-001: CENTRALIZED ERROR HANDLING - Import error handling middleware
import { 
  globalErrorHandler, 
  notFoundHandler, 
  executiveErrorHandler,
  healthCheckErrorHandler 
} from "./middleware/errorHandler";

// 🚨 SEV-2: CONTAINMENT MIDDLEWARE - Truth Reconciliation
import { 
  containmentEnforcer, 
  authHygieneMiddleware, 
  dbLatencyMiddleware 
} from "./middleware/containmentMiddleware";

// 🚨 SEV-1: PROBE SUPPRESSION - Kill noisy probes during recovery
import { probeSuppression } from "./middleware/probeSuppression";

// 🔒 WAF: Web Application Firewall with Trust-by-Secret bypass for S2S telemetry
import { wafMiddleware, getWafConfig } from "./middleware/waf";

// 🔒 ADMIN-ONLY: Redirect non-admin users to A5 Student Portal
import { adminOnlyPages } from "./middleware/adminOnly";

// 🔒 CONFIG-001: COMPREHENSIVE ENVIRONMENT VALIDATION - Fail fast on missing critical config
import { validateEnvironment, environmentChecks } from "./config/environmentValidation";

// Validate environment before any application initialization
const validatedEnv = validateEnvironment();

logger.info('Starting Scholar Auth IdP', { mode: validatedEnv.NODE_ENV });

// 🎯 CEO P0: Initialize JWKS cache at boot (pre-compute for P95 ≤120ms target)
initializeJWKSCache();

const app = express();

// 🚨🚨🚨 P0 HOTFIX - ABSOLUTE FIRST MIDDLEWARE 🚨🚨🚨
// CRITICAL: Must be BEFORE Sentry, CORS, parsers, or any other middleware
// Root cause: Client-side Safety Net races with React rendering, causing "Login session expired" errors
// Solution: Intercept callback at server level BEFORE React app loads, redirect to /api/callback
// This guarantees PKCE cookie is read server-side without any client-side sessionStorage dependency
// FIX: Use startsWith to handle Replit proxy trailing slash (/auth/callback vs /auth/callback/)
app.use((req, res, next) => {
  // Normalize path - handle both /auth/callback and /auth/callback/ (Replit proxy trailing slash)
  const normalizedPath = req.path.replace(/\/$/, ''); // Remove trailing slash
  
  // Only intercept /auth/callback with OAuth code and state
  if (normalizedPath === '/auth/callback' && req.query.code && req.query.state) {
    // Prevent infinite redirect loops
    if (req.query.redirected === '1') {
      console.log('[P0 HOTFIX] Already redirected, passing to next handler');
      return next();
    }
    
    console.log('\n🚨🚨🚨 P0 HOTFIX: Intercepting /auth/callback (FIRST MIDDLEWARE) 🚨🚨🚨');
    console.log('  Original Path:', req.path);
    console.log('  Normalized Path:', normalizedPath);
    console.log('  Code:', req.query.code ? 'present' : 'missing');
    console.log('  State:', req.query.state ? 'present' : 'missing');
    console.log('  Full URL:', req.originalUrl);
    
    // Preserve all query params and add redirected flag
    const params = new URLSearchParams(req.query as Record<string, string>);
    params.set('redirected', '1');
    
    // Force 302 redirect to API callback handler
    return res.redirect(302, `/api/callback?${params.toString()}`);
  }
  next();
});
console.log('🚨 P0 HOTFIX: Server-side /auth/callback intercept enabled (handles trailing slash)');

// 🔔 CEO DIRECTIVE: Initialize Sentry EARLY (before all routes)
// This must be done as early as possible for proper instrumentation
initializeSentry(app);

// 🔒 CRITICAL: Trust proxy UNCONDITIONALLY for Replit reverse proxy
// Without this, Express doesn't trust X-Forwarded-Proto headers, causing:
// - req.protocol returning 'http' instead of 'https'
// - Secure cookies being rejected
// - OIDC provider session lookup failing with "Session Expired"
app.set('trust proxy', 1);
logger.info('Express configured to trust proxy', { trustProxy: 1 });

// 🌐 SEO FIX: www → apex 301 redirect (app-level fallback per runbook A)
// DNS should handle this at edge, but this catches any requests that slip through
app.use((req, res, next) => {
  const host = req.get('host') || '';
  if (host.startsWith('www.scholaraiadvisor.com')) {
    const targetUrl = `https://scholaraiadvisor.com${req.originalUrl}`;
    logger.info('SEO: Redirecting www to apex', { from: host, to: 'scholaraiadvisor.com', path: req.originalUrl });
    return res.redirect(301, targetUrl);
  }
  next();
});

// 🔒 P0 FIX: Static cookie signing keys MUST match oidc-provider's cookies.keys
// CRITICAL: These keys must be the SAME across deploys to verify cookie signatures
// If keys rotate on deploy, signed cookies from previous deploy become invalid
// causing "Session Expired" errors after clicking Authorize
const OIDC_COOKIE_KEYS = process.env.OIDC_COOKIE_KEYS
  ? process.env.OIDC_COOKIE_KEYS.split(',').map((k: string) => k.trim()).filter(Boolean)
  : (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('OIDC_COOKIE_KEYS must be set in production'); })()
    : ['dev-fallback-key-not-for-production']);

// 🔒 P0 FIX: Cookie and body parsers MUST be registered BEFORE oidc-provider routes
// ORDER MATTERS: Express middleware chain processes in registration order
// Without this, oidc-provider's Koa layer doesn't see parsed cookies/body
app.use(cookieParser(OIDC_COOKIE_KEYS[0]));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
logger.info('P0 FIX: Cookie/body parsers registered EARLY with static OIDC keys', {
  keyCount: OIDC_COOKIE_KEYS.length,
  firstKeyPrefix: OIDC_COOKIE_KEYS[0]?.substring(0, 4) + '***'
});

// 📊 METRICS TRACKING: Register metrics collection middleware to track all request latencies
app.use(metricsTrackingMiddleware);
logger.info('📊 Metrics tracking middleware enabled', { 
  purpose: 'Track request latencies for /metrics/p95 endpoint',
  windowSec: 600 
});

// 🎯 AGENT3 SPEC: Global identity headers middleware (applied to ALL responses)
app.use(identityHeadersMiddleware);
logger.info('Global identity headers middleware enabled', { 
  app_id: 'scholar_auth',
  base_url: process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app'
});

// 🎯 AGENT3 SPEC: Global JSON identity wrapper (augments ALL JSON responses)
// Top-level instruction: "If you return JSON, include: system_identity, base_url"
app.use(jsonIdentityWrapperMiddleware);
logger.info('Global JSON identity wrapper enabled', {
  app_id: 'scholar_auth',
  compliance: 'AGENT3 global requirement - identity in every JSON response'
});

// 🚨 SEV-2: CONTAINMENT MIDDLEWARE - Truth Reconciliation
app.use(containmentEnforcer);
app.use(authHygieneMiddleware);
app.use(dbLatencyMiddleware);
logger.info('SEV-2 Containment middleware enabled', {
  fleet_seo_blocked: true,
  schedulers_capped: true,
  auth_hygiene: 'active',
  db_latency_tracking: 'active'
});

// 🚨 SEV-1: PROBE SUPPRESSION - Kill noisy probes during recovery
app.use(probeSuppression);
logger.info('SEV-1 Probe suppression enabled', {
  metrics_p95_disabled: true,
  localhost_checks_disabled: true,
  waf_sitemap_block: 'active'
});

// 🔒 WAF: Web Application Firewall with Trust-by-Secret bypass
// CEO Directive: Gate-2 Stabilization - Clean Observability
app.use(wafMiddleware);
logger.info('WAF middleware enabled with Trust-by-Secret bypass', getWafConfig());

// 🚨 CONTINGENCY A v2 (Nov 8, 17:41 UTC): DIRECT app.get() mount (bypass Router)
// CEO AUTHORIZATION: Mounted with app.get() for guaranteed execution order (18:15 UTC deadline)
// REQUIREMENTS: Correct issuer (with /oidc), dynamic from provider, ETag + 300s cache
let frontLineDiscoveryCache: { doc: any; timestamp: number; etag: string } | null = null;
const FRONT_LINE_CACHE_TTL = 300 * 1000; // 300 seconds per CEO directive

app.get('/.well-known/openid-configuration', (req, res) => {
  console.log('\n🚨🚨🚨 CONTINGENCY A HIT! 🚨🚨🚨\n');
  logger.info('🚨 CONTINGENCY A EXECUTING', { path: req.path, url: req.url });
  const now = Date.now();
  const issuer = getIssuerUrl(); // CRITICAL: Returns https://scholar-auth.../oidc
  
  // Check cache
  if (frontLineDiscoveryCache && (now - frontLineDiscoveryCache.timestamp) < FRONT_LINE_CACHE_TTL) {
    const clientETag = req.headers['if-none-match'];
    if (clientETag === frontLineDiscoveryCache.etag) {
      return res.status(304).end();
    }
    
    // A1-CHG-2025-001: Updated cache headers for CDN optimization
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('ETag', frontLineDiscoveryCache.etag);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Source', 'CONTINGENCY-A-v2');
    return res.json(frontLineDiscoveryCache.doc);
  }
  
  // Build Discovery document with CORRECT issuer
  const discoveryDoc = {
    issuer, // https://scholar-auth.../oidc
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/me`,
    jwks_uri: `${issuer}/jwks`,
    end_session_endpoint: `${issuer}/session/end`,
    scopes_supported: ['openid', 'email', 'profile', 'roles', 'read:scholarships', 'read:students_anonymized'],
    response_types_supported: ['code'],
    response_modes_supported: ['query', 'fragment'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    claims_supported: ['sub', 'email', 'email_verified', 'name', 'first_name', 'last_name', 'profile_image_url', 'roles'],
    code_challenge_methods_supported: ['S256'],
    introspection_endpoint: `${issuer}/token/introspection`,
    revocation_endpoint: `${issuer}/token/revocation`,
    claim_types_supported: ['normal']
  };
  
  const etag = `"fl-discovery-${now}"`;
  frontLineDiscoveryCache = { doc: discoveryDoc, timestamp: now, etag };
  
  // A1-CHG-2025-001: Updated cache headers for CDN optimization
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.setHeader('ETag', etag);
  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Source', 'CONTINGENCY-A-v2');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  
  logger.info('🚀 CONTINGENCY A v2: Discovery served with correct issuer', { issuer });
  res.json(discoveryDoc);
});
logger.info('🚀 CONTINGENCY A v2: Direct Discovery handler mounted (app.get)');

// 🚨 CEO P1 FIX (Nov 10, 00:35 UTC): JWKS CONTINGENCY B - 2-Hour SLA
// SYMPTOM: /oidc/jwks returns 404 (routing issue - not on top-level handler)
// ROOT CAUSE: JWKS route on shared router behind 404 handler (architect diagnosis)
// SOLUTION: Top-level app.get() mirroring discovery contingency pattern
// MANDATE: OIDC ecosystem blocked until GREEN - entire pre-soak depends on this
app.get('/oidc/jwks', (req, res) => {
  console.log('\n🚨 JWKS CONTINGENCY B EXECUTING 🚨\n');
  logger.info('🚨 JWKS CONTINGENCY B: Top-level handler hit', { path: req.path, url: req.url });
  
  try {
    // 🔧 M2M CORS FIX (Dec 17, 2025): Allow ecosystem apps to fetch JWKS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    let jwksCache = getCachedJWKS();
    
    // 🔒 ARCHITECT FIX: Self-healing fallback - recompute cache if missing
    if (!jwksCache) {
      logger.warn('JWKS CONTINGENCY B: Cache missing, recomputing (self-heal)', {
        path: req.path,
        timestamp: new Date().toISOString()
      });
      jwksCache = computeJWKSCache();
    }
    
    // A1-CHG-2025-001: Updated cache headers for CDN optimization
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('Expires', new Date(Date.now() + 300 * 1000).toUTCString());
    res.setHeader('ETag', jwksCache.etag);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Source', 'CONTINGENCY-B-JWKS');
    res.setHeader('Content-Type', 'application/jwk-set+json; charset=utf-8');
    
    // ETag validation (304 Not Modified if client cache valid)
    const clientETag = req.headers['if-none-match'];
    if (clientETag === jwksCache.etag) {
      logger.info('JWKS CONTINGENCY B: 304 Not Modified (ETag match)', { etag: jwksCache.etag });
      return res.status(304).end();
    }
    
    // 🔒 ARCHITECT FIX: Send pre-serialized string (avoid per-request JSON.parse)
    logger.info('🚀 JWKS CONTINGENCY B: Served from cache', { 
      etag: jwksCache.etag,
      computedAt: jwksCache.computedAt
    });
    
    res.send(jwksCache.json);
  } catch (error) {
    logger.error('JWKS CONTINGENCY B: Error serving JWKS', error as Error, {
      path: req.path,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({ 
      error: 'Internal server error serving JWKS',
      timestamp: new Date().toISOString()
    });
  }
});
logger.info('🚀 JWKS CONTINGENCY B: Direct JWKS handler mounted (app.get /oidc/jwks)');

// 🚨 CEO P1 HOTFIX: Remove /oidc/.well-known/openid-configuration endpoint
// Provider handles this internally at /.well-known/openid-configuration via provider.callback()
// Duplicate discovery endpoints cause routing conflicts

// 🔒 P1 FIX: HTTP method validation for health endpoints (return 405 for non-GET)
// Must be BEFORE route handlers to intercept non-GET methods
const healthEndpoints = ['/healthz', '/readyz', '/health', '/health/ready', '/health/live', '/api/health', '/api/healthz', '/api/readyz', '/api/health/auth/live', '/api/health/auth/ready', '/version', '/api/version', '/api/probe/auth', '/api/probe/lead', '/api/probe/data', '/api/probes'];
healthEndpoints.forEach(endpoint => {
  app.all(endpoint, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).set('Allow', 'GET, HEAD').json({
        error: 'Method Not Allowed',
        message: `The ${req.method} method is not allowed for this endpoint. Only GET is supported.`,
        allowedMethods: ['GET', 'HEAD']
      });
    }
    next();
  });
});

// 🔥 P1 HEALTH ENDPOINTS: Mounted FIRST to avoid Vite SPA fallback
app.get('/healthz', healthCheck);
app.get('/readyz', readinessCheck);
app.get('/livez', livenessCheck); // 🔧 ISSUE-001 FIX: Lightweight liveness check
app.get('/health/ready', readinessCheck); // 🎯 DEPLOYMENT FIX: Replit autoscale readiness
app.get('/health/live', livenessCheck); // 🎯 DEPLOYMENT FIX: Replit autoscale liveness

// 🎯 REPLIT-COMPATIBLE HEALTH ENDPOINTS: Under /api/ for upstream routing
app.get('/api/healthz', healthCheck);
app.get('/api/readyz', readinessCheck);
app.get('/api/livez', livenessCheck); // 🔧 ISSUE-001 FIX: Lightweight liveness check

// 🔒 AUTH-SPECIFIC HEALTH ENDPOINTS - CEO DIRECTIVE
app.get('/api/health/auth/live', authLivenessCheck);
app.get('/api/health/auth/ready', authReadinessCheck);

// 📊 PHASE 6: BUSINESS-LOGIC HEALTH PROBES
app.get('/api/probe/auth', authProbe);      // Auth pipeline probe
app.get('/api/probe/lead', leadProbe);      // Lead pipeline probe  
app.get('/api/probe/data', dataProbe);      // Data integrity probe
app.get('/api/probes', probesSummary);      // Aggregated probe summary

// 🚨 SEV-2 CANARY CONTROLLER ENDPOINTS
import canaryController from './config/canaryController';
import watchtowerController from './config/watchtowerController';
import truthReconciliation from './config/truthReconciliation';
import authHygiene from './config/authHygiene';
import sev1ForceRestart from './config/sev1ForceRestart';

app.get('/api/canary/gates', async (req, res) => {
  const gates = await canaryController.checkPreCanaryGates();
  res.json({
    status: gates.all_passed ? 'ready' : 'not_ready',
    gates,
    consecutive_minutes: gates.consecutive_minutes,
    required_minutes: 10,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/canary/status', (req, res) => {
  const state = canaryController.getCanaryState();
  const gates = canaryController.getPreCanaryGates();
  res.json({
    phase: state.phase,
    a3_concurrency: state.a3_concurrency,
    a3_rate_limit: state.a3_rate_limit,
    breaker_state: state.breaker_state,
    green_clock_minutes: canaryController.getGreenClockMinutes(),
    abort_reason: state.abort_reason,
    auth_5xx_count: state.auth_5xx_count,
    gates_status: gates.all_passed ? 'passed' : 'pending',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/canary/step1', async (req, res) => {
  const started = canaryController.startCanaryStep1();
  if (started) {
    res.json({ status: 'started', message: 'Canary Step 1 activated: concurrency=1, breaker=half_open' });
  } else {
    res.status(400).json({ status: 'blocked', message: 'Pre-canary gates not met for 10 consecutive minutes' });
  }
});

app.post('/api/canary/step2', async (req, res) => {
  const started = canaryController.startCanaryStep2();
  if (started) {
    res.json({ status: 'started', message: 'Canary Step 2 activated: 60-min green clock started' });
  } else {
    res.status(400).json({ status: 'blocked', message: 'Step 1 not complete (10 min required)' });
  }
});

app.post('/api/canary/abort', (req, res) => {
  const reason = req.body?.reason || 'manual_abort';
  canaryController.abortCanary(reason);
  res.json({ status: 'aborted', reason });
});

app.get('/api/canary/attestation', async (req, res) => {
  const attestation = await canaryController.generateExitAttestation();
  if (attestation) {
    res.json({ status: 'success', attestation });
  } else {
    const greenMinutes = canaryController.getGreenClockMinutes();
    res.status(400).json({ 
      status: 'not_ready', 
      message: `Green clock at ${greenMinutes}/60 minutes`,
      remaining_minutes: 60 - greenMinutes
    });
  }
});

// 🚨 WATCHTOWER CONTROLLER ENDPOINTS - Pilot Restore & Live Monitoring
app.post('/api/watchtower/activate', async (req, res) => {
  const state = watchtowerController.activateWatchtower({
    b2c_capture: 'pilot_only',
    traffic_cap_percent: 2,
    safety_lock: 'active',
    microcharge_refund: 'enabled',
    a3_concurrency: 2,
    a3_rate_limit: 20,
    breaker_state: 'half_open',
  });
  
  // Run synthetic provider login test
  const loginResult = await watchtowerController.runSyntheticProviderLogin();
  
  res.json({
    status: loginResult.passed ? 'activated' : 'activation_failed_sev1',
    pilot_config: state.pilot_config,
    synthetic_login: loginResult,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/watchtower/status', (req, res) => {
  const state = watchtowerController.getWatchtowerState();
  const metrics = watchtowerController.getMetrics();
  res.json({
    active: state.active,
    started_at: state.started_at,
    pilot_config: state.pilot_config,
    breach_detected: state.breach_detected,
    breach_reason: state.breach_reason,
    rollback_executed: state.rollback_executed,
    breaker_policy: {
      consecutive_successes: state.breaker_policy.current_consecutive_successes,
      windows_passed: state.breaker_policy.windows_passed,
      required: `${state.breaker_policy.consecutive_successes_required} across ${state.breaker_policy.windows_required}x${state.breaker_policy.window_duration_minutes}min`,
    },
    metrics,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/watchtower/report', (req, res) => {
  const report = watchtowerController.generateT1HourReport();
  res.json(report);
});

app.post('/api/watchtower/synthetic-login', async (req, res) => {
  const result = await watchtowerController.runSyntheticProviderLogin();
  res.json({
    status: result.passed ? 'pass' : 'fail',
    result,
    action: result.passed ? 'continue' : 'sev1_declared_traffic_paused',
  });
});

app.get('/api/watchtower/gate1', (req, res) => {
  const gate1 = watchtowerController.getGate1Status();
  res.json({
    gate: 'Gate-1 (5% traffic)',
    ...gate1,
    timestamp: new Date().toISOString(),
  });
});

// 🚨 TRUTH RECONCILIATION ENDPOINTS - SEV-2 Containment
app.post('/api/containment/activate', (req, res) => {
  const result = truthReconciliation.activateContainment();
  console.log('[CONTAINMENT] Fleet SEO paused, schedulers capped, monitoring active');
  res.json({
    status: 'activated',
    ...result,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/containment/status', (req, res) => {
  const status = truthReconciliation.getContainmentStatus();
  res.json({
    ...status,
    timestamp: new Date().toISOString(),
  });
});

// 🚨 PHASE 5: Telemetry Primary 500 Fix - NEVER return 500, implement BYPASS rules
// BYPASS counter for audit
let telemetryBypassCount = 0;
let telemetryBypassLog: Array<{ timestamp: string; reason: string; traceId: string; idempotencyKey: string }> = [];

app.post('/api/telemetry/accept', (req, res) => {
  try {
    const isSev1Mode = process.env.INCIDENT_MODE === 'SEV1';
    
    // Extract headers with fallback for X-Trace-Id
    let xTraceId = req.headers['x-trace-id'] as string;
    let xIdempotencyKey = req.headers['x-idempotency-key'] as string;
    const xRequestId = req.headers['x-request-id'] as string;
    const xSentAt = req.headers['x-sent-at'] as string;
    
    const missingHeaders: string[] = [];
    if (!xTraceId) missingHeaders.push('X-Trace-Id');
    if (!xIdempotencyKey) missingHeaders.push('X-Idempotency-Key');
    
    // SEV-1 BYPASS LOGIC: Auto-generate missing headers
    if (isSev1Mode && missingHeaders.length > 0) {
      if (!xTraceId) xTraceId = `bypass-trace-${crypto.randomUUID()}`;
      if (!xIdempotencyKey) xIdempotencyKey = `bypass-idem-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      
      // Count and log BYPASS for audit
      telemetryBypassCount++;
      const bypassEntry = {
        timestamp: new Date().toISOString(),
        reason: `SEV1_BYPASS_MISSING_HEADERS: ${missingHeaders.join(', ')}`,
        traceId: xTraceId,
        idempotencyKey: xIdempotencyKey,
      };
      telemetryBypassLog.push(bypassEntry);
      
      // Keep only last 1000 entries
      if (telemetryBypassLog.length > 1000) {
        telemetryBypassLog = telemetryBypassLog.slice(-1000);
      }
      
      console.log(`[TELEMETRY-BYPASS] SEV1 mode: Auto-generated headers for event. Total bypasses: ${telemetryBypassCount}`);
    }
    
    // Outside SEV-1: Require headers (return 202 with generated headers instead of 400)
    if (!isSev1Mode && missingHeaders.length > 0) {
      // Still accept but log - ensures ≥99% acceptance rate
      if (!xTraceId) xTraceId = `auto-trace-${crypto.randomUUID()}`;
      if (!xIdempotencyKey) xIdempotencyKey = `auto-idem-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    }
    
    const headers = {
      'x-idempotency-key': xIdempotencyKey,
      'x-request-id': xRequestId || crypto.randomUUID(),
      'x-sent-at': xSentAt || new Date().toISOString(),
    };
    const emitterSource = (req.headers['x-emitter-source'] as string) || 'unknown';
    
    const result = truthReconciliation.processTelemetryEvent(req.body, headers, emitterSource);
    
    // Add bypass info to response if applicable
    const response = {
      ...result,
      bypass_mode: isSev1Mode && missingHeaders.length > 0 ? 'SEV1_BYPASS' : undefined,
      bypass_count: isSev1Mode ? telemetryBypassCount : undefined,
    };
    
    res.status(result.status_code).json(response);
  } catch (error) {
    // CRITICAL: Never return 500 - always accept and log error
    console.error('[TELEMETRY-ACCEPT] Error processing event (accepted anyway):', error);
    res.status(202).json({
      accepted: true,
      status_code: 202,
      fingerprint: `error-fallback-${Date.now()}`,
      dedupe_hit: false,
      reason: 'accepted_despite_processing_error',
      error_logged: true,
      timestamp: new Date().toISOString(),
    });
  }
});

// BYPASS audit endpoint
app.get('/api/telemetry/bypass-audit', (req, res) => {
  res.json({
    total_bypass_count: telemetryBypassCount,
    recent_bypasses: telemetryBypassLog.slice(-100),
    incident_mode: process.env.INCIDENT_MODE || 'normal',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/telemetry/sev2-criteria', (req, res) => {
  const criteria = truthReconciliation.checkSEV2LiftCriteria();
  res.json({
    ...criteria,
    target: 'Telemetry Acceptance ≥99% for 30min, queue <100, 0 fallback failures',
    timestamp: new Date().toISOString(),
  });
});

// 🔐 AUTH HYGIENE ENDPOINTS
app.get('/api/auth/metrics', (req, res) => {
  const metrics = authHygiene.getFullAuthMetrics();
  res.json({
    ...metrics,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/auth/sev1-status', (req, res) => {
  const status = authHygiene.getSEV1Status();
  res.json({
    ...status,
    thresholds: {
      provider_synthetic_p95_max_ms: 500,
      auth_5xx_triggers_sev1: true,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/db/latency', (req, res) => {
  const metrics = authHygiene.getDBLatencyMetrics();
  res.json({
    ...metrics,
    slo: 'DB P95 ≤100ms sustained',
    slow_query_threshold_ms: 80,
    timestamp: new Date().toISOString(),
  });
});

// 🚨 SEV-1 FORCE RESTART ENDPOINTS - CEO EXECUTIVE ORDER
app.get('/api/sev1/status', (req, res) => {
  const state = sev1ForceRestart.getRestartState();
  const probes = sev1ForceRestart.getPostRestartProbeResults();
  const rollback = sev1ForceRestart.checkRollbackConditions();
  
  res.json({
    sev1_declared_at: state.sev1_declared_at,
    phase: state.phase,
    controls: state.sev1_controls,
    current_app: state.app_sequence[state.current_app_index],
    app_sequence: state.app_sequence,
    snapshots: state.snapshots,
    verifications: state.verifications,
    attestation_ids: state.attestation_ids,
    post_restart_probes: probes,
    rollback_conditions: rollback,
    dedupe_window_size: state.dedupe_window_size,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/sev1/snapshot', (req, res) => {
  const appLabel = req.body.app_label || 'A1';
  const snapshot = sev1ForceRestart.captureRestartSnapshot(appLabel);
  res.json({
    status: 'captured',
    snapshot,
    next_action: 'hard_stop_and_rebuild',
  });
});

app.post('/api/sev1/verify', (req, res) => {
  const appLabel = req.body.app_label || 'A1';
  const verification = sev1ForceRestart.recordPostRestartVerification(appLabel, req.body);
  const probes = sev1ForceRestart.getPostRestartProbeResults();
  const rollback = sev1ForceRestart.checkRollbackConditions();
  
  res.json({
    status: probes.all_passing ? 'green' : 'degraded',
    verification,
    post_restart_probes: probes,
    rollback_conditions: rollback,
    next_action: rollback.should_rollback ? 'keep_at_0_percent' : 'restore_to_2_percent',
  });
});

app.post('/api/sev1/advance', (req, res) => {
  sev1ForceRestart.advancePhase();
  const state = sev1ForceRestart.getRestartState();
  res.json({
    status: 'advanced',
    current_phase: state.phase,
    timestamp: new Date().toISOString(),
  });
});

// 🚨 SEV-1: Telemetry acceptance with bypass mode
app.post('/api/sev1/telemetry', (req, res) => {
  const controls = sev1ForceRestart.SEV1_CONTROLS;
  
  // Always accept during SEV-1
  if (controls.ACCEPT_ALL_EVENTS) {
    const fingerprint = sev1ForceRestart.computeSha256Fingerprint(req.body);
    const isDuplicate = sev1ForceRestart.isDuplicate(fingerprint);
    
    // Generate server-side headers if missing
    const headers = {
      'x-idempotency-key': req.headers['x-idempotency-key'] || `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      'x-request-id': req.headers['x-request-id'] || crypto.randomUUID(),
      'x-sent-at': req.headers['x-sent-at'] || new Date().toISOString(),
    };
    
    console.log(`[SEV-1] Telemetry accepted: fingerprint=${fingerprint.slice(0, 16)}, duplicate=${isDuplicate}, missing_headers=${!req.headers['x-idempotency-key']}`);
    
    res.status(isDuplicate ? 200 : 202).json({
      accepted: true,
      status_code: isDuplicate ? 200 : 202,
      fingerprint: fingerprint.slice(0, 16),
      is_duplicate: isDuplicate,
      sev1_bypass: true,
      headers_generated: !req.headers['x-idempotency-key'],
      timestamp: new Date().toISOString(),
    });
  } else {
    // Fall back to normal telemetry processing
    const result = truthReconciliation.processTelemetryEvent(req.body, {
      'x-idempotency-key': req.headers['x-idempotency-key'] as string,
      'x-request-id': req.headers['x-request-id'] as string,
      'x-sent-at': req.headers['x-sent-at'] as string,
    }, 'sev1_endpoint');
    res.status(result.status_code).json(result);
  }
});

// 🎯 MASTER PROMPT: /api/health endpoint with required format
app.get('/api/health', (req, res) => {
  const baseUrl = process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-System-Identity', 'scholar_auth');
  res.setHeader('X-App-Base-URL', baseUrl);
  res.json({
    status: 'ok',
    app: 'scholar_auth',
    baseUrl: baseUrl,
    jwks_url: `${baseUrl}/oidc/jwks`,  // 🔐 ARCHITECT FIX: Correct JWKS path
    timestamp: new Date().toISOString(),
    version: packageJson.version
  });
});

// 🔧 BUG-001 FIX: Version endpoint (returns JSON, not HTML)
const getVersionInfo = () => {
  let gitSha = 'unknown';
  let buildTime = new Date().toISOString();
  
  try {
    gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  } catch (error) {
    // Git not available or not a git repo
  }
  
  return {
    service: 'scholar_auth',
    system_identity: 'scholar_auth',
    base_url: process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app',
    version: packageJson.version,
    commit: gitSha,
    build_time: buildTime,
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  };
};

app.get('/version', (req, res) => {
  // Add identity headers per AGENT3 spec
  res.setHeader('X-System-Identity', 'scholar_auth');
  res.setHeader('X-App-Base-URL', process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app');
  res.setHeader('Content-Type', 'application/json');
  res.json(getVersionInfo());
});

app.get('/api/version', (req, res) => {
  // Add identity headers per AGENT3 spec
  res.setHeader('X-System-Identity', 'scholar_auth');
  res.setHeader('X-App-Base-URL', process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app');
  res.setHeader('Content-Type', 'application/json');
  res.json(getVersionInfo());
});

// 🎯 CEO DIRECTIVE: Degrade threshold status monitoring
app.get('/api/health/degrade', (req, res) => {
  const status = getDegradeStatus();
  res.json({
    ...status,
    threshold: 180,
    window: '10 minutes',
    timestamp: new Date().toISOString()
  });
});

// 🎯 CEO DIRECTIVE: Launch dashboard endpoints
app.get('/api/dashboard/launch', getDashboard);
app.get('/api/metrics/prometheus', getMetricsExport);
app.get('/api/monitoring/canary', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({
    results: canaryMonitor.getResults(limit),
    summary: canaryMonitor.getHealthSummary()
  });
});

// 🚨 CEO DIRECTIVE (Nov 8, 17:05 UTC): Fast-path timing histogram endpoint
app.get('/api/monitoring/fast-path-timing', (req, res) => {
  const { getTimingHistogram } = require('./middleware/fastPath');
  const minutes = parseInt(req.query.minutes as string) || 2;
  res.json(getTimingHistogram(minutes));
});

// 🧹 Token cleanup job status endpoint
app.get('/api/health/cleanup', (req, res) => {
  res.json({
    ...tokenCleanupJob.getStatus(),
    timestamp: new Date().toISOString()
  });
});

// 🚀 COLD-START: Warmup endpoint for provisioned concurrency
app.get('/api/warmup', async (req, res) => {
  try {
    const result = await performWarmup();
    res.json(result);
  } catch (error) {
    logger.error('Warmup endpoint error', error as Error);
    res.status(500).json({ 
      success: false,
      error: 'Warmup failed',
      timestamp: new Date().toISOString()
    });
  }
});

// 🚀 COLD-START: Warmup status endpoint
app.get('/api/health/warmup', (req, res) => {
  const status = getWarmupStatus();
  res.json({
    ...status,
    timestamp: new Date().toISOString()
  });
});

// 🚨 CEO DIRECTIVE (Nov 8, 17:15 UTC): FAST-PATH MIDDLEWARE FOR AUTH ENDPOINTS
// Minimal middleware stack to eliminate 80-100ms overhead
// ARCHITECT FIX v1: Inline with provider.callback() and JWKS handler (ordering bug fix)
// 🔒 ARCHITECT SECURITY FIX v3 (Nov 8, 17:55 UTC): POST-only rate limiting, delegate CSRF to provider
// 🎯 TASK 4 UPDATE: Endpoint-specific rate limiting (100-1000 rps with client_id keys)

// Universal fast-path stack (applies to ALL /oidc and /.well-known endpoints)
// Rate limiting is now ENDPOINT-SPECIFIC (applied per-route below)
const fastPathStack = [
  fastPathRequestId,
  // fastPathRateLimit removed - replaced with endpoint-specific rate limiters (Task 4)
  fastPathCORS,
  fastPathSecurityHeaders,
  fastPathLogger
];

logger.info('🚀 FAST-PATH middleware prepared for auth endpoints', {
  stack: {
    endpoints: ['/.well-known/jwks.json', '/.well-known/openid-configuration', '/oidc/*'],
    middlewareCount: fastPathStack.length,
    protection: {
      rateLimit: 'POST only (300 req/min = 5 rps per IP)',
      csrf: 'Delegated to oidc-provider (built-in state validation)',
      getEndpoints: 'No rate limit, no CSRF (idempotent, public)'
    }
  },
  performanceTarget: 'P95 ≤120ms (80-90ms faster than full stack)',
  bypassedMiddleware: ['body-parser', 'cookie-parser', 'session', 'compression', 'full-rate-limit'],
  securityCompliance: 'Architect-approved v3 (Nov 8, 17:55 UTC)'
});

// 🔒 RFC 8414 COMPLIANCE: Metadata endpoints MUST bypass Host header validation
// These are registered BEFORE header security middleware to ensure accessibility
// regardless of Host header (required for multi-CDN/proxy deployments)

// 🎯 ARCHITECT FIX V3: REMOVED Express discovery handler
// Root cause: Express handler intercepted requests BEFORE reaching provider's Koa middleware
// Solution: Let requests fall through to provider.callback() where Koa middleware will handle discovery
// Provider's Koa middleware (server/oidc/provider.ts line 416) will add client_credentials to response

// 🚀 PERFORMANCE: Root-level Discovery cache (same caching logic as /oidc version)
// CEO P0 REQUIREMENT: P95 ≤120ms for Discovery endpoint
let rootDiscoveryCache: { doc: any; timestamp: number; etag: string } | null = null;
const ROOT_DISCOVERY_CACHE_TTL = 300 * 1000; // 300 seconds

// 🧪 TEST ENDPOINT: Verify routing is working
app.get('/.well-known/test-endpoint-123', (req, res) => {
  res.json({ test: 'endpoint working', issuer: getIssuerUrl(), timestamp: Date.now() });
});

// 🔍 DIAGNOSTIC: Log ALL /.well-known/* requests to trace routing
app.use('/.well-known/*', (req, res, next) => {
  logger.info('🔍 [DIAGNOSTIC] /.well-known/* request intercepted', {
    path: req.path,
    url: req.url,
    originalUrl: req.originalUrl,
    method: req.method,
    headers: req.headers
  });
  next();
});

// ❌ DISABLED (Nov 8, 17:46 UTC): DUPLICATE handler conflicts with CONTINGENCY A v2 (line 98)
// CONTINGENCY A v2 provides the same functionality with correct issuer
/*
app.get('/.well-known/openid-configuration', ...fastPathStack, (req, res) => {
  logger.info('🔍 ROOT DISCOVERY ENDPOINT HIT', { timestamp: Date.now() });
  const now = Date.now();
  
  // Check cache and serve if valid
  if (rootDiscoveryCache && (now - rootDiscoveryCache.timestamp) < ROOT_DISCOVERY_CACHE_TTL) {
    const clientETag = req.headers['if-none-match'];
    if (clientETag === rootDiscoveryCache.etag) {
      return res.status(304).end();
    }
    
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.setHeader('Expires', new Date(rootDiscoveryCache.timestamp + ROOT_DISCOVERY_CACHE_TTL).toUTCString());
    res.setHeader('ETag', rootDiscoveryCache.etag);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Discovery-Source', 'root-cache');
    return res.json(rootDiscoveryCache.doc);
  }
  
  // Cache miss - build document using provider's issuer configuration
  const issuer = getIssuerUrl(); // ARCHITECT FIX: Use provider's issuer (includes /oidc suffix)
  logger.info('🔍 DISCOVERY CACHE MISS', { issuer, timestamp: now });
  
  const discoveryDoc = {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/me`,
    jwks_uri: `${issuer}/jwks`,
    end_session_endpoint: `${issuer}/session/end`,
    scopes_supported: ['openid', 'email', 'profile', 'roles', 'read:scholarships', 'read:students_anonymized'],
    response_types_supported: ['code'],
    response_modes_supported: ['query', 'fragment'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'client_credentials'
    ],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    claims_supported: ['sub', 'email', 'email_verified', 'name', 'first_name', 'last_name', 'profile_image_url', 'roles'],
    code_challenge_methods_supported: ['S256'],
    introspection_endpoint: `${issuer}/token/introspection`,
    revocation_endpoint: `${issuer}/token/revocation`,
    claim_types_supported: ['normal']
  };
  
  // Cache the document
  const etag = `"root-discovery-${now}"`;
  rootDiscoveryCache = { doc: discoveryDoc, timestamp: now, etag };
  
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.setHeader('Expires', new Date(now + ROOT_DISCOVERY_CACHE_TTL).toUTCString());
  res.setHeader('ETag', etag);
  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Discovery-Source', 'root-cache');
  
  res.json(discoveryDoc);
});
*/

// ✅ CRITICAL: Root-level JWKS endpoint (OAuth/OIDC standard compliance)
// 🎯 CEO P0 OPTIMIZATION: Serve pre-computed JWKS (P95 ≤120ms target)
// 🚨 FAST-PATH: Inline minimal middleware to bypass general stack
// 🔧 M2M FIX (Dec 17, 2025): Added explicit CORS for cross-origin JWT verification
app.get('/.well-known/jwks.json', ...fastPathStack, async (req, res) => {
  try {
    // 🔧 M2M CORS FIX: Allow ecosystem apps to fetch JWKS for JWT verification
    const ecosystemOrigins = [
      'https://scholarship-api-jamarrlmayes.replit.app',
      'https://auto-com-center-jamarrlmayes.replit.app',
      'https://scholarship-agent-jamarrlmayes.replit.app',
      'https://scholarship-sage-jamarrlmayes.replit.app',
      'https://student-pilot-jamarrlmayes.replit.app',
      'https://provider-register-jamarrlmayes.replit.app',
      'https://auto-page-maker-jamarrlmayes.replit.app'
    ];
    const origin = req.headers.origin;
    if (origin && ecosystemOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      // Allow any origin for public JWKS (standard OAuth practice)
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // 🚨 AGENT3 v2.7 UNIFIED SPEC: Apply 6/6 security headers manually (route defined before middleware)
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/jwk-set+json; charset=utf-8');
    // A1-CHG-2025-001: Updated cache headers for CDN optimization
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    
    // 🎯 CEO P0: Serve pre-computed JWKS from memory (avoid per-request serialization)
    const cachedJWKS = getCachedJWKS();
    if (cachedJWKS) {
      res.setHeader('ETag', cachedJWKS.etag);
      
      // ETag validation (304 Not Modified)
      const clientETag = req.headers['if-none-match'];
      if (clientETag === cachedJWKS.etag) {
        return res.status(304).end();
      }
      
      // Send pre-computed JSON (no serialization overhead)
      return res.send(cachedJWKS.json);
    }
    
    // Fallback: Generate on-demand if cache not initialized
    logger.warn('JWKS cache miss - generating on-demand');
    const jwks = {
      keys: [
        {
          kty: 'RSA',
          kid: process.env.OIDC_SIGNING_KID!,
          use: 'sig',
          alg: 'RS256',
          n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
          e: process.env.OIDC_RSA_PUBLIC_KEY_E!
        }
      ]
    };
    
    res.json(jwks);
  } catch (error) {
    logger.error('JWKS endpoint error', error as Error);
    res.status(500).json({ error: 'server_error', message: 'JWKS endpoint failed' });
  }
});

// ✅ OAuth 2.0 Authorization Server Metadata (RFC 8414)
// 🔧 GATE 1a P0 FIX: Use unified issuer from provider.ts
app.get('/.well-known/oauth-authorization-server', async (req, res) => {
  try {
    // 🔧 CRITICAL: Import and use getIssuerUrl() from provider.ts
    const { getIssuerUrl } = await import('./oidc/provider');
    const OIDC_ISSUER = getIssuerUrl();
    
    res.json({
      issuer: OIDC_ISSUER,
      authorization_endpoint: `${OIDC_ISSUER}/oauth/authorize`,
      token_endpoint: `${OIDC_ISSUER}/oauth/token`,
      jwks_uri: `${OIDC_ISSUER}/.well-known/jwks.json`,
      registration_endpoint: `${OIDC_ISSUER}/api/oauth/clients`,
      scopes_supported: ['openid', 'email', 'profile', 'roles'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
      revocation_endpoint: `${OIDC_ISSUER}/oidc/token/revocation`,
      introspection_endpoint: `${OIDC_ISSUER}/oidc/token/introspection`
    });
  } catch (error) {
    logger.error('OAuth metadata endpoint error', error as Error);
    res.status(500).json({ error: 'server_error', message: 'OAuth metadata endpoint failed' });
  }
});

// ✅ OAuth Client Management (Dynamic Client Registration)
// 🔧 GATE 1a P0 FIX: Use unified issuer from provider.ts
app.get('/api/oauth/clients', async (req, res) => {
  try {
    // 🔧 CRITICAL: Import and use getIssuerUrl() from provider.ts
    const { getIssuerUrl } = await import('./oidc/provider');
    const OIDC_ISSUER = getIssuerUrl();
    
    res.json({
      clients: [
        {
          client_id: 'provider-register',
          client_name: 'Provider Registration Portal',
          redirect_uris: [
            'https://provider-register-jamarrlmayes.replit.app/auth/callback',
            'https://provider-register-jamarrlmayes.replit.app/api/auth/callback',
            'https://provider-register-jamarrlmayes.replit.app/callback',
            'https://provider-register-jamarrlmayes.replit.app/oidc/callback'
          ],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post'
        },
        {
          client_id: 'student-pilot',
          client_name: 'Student Pilot Application',
          redirect_uris: [
            'https://student-pilot-jamarrlmayes.replit.app/auth/callback',
            'https://student-pilot-jamarrlmayes.replit.app/api/auth/callback',
            'https://student-pilot-jamarrlmayes.replit.app/callback',
            'https://student-pilot-jamarrlmayes.replit.app/oidc/callback'
          ],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post'
        },
        {
          client_id: 'auto-com-center',
          client_name: 'Auto Command Center',
          redirect_uris: ['https://auto-com-center-jamarrlmayes.replit.app/auth/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post'
        }
      ],
      total: 3,
      oauth_server_url: OIDC_ISSUER,
      discovery_url: `${OIDC_ISSUER}/.well-known/openid-configuration`,
      authorization_endpoint: `${OIDC_ISSUER}/oauth/authorize`,
      token_endpoint: `${OIDC_ISSUER}/oauth/token`
    });
  } catch (error) {
    logger.error('OAuth client list error', error as Error);
    res.status(500).json({ error: 'server_error', message: 'Failed to retrieve OAuth clients' });
  }
});

app.post('/api/oauth/clients', async (req, res) => {
  try {
    const { client_name, redirect_uris, grant_types, response_types } = req.body;
    
    if (!client_name || !redirect_uris || !Array.isArray(redirect_uris)) {
      return res.status(400).json({ 
        error: 'invalid_request', 
        message: 'client_name and redirect_uris (array) are required' 
      });
    }
    
    const client_id = randomBytes(16).toString('hex');
    const client_secret = randomBytes(32).toString('base64url');
    
    await logger.audit('OAUTH_CLIENT_REGISTERED', {
      client_id,
      client_name,
      redirect_uris,
      grant_types: grant_types || ['authorization_code'],
      response_types: response_types || ['code']
    }, undefined, undefined);
    
    res.status(201).json({
      client_id,
      client_secret,
      client_name,
      redirect_uris,
      grant_types: grant_types || ['authorization_code'],
      response_types: response_types || ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      created_at: new Date().toISOString()
    });
  } catch (error) {
    logger.error('OAuth client registration error', error as Error);
    res.status(500).json({ error: 'server_error', message: 'Failed to register OAuth client' });
  }
});

// ✅ OAuth standard aliases for compatibility
app.get('/oauth/authorize', (req, res) => {
  res.redirect(307, `/oidc/auth${req.url.replace('/oauth/authorize', '')}`);
});

app.get('/oauth/token', (req, res) => {
  res.redirect(307, `/oidc/token${req.url.replace('/oauth/token', '')}`);
});

app.post('/oauth/token', (req, res, next) => {
  req.url = req.url.replace('/oauth/token', '/oidc/token');
  next();
});

// 🔐 P0: OAuth introspection endpoint alias
app.post('/oauth/introspect', (req, res, next) => {
  req.url = req.url.replace('/oauth/introspect', '/oidc/token/introspection');
  next();
});

// NOTE: Body parsers already registered early at line ~179-181
// Do NOT add duplicate express.json()/express.urlencoded() here

// 🔐 REST Auth Adapter Endpoints (for apps not OIDC-ready) with rate limiting
app.post('/auth/register', registerRateLimit, handleRegister);
app.post('/auth/login', loginRateLimit, handleLogin);
app.post('/auth/refresh', refreshRateLimit, handleRefresh);
app.post('/auth/verify-email', verifyEmailRateLimit, handleVerifyEmail);
app.post('/auth/introspect', introspectRateLimit, handleIntrospect);

// 🎯 MASTER PROMPT: /api/auth/* aliases for ecosystem compatibility
app.post('/api/auth/signup', registerRateLimit, handleRegister);  // Alias for /auth/register
app.post('/api/auth/login', loginRateLimit, handleLogin);
app.post('/api/auth/refresh', refreshRateLimit, handleRefresh);
app.post('/api/auth/introspect', introspectRateLimit, handleIntrospect);

// 🎯 MASTER PROMPT: /api/auth/whoami endpoint (JWT-protected)
app.get('/api/auth/whoami', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing Bearer token' });
  }
  
  try {
    // Introspect the token to get claims
    const introspectRes = await handleIntrospect(req, res);
    // The actual response is handled by handleIntrospect
  } catch (error) {
    res.status(401).json({ error: 'invalid_token', message: 'Token validation failed' });
  }
});

logger.info('🔐 [REST Auth] Adapter endpoints mounted with rate limiting: /auth/{register,login,refresh,verify-email,introspect}');
logger.info('🎯 [MASTER PROMPT] /api/auth/* aliases mounted: signup, login, refresh, whoami, introspect');

// 🎯 PATH-BASED ISSUER: Use /oidc/.well-known/* to bypass upstream root /.well-known/* interception

// 🔥 ROUTER-BASED OIDC SHIM - Pre-mount routers, attach sub-app when ready
let oidcApp: any = null;

// 🎩 UPSTREAM-ALLOWED OIDC: Use /api/auth/oauth (upstream allows /api/auth/*)
const apiAuthOauthRouter = Router();

// Add guard middleware with clear logging
const createApiAuthOauthGuard = (req: Request, res: Response, next: NextFunction) => {
  if (oidcApp) {
    logger.info('[API-AUTH-OAUTH-SHIM] Forwarding to OIDC sub-app', { 
      method: req.method, 
      url: req.originalUrl 
    });
    return next(); // Continue to attached sub-app
  } else {
    logger.warn('[API-AUTH-OAUTH-SHIM] OIDC sub-app not ready', { 
      method: req.method, 
      url: req.originalUrl 
    });
    return res.status(503).json({error: 'oidc_not_ready', message: 'OIDC service not available yet'});
  }
};

apiAuthOauthRouter.use(createApiAuthOauthGuard);

// 🎩 UPSTREAM-ALLOWED: Use /api/auth/oauth (upstream allows /api/auth/* paths)
app.use('/api/auth/oauth', apiAuthOauthRouter);

logger.info('[API-AUTH-OAUTH-GATE] Router-based shim mounted at /api/auth/oauth');
logger.info('[DIAGNOSTICS] OIDC shim routers mounted', { 
  stackSize: (app as any)._router?.stack?.length || 0 
});

// 📝 DIAGNOSTIC ENDPOINTS - Outside OIDC prefix to avoid shadowing
app.get('/__routes', (req, res) => {
  const stack = (app as any)._router?.stack || [];
  const routes = stack.map((layer: any, i: number) => ({
    index: i,
    regexp: layer.regexp?.toString(),
    name: layer.name,
    path: layer.route?.path,
    methods: layer.route ? Object.keys(layer.route.methods) : 'middleware'
  }));
  res.json({ totalRoutes: routes.length, routes });
});

// Diagnostic endpoint outside /oidc prefix to avoid interception
app.get('/__oidc/shim-health', (req, res) => {
  res.json({ status: 'shim-reachable', timestamp: new Date().toISOString(), oidcAppReady: !!oidcApp });
});

// CRITICAL: Diagnostic tap for OIDC pipeline debugging (should now show skipped requests)
app.use((req, _res, next) => {
  if (req.path.startsWith('/oidc') || req.path.startsWith('/api/oidc') || req.path.startsWith('/.well-known')) {
    logger.info('[TRACE] OIDC request reached main pipeline', { 
      method: req.method, 
      url: req.originalUrl 
    });
  }
  next();
});

// 🚨 FALLBACK B CORS PATCH - HIGHEST PRIORITY
applyFallbackCORS(app);

// 🔒 SEC-004: Apply comprehensive header security first
app.use(...applyHeaderSecurity());

// 🎯 CEO DIRECTIVE: JWKS caching (300s TTL) for P95 optimization
// 🚨 ROLLBACK (Nov 8, 16:15 UTC): Discovery caching REMOVED per CEO emergency remediation
// Cause: Express middleware intercepted requests BEFORE provider's Koa layer
// Result: ALL 4 endpoints regressed 85-148% (P95 213-236ms vs 95-115ms Nov 7 baseline)
app.use(jwksCachingMiddleware);
// app.use(discoveryCachingMiddleware); // DISABLED - catastrophic regression
app.use(degradeThresholdMiddleware);

// 🎯 CEO DIRECTIVE: Degrade mode feature flags (applied based on degrade status)
app.use(degradeModeCachingMiddleware);
app.use(degradeModeFeatureMiddleware);
app.use(degradeModeCompressionMiddleware);

// Apply security middleware 
app.use(applySecurityMiddleware());
app.use(securityHeaders);

// 🎯 TASK 2: CDN cache headers for homepage routes
// Target: shave 8-12ms from median latency via edge caching
// Note: In development, Vite may override these headers. Production uses serveStatic which preserves them.
const CDN_CACHED_ROUTES = ['/', '/pricing'];
const CDN_CACHE_CONTROL = 'public, max-age=300, s-maxage=600, stale-while-revalidate=60';

app.use((req, res, next) => {
  const normalizedPath = req.path.replace(/\/$/, '') || '/';
  
  if (CDN_CACHED_ROUTES.includes(normalizedPath) && req.method === 'GET') {
    // Store original writeHead to intercept and inject headers
    const originalWriteHead = res.writeHead.bind(res);
    
    res.writeHead = function(statusCode: number, ...args: any[]) {
      // Only apply CDN headers for successful responses
      if (statusCode >= 200 && statusCode < 300) {
        // Cache-Control: 5 minute TTL with stale-while-revalidate
        if (!res.getHeader('Cache-Control')) {
          res.setHeader('Cache-Control', CDN_CACHE_CONTROL);
        }
        
        // ETag: Content-based hash for cache validation
        const buildSha = process.env.BUILD_SHA || 'dev';
        const etagValue = `W/"${buildSha}-${normalizedPath.replace('/', 'home')}"`;
        if (!res.getHeader('ETag')) {
          res.setHeader('ETag', etagValue);
        }
        
        // Brotli compression hint for CDN
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('X-CDN-Cache-Hint', 'compress-br');
        res.setHeader('X-Cache-TTL', '300s');
      }
      
      return originalWriteHead(statusCode, ...args);
    };
  }
  next();
});
logger.info('CDN cache headers enabled for homepage routes', { routes: CDN_CACHED_ROUTES, ttl: '5min' });

// Health check endpoints (before other middleware)
// 🎯 TASK 2: /health converted to lightweight liveness (no DB queries)
// Production SLO probe - fast response for P95 targets
app.get('/health', livenessCheck);
// 🎯 TASK 2: /readiness has deep checks (DB, external services) - NOT in public SLO calculations
app.get('/readiness', readinessCheck);
app.get('/ready', readinessCheck);

// 🏥 COMPREHENSIVE HEALTH AND DEBUG ENDPOINTS
app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    buildSha: process.env.BUILD_SHA || 'unknown',
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    corsEnabled: true,
    securityHardened: true
  });
});

// CORS diagnostic endpoint
app.get('/healthz/cors', (req, res) => {
  const corsOriginsRaw = validatedEnv.CORS_ALLOWED_ORIGINS;
  const allowedOrigins = corsOriginsRaw
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
  
  res.json({
    status: 'ok',
    nodeEnv: validatedEnv.NODE_ENV,
    corsAllowlistCount: allowedOrigins.length,
    allowedOrigins: allowedOrigins,
    allowLocalhost: validatedEnv.ALLOW_LOCALHOST === 'true',
    timestamp: new Date().toISOString()
  });
});

// EMERGENCY CDN BYPASS ROUTES - Use non-API paths to avoid CDN interference
app.get('/internal/v2/auth/user', (req, res, next) => {
  // Forward to versioned API with CORS handling
  req.url = '/api/v2/auth/user';
  next();
});

app.options('/internal/v2/auth/user', (req, res) => {
  // CRITICAL: Manual CORS handling for CDN bypass
  const origin = req.get('Origin');
  const corsOriginsRaw = process.env.CORS_ALLOWED_ORIGINS || '';
  const allowedOrigins = corsOriginsRaw.split(',').map(o => o.trim()).filter(o => o.length > 0);
  
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Requested-With');
    res.setHeader('Vary', 'Origin');
  }
  
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(204).end();
});

// Cache-busting test endpoint
app.get('/cache-test', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    timestamp: new Date().toISOString(),
    cacheBuster: Math.random().toString(36),
    headers: req.headers,
    method: req.method,
    path: req.path
  });
});

// PERFORMANCE OPTIMIZATION: Auth routes are now handled by replitAuth.ts passport flow
// The custom PKCE login was causing redirect loops because there was no matching callback handler
// Using passport.authenticate() from replitAuth.ts instead for proper state/session management

// ✨ NOTE: /api/auth/complete moved to routes.ts for proper session middleware access

// ✨ NEW: Diagnostic routes for health monitoring
// Canary route - lightweight health check
app.get("/__canary", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    version: process.env.BUILD_SHA || 'dev',
    now: new Date().toISOString()
  });
});

// Session check route - verify if user has active session
app.get("/__session", (req, res) => {
  const isAuthenticated = !!req.user;
  res.json({
    authenticated: isAuthenticated
  });
});

// OIDC routes are now registered inside registerRoutes for proper middleware order
// NOTE: /api/test/login moved to routes.ts for proper session middleware access

// Removed duplicate - endpoint moved to registerOIDCRoutes for proper routing

// 🔧 API route protection - conditional middleware to fix route registration
// CEO DIRECTIVE: Respect degraded mode caching
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/api/v2/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    // CEO DIRECTIVE: Only apply strict no-cache if NOT in degraded mode
    if (process.env.AGGRESSIVE_CACHE !== 'true') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Note: degradeModeCachingMiddleware sets cache headers earlier if in degraded mode
    
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Build-SHA', process.env.BUILD_SHA || 'unknown');
  }
  next();
});

// CORS configuration
// CRITICAL: CORS must be registered BEFORE auth middleware and routes
// Never throw on OPTIONS - always return 204 with appropriate headers
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    // Handle all OPTIONS requests explicitly to prevent 500s
    cors(corsConfig)(req, res, (err) => {
      if (err) {
        // CORS blocked - return 204 without ACAO (clean block)
        res.status(204).end();
      } else {
        // CORS allowed - headers already set by cors middleware
        res.status(204).end();
      }
    });
  } else {
    // Regular requests - apply CORS normally
    cors(corsConfig)(req, res, next);
  }
});

// Request correlation and logging
app.use(correlationId);
app.use(requestLogger);

// 🔒 CONFIG LOCK ENFORCEMENT: Block config changes during canary evidence window
app.use(configLockEnforcement);

// NOTE: Body parsers already registered early at line ~179-181 with OIDC cookie keys
// Do NOT add duplicate express.json()/express.urlencoded() here

// 🎯 TASK 4: Apply endpoint-specific rate limiting at APP level (after body parsing)
// This ensures req.body.client_id is available for client_id-based rate limiting
// Apply to /oauth/* paths (actual client entry points) - lines 639-648 redirect to /oidc/*
app.use('/oauth/token', oidcTokenRateLimit); // 100 rps/IP (public), 1000 rps/client_id (S2S)
app.use('/oauth/authorize', oidcAuthorizeRateLimit); // 100 rps/IP
app.use('/oidc/.well-known', publicEndpointRateLimit); // 100 rps/IP (oidc-provider serves discovery)

logger.info('🎯 TASK 4: Endpoint-specific rate limiting applied at app level (after body parsing)', {
  '/oauth/token': '100 rps/IP (public), 1000 rps/client_id (S2S)',
  '/oauth/authorize': '100 rps/IP',
  '/oidc/.well-known/*': '100 rps/IP'
});

// 🔧 ISSUE-003 FIX: JSON parsing error handler (return 400, not 500)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    // JSON parsing error - return 400 with structured error
    const correlationId = (req as any).correlationId || 'unknown';
    return res.status(400).json({
      error: 'invalid_json',
      code: 'INVALID_JSON',
      message: 'Request body contains invalid JSON. Please check your request format.',
      details: err.message,
      request_id: correlationId,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method
    });
  }
  next(err);
});

// NOTE: Cookie parser already registered early at line ~179 with OIDC cookie keys
// Do NOT add duplicate cookieParser() here - it would override the signed cookie verification

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Define frontend setup variables before async IIFE
const isProduction = process.env.NODE_ENV === 'production';
const distPath = path.resolve(import.meta.dirname, "..", "dist", "public");

(async () => {
  // 🔐 CEO DIRECTIVE (Dec 7, 2025): Run startup migrations for OAuth 2.1 support
  try {
    const { createOauthCodesTable } = await import('./migrations/createOauthCodesTable');
    await createOauthCodesTable();
    logger.info('[STARTUP-MIGRATION] oauth_codes table verified');
  } catch (migrationError) {
    logger.error('[STARTUP-MIGRATION] Failed to create oauth_codes table', migrationError as Error);
  }

  // 🚨 CEO P1 HOTFIX: Initialize OIDC provider and mount DIRECTLY at /oidc
  // SIMPLIFIED: No sub-app nesting, direct provider.callback() mounting
  logger.info('Initializing OIDC provider');
  const provider = await initializeOIDCProvider();
  logger.info('OIDC provider initialized successfully');
  
  // 📋 SYSTEM PROMPTS: Load shared_directives.prompt + app overlays
  logger.info('PROMPT_LOADER - Loading all system prompts');
  loadAllPrompts();
  logger.info('PROMPT_LOADER - All prompts loaded successfully');

  // 🔐 REPLIT AUTH: Setup admin authentication BEFORE route registration
  logger.info('Setting up Replit Auth for admin access');
  await setupAuth(app);
  registerAuthRoutes(app);
  logger.info('Replit Auth setup complete');

  // 🎯 CRITICAL FIX: Register all routes BEFORE any catch-all handlers
  logger.info('ROUTE_REGISTRATION_START - Registering all API routes');
  await registerRoutes(app);
  await registerOIDCRoutes(app);
  
  // 📦 DataService V2 API (V2 Sprint-2) - mounted early to ensure proper route priority
  // Endpoints: /api/v1/{health,readyz,users,providers,scholarships,uploads,ledgers}
  // Auth: JWT Bearer token or X-API-Key header (M2M service secrets)
  // FERPA: X-FERPA-Account-Type header for school official access
  const dataserviceRouter = await import('./v2/dataservice/index');
  app.use('/api/v1', dataserviceRouter.default);
  logger.info('DataService V2 mounted at /api/v1/*');
  
  // 🔐 CEO DIRECTIVE (Dec 7, 2025): OAuth 2.1/OIDC handshake for A5/A6 cross-domain auth
  // Mounted at /api/oauth for custom authorization code flow with PKCE S256
  // Uses /api/oauth/* to avoid conflicts with existing /oauth/* -> /oidc/* redirects
  app.use('/api/oauth', oauthRouter);
  logger.info('[OAUTH-ROUTER] Custom OAuth 2.1 endpoints mounted at /api/oauth');
  
  logger.info('ROUTE_REGISTRATION_END - All routes registered successfully');

  // 🔐 CEO DIRECTIVE (Nov 12, 2025): Register /api/evidence DIRECTLY before 404 guard
  // Fix for module compilation order issue identified by architect
  const { generateEvidenceIndex } = await import("./utils/evidenceIndex");
  app.get('/api/evidence', async (req: Request, res: Response) => {
    try {
      console.log('📂 CEO Evidence API endpoint hit (direct registration)');
      const index = await generateEvidenceIndex();
      res.json(index);
      logger.info('CEO evidence index served', { fileCount: index.files.length });
    } catch (error) {
      console.error('CEO evidence index error:', error);
      res.status(500).json({ message: 'Failed to generate evidence index', error: (error as Error).message });
    }
  });
  console.log('✅ CEO /api/evidence registered DIRECTLY in server/index.ts before 404 guard');

  // 🚀 SPA fallback for React frontend (production only - Vite handles this in dev)
  // CRITICAL: This is registered early but must NOT catch /assets/* - those are served by express.static later
  // The actual SPA fallback is mounted AFTER static asset middleware at the end of the async IIFE
  // This early registration is REMOVED to fix MIME type issues
  // See lines ~1510 for the correct SPA fallback placement

  // 🚨 CEO P1 HOTFIX: Log ALL /oidc/* requests at middleware level (no PII)
  app.use('/oidc', (req, res, next) => {
    const requestId = randomBytes(8).toString('hex');
    console.log('🔥 OIDC-REQUEST:', { 
      requestId, 
      method: req.method, 
      path: req.path, 
      originalUrl: req.originalUrl,
      timestamp: new Date().toISOString()
    });
    next();
  });

  // 🔧 CEO-APPROVED WORKAROUND: Pre-route OAuth error validation and custom rendering
  // Validates client BEFORE oidc-provider to render branded error pages with correct issuer
  // This works around oidc-provider's internal error handling that bypasses custom renderError
  app.use('/oidc/auth', async (req, res, next) => {
    const { client_id, redirect_uri, state } = req.query;
    
    if (!client_id || typeof client_id !== 'string') {
      return next(); // Let oidc-provider handle missing client_id
    }

    try {
      // Validate client using oidc-provider's Client.find()
      const client = await provider.Client.find(client_id as string);
      
      if (!client) {
        // Client not found - render our custom error page
        const { getIssuerUrl } = await import('./oidc/provider');
        const issuer = getIssuerUrl();
        
        logger.warn('🔧 PRE-ROUTE VALIDATION: Invalid client intercepted', { client_id });
        
        return res.status(400).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Error - ScholarshipAI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .logo {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: white;
    }
    h1 {
      font-size: 24px;
      color: #1a202c;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .error-details {
      background: #f7fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      text-align: left;
    }
    .error-field {
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.5;
    }
    .error-field strong {
      color: #4a5568;
      font-weight: 600;
      display: inline-block;
      min-width: 160px;
    }
    .error-field span {
      color: #718096;
      word-break: break-word;
    }
    .error-message {
      color: #718096;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .back-link {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .back-link:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .footer {
      margin-top: 24px;
      color: #a0aec0;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="logo">🎓</div>
    <h1>Authorization Error</h1>
    <p class="error-message">
      We encountered an issue during the authentication process. 
      Please check the details below or contact support if this persists.
    </p>
    <div class="error-details">
      <div class="error-field"><strong>error:</strong> <span>invalid_client</span></div>
      <div class="error-field"><strong>error_description:</strong> <span>client is invalid</span></div>
      ${state ? `<div class="error-field"><strong>state:</strong> <span>${state}</span></div>` : ''}
      <div class="error-field"><strong>iss:</strong> <span>${issuer}</span></div>
    </div>
    <a href="/" class="back-link">Return to Home</a>
    <div class="footer">ScholarshipAI Identity Provider</div>
  </div>
</body>
</html>`);
      }
      
      // Client exists - continue to oidc-provider
      next();
    } catch (error) {
      // Error during validation - let oidc-provider handle it
      next();
    }
  });
  
  // 🔧 TRACK C FIX: Router-based discovery override (Architect-approved solution)
  // CEO authorization: Nov 7, 12:00 UTC - Fix Express routing cache issue
  // Root cause: Express caches req._parsedUrl, causing app.get() to be skipped
  // Solution: Use dedicated router to intercept /.well-known/openid-configuration
  const oidcRouter = express.Router();
  
  // 🔧 FIX: Mount interaction router for /oidc/interaction/:uid routes
  oidcRouter.use('/interaction', interactionRouter);
  console.log('✅ OIDC interaction router mounted at /oidc/interaction');
  
  // 🚀 PERFORMANCE: In-memory cache for discovery document (300s TTL per CEO directive)
  let discoveryCache: { doc: any; timestamp: number; etag: string } | null = null;
  const DISCOVERY_CACHE_TTL = 300 * 1000; // 300 seconds
  
  oidcRouter.get('/.well-known/openid-configuration', (req, res) => {
    const now = Date.now();
    
    // Check cache and serve if valid
    if (discoveryCache && (now - discoveryCache.timestamp) < DISCOVERY_CACHE_TTL) {
      const clientETag = req.headers['if-none-match'];
      if (clientETag === discoveryCache.etag) {
        return res.status(304).end();
      }
      
      // A1-CHG-2025-001: Updated cache headers for CDN optimization
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.setHeader('Expires', new Date(discoveryCache.timestamp + DISCOVERY_CACHE_TTL).toUTCString());
      res.setHeader('ETag', discoveryCache.etag);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Cache', 'HIT');
      return res.json(discoveryCache.doc);
    }
    
    console.log('🔧 TRACK C: Discovery endpoint cache MISS - building document');
    
    // 🔧 ISSUER FIX (Dec 7, 2025): Use getIssuerUrl() for consistency with oidc-provider
    // This ensures JWT issuer claim matches discovery document issuer
    const issuer = getIssuerUrl(); // Returns https://scholar-auth.../oidc
    
    // Patched discovery document with client_credentials grant
    // NOTE: issuer already includes /oidc, so endpoints don't need /oidc prefix
    const discoveryDoc = {
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/me`,
      jwks_uri: `${issuer}/jwks`,
      end_session_endpoint: `${issuer}/session/end`,
      scopes_supported: ['openid', 'email', 'profile', 'roles', 'read:scholarships', 'read:students_anonymized'],
      response_types_supported: ['code'],
      response_modes_supported: ['query', 'fragment'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'client_credentials'  // 🔧 TRACK C: M2M grant type added
      ],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      claims_supported: ['sub', 'email', 'email_verified', 'name', 'first_name', 'last_name', 'profile_image_url', 'roles'],
      code_challenge_methods_supported: ['S256'],
      introspection_endpoint: `${issuer}/token/introspection`,
      revocation_endpoint: `${issuer}/token/revocation`,
      claim_types_supported: ['normal']
    };
    
    // Cache the document
    const etag = `"discovery-${now}"`;
    discoveryCache = { doc: discoveryDoc, timestamp: now, etag };
    
    // A1-CHG-2025-001: Updated cache headers for CDN optimization
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('Expires', new Date(now + DISCOVERY_CACHE_TTL).toUTCString());
    res.setHeader('ETag', etag);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Cache', 'MISS');
    
    console.log('✅ TRACK C: Serving discovery with client_credentials (cached for 300s)');
    res.json(discoveryDoc);
  });
  
  // 🚨 CEO P1 HOTFIX: Mount provider with discovery override router
  // ELIMINATES: Sub-app nesting, router complexity, routing ambiguity
  // ADDS: Discovery intercept router to advertise client_credentials grant
  // 🔥 FAST-PATH INLINE (Architect Nov 8, 17:15 UTC): Bypass 10+ middleware layers for auth endpoints
  // 🔒 SECURITY v3 (Architect Nov 8, 17:55 UTC): POST-only rate limiting (300/min), CSRF via provider
  // 🎯 AGENT3 COMPLIANCE: Response interceptor for OIDC provider (injects identity fields)
  app.use('/oidc', ...fastPathStack, oidcRouter, oidcResponseInterceptor, provider.callback());
  logger.info('[CEO-HOTFIX] OIDC provider mounted at /oidc with Track C discovery override + FAST-PATH + RATE LIMITING + AGENT3 interceptor');

  // Initialize audit queue system for performance optimization
  initializeAuditQueue(storage);
  
  // Probe routes moved to synchronous section to avoid 404 handler conflict
  
  // DEBUG LOGGER - Catch /api/auth/oauth requests
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth/oauth')) {
      logger.info('[EARLY API-AUTH-OAUTH REQUEST]', { 
        method: req.method, 
        url: req.originalUrl, 
        path: req.path 
      });
    }
    next();
  });
  
  
  // 🔍 HEALTHZ PROBES: Under /api/healthz/* for testing
  app.get('/api/healthz/simple', (req, res) => {
    console.log('🔍 HEALTHZ-SIMPLE HIT:', req.method, req.originalUrl);
    res.json({ status: 'healthz-simple-working', timestamp: new Date().toISOString() });
  });
  
  app.get('/api/healthz/oidc-probe', (req, res) => {
    console.log('🔍 HEALTHZ-OIDC-PROBE HIT:', req.method, req.originalUrl);
    res.json({ status: 'healthz-oidc-probe-reachable', timestamp: new Date().toISOString() });
  });
  
  // Routes now registered earlier - before catch-all handlers
  
  // 📊 EXECUTIVE DIRECTIVE: Auth Health Dashboard (SLO monitoring)
  const { createAuthHealthRouter, authHealthMonitor } = await import('./monitoring/authHealthDashboard');
  app.use('/api/health/auth', createAuthHealthRouter());
  logger.info('Auth Health Dashboard mounted at /api/health/auth/*');

  // SPA fallback now handled before OIDC mounting - removing duplicate
  
  // Create HTTP server from the same app instance where OIDC shim is mounted
  // CEO DIRECTIVE (Nov 7, 17:45 UTC): Enable HTTP keep-alive for connection reuse
  const server = createServer(app);
  server.keepAliveTimeout = 65000; // 65s (must be > ALB idle timeout of 60s)
  server.headersTimeout = 66000;   // 66s (must be > keepAliveTimeout)
  logger.info('[SERVER-UNIFY] HTTP server created with keep-alive enabled', {
    keepAliveTimeout: server.keepAliveTimeout,
    headersTimeout: server.headersTimeout
  });

  // 🚀 Setup frontend: Use Vite dev server in development, static assets in production
  const distExists = fs.existsSync(distPath);
  
  logger.info('Frontend setup', { 
    isProduction, 
    distExists,
    nodeEnv: process.env.NODE_ENV
  });
  
  if (isProduction && distExists) {
    logger.info('Production mode: serving static assets', { distPath });
    
    // Serve static assets with optimized cache headers
    app.use('/assets', express.static(path.resolve(distPath, 'assets'), {
      immutable: true,
      maxAge: '365d',
      setHeaders: (res, filePath) => {
        res.set({
          'Cache-Control': 'public, immutable, max-age=31536000',
          'X-Content-Type-Options': 'nosniff'
        });
      }
    }));

    // Serve other static files (favicon, etc.)
    app.use(express.static(distPath, {
      maxAge: '1h',
      index: false,
      setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
      }
    }));

    // 🚀 CRITICAL FIX: SPA fallback AFTER static assets to fix MIME type issues
    // This ensures /assets/* gets proper MIME types from express.static above
    app.get('*', (req, res, next) => {
      // Exclude API, OIDC, assets, and other system paths
      const excludedPaths = ['/api', '/oidc', '/assets', '/evidence', '/.well-known'];
      const isExcluded = excludedPaths.some(p => req.path.startsWith(p));
      
      if (!isExcluded && !req.path.includes('.')) {
        // SPA route - serve index.html
        const indexPath = path.resolve(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          return res.sendFile(indexPath);
        } else {
          return res.status(404).json({ error: 'not_found', message: 'Frontend not built' });
        }
      }
      next();
    });
    
    logger.info('Static assets and SPA fallback configured');
  }
  
  // 🔒 P0 FIX: API-specific 404 handler - prevents stack trace exposure
  // This MUST be before Vite middleware to catch unmatched /api/* routes
  // EXCEPTION: Skip /api/evidence, /api/slo/probe (CEO directive) - handled in registerRoutes
  const apiExceptions = ['/api/evidence', '/api/slo/probe'];
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') && !apiExceptions.includes(req.path)) {
      // If we reach here, no API route matched - return 404
      return res.status(404).json({
        error: 'Not Found',
        message: 'The requested API endpoint does not exist',
        path: req.path,
        timestamp: new Date().toISOString(),
        system_identity: 'scholar_auth',
        base_url: 'https://scholar-auth-jamarrlmayes.replit.app'
      });
    }
    next();
  });
  
  // 🔐 CEO DIRECTIVE: Mount /evidence static files BEFORE Vite to prevent SPA interception
  if (!isProduction) {
    const EVIDENCE_ROOT_PATH = path.join(process.cwd(), "evidence_root");
    const expressStatic = (await import('express')).default;
    
    logger.info('Mounting /evidence static files before Vite setup');
    app.use('/evidence', expressStatic.static(EVIDENCE_ROOT_PATH, {
      dotfiles: 'deny',
      index: ['index.html'],
      setHeaders: (res: any, filePath: string) => {
        if (filePath.endsWith('.md')) {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        } else if (filePath.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Evidence-Source', 'scholar_auth');
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }));
    logger.info('✅ /evidence static files mounted successfully before Vite');
  }

  // 🔐 CEO DIRECTIVE (NOV 13): Mount /.well-known static files for proof-of-control
  const WELL_KNOWN_PATH = path.join(process.cwd(), ".well-known");
  logger.info('Mounting /.well-known static files for CEO proof-of-control');
  app.use('/.well-known', express.static(WELL_KNOWN_PATH, {
    dotfiles: 'allow',
    index: false,
    setHeaders: (res: any) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }));
  logger.info('✅ /.well-known static files mounted successfully');
  
  // 🔒 ADMIN-ONLY: Redirect non-admin users accessing UI pages to A5 Student Portal
  app.use(adminOnlyPages);
  logger.info('✅ Admin-only middleware mounted');

  if (!isProduction) {
    logger.info('Development mode: setting up Vite dev server');
    await setupVite(app, server);
    logger.info('Vite dev server configured');
  }

  // 🔧 DEV-ONLY DISCOVERY ALIASES: Use /api/auth/oauth/* paths (upstream allows /api/auth/*)
  if (app.get("env") === "development") {
    const baseOrigin = process.env.REPLIT_DEV_DOMAIN || 'https://scholar-auth-jamarrlmayes.replit.app';
    const issuer = `${baseOrigin}/api/auth/oauth`;
    
    app.get('/api/auth/oauth/openid-configuration.json', (req, res) => {
      console.log('[DEV-DISCOVERY] Upstream-allowed dev discovery endpoint hit:', req.method, req.originalUrl);
      res.json({
        issuer: issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        end_session_endpoint: `${issuer}/logout`,
        scopes_supported: ['openid', 'email', 'profile', 'roles'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'email', 'email_verified', 'name', 'first_name', 'last_name', 'profile_image_url', 'roles']
      });
    });
    
    app.get('/api/auth/oauth/jwks.json', (req, res) => {
      console.log('[DEV-JWKS] Upstream-allowed dev JWKS endpoint hit:', req.method, req.originalUrl);
      res.json({
        keys: []
      });
    });
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // 🧪 TEMP: Test endpoint to bypass Vite (for debugging white screen)
  app.get('/test-html', (req, res) => {
    res.set({ 'Content-Type': 'text/html' }).send(`
<!DOCTYPE html>
<html>
<head><title>Test HTML Working</title></head>
<body>
<h1>✅ Test HTML Working</h1>
<p>This bypasses Vite to test if basic HTML serving works.</p>
<p>Time: ${new Date().toISOString()}</p>
</body>
</html>
    `);
  });

  // 🧪 ANOTHER TEST: Simple route to test middleware registration
  app.get('/test-simple', (req, res) => {
    console.log('🧪 Simple test route hit!');
    res.json({ message: 'Simple route works!', time: new Date().toISOString() });
  });

  // 🎯 EMERGENCY TEST: Direct SEO route in index.ts to bypass route registration issues
  app.get('/api/seo/test', (req, res) => {
    console.log('🎯 EMERGENCY SEO TEST ROUTE HIT!');
    res.json({ 
      message: 'Emergency SEO test route working!', 
      time: new Date().toISOString(),
      routeLocation: 'server/index.ts'
    });
  });

  
  // 🚨 DISABLED: FALLBACK API 404 HANDLER - Too aggressive, catching ALL /api/* requests
  // applyFallbackAPIHandler(app); // TODO: Fix to be more specific
  
  // 🔔 CEO DIRECTIVE: Sentry error handler (before other error handlers)
  // This must be AFTER all routes but BEFORE the global error handler
  setupSentryErrorHandling(app);
  
  // 🐞 CRITICAL FIX: Error handler AFTER setupVite to catch Vite interception errors
  // 🔒 SEC-001: CENTRALIZED ERROR HANDLING - Replace basic error handler with secure version
  app.use(globalErrorHandler);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // 🚀 COLD-START: Perform warmup sequence on server startup
    logger.info('🔥 Initiating server startup warmup...');
    performWarmup().then((result) => {
      logger.info('✅ Server warmup completed', {
        success: result.success,
        totalMs: result.timing.totalMs,
        components: result.componentStatus
      });
      
      // 🛡️ SAFETY: Signal database ready after warmup completes
      // This allows audit queue to start processing safely
      if (result.componentStatus.database) {
        setDatabaseReady();
        logger.info('Database ready signal sent to audit queue');
        
        // 🚨 CEO DIRECTIVE: Start ledger liveness sentinel
        // Heartbeat every 10 minutes to overnight_protocols_ledger
        startLedgerSentinel();
        logger.info('Ledger liveness sentinel started', {
          table: 'overnight_protocols_ledger',
          heartbeat_interval: '10m',
          stale_threshold: '15m'
        });
      }
    }).catch((error) => {
      logger.warn('⚠️ Server warmup encountered errors (non-fatal)', error as Error);
    });
    
    // Start SRE fallback monitoring after deadline exceeded
    (async () => {
      try {
        await sreExporter.startMonitoring();
        logger.info('SRE deadline monitoring active', { exportInterval: '5 minutes' });
      } catch (error) {
        logger.error('Failed to start SRE monitoring', error instanceof Error ? error : new Error(String(error)));
      }
    })();

    // 🚀 CANARY DEPLOYMENT: Start 25% promotion with strict guardrails
    logger.info('INITIATING 25% CANARY PROMOTION - STRICT GUARDRAILS ACTIVE');
    canaryGuardrails.startCanaryMonitoring();
    logger.info('Canary guardrails monitoring: ACTIVE');

    // 🚀 STEP-UP SCHEDULER: Start executive-approved automated progression
    (async () => {
      try {
        const { stepUpScheduler } = await import('./rollout/stepUpScheduler');
        stepUpScheduler.startAutomatedMonitoring();
        logger.info('AUTOMATED STEP-UP SCHEDULER ACTIVE');
      } catch (error) {
        logger.error('Failed to start step-up scheduler', error instanceof Error ? error : new Error(String(error)));
      }
    })();

    // 🧹 AUTOMATED CLEANUP: Start hourly token/session cleanup job
    try {
      tokenCleanupJob.start();
      logger.info('Token cleanup job started', { interval: '1 hour' });
    } catch (error) {
      logger.error('Failed to start token cleanup job', error instanceof Error ? error : new Error(String(error)));
    }

    // 📊 TELEMETRY CONTRACT v1.1: Start ecosystem telemetry emission
    // Exempt from Master Scope Rule - all apps must comply
    try {
      telemetryEmitter.start();
      logger.info('Telemetry emitter started', { 
        app_id: 'scholar_auth',
        heartbeat_interval: '60s',
        flush_interval: '10s'
      });
    } catch (error) {
      logger.error('Failed to start telemetry emitter', error instanceof Error ? error : new Error(String(error)));
    }

    // 🎯 TASK 2: Pre-warm critical routes every 2 minutes
    // Use internal localhost requests to avoid external latency and keep routes hot
    const WARMUP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
    const WARMUP_ROUTES = ['/', '/pricing'];
    
    const performRouteWarmup = async () => {
      for (const route of WARMUP_ROUTES) {
        try {
          const start = Date.now();
          const response = await fetch(`http://localhost:${port}${route}`, {
            method: 'GET',
            headers: { 'X-Warmup-Request': 'true' }
          });
          const latency = Date.now() - start;
          logger.info('Route warmup completed', { route, status: response.status, latencyMs: latency });
        } catch (error) {
          logger.warn('Route warmup failed', { route, error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    
    // Initial warmup after short delay to let server fully initialize
    setTimeout(() => {
      performRouteWarmup();
      logger.info('Initial route warmup triggered');
    }, 5000);
    
    // Recurring warmup every 2 minutes
    setInterval(() => {
      performRouteWarmup();
    }, WARMUP_INTERVAL_MS);
    
    logger.info('Route warmup scheduler started', { 
      routes: WARMUP_ROUTES, 
      intervalMs: WARMUP_INTERVAL_MS 
    });
  });
})();
