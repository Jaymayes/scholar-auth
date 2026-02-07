import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { authMetrics } from "./monitoring/authMetrics";
import { randomBytes, createHmac } from "crypto";
import { logger } from "./middleware/auditLogger";

// 🚨 CEO DIRECTIVE (Nov 9, 23:40 UTC): JWT auth service for emergency database timeout mitigation
import { 
  jwtAuthMiddleware, 
  issueJWTForUser, 
  setJWTCookie,
  clearJWTCookie 
} from "./services/jwtAuthService";

// Support both Replit environment and localhost for development
const REPLIT_DOMAINS = process.env.REPLIT_DOMAINS 
  ? `${process.env.REPLIT_DOMAINS},localhost`
  : "localhost";

// Detect test mode from environment
// Also consider ISSUER_URL for E2E test framework compatibility  
const TEST_MODE = process.env.NODE_ENV === 'test' || !!process.env.REPLIT_AUTH_ISSUER;

// PHASE 4: Circuit Breaker for OIDC Discovery
// Prevents cascade failures when Replit OIDC is unavailable
const circuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
  threshold: 3,  // Open circuit after 3 consecutive failures
  resetTimeout: 30000,  // 30 seconds before attempting recovery
};

function exponentialBackoff(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
}

async function discoveryWithRetry(issuerUrl: string, maxRetries: number = 3): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const config = await Promise.race([
        client.discovery(new URL(issuerUrl), process.env.REPL_ID!),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OIDC discovery timeout')), 10000)
        )
      ]) as any;
      
      // Success - reset circuit breaker
      circuitBreakerState.failures = 0;
      circuitBreakerState.isOpen = false;
      
      return config;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn('OIDC discovery attempt failed', {
        attempt: attempt + 1,
        maxRetries,
        error: lastError.message,
        action: 'oidc_discovery_retry',
      });
      
      if (attempt < maxRetries - 1) {
        const backoff = exponentialBackoff(attempt);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }
  
  // All retries failed - update circuit breaker
  circuitBreakerState.failures++;
  circuitBreakerState.lastFailure = Date.now();
  
  if (circuitBreakerState.failures >= circuitBreakerState.threshold) {
    circuitBreakerState.isOpen = true;
    logger.error('OIDC circuit breaker OPEN', new Error('Circuit breaker triggered'), {
      failures: circuitBreakerState.failures,
      action: 'circuit_breaker_open',
    });
  }
  
  throw lastError || new Error('OIDC discovery failed after retries');
}

// ============================================================================
// OIDC TOKEN EXCHANGE RETRY STRATEGY (Dec 24, 2025)
// P0 FIX: Bounded exponential backoff for transient OIDC failures
// Feature flag: OIDC_RETRY_ENABLED (default true, disable with 'false')
// ============================================================================

const OIDC_RETRY_ENABLED = process.env.OIDC_RETRY_ENABLED !== 'false';
const OIDC_RETRY_MAX_ATTEMPTS = 4;
const OIDC_RETRY_MAX_WINDOW_MS = 15000; // 15 second total window

type RetryBucket =
  | 'expired_auth_code'
  | 'client_configuration'
  | 'pkce_mismatch'
  | 'upstream_unavailable'
  | 'upstream_auth_rejection'
  | 'upstream_server_error'
  | 'upstream_temporarily_unavailable'
  | 'access_denied'
  | 'jwt_signing_failure'
  | 'db_storage_failure'
  | 'unknown';

