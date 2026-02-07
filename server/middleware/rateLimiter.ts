import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

// Executive enhancement: Advanced key generator for IP+account+UA tracking (IPv6 safe)
const createAdvancedKeyGenerator = (prefix: string) => {
  return (req: Request): string => {
    // Use express-rate-limit's IPv6-safe IP key generator
    const ipKey = (ipKeyGenerator as any)(req) as string;
    const userAgent = req.get('User-Agent') || 'unknown';
    const userId = (req.user as any)?.userId || (req.session as any)?.userId || 'anonymous';
    
    // Create composite key for IP+account+UA tracking with IPv6-safe IP
    const uaFingerprint = Buffer.from(userAgent).toString('base64').slice(0, 8);
    return `${prefix}:${ipKey}:${userId}:${uaFingerprint}`;
  };
};

// Executive bot detection patterns
const detectBot = (req: Request): boolean => {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || '';
  
  // Bot patterns (behavioral detection)
  const botPatterns = [
    /bot|crawler|spider|scraper/i,
    /curl|wget|python|go-http/i,
    /headless|phantom|selenium/i,
    /automated|script|tool/i
  ];
  
  // Suspicious user agent patterns
  const suspiciousUA = botPatterns.some(pattern => pattern.test(userAgent));
  
  // Missing or minimal user agent (< 10 chars)
  const minimalUA = userAgent.length < 10;
  
  // Datacenter IP ranges (simplified detection)
  const datacenterIPs = [
    /^192\.168\./, /^10\./, /^172\./, // Private ranges
    /^54\./, /^52\./, /^18\./, // AWS ranges
    /^104\./, /^108\./, // Google/GCP ranges
  ];
  const datacenterIP = datacenterIPs.some(pattern => pattern.test(ip));
  
  return suspiciousUA || minimalUA || datacenterIP;
};

// Executive exponential backoff handler
const createExponentialBackoffHandler = (baseDelayMs: number = 1000) => {
  const attempts = new Map<string, number>();
  
  return (req: Request): number => {
    const key = createAdvancedKeyGenerator('backoff')(req);
    const attemptCount = attempts.get(key) || 0;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 60s
    const delay = Math.min(baseDelayMs * Math.pow(2, attemptCount), 60000);
    
    // Increment attempt count
    attempts.set(key, attemptCount + 1);
    
    // Cleanup old entries after 1 hour
    setTimeout(() => attempts.delete(key), 3600000);
    
    return delay;
  };
};

// EXECUTIVE ENHANCED: Advanced authentication rate limiter with IP+account+UA tracking
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Executive bot detection - stricter limits for bots
    if (detectBot(req)) {
      return 2; // Very strict for detected bots
    }
    // Legitimate users get higher limits to avoid false positives
    return 15; // Increased from 5 to avoid legitimate burst blocking
  },
  keyGenerator: createAdvancedKeyGenerator('auth'),
  message: {
    message: 'Too many authentication attempts, please try again later.',
    code: 'RATE_LIMIT_AUTH'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip synthetic health checks
    return req.get('User-Agent')?.includes('ScholarshipAI-Synthetic-Check') ?? false;
  },
});

// Password reset rate limiter
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 password reset requests per hour
  message: {
    message: 'Too many password reset attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// EXECUTIVE ENHANCED: Advanced login rate limiter with bot detection and exponential backoff
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Executive bot detection - much stricter limits for bots
    if (detectBot(req)) {
      return 3; // Very strict for detected bots
    }
    // Legitimate users get higher limits to avoid false positives on bursts
    return 25; // Increased from 10 to prevent legitimate user blocking
  },
  keyGenerator: createAdvancedKeyGenerator('login'),
  message: {
    message: 'Too many login attempts, please try again later.',
    code: 'RATE_LIMIT_LOGIN',
    retryAfter: 'Check Retry-After header'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip synthetic health checks
    return req.get('User-Agent')?.includes('ScholarshipAI-Synthetic-Check') ?? false;
  },
});

