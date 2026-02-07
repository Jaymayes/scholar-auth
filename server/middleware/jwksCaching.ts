/**
 * JWKS Pre-Computation Cache - CENTRALIZED OPTIMIZATION
 * 
 * CEO Directive (Nov 7, 16:45 UTC): Pre-compute JWKS JSON at boot, serve from memory
 * "Avoid per-request crypto/serialization" - eliminate overhead
 * Performance target: P95 ≤120ms (currently at 130ms, need 8% improvement)
 * 
 * Architect Review: Centralized on Express handler, not middleware interception
 */

import { createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Pre-computed JWKS response cache
 * Refreshable for key rotation support
 */
interface JWKSCache {
  json: string;
  etag: string;
  computedAt: Date;
}

let cache: JWKSCache | null = null;

/**
 * Compute JWKS from environment with hash-based ETag
 * Validates key presence and generates rotation-safe cache
 */
export function computeJWKSCache(): JWKSCache {
  const kid = process.env.OIDC_SIGNING_KID;
  const n = process.env.OIDC_RSA_PUBLIC_KEY_N;
  const e = process.env.OIDC_RSA_PUBLIC_KEY_E;
  
  if (!kid || !n || !e) {
    throw new Error('JWKS cache: Missing required environment variables');
  }
  
  // Public-only JWKS (strip private key components)
  const jwks = {
    keys: [
      {
        kty: 'RSA',
        kid: kid,
        use: 'sig',
        alg: 'RS256',
        n: n,
        e: e,
      }
    ]
  };
  
  // Serialize and compute content-based ETag
  const json = JSON.stringify(jwks);
  const hash = createHash('sha256').update(json).digest('hex');
  const etag = `"jwks-${hash.substring(0, 16)}"`;
  
  return {
    json,
    etag,
    computedAt: new Date()
  };
}

/**
 * Initialize JWKS cache at boot time
 * Called from server/index.ts initialization
 */
export function initializeJWKSCache(): void {
  cache = computeJWKSCache();
  console.log('✅ JWKS Cache initialized:', {
    size: cache.json.length,
    etag: cache.etag,
    timestamp: cache.computedAt.toISOString()
  });
}

/**
 * Refresh JWKS cache (for key rotation)
 * Call this when keys are rotated
 */
export function refreshJWKSCache(): void {
  cache = computeJWKSCache();
  console.log('🔄 JWKS Cache refreshed:', {
    etag: cache.etag,
    timestamp: cache.computedAt.toISOString()
  });
}

/**
 * Get cached JWKS response
 * Returns pre-computed JSON and ETag for direct serving
 */
export function getCachedJWKS(): JWKSCache | null {
  return cache;
}

/**
 * Legacy middleware for oidc-provider JWKS endpoint caching
 * Sets HTTP cache headers only (does not intercept)
 */
export function jwksCachingMiddleware(req: Request, res: Response, next: NextFunction) {
  // Only apply to oidc-provider JWKS endpoint (not root-level Express handler)
  // A1-CHG-2025-001: Updated cache headers for CDN optimization
  if (req.path === '/oidc/.well-known/jwks.json' || req.path === '/oidc/jwks') {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('Expires', new Date(Date.now() + 300 * 1000).toUTCString());
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    if (cache) {
      res.setHeader('ETag', cache.etag);
      
      // ETag validation
      const clientETag = req.headers['if-none-match'];
      if (clientETag === cache.etag) {
        return res.status(304).end();
      }
    }
  }
  
  next();
}
