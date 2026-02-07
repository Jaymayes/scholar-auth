import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';

/**
 * AGENT3 UNIFIED EXECUTION PROMPT - Global Compliance Requirement
 * 
 * Top-level instruction: "If you return JSON, include: system_identity, base_url"
 * This middleware patches res.json() to automatically inject identity fields
 * into every JSON response across the entire application.
 * 
 * Applied globally to ensure 100% compliance without manual modifications.
 */

const SYSTEM_IDENTITY = 'scholar_auth';
const BASE_URL = process.env.APP_BASE_URL || 'https://scholar-auth-jamarrlmayes.replit.app';

function augmentWithIdentity(body: any): any {
  // Skip if not an object (primitives, arrays should not be modified)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return body;
  }

  // Check if identity fields already exist (avoid duplication)
  const hasIdentity = 'system_identity' in body && 'base_url' in body;
  
  if (hasIdentity) {
    // Already has identity fields, return as-is
    return body;
  }

  // Augment with identity fields (AGENT3 requirement)
  return {
    ...body,
    system_identity: SYSTEM_IDENTITY,
    base_url: BASE_URL
  };
}

export function jsonIdentityWrapperMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Patch res.json() - used by most Express routes
  res.json = function (body: any) {
    return originalJson(augmentWithIdentity(body));
  };

  // Patch res.send() - used by oidc-provider and other libraries
  res.send = function (body: any) {
    // Only augment if Content-Type is application/json
    const contentType = res.get('Content-Type') || '';
    if (contentType.includes('application/json') && typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        const augmented = augmentWithIdentity(parsed);
        return originalSend(JSON.stringify(augmented));
      } catch (e) {
        // Not valid JSON, send as-is
        return originalSend(body);
      }
    } else if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
      // Plain object sent via res.send() - augment it
      return originalSend(augmentWithIdentity(body));
    }
    
    return originalSend(body);
  };

  next();
}
