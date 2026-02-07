/**
 * Metrics Tracking Middleware - Records request latencies
 * Integrates with metricsCollector and endpointTelemetry to track performance
 */

import { Request, Response, NextFunction } from 'express';
import { metricsCollector } from '../monitoring/metricsCollector';
import { endpointTelemetry } from '../monitoring/endpointTelemetry';

/**
 * Middleware to track request latency
 * Measures time from request start to response finish
 */
export function metricsTrackingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const requestId = (req as any).id || (req.headers['x-request-id'] as string);
  
  // Hook into response finish event to record latency
  res.on('finish', () => {
    const latencyMs = Date.now() - startTime;
    metricsCollector.recordLatency(latencyMs);
    
    // Wire endpointTelemetry for tracked routes: /, /pricing, /browse, /health
    const route = req.path;
    endpointTelemetry.recordRequest(route, latencyMs, {
      dbWaitMs: (res as any).dbWaitMs,
      gcTimeMs: (res as any).gcTimeMs,
      requestId
    });
  });
  
  // Also handle cases where connection closes without finish event
  res.on('close', () => {
    // Only record if finish wasn't already called
    if (!res.headersSent) {
      const latencyMs = Date.now() - startTime;
      metricsCollector.recordLatency(latencyMs);
      
      const route = req.path;
      endpointTelemetry.recordRequest(route, latencyMs, {
        dbWaitMs: (res as any).dbWaitMs,
        gcTimeMs: (res as any).gcTimeMs,
        requestId
      });
    }
  });
  
  next();
}
