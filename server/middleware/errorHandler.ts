// 🔒 SEC-001: CENTRALIZED ERROR HANDLING 
// Production error sanitization with structured logging and correlation IDs

import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';
import { environmentChecks } from '../config/environmentValidation';

/**
 * Executive-approved error codes for client responses
 */
export const ERROR_CODES = {
  // Authentication & Authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  
  // Validation & Input
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Business Logic
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  
  // System & Infrastructure
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  ROLLOUT_ERROR: 'ROLLOUT_ERROR',
  
  // Executive & Reporting
  EXECUTIVE_ACCESS_DENIED: 'EXECUTIVE_ACCESS_DENIED',
  GUARDRAIL_VIOLATION: 'GUARDRAIL_VIOLATION',
  MONITORING_ERROR: 'MONITORING_ERROR'
} as const;

/**
 * Safe error response structure - no sensitive information leaked
 */
export interface SafeErrorResponse {
  error: string;
  code: keyof typeof ERROR_CODES;
  message: string;
  correlationId: string;
  timestamp: string;
  path?: string;
  method?: string;
}

/**
 * Error classification and sanitization
 */
export class ErrorSanitizer {
  /**
   * Convert any error to safe client response
   */
  static sanitizeError(error: any, req: Request): SafeErrorResponse {
    const correlationId = req.get('x-correlation-id') || 'unknown';
    const timestamp = new Date().toISOString();
    const isProduction = environmentChecks.isProduction();
    
    // Default safe response
    let safeResponse: SafeErrorResponse = {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      correlationId,
      timestamp,
      path: req.originalUrl,
      method: req.method
    };

    // Handle known error types with safe messages
    if (error.name === 'ValidationError' || error.code === 'INVALID_INPUT') {
      safeResponse = {
        ...safeResponse,
        error: 'Validation failed',
        code: 'VALIDATION_FAILED',
        message: 'The request data is invalid. Please check your input and try again.'
      };
    } else if (error.code === 'UNAUTHORIZED' || error.status === 401) {
      safeResponse = {
        ...safeResponse,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please log in and try again.'
      };
    } else if (error.code === 'FORBIDDEN' || error.status === 403) {
      safeResponse = {
        ...safeResponse,
        error: 'Forbidden',
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.'
      };
    } else if (error.code === 'NOT_FOUND' || error.status === 404) {
      safeResponse = {
        ...safeResponse,
        error: 'Not found',
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested resource was not found.'
      };
    } else if (error.code === 'RATE_LIMITED' || error.status === 429) {
      safeResponse = {
        ...safeResponse,
        error: 'Rate limited',
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait and try again later.'
      };
    } else if (error.code?.includes('DB_') || error.message?.includes('database')) {
      safeResponse = {
        ...safeResponse,
        error: 'Database error',
        code: 'DATABASE_ERROR',
        message: 'A data storage error occurred. Please try again.'
      };
    }

    // In development, include more details (but still sanitized)
    if (!isProduction && error.message) {
      // Sanitize sensitive information even in development
      const sanitizedMessage = error.message
        .replace(/password[^a-zA-Z0-9]*[a-zA-Z0-9]{6,}/gi, 'password=***')
        .replace(/token[^a-zA-Z0-9]*[a-zA-Z0-9]{20,}/gi, 'token=***')
        .replace(/key[^a-zA-Z0-9]*[a-zA-Z0-9]{20,}/gi, 'key=***')
        .substring(0, 200); // Limit message length
      
      safeResponse.message += ` (Dev: ${sanitizedMessage})`;
    }

    return safeResponse;
  }

  /**
   * Log error with full details for debugging (server-side only)
   */
  static logError(error: any, req: Request, additionalContext?: Record<string, any>) {
    const correlationId = req.get('x-correlation-id') || 'unknown';
    
    // Create comprehensive error log entry
    const errorLog = {
      error: {
        name: error.name || 'UnknownError',
        message: error.message || 'No message provided',
        stack: error.stack || 'No stack trace available',
        code: error.code || 'UNHANDLED',
        status: error.status || 500
      },
      request: {
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('user-agent'),
        ip: req.ip,
        correlationId,
        userId: (req as any).user?.id || null,
        sessionId: (req as any).sessionID || null
      },
      context: additionalContext || {},
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    };

    // Log with appropriate level based on error severity
    const logMessage = `${error.name || 'Error'}: ${error.message || 'Unknown error'}`;
    if (error.status >= 500 || !error.status) {
      logger.error(logMessage, error instanceof Error ? error : undefined, errorLog);
    } else if (error.status >= 400) {
      logger.warn(logMessage, errorLog);
    } else {
      logger.info(logMessage, errorLog);
    }
  }
}

/**
 * Global error handling middleware - catches all unhandled errors
 */
export function globalErrorHandler(error: any, req: Request, res: Response, next: NextFunction) {
  // Log the full error details for debugging
  ErrorSanitizer.logError(error, req);
  
  // Generate safe response for client
  const safeResponse = ErrorSanitizer.sanitizeError(error, req);
  
  // Determine HTTP status code
  const statusCode = error.status || error.statusCode || 500;
  
  // Send sanitized response to client
  res.status(statusCode).json(safeResponse);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncErrorHandler<T>(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Executive reporting error handler - special handling for sensitive endpoints
 */
export function executiveErrorHandler(error: any, req: Request, res: Response, next: NextFunction) {
  // Enhanced logging for executive endpoints
  ErrorSanitizer.logError(error, req, {
    category: 'EXECUTIVE_ENDPOINT',
    sensitivityLevel: 'HIGH',
    rolloutStage: req.path.includes('rollout') ? 'ROLLOUT_MONITORING' : 'GENERAL'
  });
  
  // More restrictive error messages for executive endpoints
  const safeResponse: SafeErrorResponse = {
    error: 'Executive system error',
    code: 'EXECUTIVE_ACCESS_DENIED',
    message: 'Access to executive reporting system failed. Contact system administrator.',
    correlationId: req.get('x-correlation-id') || 'unknown',
    timestamp: new Date().toISOString()
  };
  
  res.status(500).json(safeResponse);
}

/**
 * 404 handler for unknown routes
 */
export function notFoundHandler(req: Request, res: Response) {
  const safeResponse: SafeErrorResponse = {
    error: 'Not found',
    code: 'RESOURCE_NOT_FOUND',
    message: 'The requested endpoint does not exist.',
    correlationId: req.get('x-correlation-id') || 'unknown',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };
  
  logger.warn('Route not found', {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: req.get('x-correlation-id')
  });
  
  res.status(404).json(safeResponse);
}

/**
 * Health check specific error handler
 */
export function healthCheckErrorHandler(error: any, req: Request, res: Response, next: NextFunction) {
  // Minimal logging for health checks to avoid log spam
  logger.error('Health check failed', error instanceof Error ? error : undefined, {
    correlationId: req.get('x-correlation-id'),
    endpoint: req.originalUrl
  });
  
  res.status(503).json({
    error: 'Service unavailable',
    code: 'SERVICE_UNAVAILABLE',
    message: 'Health check failed',
    timestamp: new Date().toISOString()
  });
}

/**
 * Utility function to safely send error responses
 */
export function sendSafeError(res: Response, req: Request, error: any, statusCode: number = 500) {
  const safeResponse = ErrorSanitizer.sanitizeError(error, req);
  ErrorSanitizer.logError(error, req);
  res.status(statusCode).json(safeResponse);
}