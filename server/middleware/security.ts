import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';

// Security configuration based on environment
const getSecurityConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  return {
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://replit.com",
          "blob:",
          ...(isDevelopment ? ["'unsafe-inline'", "'unsafe-eval'"] : []), // Required for Vite dev server and HMR
        ],
        styleSrc: [
          "'self'",
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
          ...(isDevelopment ? ["'unsafe-inline'"] : []), // Required for styled components and CSS-in-JS in dev
        ],
        fontSrc: [
          "'self'",
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://images.unsplash.com",
          "https://replit.com",
        ],
        connectSrc: [
          "'self'",
          "https://replit.com",
          "wss://replit.com",
          ...(isDevelopment ? ["ws://localhost:*", "wss://localhost:*"] : []), // Vite WebSocket - DEV ONLY
        ],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://replit.com"],
      },
      reportOnly: false,
    },
    
    // Strict Transport Security (HTTPS only in production)
    hsts: isProduction ? {
      maxAge: 63072000, // 2 years (required for HSTS preload list)
      includeSubDomains: true,
      preload: true,
    } : false,
    
    // X-Frame-Options (backup for older browsers)
    frameguard: {
      action: 'deny' as const,
    },
    
    // Disable X-Powered-By header
    hidePoweredBy: true,
    
    // MIME type sniffing protection
    noSniff: true,
    
    // XSS filter protection
    xssFilter: true,
    
    // Referrer Policy
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin' as const,
    },
    
    // Permissions Policy
    permittedCrossDomainPolicies: false,
    
    // Cross-Origin policies - DISABLED to allow Clerk third-party resources
    // COEP/COOP block external resources like Clerk's auth UI components
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' as const },
  };
};

// Custom security headers middleware (AGENT3 v2.2 CEO FINAL SPEC compliant)
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // 🚨 AGENT3 v2.2 CEO FINAL SPEC: Exact 6/6 security headers (UI CSP Profile for scholar_auth)
  // 🔧 DEC 25: Added Cloudflare Turnstile domains for Clerk CAPTCHA support
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com https://*.clerk.accounts.dev https://clerk.shared.lcl.dev https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.clerk.com https://challenges.cloudflare.com; font-src 'self' data:; connect-src 'self' https://scholarship-api-jamarrlmayes.replit.app https://auto-com-center-jamarrlmayes.replit.app https://scholar-auth-jamarrlmayes.replit.app https://scholarship-agent-jamarrlmayes.replit.app https://scholarship-sage-jamarrlmayes.replit.app https://student-pilot-jamarrlmayes.replit.app https://provider-register-jamarrlmayes.replit.app https://auto-page-maker-jamarrlmayes.replit.app https://api.stripe.com https://*.clerk.accounts.dev https://clerk.shared.lcl.dev https://challenges.cloudflare.com; frame-src https://js.stripe.com https://hooks.stripe.com https://*.clerk.accounts.dev https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://hooks.stripe.com; object-src 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(self), usb=(), xr-spatial-tracking=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Legacy XSS protection (deprecated but harmless)
  res.setHeader('X-XSS-Protection', '1; mode=block');
    
  // Cache control for different resource types
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year for static assets
  }
  
  // HTTPS redirect in production
  if (isProduction && !req.secure && req.get('X-Forwarded-Proto') !== 'https') {
    return res.redirect(301, `https://${req.get('Host')}${req.url}`);
  }
  
  next();
};

// Apply Helmet with configuration
export const applySecurityMiddleware = () => {
  return helmet(getSecurityConfig());
};

// CORS allowlist cache (load once at startup)
let corsAllowedOrigins: string[] = [];
let corsConfigLoaded = false;

