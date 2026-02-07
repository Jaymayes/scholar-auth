// 🔒 SEC-004: HEADER INJECTION PROTECTION
// Comprehensive header sanitization and CRLF protection with strict security policies

import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import permissionsPolicy from 'permissions-policy';
import { logger } from './auditLogger';
import { environmentChecks } from '../config/environmentValidation';

/**
 * CRLF and control character detection patterns
 */
const DANGEROUS_CHARS = /[\r\n\x00-\x1f\x7f-\x9f]/g;
const CRLF_PATTERN = /(\r\n|\r|\n)/g;
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

/**
 * Whitelist of safe header characters - INCLUDES % for URL encoding
 * SEV-1 HOTFIX: Added % to fix invalid_redirect_uri caused by URL encoding corruption
 */
const SAFE_HEADER_CHARS = /^[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=% ]*$/;

/**
 * SEV-1 Feature Flag: Skip Location header sanitization for auth endpoints
 */
const DISABLE_LOCATION_SANITIZATION = process.env.DISABLE_LOCATION_SANITIZATION !== 'false';

/**
 * Header sanitization middleware - prevents HTTP response splitting
 */
export function sanitizeHeaders(req: Request, res: Response, next: NextFunction) {
  const originalSetHeader = res.setHeader;
  const originalAppend = res.append;
  
  // Override setHeader to sanitize values
  res.setHeader = function(name: string, value: any): Response {
    const sanitizedValue = sanitizeHeaderValue(value, name, req);
    if (sanitizedValue === null) {
      logger.warn('Blocked dangerous header value', {
        header: name,
        originalValue: String(value).substring(0, 50),
        correlationId: req.get('x-correlation-id'),
        ip: req.ip,
        endpoint: req.originalUrl
      });
      return this;
    }
    return originalSetHeader.call(this, name, sanitizedValue);
  };
  
  // Override append to sanitize values
  res.append = function(name: string, value: any): Response {
    const sanitizedValue = sanitizeHeaderValue(value, name, req);
    if (sanitizedValue === null) {
      logger.warn('Blocked dangerous header append', {
        header: name,
        originalValue: String(value).substring(0, 50),
        correlationId: req.get('x-correlation-id'),
        ip: req.ip,
        endpoint: req.originalUrl
      });
      return this;
    }
    return originalAppend.call(this, name, sanitizedValue);
  };
  
  next();
}

/**
 * Sanitize individual header value
 * SEV-1 HOTFIX: Skip Location header sanitization for auth endpoints to prevent URL encoding corruption
 */
function sanitizeHeaderValue(value: any, headerName: string, req: Request): string | null {
  if (value == null) {
    return null;
  }
  
  const stringValue = String(value);
  
  // SEV-1 HOTFIX: Skip Location header sanitization for auth endpoints
  if (DISABLE_LOCATION_SANITIZATION && 
      headerName.toLowerCase() === 'location' && 
      (req.originalUrl.includes('/api/login') || req.originalUrl.includes('/api/callback'))) {
    // Only check for CRLF injection on Location headers for auth endpoints
    if (CRLF_PATTERN.test(stringValue)) {
      logger.error('CRLF injection attempt detected in auth Location header', new Error('CRLF injection'), {
        headerName,
        value: stringValue.substring(0, 100),
        correlationId: req.get('x-correlation-id'),
        ip: req.ip,
        userAgent: req.get('user-agent'),
        endpoint: req.originalUrl
      } as any);
      return null;
    }
    // Return Location header unchanged to preserve URL encoding
    return stringValue;
  }
  
  // Check for CRLF injection attempts
  if (CRLF_PATTERN.test(stringValue)) {
    logger.error('CRLF injection attempt detected', new Error('CRLF injection'), {
      headerName,
      value: stringValue.substring(0, 100),
      correlationId: req.get('x-correlation-id'),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      endpoint: req.originalUrl
    } as any);
    return null; // Block the header entirely
  }
  
  // Check for other control characters
  if (CONTROL_CHARS.test(stringValue)) {
    logger.warn('Control characters in header', {
      headerName,
      correlationId: req.get('x-correlation-id'),
      endpoint: req.originalUrl
    });
    // Strip control characters instead of blocking
    return stringValue.replace(CONTROL_CHARS, '');
  }
  
  // Validate against safe character set
  if (!SAFE_HEADER_CHARS.test(stringValue)) {
    // NOTE: ETag header sanitization warnings are informational only and non-blocking
    // Security middleware automatically strips unsafe characters for safety
    // Logging disabled for this informational check to reduce noise
    // Strip unsafe characters
    return stringValue.replace(/[^a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;= ]/g, '');
  }
  
  // Length validation
  if (stringValue.length > 8192) {
    logger.warn('Header value too long', {
      headerName,
      length: stringValue.length,
      correlationId: req.get('x-correlation-id'),
      endpoint: req.originalUrl
    });
    return stringValue.substring(0, 8192);
  }
  
  return stringValue;
}

/**
 * Executive-approved strict Helmet configuration
 */