// Registration rate limiter
export const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 registration attempts per hour
  message: {
    message: 'Too many registration attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🎯 Task 4: Public endpoint rate limiter (100 rps/IP)
// Used for /.well-known/* endpoints that should be publicly accessible
export const publicEndpointRateLimit = rateLimit({
  windowMs: 1000, // 1 second window for RPS (requests per second) limiting
  max: 100, // 100 requests per second per IP
  message: {
    error: 'too_many_requests',
    error_description: 'Too many requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip synthetic health checks
    return req.get('User-Agent')?.includes('ScholarshipAI-Synthetic-Check') ?? false;
  },
});

// 🎯 Task 4: Client ID key generator for S2S authentication
const createClientIdKeyGenerator = (prefix: string) => {
  return (req: Request): string => {
    // Try to extract client_id from:
    // 1. Authorization header (Basic auth: base64(client_id:client_secret))
    // 2. Request body (client_id field)
    // 3. Query params (client_id param)
    const authHeader = req.get('Authorization');
    let clientId = 'unknown';
    
    if (authHeader?.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
        clientId = decoded.split(':')[0]; // Extract client_id from Basic auth
      } catch {
        // Fall through to other extraction methods
      }
    }
    
    if (clientId === 'unknown' && (req.body as any)?.client_id) {
      clientId = (req.body as any).client_id;
    }
    
    if (clientId === 'unknown' && (req.query as any)?.client_id) {
      clientId = (req.query as any).client_id as string;
    }
    
    // Fallback to IP if no client_id found (for public clients)
    if (clientId === 'unknown') {
      const ipKey = (ipKeyGenerator as any)(req) as string;
      return `${prefix}:ip:${ipKey}`;
    }
    
    return `${prefix}:client:${clientId}`;
  };
};

// 🎯 Task 4: OIDC authorization endpoint rate limiter (100 rps/IP for public clients)
export const oidcAuthorizeRateLimit = rateLimit({
  windowMs: 1000, // 1 second window for RPS limiting
  max: 100, // 100 requests per second per IP
  message: {
    error: 'too_many_requests',
    error_description: 'Too many authorization requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for same-origin requests (server-to-server)
    return (!req.get('Origin') && req.get('User-Agent')?.includes('node')) ?? false;
  },
});

// 🎯 Task 4: OIDC token endpoint rate limiter with dual limits
// - Public clients (IP-based): 100 rps/IP
// - S2S clients (client_id-based): 1000 rps/client_id
export const oidcTokenRateLimit = rateLimit({
  windowMs: 1000, // 1 second window for RPS limiting
  max: (req) => {
    // S2S clients with client credentials get higher limit (1000 rps)
    const grantType = (req.body as any)?.grant_type;
    if (grantType === 'client_credentials') {
      return 1000; // 1000 requests per second for S2S
    }
    // Public clients get standard limit (100 rps)
    return 100; // 100 requests per second for public clients
  },
  keyGenerator: createClientIdKeyGenerator('oidc-token'),
  message: {
    error: 'too_many_requests',
    error_description: 'Too many token requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // 1. Skip synthetic health checks
    if (req.get('User-Agent')?.includes('ScholarshipAI-Synthetic-Check')) {
      return true;
    }
    
    // 2. CEO NOV 13: Skip sanctioned load tests with shared secret (Gate 0 requirement)
    const loadTestUA = process.env.LOAD_TEST_USER_AGENT || 'ScholarshipAI-LoadTest';
    const loadTestSecret = process.env.LOAD_TEST_SHARED_SECRET;
    const requestUA = req.get('User-Agent') || '';
    const requestSecret = req.get('X-Load-Test-Secret');
    
    if (loadTestSecret && 
        requestUA.includes(loadTestUA) && 
        requestSecret === loadTestSecret) {
      return true; // Bypass rate limit for authenticated load tests
    }
    
    // 3. Skip same-origin server-to-server (backward compatibility)
    return (!req.get('Origin') && req.get('User-Agent')?.includes('node')) ?? false;
  },
});

// CEO DIRECTIVE (2025-11-10): Strict admin route rate limiter as compensating control for delayed MFA
// Implements stricter limits than general API to prevent brute-force on admin surfaces
export const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Much stricter limits for admin routes to protect elevated privilege access
    if (detectBot(req)) {
      return 10; // Bots get very limited admin access attempts
    }
    return 100; // Legitimate admin users: 100 requests per 15 minutes
  },
  keyGenerator: createAdvancedKeyGenerator('admin'),
  message: {
    error: 'admin_rate_limit_exceeded',
    message: 'Too many admin requests. Please try again later.',
    code: 'RATE_LIMIT_ADMIN',
    retryAfter: 'Check Retry-After header'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Never skip rate limiting for admin routes (no synthetic check exception)
    return false;
  },
  // Enhanced logging for admin rate limit violations
  handler: (req, res) => {
    const userId = (req.user as any)?.userId || (req.session as any)?.userId || 'anonymous';
    console.warn('[SECURITY] Admin rate limit exceeded', {
      action: 'admin_rate_limit_exceeded',
      userId,
      ip: req.ip,
      path: req.path,
      timestamp: new Date().toISOString()
    });
    
    res.status(429).json({
      error: 'admin_rate_limit_exceeded',
      message: 'Too many admin requests. Please try again later.',
      code: 'RATE_LIMIT_ADMIN',
      retryAfter: res.get('Retry-After')
    });
  },
});
