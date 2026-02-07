import { Request, Response, NextFunction } from 'express';
import { verifyInterAppSignature } from './index';

export interface InterAppMiddlewareConfig {
  secrets: Record<string, string>;
  allowedApps?: string[];
}

export function interAppAuthMiddleware(config: InterAppMiddlewareConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sourceApp = req.headers['x-source-app'] as string;
    const timestamp = req.headers['x-timestamp'] as string;
    const signature = req.headers['x-signature'] as string;
    const protocol = req.headers['x-scholar-protocol'] as string;

    if (!sourceApp || !timestamp || !signature) {
      return res.status(401).json({
        error: 'missing_auth_headers',
        message: 'Required headers: X-Source-App, X-Timestamp, X-Signature',
      });
    }

    if (protocol !== 'v3.5.1') {
      return res.status(400).json({
        error: 'protocol_mismatch',
        message: 'Expected X-Scholar-Protocol: v3.5.1',
      });
    }

    if (config.allowedApps && !config.allowedApps.includes(sourceApp)) {
      return res.status(403).json({
        error: 'app_not_allowed',
        message: `Source app ${sourceApp} is not in the allowlist`,
      });
    }

    const secret = config.secrets[sourceApp];
    if (!secret) {
      return res.status(403).json({
        error: 'unknown_source_app',
        message: `No secret configured for ${sourceApp}`,
      });
    }

    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');

    const isValid = verifyInterAppSignature(secret, signature, timestamp, body);
    if (!isValid) {
      return res.status(401).json({
        error: 'invalid_signature',
        message: 'Signature verification failed or timestamp expired',
      });
    }

    (req as any).sourceApp = sourceApp;
    next();
  };
}

export function interAppRateLimiter(options: { windowMs?: number; max?: number } = {}) {
  const windowMs = options.windowMs ?? 60000;
  const max = options.max ?? 100;
  const requests = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const sourceApp = (req as any).sourceApp || req.headers['x-source-app'] || 'unknown';
    const key = `${sourceApp}:${req.path}`;
    const now = Date.now();

    let record = requests.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      requests.set(key, record);
    }

    record.count++;

    res.setHeader('X-RateLimit-Limit', max.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count).toString());
    res.setHeader('X-RateLimit-Reset', record.resetAt.toString());

    if (record.count > max) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: `Rate limit exceeded for ${sourceApp}`,
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      });
    }

    next();
  };
}
