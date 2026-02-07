/**
 * Degraded Mode Feature Flags
 * 
 * CEO Directive: Middleware that checks degrade status and applies
 * appropriate caching/feature optimizations
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Apply aggressive caching when in degraded mode
 */
export function degradeModeCachingMiddleware(req: Request, res: Response, next: NextFunction) {
  if (process.env.AGGRESSIVE_CACHE === 'true') {
    // Apply aggressive cache headers for static content and APIs
    const isStaticAsset = req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/);
    const isApiRequest = req.path.startsWith('/api');
    
    if (isStaticAsset) {
      // Static assets: 1 hour cache in degraded mode
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    } else if (isApiRequest) {
      // API responses: short cache in degraded mode (30 seconds)
      const multiplier = parseInt(process.env.CACHE_TTL_MULTIPLIER || '3');
      res.setHeader('Cache-Control', `public, max-age=${30 * multiplier}`);
    }
  }
  
  next();
}

/**
 * Disable expensive features when in degraded mode
 */
export function degradeModeFeatureMiddleware(req: Request, res: Response, next: NextFunction) {
  if (process.env.DISABLE_EXPENSIVE_FEATURES === 'true') {
    // Attach feature flags to request
    (req as any).degradeMode = {
      disableExpensiveQueries: true,
      disableRealTimeUpdates: true,
      disableComplexAggregations: true,
      limitResultSets: true,
    };
  }
  
  next();
}

/**
 * Enable response compression in degraded mode
 */
export function degradeModeCompressionMiddleware(req: Request, res: Response, next: NextFunction) {
  if (process.env.ENABLE_COMPRESSION === 'true') {
    // Set Vary header for proper caching with compression
    res.setHeader('Vary', 'Accept-Encoding');
  }
  
  next();
}
