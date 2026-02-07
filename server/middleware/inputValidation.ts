// 🔒 SEC-002: GLOBAL ZOD VALIDATION LAYER
// Comprehensive input validation with bounds checking and sanitization

import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { logger } from './auditLogger';

/**
 * Executive-approved validation schemas for query parameters
 */
export const querySchemas = {
  // Pagination with strict bounds
  pagination: z.object({
    limit: z.coerce.number().min(1).max(1000).default(50),
    offset: z.coerce.number().min(0).max(100000).default(0),
    page: z.coerce.number().min(1).max(10000).optional(),
  }),

  // Time range validation
  timeRange: z.object({
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    limitMinutes: z.coerce.number().min(1).max(10080).default(60), // Max 1 week
    hours: z.coerce.number().min(1).max(168).optional(), // Max 1 week
  }),

  // Segment and cohort parameters
  segment: z.object({
    segmentId: z.string().max(50).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    cohortId: z.string().max(50).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    percentage: z.coerce.number().min(0).max(100).optional(),
  }),

  // Executive reporting parameters
  executive: z.object({
    digestType: z.enum(['morning', 'evening', 'weekly']).optional(),
    includeMetrics: z.coerce.boolean().default(true),
    includeAlerts: z.coerce.boolean().default(true),
    format: z.enum(['json', 'csv', 'pdf']).default('json'),
  }),

  // Safe string parameters
  safeString: z.object({
    q: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.@]+$/).optional(), // Search query
    filter: z.string().max(50).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    sort: z.enum(['asc', 'desc', 'relevance']).default('desc'),
  }),
};

/**
 * Body validation schemas
 */
export const bodySchemas = {
  // User authentication
  userAuth: z.object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
    rememberMe: z.boolean().optional(),
  }),

  // Age verification
  ageVerification: z.object({
    isOver13: z.boolean(),
    isOver18: z.boolean().optional(),
    parentalConsent: z.boolean().optional(),
    verificationToken: z.string().max(255).optional(),
  }),

  // Executive configuration
  executiveConfig: z.object({
    alertThreshold: z.number().min(0).max(100),
    reportingFrequency: z.enum(['hourly', 'daily', 'weekly']),
    enableRealTimeAlerts: z.boolean(),
    metricFilters: z.array(z.string().max(50)).max(20),
  }),

  // Guardrail configuration
  guardrailConfig: z.object({
    metricName: z.string().max(50).regex(/^[A-Z_]+$/),
    threshold: z.number().min(0).max(1000),
    windowMinutes: z.number().min(1).max(1440), // Max 24 hours
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  }),
};

/**
 * Validation middleware factory
 */
export function validateInput<T extends ZodSchema>(schema: T, source: 'query' | 'body' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = source === 'query' ? req.query : 
                   source === 'params' ? req.params : 
                   req.body;

      const validatedData = schema.parse(data);
      
      // Store validated data for route handlers
      if (source === 'query') {
        req.query = validatedData as any;
      } else if (source === 'body') {
        req.body = validatedData;
      } else {
        req.params = validatedData as any;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          value: err.code === 'invalid_type' ? 'hidden' : 'sanitized'
        }));

        // Audit validation failures for security monitoring
        logger.warn('Input validation failure', {
          source,
          errors: validationErrors,
          endpoint: req.originalUrl,
          method: req.method,
          correlationId: req.get('x-correlation-id'),
        });

        return res.status(400).json({
          error: 'Validation failed',
          code: 'INVALID_INPUT',
          details: validationErrors,
          message: 'Request data does not meet security requirements'
        });
      }

      // Unknown validation error
      console.error('Unknown validation error:', error);
      return res.status(500).json({
        error: 'Internal validation error',
        code: 'VALIDATION_ERROR'
      });
    }
  };
}

/**
 * Safe integer parsing with bounds
 */
