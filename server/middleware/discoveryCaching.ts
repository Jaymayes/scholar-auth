/**
 * Discovery Endpoint Caching Middleware
 * 
 * CEO Directive (Nov 7, 18:20 UTC): 300s TTL for discovery endpoint
 * Performance optimization for P95 ≤120ms target
 * 
 * Caches: /.well-known/openid-configuration
 */

import type { Request, Response, NextFunction } from 'express';

// In-memory cache for discovery response
interface CachedDiscovery {
  body: any;
  timestamp: number;
  etag: string;
}

let discoveryCache: CachedDiscovery | null = null;
const CACHE_TTL = 300 * 1000; // 300 seconds (5 minutes) as per CEO directive

/**
 * Add caching headers and in-memory cache for discovery endpoint responses
 * TTL: 300 seconds as per CEO directive
 */
export function discoveryCachingMiddleware(req: Request, res: Response, next: NextFunction) {
  // Only apply to discovery endpoint
  if (req.path.includes('/.well-known/openid-configuration')) {
    const now = Date.now();
    
    // Check if we have a valid cache
    if (discoveryCache && (now - discoveryCache.timestamp) < CACHE_TTL) {
      // Send cached response with 304 if ETag matches
      const clientETag = req.headers['if-none-match'];
      if (clientETag === discoveryCache.etag) {
        return res.status(304).end();
      }
      
      // Send cached response with headers (A1-CHG-2025-001)
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.setHeader('Expires', new Date(discoveryCache.timestamp + CACHE_TTL).toUTCString());
      res.setHeader('ETag', discoveryCache.etag);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Cache', 'HIT');
      return res.json(discoveryCache.body);
    }
    
    // Cache miss - intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = function(body: any) {
      // Cache the response
      const etag = `"discovery-${Date.now()}"`;
      discoveryCache = {
        body,
        timestamp: now,
        etag
      };
      
      // Set cache headers (A1-CHG-2025-001)
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.setHeader('Expires', new Date(now + CACHE_TTL).toUTCString());
      res.setHeader('ETag', etag);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Cache', 'MISS');
      
      return originalJson(body);
    };
  }
  
  next();
}

/**
 * Force refresh the discovery cache (useful for testing)
 */
export function refreshDiscoveryCache() {
  discoveryCache = null;
}