interface RetryAttemptLog {
  ts: string;
  correlation_id: string;
  attempt: number;
  elapsed_ms: number;
  provider_status?: number;
  provider_error?: string;
  bucket: RetryBucket;
  decision: 'retry' | 'abort';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tokenExchangeBackoffMs(attempt: number): number {
  // attempt: 1..4 => 250ms, 1000ms, 3000ms, 7000ms
  const base = [250, 1000, 3000, 7000][attempt - 1] ?? 7000;
  const jitter = Math.floor(Math.random() * Math.min(200, base * 0.2));
  return base + jitter;
}

function isNetworkTransportError(err: unknown): boolean {
  const msg = String((err as Error)?.message || '');
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(msg);
}

function classifyTokenExchangeError(err: unknown, status?: number): RetryBucket {
  const opError = err as { error?: string; code?: string; message?: string };
  const code = String(opError?.error || opError?.code || '').toLowerCase();
  const msg = String(opError?.message || '').toLowerCase();
  // P0 FIX (Dec 24, 2025): Also check stringified error for primitives or unusual structures
  const stringified = String(err).toLowerCase();

  // Check all three sources: code, message, and stringified error
  const all = [code, msg, stringified];
  
  if (all.some(s => s.includes('invalid_grant') || s.includes('expired'))) {
    return 'expired_auth_code';
  }
  if (all.some(s => s.includes('invalid_client'))) {
    return 'client_configuration';
  }
  if (all.some(s => s.includes('pkce') || s.includes('code_verifier'))) {
    return 'pkce_mismatch';
  }
  if (all.some(s => s.includes('access_denied'))) {
    return 'access_denied';
  }
  if (all.some(s => s.includes('temporarily_unavailable') || s.includes('temporarily'))) {
    return 'upstream_temporarily_unavailable';
  }
  if (all.some(s => s.includes('server_error'))) {
    return 'upstream_server_error';
  }
  if (status && status >= 500) {
    return 'upstream_unavailable';
  }
  if (status && (status === 401 || status === 403)) {
    return 'upstream_auth_rejection';
  }
  if (isNetworkTransportError(err)) {
    return 'upstream_unavailable';
  }
  if (all.some(s => s.includes('jsonwebt') || s.includes('jwks') || s.includes('kid'))) {
    return 'jwt_signing_failure';
  }
  if (all.some(s => s.includes('prisma') || s.includes('sequelize') || s.includes('database'))) {
    return 'db_storage_failure';
  }
  // P0 FIX (Dec 24, 2025): Additional patterns for edge cases
  if (all.some(s => s.includes('invalid_token') || s.includes('malformed'))) {
    return 'expired_auth_code';
  }
  if (all.some(s => s.includes('login_required') || s.includes('session'))) {
    return 'expired_auth_code';
  }
  if (all.some(s => s.includes('state') || s.includes('hmac') || s.includes('signature'))) {
    return 'pkce_mismatch';
  }
  if (all.some(s => s.includes('timeout') || s.includes('timed out') || s.includes('socket'))) {
    return 'upstream_unavailable';
  }
  if (all.some(s => s.includes('rate') || s.includes('too many') || s.includes('throttl'))) {
    return 'upstream_temporarily_unavailable';
  }
  // 4xx client errors (400, 404, 429, etc.) - treat as configuration issues
  if (status && status >= 400 && status < 500) {
    return 'client_configuration';
  }
  // OpenID-client v6 RPError for response parsing failures
  if (all.some(s => s.includes('rperror') || s.includes('unexpected') || s.includes('parse'))) {
    return 'upstream_server_error';
  }
  // Final fallback: any error string hint - use stringified for deep inspection
  if (stringified.includes('error')) {
    return 'upstream_server_error';
  }
  return 'unknown';
}

function isRetryableBucket(bucket: RetryBucket, status?: number): boolean {
  if (bucket === 'upstream_temporarily_unavailable' || 
      bucket === 'upstream_server_error' || 
      bucket === 'upstream_unavailable') {
    return true;
  }
  if (status && [500, 502, 503, 504].includes(status)) {
    return true;
  }
  return false;
}

function logRetryAttempt(log: RetryAttemptLog): void {
  logger.info('OIDC token exchange attempt', {
    ...log,
    action: 'token_exchange_attempt',
  });
}

// Metrics for token exchange retries - uses existing logging infrastructure
function incTokenExchangeMetric(bucket: string, attempt: number, success: boolean): void {
  logger.info('Token exchange metric', {
    action: 'token_exchange_metric',
    bucket,
    attempt,
    success,
    timestamp: new Date().toISOString(),
  });
}

export const getOidcConfig = memoize(
  async () => {
    // Check circuit breaker
    if (circuitBreakerState.isOpen) {
      const timeSinceFailure = Date.now() - circuitBreakerState.lastFailure;
      
      if (timeSinceFailure < circuitBreakerState.resetTimeout) {
        logger.warn('OIDC circuit breaker is OPEN - fast-failing', {
          timeSinceFailure,
          resetTimeout: circuitBreakerState.resetTimeout,
          action: 'circuit_breaker_fast_fail',
        });
        throw new Error('OIDC service unavailable (circuit breaker open)');
      }
      
      // Half-open: try one request
      logger.info('OIDC circuit breaker HALF-OPEN - attempting recovery', {
        action: 'circuit_breaker_half_open',
      });
    }
    
    // Use REPLIT_AUTH_ISSUER for external Replit OIDC (user authentication)
    // Note: ISSUER_URL is for ScholarAuth's own OAuth provider, NOT for Replit Auth
    // E2E tests should set REPLIT_AUTH_ISSUER to use the mock OIDC
    const issuerUrl = process.env.REPLIT_AUTH_ISSUER || "https://replit.com/oidc";
    const isTestMode = !!process.env.REPLIT_AUTH_ISSUER;
    logger.info('Using Replit OIDC issuer for user auth', { 
      issuerUrl, 
      isTestMode, 
      replitAuthIssuerOverride: !!process.env.REPLIT_AUTH_ISSUER,
    });
    const startTime = Date.now();
    
    // PHASE 4: Use discovery with retry and circuit breaker
    const config = await discoveryWithRetry(issuerUrl, 3);
    
    const duration = Date.now() - startTime;
    logger.info('OIDC discovery completed', { durationMs: duration });
    
    // PERFORMANCE ALERT: Log slow discovery for monitoring
    if (duration > 200) {
      logger.warn('SLOW OIDC discovery', { durationMs: duration, targetMs: 200 });
    }
    
    return config;
  },
  { 
    maxAge: 24 * 3600 * 1000, // 24 hours - JWKS rotate infrequently
    preFetch: true // Enable pre-fetching before expiration
  }
);

// PERFORMANCE OPTIMIZATION: More aggressive cache warming and refresh
const warmOidcCache = async () => {
  try {
    const startTime = Date.now();
    await getOidcConfig();
    logger.info('OIDC config pre-warmed and cached for 24h', { 
      durationMs: Date.now() - startTime 
    });
  } catch (err) {
    logger.error('OIDC config pre-warm failed', 
      err instanceof Error ? err : new Error(String(err))
    );
    // Retry after 5 seconds on failure
    setTimeout(warmOidcCache, 5000);
  }
};

// Pre-warm immediately (skip in test mode to allow dynamic issuer override)
// NON-BLOCKING: Allow app to start even if OIDC discovery is slow
if (!TEST_MODE) {
  warmOidcCache().catch(() => {}); // Non-blocking - don't wait for pre-warm
  // PERFORMANCE: Re-warm cache every 12 hours to avoid expiration delays
  setInterval(() => warmOidcCache().catch(() => {}), 12 * 60 * 60 * 1000);
} else {
  logger.info('TEST_MODE active: skipping OIDC cache pre-warming to allow dynamic issuer override');
}

// STABLE SESSION CONFIGURATION - CRITICAL: Do not modify pool config
export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  
  // 🚨 P1 HOTFIX (Nov 9, 23:05 UTC): Strip psql command prefix from DATABASE_URL
  // Root cause: DATABASE_URL contains "psql 'postgresql://..." instead of clean connection string
  const rawDatabaseUrl = process.env.DATABASE_URL!;
  const cleanDatabaseUrl = rawDatabaseUrl.replace(/^psql\s+'(.+)'$/, '$1').trim();
  