export function safeParseInt(value: any, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = parseInt(String(value), 10);
  
  if (isNaN(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

/**
 * Safe float parsing with bounds
 */
export function safeParseFloat(value: any, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = parseFloat(String(value));
  
  if (isNaN(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

/**
 * SQL injection prevention for search queries
 */
export function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Remove potentially dangerous characters
  return query
    .replace(/['"\\;]/g, '') // Remove quotes, backslashes, semicolons
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove block comment starts
    .replace(/\*\//g, '') // Remove block comment ends
    .trim()
    .substring(0, 100); // Limit length
}

/**
 * Validate UUID format
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Combined validation middleware for common endpoint patterns
 */
export const commonValidation = {
  // GET endpoints with pagination
  paginatedQuery: validateInput(querySchemas.pagination.merge(querySchemas.safeString), 'query'),
  
  // Time-based endpoints  
  timeRangeQuery: validateInput(querySchemas.timeRange.merge(querySchemas.pagination), 'query'),
  
  // Executive reporting endpoints
  executiveQuery: validateInput(querySchemas.executive.merge(querySchemas.timeRange), 'query'),
  
  // Segment metrics
  segmentQuery: validateInput(querySchemas.segment.merge(querySchemas.pagination), 'query'),
};

/**
 * SEV-1 WAF Underscore Allowlist
 * Allow internal metadata properties while blocking prototype pollution vectors
 */
const UNDERSCORE_ALLOWLIST = (process.env.WAF_UNDERSCORE_ALLOWLIST || '_meta').split(',').map(s => s.trim());
const PROTOTYPE_POLLUTION_VECTORS = ['__proto__', 'constructor', 'prototype'];

/**
 * Recursively sanitize object, handling underscore-prefixed keys
 * - Allow keys in UNDERSCORE_ALLOWLIST
 * - Block prototype pollution vectors (always)
 * - Drop other underscore-prefixed keys with logging (no 4xx)
 */
function sanitizeObjectKeys(obj: any, path: string = '', req: Request): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item, i) => sanitizeObjectKeys(item, `${path}[${i}]`, req));
  }

  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const keyPath = path ? `${path}.${key}` : key;
    
    // ALWAYS block prototype pollution vectors
    if (PROTOTYPE_POLLUTION_VECTORS.includes(key)) {
      logger.warn('[SECURITY] Blocked prototype pollution vector', {
        key,
        path: keyPath,
        correlationId: req.get('x-correlation-id'),
        ip: req.ip,
        endpoint: req.originalUrl
      });
      continue;
    }
    
    // Check underscore-prefixed keys
    if (key.startsWith('_')) {
      if (UNDERSCORE_ALLOWLIST.includes(key)) {
        // ALLOW: Key is in allowlist (e.g., _meta)
        sanitized[key] = sanitizeObjectKeys(value, keyPath, req);
      } else {
        // DROP: Non-allowlisted underscore key (no 4xx, just log redacted)
        logger.info('[WAF] Dropped non-allowlisted underscore property', {
          key: key.substring(0, 10) + (key.length > 10 ? '...' : ''),
          path: keyPath,
          correlationId: req.get('x-correlation-id'),
          endpoint: req.originalUrl
        });
        continue;
      }
    } else {
      // Regular key - sanitize recursively
      sanitized[key] = sanitizeObjectKeys(value, keyPath, req);
    }
  }
  
  return sanitized;
}

/**
 * Request sanitization middleware - applied to all routes
 * SEV-1 FIX: Implements underscore allowlist for _meta
 */
export function sanitizeRequest(req: Request, res: Response, next: NextFunction) {
  // Sanitize query parameters
  if (req.query) {
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(req.query)) {
      // SEC-PATCH: Prevent prototype pollution via bracket notation
      if (dangerousKeys.includes(key) || !Object.prototype.hasOwnProperty.call(req.query, key)) {
        continue;
      }
      
      if (typeof value === 'string') {
        // Basic XSS prevention - assign to new object instead of using bracket notation
        sanitized[key] = value
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '');
      } else {
        sanitized[key] = value;
      }
    }
    
    req.query = sanitized;
  }

  // SEV-1 FIX: Sanitize request body with underscore allowlist
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObjectKeys(req.body, '', req);
  }

  // Sanitize headers for logging
  const sanitizedHeaders = { ...req.headers };
  delete sanitizedHeaders.authorization;
  delete sanitizedHeaders.cookie;
  
  next();
}

// Schemas are already exported above