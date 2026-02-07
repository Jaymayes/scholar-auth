import { Request, Response, NextFunction } from 'express';

/**
 * AGENT3 UNIFIED EXECUTION PROMPT - OIDC Response Interceptor
 * 
 * The oidc-provider library uses Koa internally and bypasses Express's res.json() and res.send().
 * This middleware intercepts the response after oidc-provider sets the body but before it's sent.
 * 
 * Applied specifically to /oidc/* routes to inject system_identity and base_url into token responses.
 */

const SYSTEM_IDENTITY = 'scholar_auth';
const BASE_URL = process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app';

export function oidcResponseInterceptor(req: Request, res: Response, next: NextFunction) {
  const originalEnd = res.end.bind(res);
  const originalWrite = res.write.bind(res);
  const chunks: Buffer[] = [];

  // Intercept res.write() to capture chunked responses
  res.write = function (chunk: any, ...args: any[]): boolean {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return true; // Don't actually write yet
  };

  // Intercept res.end() to modify the final response
  res.end = function (chunk: any, ...args: any[]): any {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString('utf8');
    const contentType = res.get('Content-Type') || '';

    // Only modify JSON responses
    if (contentType.includes('application/json') && body) {
      try {
        const parsed = JSON.parse(body);
        
        // Only augment if it's an object and doesn't already have identity
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          if (!('system_identity' in parsed)) {
            const augmented = {
              ...parsed,
              system_identity: SYSTEM_IDENTITY,
              base_url: BASE_URL
            };
            const newBody = JSON.stringify(augmented);
            res.setHeader('Content-Length', Buffer.byteLength(newBody));
            return originalEnd.call(res, newBody, ...args);
          }
        }
      } catch (e) {
        // Not valid JSON or error parsing, send original
      }
    }

    // Send original body if not JSON or augmentation not needed
    return originalEnd.call(res, body, ...args);
  };

  next();
}
