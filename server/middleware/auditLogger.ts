import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { storage } from '../storage';
import type { InsertAuditLog } from '@shared/schema';
import { canaryGuardrails } from '../monitoring/canaryGuardrails';

// Extend Express Request interface to include correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

// Generate correlation ID middleware
export const correlationId = (req: Request, res: Response, next: NextFunction) => {
  req.correlationId = req.get('X-Correlation-ID') || randomUUID();
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
};

// Structured logging utility
export const logger = {
  info: (message: string, meta: Record<string, any> = {}) => {
    console.log(JSON.stringify({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    }));
  },
  
  warn: (message: string, meta: Record<string, any> = {}) => {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    }));
  },
  
  error: (message: string, error?: Error, meta: Record<string, any> = {}) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
      timestamp: new Date().toISOString(),
      ...meta,
    }));
  },
  
  audit: async (action: string, details: Record<string, any>, req?: Request, userId?: string) => {
    // PERFORMANCE BREAKTHROUGH: Use global audit queue for non-blocking audit logging
    try {
      // Use dynamic import instead of require for ES modules
      const { enqueueAudit } = await import('../auditQueue.js');
      
      // Queue the audit log with PII redaction
      enqueueAudit(action, redactSensitiveData(details), req, userId || null);
      
      // Non-blocking info log for immediate feedback
      logger.info(`Audit: ${action}`, {
        correlationId: req?.correlationId,
        userId,
        action,
        redacted: true,
        queued: true
      });
    } catch (error) {
      // Fallback to emergency direct database write
      try {
        const auditData: InsertAuditLog = {
          userId: userId || null,
          action,
          details: redactSensitiveData(details),
          ipAddress: req?.ip || req?.socket.remoteAddress || null,
          userAgent: req?.get('User-Agent') || null,
        };
        
        // Direct database write for fallback
        await storage.createAuditLogAsync(auditData);
        logger.info(`Audit (fallback): ${action}`, {
          correlationId: req?.correlationId,
          userId,
          action,
          redacted: true,
          fallback: true
        });
      } catch (fallbackError) {
        console.warn('Audit logging failed completely:', {
          action,
          userId,
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        });
      }
    }
  },
};

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Log request
  logger.info('HTTP Request', {
    correlationId: req.correlationId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });
  
  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - startTime;
    
    logger.info('HTTP Response', {
      correlationId: req.correlationId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      contentLength: res.get('Content-Length'),
    });
    
    // 🚀 CANARY MONITORING: Record performance metrics for guardrails
    if (req.url.startsWith('/api/')) {
      try {
        canaryGuardrails.recordMetrics(req.url, req.method, duration, res.statusCode);
      } catch (error) {
        // Don't let canary monitoring affect request processing
        console.warn('Canary metrics recording failed:', error);
      }
    }
    
    return originalSend.call(this, body);
  };
  
  next();
};

// Redact sensitive data from logs
const redactSensitiveData = (data: Record<string, any>): Record<string, any> => {
  const sensitiveKeys = [
    'password', 'token', 'secret', 'key', 'authorization',
    'cookie', 'session', 'credentials', 'auth', 'bearer',
  ];
  
  const redacted = { ...data };
  
  for (const [key, value] of Object.entries(redacted)) {
    if (sensitiveKeys.some(sensitiveKey => 
      key.toLowerCase().includes(sensitiveKey.toLowerCase()))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value);
    }
  }
  
  return redacted;
};