export function strictHelmetConfig() {
  const isProduction = environmentChecks.isProduction();
  
  return helmet({
    // Content Security Policy with strict rules
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProduction ? [
          "'self'",
          "https://js.stripe.com",
          "https://checkout.stripe.com"
        ] : [
          "'self'",
          "'unsafe-inline'", // Required for Vite in development
          "'unsafe-eval'", // Required for Vite in development
          "https://js.stripe.com",
          "https://checkout.stripe.com",
          "blob:",
          "ws:",
          "wss:"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'", // Required for styled components
          "https://fonts.googleapis.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com"
        ],
        imgSrc: [
          "'self'",
          "data:",
          "https:",
          "blob:"
        ],
        connectSrc: isProduction ? [
          "'self'",
          "https://api.stripe.com"
        ] : [
          "'self'",
          "https://api.stripe.com",
          "ws:",
          "wss:",
          "*.replit.dev",
          "*.repl.co",
          "localhost:*"
        ],
        frameSrc: [
          "https://js.stripe.com",
          "https://hooks.stripe.com"
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://replit.com"],
        frameAncestors: ["'none'"],
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"]
      },
      reportOnly: !isProduction, // Report-only in development
    },
    
    // HTTP Strict Transport Security
    hsts: {
      maxAge: 63072000, // 2 years (required for HSTS preload list)
      includeSubDomains: true,
      preload: true
    },
    
    // Other security headers
    noSniff: true,
    frameguard: { action: 'deny' },
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    
    // Note: permissionsPolicy not available in this version of helmet
    
    // Cross-Origin policies
    crossOriginEmbedderPolicy: false, // May conflict with some integrations
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    
    // Hide server information
    hidePoweredBy: true
  });
}

/**
 * 🔒 CEO P0: Permissions-Policy using standalone package
 * Note: Helmet doesn't support Permissions-Policy yet (as of 2024)
 * Using permissions-policy npm package per maintainer recommendation
 */
export const permissionsPolicyMiddleware = permissionsPolicy({
  features: {
    accelerometer: [],
    camera: [],
    geolocation: [],
    gyroscope: [],
    magnetometer: [],
    microphone: [],
    payment: ['self'],          // Allow payment APIs from same origin (Stripe)
    usb: [],
    interestCohort: []          // Disable FLoC tracking
  }
});

/**
 * Additional security headers for executive endpoints
 */
export function executiveSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  // Enhanced security for executive/reporting endpoints
  if (req.path.includes('/api/executive') || req.path.includes('/api/rollout')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Custom security headers for executive data
    res.setHeader('X-Executive-Data', 'restricted');
    res.setHeader('X-Content-Sensitivity', 'high');
  }
  
  next();
}

/**
 * CORS security enhancement - prevent origin header manipulation
 * 🔧 DEC 25: Exempt OIDC interaction routes from strict origin validation
 * since they receive form POSTs during OAuth flows where browsers may send
 * Origin: null or cross-origin headers from Clerk authentication
 */
export function secureCORS(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('Origin');
  
  // Skip origin validation for OIDC interaction routes (form POSTs from OAuth flows)
  if (req.path.startsWith('/oidc/interaction')) {
    return next();
  }
  
  if (origin) {
    // Validate origin format to prevent manipulation
    if (!isValidOrigin(origin)) {
      logger.warn('Invalid origin header format', {
        origin,
        correlationId: req.get('x-correlation-id'),
        ip: req.ip,
        endpoint: req.originalUrl
      });
      return res.status(400).json({
        error: 'Invalid origin header',
        code: 'INVALID_ORIGIN'
      });
    }
    
    // Log cross-origin requests for monitoring
    if (!origin.includes('replit.app') && !origin.includes('scholarshipai.com') && !origin.includes('clerk.')) {
      logger.info('External origin request', {
        origin,
        endpoint: req.originalUrl,
        method: req.method,
        correlationId: req.get('x-correlation-id'),
        ip: req.ip
      });
    }
  }
  
  next();
}

/**
 * Validate origin header format
 */
function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    
    // Must be HTTPS in production
    if (environmentChecks.isProduction() && url.protocol !== 'https:') {
      return false;
    }
    
    // Check for suspicious patterns
    if (origin.includes('\r') || origin.includes('\n') || origin.includes('\0')) {
      return false;
    }
    
    // Length validation
    if (origin.length > 2048) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * SEV-1 WAF Allowlist Policy
 * Preserve x-forwarded-host for trusted ingress; strip otherwise
 */
const WAF_CONFIG = {
  stripXForwardedHost: process.env.WAF_STRIP_X_FORWARDED_HOST !== 'false',
  allowlistEnabled: process.env.WAF_ALLOWLIST_XFH === 'true',
  trustedIngressCidrs: (process.env.WAF_TRUSTED_INGRESS_CIDRS || '').split(',').filter(Boolean),
  trustedInternals: (process.env.WAF_TRUSTED_INTERNALS || '127.0.0.1/32,::1/128').split(',').filter(Boolean),
  allowedHostSuffixes: (process.env.WAF_ALLOWED_HOST_SUFFIXES || '.replit.app,.replit.co,.scholaraiadvisor.com').split(',').filter(Boolean)
};

