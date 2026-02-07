import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';

const A5_STUDENT_PORTAL = 'https://student-pilot-jamarrlmayes.replit.app/dashboard';

const PUBLIC_PATHS = [
  '/oidc',
  '/api/oauth',
  '/api/auth',
  '/api/v1',
  '/api/probe',
  '/api/probes',
  '/.well-known',
  '/health',
  '/readyz',
  '/api/health',
  '/privacy',
  '/terms',
  '/accessibility',
  '/trust-security',
  '/age-gate',
  '/parent-consent',
  '/evidence',
  '/docs',
];

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

export function adminOnlyPages(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_PATHS.some(path => req.path.startsWith(path))) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return next();
  }

  if (req.path.startsWith('/@')) {
    return next();
  }

  if (req.path.startsWith('/src/')) {
    return next();
  }

  if (req.path.startsWith('/@fs/')) {
    return next();
  }

  if (req.path.startsWith('/node_modules/')) {
    return next();
  }

  if (req.path.includes('.') && !req.path.endsWith('.html')) {
    return next();
  }

  const user = (req as any).user;
  
  if (!user) {
    return next();
  }

  const userEmail = user.email?.toLowerCase() || '';
  const isAdmin = user.role === 'admin' || ADMIN_EMAILS.includes(userEmail);

  if (!isAdmin) {
    logger.info('Non-admin user redirected to A5', {
      userId: user.id || user.sub,
      email: userEmail,
      requestedPath: req.path
    });
    return res.redirect(A5_STUDENT_PORTAL);
  }

  next();
}