// Security event logger middleware
export const securityEventLogger = {
  loginSuccess: async (req: Request, userId: string) => {
    await logger.audit('LOGIN_SUCCESS', {
      method: 'oauth',
      provider: 'replit',
    }, req, userId);
  },
  
  loginFailure: async (req: Request, reason: string) => {
    await logger.audit('LOGIN_FAILURE', {
      reason,
      method: 'oauth',
      provider: 'replit',
    }, req);
  },
  
  logout: async (req: Request, userId: string) => {
    await logger.audit('LOGOUT', {
      method: 'explicit',
    }, req, userId);
  },
  
  emailVerificationSent: async (req: Request, userId: string, email: string) => {
    await logger.audit('EMAIL_VERIFICATION_SENT', {
      email: redactEmail(email),
    }, req, userId);
  },
  
  emailVerificationSuccess: async (req: Request, userId: string) => {
    await logger.audit('EMAIL_VERIFICATION_SUCCESS', {}, req, userId);
  },
  
  emailVerificationFailure: async (req: Request, userId: string, reason: string) => {
    await logger.audit('EMAIL_VERIFICATION_FAILURE', {
      reason,
    }, req, userId);
  },
  
  passwordResetRequested: async (req: Request, email: string) => {
    await logger.audit('PASSWORD_RESET_REQUESTED', {
      email: redactEmail(email),
    }, req);
  },
  
  rateLimitTriggered: async (req: Request, endpoint: string, limit: number) => {
    await logger.audit('RATE_LIMIT_TRIGGERED', {
      endpoint,
      limit,
      window: '15_minutes',
    }, req);
  },
  
  unauthorizedAccess: async (req: Request, resource: string) => {
    await logger.audit('UNAUTHORIZED_ACCESS_ATTEMPT', {
      resource,
      method: req.method,
    }, req);
  },
};

// Helper function to partially redact emails
const redactEmail = (email: string): string => {
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 2) return `${localPart}***@${domain}`;
  return `${localPart.substring(0, 2)}***@${domain}`;
};

// 🔒 CONFIG LOCK ENFORCEMENT: Block configuration changes during evidence window
export const configLockEnforcement = (req: Request, res: Response, next: NextFunction) => {
  // Define allowed patterns during config lock (emergency operations)
  const allowedPatterns = [
    /^\/oidc\/admin\/client-secret$/, // OIDC client secret rotation for emergency migrations
    /^\/api\/oidc\/admin\/client-secret$/, // Alternative API path
    /^\/test-endpoint$/, // Temporary testing endpoint
  ];
  
  // Check if request is explicitly allowed
  const isAllowed = allowedPatterns.some(pattern => pattern.test(req.url));
  if (isAllowed) {
    return next(); // Skip config lock for allowed endpoints
  }
  
  // Define blocked patterns during config lock
  const blockedPatterns = [
    // Feature flag operations
    /^\/api\/admin\/feature-flags/,
    /^\/api\/internal\/config/,
    
    // Deployment and system operations
    /^\/api\/admin\/deploy/,
    /^\/api\/internal\/deploy/,
    /^\/api\/system\/restart/,
    
    // Configuration changes
    /^\/api\/admin\/settings/,
    /^\/api\/config\//,
    
    // Infrastructure changes (if exposed via API)
    /^\/api\/admin\/infrastructure/,
    /^\/api\/internal\/scaling/,
  ];
  
  // Check if request matches blocked patterns
  const isBlocked = blockedPatterns.some(pattern => pattern.test(req.url)) && 
                   ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  
  if (isBlocked) {
    // Use the built-in config lock check
    const changeType = `${req.method} ${req.url}`;
    if (!canaryGuardrails.isConfigChangeAllowed(changeType)) {
      const status = canaryGuardrails.getStabilityStatus();
      
      logger.warn('Config lock enforcement: Blocked request during evidence window', {
        correlationId: req.correlationId,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        configLockActive: status.configLockActive,
      });
      
      // Audit the blocked attempt
      logger.audit('CONFIG_LOCK_VIOLATION', {
        blockedEndpoint: req.url,
        method: req.method,
        reason: 'Configuration changes blocked during canary evidence window',
      }, req);
      
      return res.status(423).json({
        error: 'Configuration Locked',
        message: 'Configuration changes are blocked during the canary evidence collection window',
        details: {
          configLockActive: status.configLockActive,
          evidenceWindowActive: true,
          evidenceWindowRemainingMinutes: status.evidenceWindowRemainingMinutes,
        },
        retryAfter: 'After evidence window completes',
        timestamp: new Date().toISOString(),
      });
    }
  }
  
  next();
};