  const sessionStore = new pgStore({
    conString: cleanDatabaseUrl,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
    // PERFORMANCE: Optimize session store queries
    pruneSessionInterval: 60 * 15, // Prune every 15 minutes (default: 60 min)
    // 🔧 P1 FIX (2026-01-24): Graceful error logging for Neon cold-start disconnections
    // This prevents blank_page_intermittent by not crashing on transient connection errors
    errorLog: (err: Error) => {
      console.warn('⚠️ Session store error (non-fatal):', err.message);
    },
  });
  
  // 🔧 P1 FIX (2026-01-24): Handle session store errors gracefully
  sessionStore.on?.('error', (err: Error) => {
    console.warn('⚠️ Session store connection error (non-fatal, will retry):', err.message);
  });
  
  // 🔒 SECURITY FIX: Multi-secret support for zero-downtime rotation
  // Format: SESSION_SECRET=new_secret,old_secret (comma-separated)
  // First secret is used for signing, all secrets are used for verification
  const secretsEnv = process.env.SESSION_SECRET!;
  const secrets = secretsEnv.includes(',') 
    ? secretsEnv.split(',').map(s => s.trim())
    : [secretsEnv];
  
  if (secrets.length > 1) {
    logger.info('Multi-secret session configuration active', {
      secretCount: secrets.length,
      action: 'session_config',
      rotationEnabled: true
    });
  }
  
