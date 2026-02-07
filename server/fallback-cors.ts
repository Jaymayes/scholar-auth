import type { Express, Request, Response } from 'express';
import { enforceCorsPolicy } from './middleware/policyGuard';

// EXPRESS DROP-IN PATCH FOR FALLBACK B EXECUTION + P0 HOTFIX
// Critical CORS/Security implementation with environment-gated dev patterns

// 1) Production/Staging origins (strict allowlist)
// CEO DIRECTIVE NOV 24 (T+24 GO/NO-GO): All 8 ecosystem apps per MASTER PROMPT
// Gate 3 compliance: scholar_auth, scholarship_api, scholarship_agent, scholarship_sage,
// student_pilot, provider_register, auto_page_maker, auto_com_center
const productionOrigins = new Set([
  // All 8 ecosystem apps (T+24 GO/NO-GO compliance)
  'https://scholar-auth-jamarrlmayes.replit.app',       // Auth provider (OAuth/OIDC)
  'https://scholarship-api-jamarrlmayes.replit.app',    // Core data + credits ledger
  'https://scholarship-agent-jamarrlmayes.replit.app',  // AI matching engine
  'https://scholarship-sage-jamarrlmayes.replit.app',   // Advisory assistant
  'https://student-pilot-jamarrlmayes.replit.app',      // B2C student dashboard
  'https://provider-register-jamarrlmayes.replit.app',  // B2B provider portal
  'https://auto-page-maker-jamarrlmayes.replit.app',    // SEO engine
  'https://auto-com-center-jamarrlmayes.replit.app',    // Transactional notifications
  
  // 🔧 DEC 23: Custom domain origins (scholaraiadvisor.com ecosystem)
  'https://scholaraiadvisor.com',                       // Main custom domain
  'https://www.scholaraiadvisor.com',                   // WWW subdomain
  'https://app.scholaraiadvisor.com',                   // App subdomain
  'https://api.scholaraiadvisor.com',                   // API subdomain
]);

const stagingOrigins = new Set([
  'https://staging.app.scholarshipai.com'
]);

// 2) P0 HOTFIX: Dev patterns (development only) - FIXED REGEX  
const devPatterns = [
  /^https:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.replit\.dev$/,
  /^https:\/\/[a-zA-Z0-9-]+.*\.spock\.replit\.dev$/,
  /^https:\/\/.*\.vercel\.app$/
];

// 3) Origin validation logic
function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  
  // Production/staging always use exact match
  if (productionOrigins.has(origin) || stagingOrigins.has(origin)) {
    return true;
  }
  
  // Dev patterns only in development environment
  if (process.env.NODE_ENV === 'development') {
    return devPatterns.some(pattern => pattern.test(origin));
  }
  
  return false;
}

// Legacy compatibility
const allowedOrigins = productionOrigins;

const METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

