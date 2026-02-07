/**
 * Global Identity Headers Middleware (AGENT3 Spec)
 * 
 * Adds X-System-Identity and X-App-Base-URL headers to all responses
 * to ensure every API response identifies the service.
 */

import type { Request, Response, NextFunction } from 'express';

const APP_ID = 'scholar_auth';
const BASE_URL = process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app';

/**
 * Middleware to add identity headers to every response
 */
export function identityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  // Set identity headers for all responses
  res.setHeader('X-System-Identity', APP_ID);
  res.setHeader('X-App-Base-URL', BASE_URL);
  
  next();
}
