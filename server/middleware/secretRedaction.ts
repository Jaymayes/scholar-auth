/**
 * 🔒 CEO MANDATE: Log Guardrails - Strip Secrets and Authorization Headers
 * 
 * Per Operation Synergy Decision #2:
 * "Enforce 'no secrets in logs or chat.' Add log guard rails to strip secrets 
 * and authorization headers."
 * 
 * This middleware automatically redacts sensitive data from logs, responses, 
 * and error messages to prevent accidental secret exposure.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';

/**
 * Patterns to detect and redact from logs
 */
const SECRET_PATTERNS = [
  // OAuth/OIDC secrets
  /client_secret=[^&\s]*/gi,
  /client_secret"?\s*:\s*"?[^",\s}]*/gi,
  /"client_secret"\s*:\s*"[^"]*"/gi,
  
  // Authorization headers
  /authorization:\s*bearer\s+[^\s]*/gi,
  /authorization"?\s*:\s*"?bearer\s+[^",\s}]*/gi,
  /"authorization"\s*:\s*"[^"]*"/gi,
  
  // API keys
  /api[_-]?key[s]?[=:]\s*[^\s&,}]*/gi,
  /"api[_-]?key[s]?"\s*:\s*"[^"]*"/gi,
  
  // JWT tokens (long base64 strings with dots)
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  
  // Generic secrets (32+ hex chars)
  /[a-f0-9]{64,}/gi,
  /[a-f0-9]{32}/gi, // 32-byte hex (common for client secrets)
  
  // Cookie values
  /set-cookie:\s*[^\n]*/gi,
  /cookie:\s*[^\n]*/gi,
  
  // Database credentials
  /postgres:\/\/[^\s]*/gi,
  /mongodb:\/\/[^\s]*/gi,
  /DATABASE_URL=[^\s]*/gi,
];

/**
 * Redact sensitive data from string content
 */
export function redactSecrets(input: any): any {
  if (typeof input === 'string') {
    let redacted = input;
    
    // Apply all redaction patterns
    SECRET_PATTERNS.forEach(pattern => {
      redacted = redacted.replace(pattern, (match) => {
        // Preserve pattern structure for debugging
        if (match.includes('=')) {
          return match.split('=')[0] + '=[REDACTED]';
        } else if (match.includes(':')) {
          return match.split(':')[0] + ': [REDACTED]';
        } else {
          // For tokens/secrets without delimiters, show first 4 chars
          return match.substring(0, 4) + '...[REDACTED]';
        }
      });
    });
    
    return redacted;
  }
  
  if (Array.isArray(input)) {
    return input.map(item => redactSecrets(item));
  }
  
  if (typeof input === 'object' && input !== null) {
    const redacted: any = {};
    for (const [key, value] of Object.entries(input)) {
      // Redact sensitive keys entirely
      const sensitiveKeys = [
        'client_secret',
        'clientSecret',
        'password',
        'access_token',
        'accessToken',
        'refresh_token',
        'refreshToken',
        'id_token',
        'idToken',
        'api_key',
        'apiKey',
        'authorization',
        'cookie',
        'set-cookie',
      ];
      
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSecrets(value);
      }
    }
    return redacted;
  }
  
  return input;
}

/**
 * Middleware to redact secrets from request/response logs
 */
export function secretRedactionMiddleware(req: Request, res: Response, next: NextFunction) {
  // Redact authorization header from request
  if (req.headers.authorization) {
    const authType = req.headers.authorization.split(' ')[0];
    req.headers.authorization = `${authType} [REDACTED]`;
  }
  
  // Redact cookie header from request
  if (req.headers.cookie) {
    req.headers.cookie = '[REDACTED]';
  }
  
  // Override res.json to redact response data before logging
  const originalJson = res.json.bind(res);
  res.json = function(body: any) {
    // Log redacted version (using info level since debug not available)
    if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_LOGGING === 'true') {
      logger.info('Response body (redacted)', {
        path: req.path,
        method: req.method,
        body: redactSecrets(body),
      });
    }
    
    // Send original (unredacted) to client
    return originalJson(body);
  };
  
  next();
}

/**
 * Redact secrets from error objects before logging
 */
export function redactErrorSecrets(error: Error): any {
  return {
    name: error.name,
    message: redactSecrets(error.message),
    stack: redactSecrets(error.stack || ''),
    ...(error as any).data && { data: redactSecrets((error as any).data) },
  };
}

/**
 * Safe logger wrapper that always redacts
 */
export const safeLogger = {
  info: (message: string, meta?: any) => {
    logger.info(redactSecrets(message), redactSecrets(meta));
  },
  warn: (message: string, meta?: any) => {
    logger.warn(redactSecrets(message), redactSecrets(meta));
  },
  error: (message: string, error?: Error | any) => {
    logger.error(redactSecrets(message), error instanceof Error ? redactErrorSecrets(error) : redactSecrets(error));
  },
};