// 🔒 CEO NOV 24: Authorized frontend origins (T+24 GO/NO-GO compliance)
// SECURITY: EXACT origin matching - all 8 ecosystem apps per MASTER PROMPT
// 🔧 DEC 23: Added custom domain support for scholaraiadvisor.com
const getAuthorizedFrontendOrigins = () => {
  // Get domain suffix from environment or use default
  const domain = process.env.REPLIT_DOMAIN_SUFFIX || 'jamarrlmayes.replit.app';
  
  // 8 ecosystem app origins (replit.app domain)
  const ecosystemOrigins = [
    `https://scholar-auth-${domain}`,
    `https://scholarship-api-${domain}`,
    `https://scholarship-agent-${domain}`,
    `https://scholarship-sage-${domain}`,
    `https://student-pilot-${domain}`,
    `https://provider-register-${domain}`,
    `https://auto-page-maker-${domain}`,
    `https://auto-com-center-${domain}`
  ];
  
  // Custom domain origins (scholaraiadvisor.com ecosystem)
  // 🔒 CEO DEC 23: Allow custom domain frontend to use ScholarAuth OIDC
  const customDomainOrigins = [
    'https://scholaraiadvisor.com',
    'https://www.scholaraiadvisor.com',
    'https://app.scholaraiadvisor.com',
    'https://api.scholaraiadvisor.com'
  ];
  
  return [...ecosystemOrigins, ...customDomainOrigins];
};

const loadCorsConfig = () => {
  if (corsConfigLoaded) return corsAllowedOrigins;
  
  const corsOriginsRaw = process.env.CORS_ALLOWED_ORIGINS || '';
  const rawOrigins = corsOriginsRaw
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0)
    .filter((origin, index, arr) => arr.indexOf(origin) === index); // dedupe
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  // 🔒 CEO NOV 13: EXACT MATCH ONLY - no substring fuzzy matching
  // CRITICAL: Prevent origin spoofing (e.g., student-pilot.attacker.com)
  // 🔧 DEC 23: All authorized origins are allowed automatically
  const authorizedOriginsList = getAuthorizedFrontendOrigins();
  
  // Find any unauthorized origins in env var (for validation)
  const unauthorizedOrigins = rawOrigins.filter(origin => !authorizedOriginsList.includes(origin));
  
  // 🔧 DEC 23 FIX: Allow ALL authorized origins, not just those in env var
  // This ensures custom domains (scholaraiadvisor.com) work without env var config
  corsAllowedOrigins = [...authorizedOriginsList];
  
  console.log(`CORS allowlist (${isProduction ? 'prod' : 'dev'}): ${corsAllowedOrigins.length} origins`);
  console.log('Allowed origins:', corsAllowedOrigins);
  
  if (unauthorizedOrigins.length > 0) {
    console.warn('⚠️  CORS SECURITY: Unauthorized origins in CORS_ALLOWED_ORIGINS REJECTED');
    console.warn('  CEO Directive: Only exact matches to authorized list allowed');
    console.warn('  Rejected origins:', unauthorizedOrigins);
    
    if (isProduction) {
      // In production, fail fast if unauthorized origins are configured
      console.error('🚨 CORS SECURITY VIOLATION: Unauthorized origins in production config');
      console.error('  Remove these origins from CORS_ALLOWED_ORIGINS:');
      unauthorizedOrigins.forEach(origin => console.error(`    - ${origin}`));
      console.error('  CORS enforcement: ACTIVE - only exact matches allowed');
      
      // Fail fast in production if non-authorized origins present
      throw new Error(`CORS_ALLOWED_ORIGINS contains unauthorized origins in production: ${unauthorizedOrigins.join(', ')}`);
    }
  }
  
  corsConfigLoaded = true;
  return corsAllowedOrigins;
};

// CORS configuration for credentialed requests
export const corsConfig = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    try {
      const allowedOrigins = loadCorsConfig();
      const isProduction = process.env.NODE_ENV === 'production';
      const allowLocalhostEnv = process.env.ALLOW_LOCALHOST === 'true';
      
      // Same-origin requests (no Origin header) - always allow
      if (!origin) {
        callback(null, true);
        return;
      }
      
      // Production origins - exact match required
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      
      // Localhost handling
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('::1');
      if (isLocalhost) {
        if (!isProduction && allowLocalhostEnv) {
          callback(null, true);
          return;
        } else {
          // Block localhost in production - return false (no ACAO header)
          callback(null, false);
          return;
        }
      }
      
      // Block all other origins
      callback(null, false);
      
    } catch (error) {
      // Critical: Never throw on CORS - always return gracefully
      console.error('CORS origin function error:', error);
      callback(null, false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 204,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  preflightContinue: false,
};