function ipMatchesCidr(ip: string, cidr: string): boolean {
  try {
    if (!ip || !cidr) return false;
    const [range, bits] = cidr.split('/');
    if (!range) return false;
    
    // Handle IPv6 localhost
    if (ip === '::1' && cidr === '::1/128') return true;
    if (ip === '::ffff:127.0.0.1' && (cidr === '127.0.0.1/32' || cidr === '::1/128')) return true;
    
    // Simple IPv4 matching
    const ipParts = ip.replace('::ffff:', '').split('.').map(Number);
    const rangeParts = range.split('.').map(Number);
    const mask = bits ? parseInt(bits, 10) : 32;
    
    if (ipParts.length !== 4 || rangeParts.length !== 4) return false;
    
    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
    const maskBits = ~((1 << (32 - mask)) - 1);
    
    return (ipNum & maskBits) === (rangeNum & maskBits);
  } catch {
    return false;
  }
}

function isIpTrusted(ip: string | undefined): boolean {
  if (!ip) return false;
  const allTrusted = [...WAF_CONFIG.trustedIngressCidrs, ...WAF_CONFIG.trustedInternals];
  return allTrusted.some(cidr => ipMatchesCidr(ip, cidr));
}

function isHostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const hostLower = host.toLowerCase().split(':')[0]; // Remove port
  return WAF_CONFIG.allowedHostSuffixes.some(suffix => hostLower.endsWith(suffix.toLowerCase()));
}

/**
 * Request sanitization - clean dangerous headers from incoming requests
 * SEV-1 FIX: Implements WAF allowlist policy for x-forwarded-host
 */
export function sanitizeRequestHeaders(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket?.remoteAddress;
  const xForwardedHost = req.get('x-forwarded-host');
  const host = req.get('host');
  
  // WAF Allowlist Policy for x-forwarded-host
  if (xForwardedHost) {
    const isTrustedIngress = isIpTrusted(clientIp);
    const isAllowedHost = isHostAllowed(xForwardedHost) || isHostAllowed(host);
    
    // Policy: Preserve XFH if allowlist enabled AND trusted ingress AND allowed host suffix
    if (WAF_CONFIG.allowlistEnabled && isTrustedIngress && isAllowedHost) {
      // PRESERVE x-forwarded-host - trusted source with allowed suffix
      logger.info('WAF: Preserved x-forwarded-host for trusted ingress', {
        xForwardedHost,
        clientIp,
        correlationId: req.get('x-correlation-id'),
        endpoint: req.originalUrl
      });
    } else if (!WAF_CONFIG.stripXForwardedHost) {
      // WAF stripping disabled globally - preserve header
      logger.info('WAF: x-forwarded-host preserved (stripping disabled)', {
        xForwardedHost,
        clientIp
      });
    } else {
      // STRIP x-forwarded-host - untrusted source or disallowed host
      logger.warn('WAF: Stripped x-forwarded-host (untrusted)', {
        xForwardedHost,
        clientIp,
        isTrustedIngress,
        isAllowedHost,
        correlationId: req.get('x-correlation-id'),
        endpoint: req.originalUrl
      });
      delete req.headers['x-forwarded-host'];
    }
  }
  
  // Remove other dangerous headers (always strip these)
  const alwaysStripHeaders = [
    'x-original-host',
    'x-rewrite-url',
    'x-forwarded-server'
  ];
  
  alwaysStripHeaders.forEach(header => {
    if (req.headers[header]) {
      logger.warn('Removed dangerous request header', {
        header,
        correlationId: req.get('x-correlation-id'),
        ip: clientIp,
        endpoint: req.originalUrl
      });
      delete req.headers[header];
    }
  });
  
  // Validate Host header
  if (host && !isValidHost(host)) {
    logger.error('Invalid host header', new Error('Invalid host'), {
      host,
      correlationId: req.get('x-correlation-id'),
      ip: clientIp,
      endpoint: req.originalUrl
    } as any);
    return res.status(400).json({
      error: 'Invalid host header',
      code: 'INVALID_HOST'
    });
  }
  
  next();
}

/**
 * Validate Host header
 */
function isValidHost(host: string): boolean {
  // Check for CRLF injection
  if (CRLF_PATTERN.test(host)) {
    return false;
  }
  
  // Basic format validation
  const hostPattern = /^[a-zA-Z0-9.-]+(:[0-9]+)?$/;
  return hostPattern.test(host) && host.length <= 253;
}

/**
 * Complete header security middleware stack
 */
export function applyHeaderSecurity() {
  return [
    sanitizeRequestHeaders,
    secureCORS,
    sanitizeHeaders,
    strictHelmetConfig(),
    executiveSecurityHeaders,
    permissionsPolicyMiddleware      // CEO P0: Using permissions-policy package
  ];
}