  // For SameSite=None, Secure must be true (HTTPS required)
  // In production or Replit preview (HTTPS), set secure=true
  // For local HTTP testing, fallback to Lax with secure=false
  const isHttpsEnvironment = process.env.NODE_ENV === 'production' || 
    process.env.REPLIT_DEPLOYMENT === '1' ||
    process.env.REPLIT_DEV_DOMAIN?.includes('.replit.dev');
  
  return session({
    secret: secrets, // Array enables zero-downtime rotation
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    name: 'scholarai.sid', // Custom session name for security
    cookie: {
      httpOnly: true, // ✅ Prevents XSS cookie access
      secure: isHttpsEnvironment, // ✅ HTTPS-only when in production/Replit
      sameSite: isHttpsEnvironment ? 'none' : 'lax', // ✅ None for cross-site, Lax for local
      maxAge: sessionTtl, // ✅ 7-day session timeout
      path: '/', // ✅ Session available across entire app
      // Note: SameSite=None requires Secure=true (HTTPS)
      // Fallback to Lax+insecure for local HTTP development
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  try {
    // PRODUCTION HARDENING: Enhanced trust proxy configuration
    app.set("trust proxy", 1);
    
    // PRODUCTION HARDENING: Security headers for auth routes  
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/login') || req.path.startsWith('/api/callback')) {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      }
      next();
    });
    
    // 🚨 CEO EMERGENCY MITIGATION (Nov 9, 23:40 UTC): Replace PGStore sessions with JWT
    // BLOCKER: Database timeout (XX000) on session queries causing HTTP 500s
    // MITIGATION: Stateless JWT cookies - no database dependency
    // SCOPE: User auth only - OIDC provider sessions unchanged
    // ROLLBACK: Uncomment app.use(getSession()) to restore database sessions
    // app.use(getSession()); // ⏸️ DISABLED - PGStore timeout blocker
    app.use(jwtAuthMiddleware); // ✅ ENABLED - JWT stateless auth
    app.use(passport.initialize());
    // app.use(passport.session()); // ⏸️ DISABLED - Not needed with JWT auth

    // ✅ PERFORMANCE TARGET MET: P95=85ms (target was 120ms) - Re-enabling auth metrics with sampling
    // Always capture errors + 10% sampling for success metrics + synthetic checks
    app.use('/api/login', authMetrics.captureErrors, authMetrics.trackAuthAttemptSampled);
    app.use('/api/callback', authMetrics.captureErrors, authMetrics.trackAuthAttemptSampled);
    app.use('/api/auth/redirect', authMetrics.captureErrors, authMetrics.trackAuthAttemptSampled);

    const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const userId = tokens.claims()?.sub || 'unknown';
    
    try {
      const user = {};
      updateUserSession(user, tokens);
      
      // Structured logging: login_success (NO PII - email removed per security audit)
      logger.info('User authenticated successfully', {
        userId, // Replit user ID (safe identifier)
        action: 'login_success',
        timestamp: new Date().toISOString()
      });
      
      // PERFORMANCE OPTIMIZATION: Make user upsert async to avoid blocking authentication
      // This allows the auth flow to complete quickly while user data is saved in background
      upsertUser(tokens.claims()).catch(error => {
        logger.error('Background user upsert failed', 
          error instanceof Error ? error : new Error(String(error)),
          { 
            userId,
            action: 'user_upsert_error'
          }
        );
      });
      
      verified(null, user);
    } catch (error) {
      // Structured logging: login_error_reason
      logger.error('Auth verification failed', 
        error instanceof Error ? error : new Error(String(error)),
        {
          userId,
          action: 'login_error_reason',
          errorType: 'token_verification_failure'
        }
      );
      verified(error as Error);
    }
  };

  for (const domain of REPLIT_DOMAINS.split(",")) {
    // Use correct protocol and port for localhost development
    const protocol = domain === "localhost" ? "http" : "https";
    const portSuffix = domain === "localhost" ? ":5000" : "";
    const callbackURL = `${protocol}://${domain}${portSuffix}/api/callback`;
    
    logger.info('Configuring auth strategy', { domain, callbackURL });
    
    // P0 FIX (Dec 22, 2025): Removed "offline_access" scope - Replit OIDC does NOT support it
    // for hosted Repls and returns "server_error" when requested
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile",
        callbackURL,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  // NOTE: Fast login route moved to index.ts for optimal middleware ordering

  // P0 FIX: Server-side OAuth callback with PKCE cookie
  // Completes token exchange server-side - no more client-side sessionStorage dependency
  app.get("/api/callback", async (req, res) => {
    const startTime = Date.now();
    const correlationId = (req as any).correlationId || 'unknown';
    
    // P0 DIAGNOSTIC (Dec 23, 2025): Log callback request details at entry point
    // This helps diagnose why code/state might be missing
    // SECURITY: Do NOT log raw code/state values - log only presence/length
    logger.info('OAuth callback received (P0 ENTRY DIAGNOSTIC)', {
      correlationId,
      action: 'callback_entry',
      hasCode: !!req.query.code,
      hasState: !!req.query.state,
      codeLength: typeof req.query.code === 'string' ? req.query.code.length : 0,
      stateLength: typeof req.query.state === 'string' ? req.query.state.length : 0,
      hasError: !!req.query.error,
      errorValue: req.query.error,
      errorDescription: req.query.error_description,
      queryKeys: Object.keys(req.query),
      queryParamCount: Object.keys(req.query).length,
      requestPath: req.path,
      hostname: req.hostname,
      protocol: req.protocol,
      referer: req.get('referer')?.substring(0, 100) || 'no_referer',
      wasRedirected: !!req.query.redirected,
      method: req.method,
    });
    
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;
      const error = req.query.error;
      
      // Handle OAuth errors from IdP
      if (error) {
        logger.warn('OAuth callback received error from IdP', { 
          correlationId,
          error, 
          description: req.query.error_description,
          action: 'idp_error_received'
        });
        return res.redirect(`/auth/callback?error=${encodeURIComponent(String(error))}`);
      }
      
      // Validate required parameters
      if (!code || !state) {
        logger.warn('OAuth callback missing required parameters', { 
          correlationId,
          hasCode: !!code, 
          hasState: !!state,
          codeLength: code?.length || 0,
          stateLength: state?.length || 0,
          action: 'missing_parameters_error',
          queryParams: Object.keys(req.query).join(','),
        });
        return res.redirect('/auth/callback?error=missing_parameters');
      }
      
      // P0 FIX: Extract PKCE data from HMAC-signed state (stateless, cross-domain compatible)
      // State is returned unchanged by Replit OIDC, so we use it to carry PKCE data
      const { verifySignedState } = await import('./utils/oauthState.js');
      
      // Verify and decode the state (no origin check needed since callback is on production domain)
      const statePayload = verifySignedState(state);
      
      if (!statePayload) {
        logger.warn('OAuth callback: state verification failed', { correlationId });
        return res.redirect('/auth/callback?error=invalid_state');
      }
      
      // Extract PKCE and redirect data from verified state
      const { 
        code_verifier, 
        redirect_uri, 
        return_to, 
        original_origin,
        ts: created_at,
        utm // UTM attribution for marketing tracking (A7→A5/A6)
      } = statePayload;
      
      if (!code_verifier) {
        logger.warn('OAuth callback: code_verifier missing from state', { correlationId });
        return res.redirect('/auth/callback?error=invalid_session');
      }
      
      // Check expiration (5 minutes - built into verifySignedState, but double-check for 10 min max)
      if (Date.now() - created_at > 10 * 60 * 1000) {
        logger.warn('OAuth callback: PKCE data expired', { correlationId, age: Date.now() - created_at });
        return res.redirect('/auth/callback?error=session_expired');
      }
      
      // Complete token exchange server-side
      // P0 FIX: Include redirect_uri in token exchange - Replit OIDC requires it to match the original authorize request
      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);
      
      const clientModule = await import('openid-client');
      
      // P0 DIAGNOSTIC (Dec 23, 2025): Log token exchange parameters for production debugging
      // Security: Sanitize URLs to remove authorization code (credential) from logs
      const actualRequestPath = `${req.protocol}://${req.get('host')}${req.path}`;
      const callbackUrlSanitized = new URL(redirect_uri);
      callbackUrlSanitized.searchParams.set('code', '[REDACTED]');
      callbackUrlSanitized.searchParams.set('state', '[REDACTED]');
      
      logger.info('OAuth token exchange starting', {
        correlationId,
        action: 'token_exchange_start',
        redirect_uri_from_state: redirect_uri,
        callback_url_base: callbackUrlSanitized.toString(),
        actual_request_path: actualRequestPath,
        code_length: code?.length || 0,
        code_verifier_length: code_verifier?.length || 0,
        state_age_seconds: Math.round((Date.now() - created_at) / 1000),
        return_to,
        original_origin,
        client_id: process.env.REPL_ID?.substring(0, 8) + '...' // Log partial for debugging
      });
      
      // P0 FIX (Dec 24, 2025): Token exchange with bounded exponential backoff retry
      // Retries only on transient errors (server_error, temporarily_unavailable, 5xx, network)
      // Non-retryable errors (invalid_grant, invalid_client, access_denied, PKCE) fail immediately
      const retryCorrelationId = correlationId;
      const maxAttempts = OIDC_RETRY_ENABLED ? OIDC_RETRY_MAX_ATTEMPTS : 1;
      const retryStartTime = Date.now();
      
      let tokens: Awaited<ReturnType<typeof clientModule.authorizationCodeGrant>> | null = null;
      let lastError: unknown = null;
      let lastBucket: RetryBucket = 'unknown';
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // openid-client v6 signature: authorizationCodeGrant(config, currentUrl, checks, tokenEndpointParameters)
          // Replit OIDC requires redirect_uri in the token request to match the authorization request
          tokens = await clientModule.authorizationCodeGrant(
            config, 
            callbackUrl, 
            {
              pkceCodeVerifier: code_verifier,
              expectedState: state,
              idTokenExpected: true,
            },
            // Token endpoint parameters - redirect_uri MUST match the original authorize request
            { redirect_uri: redirect_uri }
          );
          
          // Success - log and break out of retry loop
          logRetryAttempt({
            ts: new Date().toISOString(),
            correlation_id: retryCorrelationId,
            attempt,
            elapsed_ms: Date.now() - retryStartTime,
            provider_status: 200,
            bucket: 'unknown', // Success path
            decision: 'abort',
          });
          incTokenExchangeMetric('success', attempt, true);
          break;
          
        } catch (err) {
          lastError = err;
          const opError = err as { response?: { status?: number }; error?: string };
          const status = opError?.response?.status;
          const bucket = classifyTokenExchangeError(err, status);
          lastBucket = bucket;
          
          const shouldRetry = OIDC_RETRY_ENABLED && 
                              isRetryableBucket(bucket, status) && 
                              attempt < maxAttempts;
          
          logRetryAttempt({
            ts: new Date().toISOString(),
            correlation_id: retryCorrelationId,
            attempt,
            elapsed_ms: Date.now() - retryStartTime,
            provider_status: status,
            provider_error: String((err as Error)?.message || 'unknown').slice(0, 300),
            bucket,
            decision: shouldRetry ? 'retry' : 'abort',
          });
          incTokenExchangeMetric(bucket, attempt, false);
          
          if (!shouldRetry) {
            // Non-retryable error - exit loop and let catch block handle it
            throw err;
          }
          
          // Check time window constraint before waiting
          const waitMs = tokenExchangeBackoffMs(attempt);
          if (Date.now() - retryStartTime + waitMs > OIDC_RETRY_MAX_WINDOW_MS) {
            logger.warn('Token exchange retry window exceeded', {
              correlationId: retryCorrelationId,
              attempt,
              elapsed_ms: Date.now() - retryStartTime,
              bucket,
              action: 'retry_window_exceeded',
            });
            throw err;
          }
          
          // Wait and retry
          logger.info('Token exchange transient failure, retrying', {
            correlationId: retryCorrelationId,
            attempt,
            bucket,
            nextAttemptIn: waitMs,
            action: 'token_exchange_retry',
          });
          await sleep(waitMs);
        }
      }
      
      // If we exhausted retries without success, throw the last error
      if (!tokens) {
        throw lastError || new Error('Token exchange failed after retries');
      }
      
      const claims = tokens.claims();
      const userId = (claims?.sub as string) || 'unknown';
      
      logger.info('OAuth code exchange successful (server-side)', {
        correlationId,
        userId,
        action: 'code_exchange_success',
        duration: Date.now() - startTime
      });
      
      // Upsert user in database (async, non-blocking)
      storage.upsertUser({
        id: userId,
        email: claims?.email as string,
        firstName: claims?.first_name as string,
        lastName: claims?.last_name as string,
        profileImageUrl: claims?.profile_image_url as string,
      }).catch(err => {
        logger.error('Background user upsert failed', err instanceof Error ? err : new Error(String(err)), { userId });
      });
      
      // Issue JWT cookie for session
      const jwtToken = await issueJWTForUser(claims, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      setJWTCookie(res, jwtToken);
      
      // Track successful login
      const { authHealthMonitor } = await import('./monitoring/authHealthDashboard');
      authHealthMonitor.recordLoginAttempt(true);
      
      logger.info('User authenticated successfully (stateless PKCE)', {
        correlationId,
        userId,
        action: 'login_success',
        duration: Date.now() - startTime,
        originalOrigin: original_origin
      });
      
      // P0 FIX: Redirect to original origin if cross-domain, otherwise use production domain
      const successPath = return_to || '/';
      const productionBaseUrl = process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app';
      
      // Build UTM query string for attribution tracking (A7→A5/A6)
      const utmParams = new URLSearchParams();
      if (utm?.utm_source) utmParams.set('utm_source', utm.utm_source);
      if (utm?.utm_medium) utmParams.set('utm_medium', utm.utm_medium);
      if (utm?.utm_campaign) utmParams.set('utm_campaign', utm.utm_campaign);
      if (utm?.utm_term) utmParams.set('utm_term', utm.utm_term);
      if (utm?.utm_content) utmParams.set('utm_content', utm.utm_content);
      const utmQueryString = utmParams.toString();
      
      // Log UTM attribution if present
      if (utmQueryString) {
        logger.info('UTM attribution preserved across auth', {
          correlationId,
          userId,
          action: 'utm_attribution_preserved',
          utm_source: utm?.utm_source,
          utm_medium: utm?.utm_medium,
          utm_campaign: utm?.utm_campaign,
        });
      }
      
      // If user came from dev preview domain, redirect back there after auth
      if (original_origin && original_origin !== productionBaseUrl) {
        // Cross-domain redirect: send to original origin with success indicator + UTMs
        const redirectUrl = `${original_origin}/auth/callback?success=true&return_to=${encodeURIComponent(successPath)}${utmQueryString ? '&' + utmQueryString : ''}`;
        res.redirect(redirectUrl);
      } else {
        // Same domain: redirect to local auth callback + UTMs
        const redirectUrl = `/auth/callback?success=true&return_to=${encodeURIComponent(successPath)}${utmQueryString ? '&' + utmQueryString : ''}`;
        res.redirect(redirectUrl);
      }
      
    } catch (error) {
      // P0 PRODUCTION DIAGNOSTIC: Structured error logging for token exchange failures
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      // P0 FIX (Dec 21, 2025): Extract OPError-specific details for debugging
      // openid-client throws OPError with response body details
      let oidcErrorCode: string | undefined;
      let oidcErrorDescription: string | undefined;
      let rawResponse: unknown;
      let responseStatus: number | undefined;
      
      if (error && typeof error === 'object') {
        const opError = error as { 
          error?: string; 
          error_description?: string; 
          response?: { 
            body?: unknown;
            status?: number;
            statusText?: string;
          };
          cause?: unknown;
          code?: string;
        };
        oidcErrorCode = opError.error;
        oidcErrorDescription = opError.error_description;
        rawResponse = opError.response?.body;
        responseStatus = opError.response?.status;
        
        // Log the raw response for debugging - critical for diagnosing OIDC issues
        logger.warn('OIDC provider error details (P0 DIAGNOSTIC)', {
          correlationId,
          oidcError: oidcErrorCode,
          oidcErrorDescription,
          responseStatus,
          responseBody: rawResponse ? JSON.stringify(rawResponse).substring(0, 500) : undefined,
          errorCode: opError.code,
          cause: opError.cause ? String(opError.cause) : undefined,
          action: 'oidc_error_details'
        });
      }
      
      // Classify error for operational dashboards using the same logic as retry loop
      // P0 FIX (Dec 24, 2025): Use centralized classification to avoid "unknown" bucket
      const bucket = classifyTokenExchangeError(error, responseStatus);
      let errorClass = bucket;
      let userErrorCode = 'server_error';
      
      // Map buckets to user-friendly error codes
      if (bucket === 'expired_auth_code') {
        userErrorCode = 'session_expired';
      } else if (bucket === 'access_denied') {
        userErrorCode = 'access_denied';
      } else if (bucket === 'pkce_mismatch') {
        userErrorCode = 'security_error';
      } else if (bucket === 'client_configuration') {
        userErrorCode = 'config_error';
      }
      
      logger.error('OAuth callback token exchange failed', error instanceof Error ? error : new Error(errorMessage), {
        correlationId,
        errorClass,
        errorName,
        errorMessage: errorMessage.substring(0, 500), // Truncate for safety
        oidcErrorCode,
        oidcErrorDescription,
        responseStatus,
        duration: Date.now() - startTime,
        hasCode: !!req.query.code,
        hasState: !!req.query.state,
        hasPkceCookie: !!req.cookies?.pkce_data,
        stackTrace: errorStack?.substring(0, 1000), // Include stack for debugging
        action: 'token_exchange_failed'
      });
      
      // Track failed login for monitoring
      import('./monitoring/authHealthDashboard').then(({ authHealthMonitor }) => {
        authHealthMonitor.recordLoginAttempt(false);
      }).catch(() => {});
      
      // P0 DIAGNOSTIC (Dec 24, 2025): Include error class in URL for operator visibility
      // This surfaces the reason in UI without exposing sensitive details
      res.redirect(`/auth/callback?error=${userErrorCode}&reason=${encodeURIComponent(errorClass)}`);
    }
  });

  // 🚨 CEO EMERGENCY MITIGATION (Nov 9, 23:40 UTC): JWT logout (clear cookie only)
  // Previous: Destroyed database session (now disabled)
  // Current: Clear JWT cookie for stateless logout
  app.get("/api/logout", async (req, res) => {
    const correlationId = (req as any).correlationId || 'unknown';
    const userId = req.user ? (req.user as any).claims?.sub || (req.user as any).sub : 'anonymous';
    
    // CRITICAL FIX: Clear legacy cookies FIRST, then JWT cookie LAST
    // Issue: res.clearCookie() calls can interfere with each other's path settings
    res.clearCookie('scholarai.sid', { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.clearCookie('auth_state', { path: '/api' });
    
    // Clear JWT cookie LAST to prevent path contamination from other clearCookie calls
    clearJWTCookie(res);
    
    // Success path: JWT cleared
    logger.info('User logged out successfully (JWT)', {
      correlationId,
      userId,
      action: 'logout_success',
      timestamp: new Date().toISOString(),
      setCookieHeaders: res.getHeader('Set-Cookie')
    });
    
    // CEO-MANDATED: Track successful logout for guardrails
    import('./monitoring/authHealthDashboard').then(({ authHealthMonitor }) => {
      authHealthMonitor.recordLogoutAttempt(true);
    });
    
    // 303 See Other: Ensures GET request to homepage (prevents POST resubmission)
    res.redirect(303, '/');
  });

  // ROUTE ALIGNMENT FIX: External systems expect /api/auth/redirect 
  app.get("/api/auth/redirect", (req, res, next) => {
    logger.info('[AUTH-REDIRECT] External redirect request', { 
      method: req.method, 
      url: req.originalUrl 
    });
    // 🚨 CEO EMERGENCY MITIGATION: Use session: false for JWT auth
    passport.authenticate(`replitauth:${req.hostname}`, {
      session: false, // ✅ JWT auth - no sessions
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });
  } catch (error) {
    logger.error('Auth setup failed', 
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};