export function applyFallbackCORS(app: Express) {
  console.log('🚨 APPLYING FALLBACK B CORS PATCH');
  console.log('🎯 Allowed origins:', Array.from(allowedOrigins));
  console.log('🔧 Environment:', process.env.NODE_ENV);
  if (process.env.NODE_ENV === 'development') {
    console.log('🚀 Dev patterns enabled for:', devPatterns.map(p => p.source));
  }
  
  // P0 HARDENING: Enforce CORS policy validation
  const allOrigins = Array.from(productionOrigins).concat(Array.from(stagingOrigins));
  enforceCorsPolicy(allOrigins, process.env.NODE_ENV || 'development');

  // 2) CORS + security middleware with HARDENING (applies globally; keep early)
  app.use((req, res, next) => {
    // BYPASS: Skip CORS enforcement for OIDC discovery endpoints (RFC 8414 compliance)
    if (req.path.startsWith('/.well-known/')) {
      return next();
    }
    
    const origin = req.headers.origin || '';
    const originAllowed = isOriginAllowed(origin);
    
    // HARDENING: Enhanced CORS decision logging for all environments
    if (origin) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        origin,
        allowed: originAllowed,
        environment: process.env.NODE_ENV || 'unknown',
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent']?.substring(0, 50) + '...' || 'unknown'
      };
      console.log(`🔍 CORS: ${JSON.stringify(logEntry)}`);
    }

    // Always vary by Origin
    res.setHeader('Vary', 'Origin');

    // Allow-list CORS
    if (originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      // Ensure ACAO not present for blocked origins (e.g., localhost)
      res.removeHeader('Access-Control-Allow-Origin');
      res.removeHeader('Access-Control-Allow-Credentials');
    }

    // Methods and headers with preflight optimization
    // P1 FIX: Don't set CORS headers for /healthz/cors-policy when origin is disallowed
    const isCorsPolicyEndpoint = req.path === '/healthz/cors-policy';
    const shouldSkipHeaders = isCorsPolicyEndpoint && origin && !originAllowed;
    
    if (!shouldSkipHeaders) {
      res.setHeader('Access-Control-Allow-Methods', METHODS);
      const reqHdrs = req.headers['access-control-request-headers'] || '';
      if (reqHdrs) res.setHeader('Access-Control-Allow-Headers', reqHdrs);
      
      // HARDENING: Access-Control-Max-Age to reduce preflight churn
      const maxAge = process.env.NODE_ENV === 'development' ? '600' : '3600';
      res.setHeader('Access-Control-Max-Age', maxAge);
    }

    // No-store for APIs by default; reinforced below for /api/*
    if (req.url.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    // OPTIONS must always 204 (never 5xx)
    if (req.method === 'OPTIONS') {
      // HARDENING: For disallowed origins, return 403 for preflight as requested
      if (origin && !originAllowed) {
        res.removeHeader('Access-Control-Allow-Methods');
        res.removeHeader('Access-Control-Allow-Headers');
        res.removeHeader('Access-Control-Max-Age');
        return res.status(403).json({ code: 'CORS_ORIGIN_BLOCKED', message: 'Origin not allowed' });
      }
      return res.status(204).end();
    }

    // Never emit HSTS on fly.dev fallback (only set it at CF/api.scholarshipai.com)
    res.removeHeader('Strict-Transport-Security');

    // P1 FIX: Handle /healthz/cors-policy for disallowed origins in middleware
    if (isCorsPolicyEndpoint && origin && !originAllowed) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      
      if (req.method === 'GET') {
        return res.status(403).json({ 
          code: 'CORS_ORIGIN_BLOCKED', 
          message: 'Origin not allowed for API access' 
        });
      }
      // OPTIONS is already handled above
    }

    // HARDENING: Block disallowed origins from accessing API endpoints
    if (origin && !originAllowed && req.path.startsWith('/api/')) {
      return res.status(403).json({ code: 'CORS_ORIGIN_BLOCKED', message: 'Origin not allowed for API access' });
    }

    next();
  });

  // 3) Health and test endpoints - OVERRIDE existing endpoints
  app.get('/healthz/cors', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      now: new Date().toISOString(),
      originEcho: req.headers.origin || null,
      originAllowed: isOriginAllowed(req.headers.origin || ''),
      fallbackActive: true,
      env: process.env.NODE_ENV
    });
  });

  // P1 ADDITION: Strict CORS policy endpoint for synthetic monitoring
  // This endpoint enforces proper 403 responses for disallowed origins
  app.options('/healthz/cors-policy', (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = isOriginAllowed(origin);
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    
    if (origin && !originAllowed) {
      // Disallowed origin preflight: 403 with NO CORS headers at all
      // Remove any CORS headers that might have been set by middleware
      res.removeHeader('Access-Control-Allow-Origin');
      res.removeHeader('Access-Control-Allow-Credentials');
      res.removeHeader('Access-Control-Allow-Methods');
      res.removeHeader('Access-Control-Allow-Headers');
      res.removeHeader('Access-Control-Max-Age');
      return res.status(403).json({ 
        code: 'CORS_ORIGIN_BLOCKED', 
        message: 'Origin not allowed' 
      });
    }
    
    // Set CORS headers only for allowed origins  
    if (origin && originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
      res.setHeader('Vary', 'Origin');
      
      const maxAge = process.env.NODE_ENV === 'development' ? '600' : '3600';
      res.setHeader('Access-Control-Max-Age', maxAge);
    }
    
    // Allowed origin preflight: 204 
    return res.status(204).end();
  });

  app.get('/healthz/cors-policy', (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = isOriginAllowed(origin);
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    
    // GET requests
    if (origin && !originAllowed) {
      // Disallowed origin resource: 403 with NO CORS headers at all
      // Remove any CORS headers that might have been set by middleware
      res.removeHeader('Access-Control-Allow-Origin');
      res.removeHeader('Access-Control-Allow-Credentials');
      res.removeHeader('Access-Control-Allow-Methods');
      res.removeHeader('Access-Control-Allow-Headers');
      res.removeHeader('Access-Control-Max-Age');
      return res.status(403).json({ 
        code: 'CORS_ORIGIN_BLOCKED', 
        message: 'Origin not allowed for API access' 
      });
    }
    
    // Set CORS headers only for allowed origins
    if (origin && originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
      res.setHeader('Vary', 'Origin');
      
      const maxAge = process.env.NODE_ENV === 'development' ? '600' : '3600';
      res.setHeader('Access-Control-Max-Age', maxAge);
    }
    
    // Allowed origin resource: 200 with policy info
    res.status(200).json({
      ok: true,
      originAllowed: true
    });
  });

  app.get('/api/test-204', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
  });

  // 4) Cookie test endpoint (HARDENED: SameSite=None; Secure; HttpOnly)
  app.get('/api/cookie-test', (req, res) => {
    // P0 HARDENING: Proper cookie posture for cross-site scenarios
    const cookieOptions = {
      httpOnly: true,
      secure: true, // HTTPS only
      sameSite: 'none' as const, // Required for cross-site
      path: '/',
      maxAge: 5 * 60 * 1000
    };
    
    // Only set domain for fly.dev fallback, not in production
    if (req.get('host')?.includes('fly.dev')) {
      (cookieOptions as any).domain = '.fly.dev';
    }
    
    res.cookie('sid', 'test', cookieOptions);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ 
      ok: true, 
      cookie: 'set', 
      fallbackActive: true,
      cookieFlags: 'HttpOnly; Secure; SameSite=None' + (req.get('host')?.includes('fly.dev') ? '; Domain=.fly.dev' : '')
    });
  });

  console.log('✅ FALLBACK B CORS PATCH APPLIED');
}

// 5) Unknown /api/* => JSON 404 handler (to be applied after other routes)
export function applyFallbackAPIHandler(app: Express) {
  // Unknown /api/* => JSON 404 (never text/html)
  app.use('/api', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'Not Found', path: req.path, fallbackActive: true });
  });
  
  console.log('✅ FALLBACK B API 404 HANDLER APPLIED');
}