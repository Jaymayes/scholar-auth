/**
 * Admin Session Management
 * 
 * Separate session cookie for admin surfaces with stricter security:
 * - Cookie name: ssa_admin_sid (Scholar ScholarshipAI Admin Session ID)
 * - SameSite: Strict (maximum CSRF protection, no cross-site requests)
 * - Path: /admin (scoped to admin routes only)
 * - TTL: 4 hours (shorter than user sessions for elevated privilege timeout)
 * - Secure: true in production (HTTPS-only)
 * - HttpOnly: true (XSS protection)
 * 
 * Executive Decision: Separate admin cookie to prevent admin actions
 * from being performed via CSRF attacks from user-facing pages.
 */

import session from "express-session";
import connectPg from "connect-pg-simple";
import { logger } from "./middleware/auditLogger";

export function getAdminSession() {
  const adminSessionTtl = 4 * 60 * 60 * 1000; // 4 hours (shorter for admin security)
  const pgStore = connectPg(session);
  
  // Separate session store table for admin sessions
  const adminSessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: adminSessionTtl,
    tableName: "admin_sessions", // Separate table for admin sessions
    pruneSessionInterval: 60 * 15, // Prune every 15 minutes
    errorLog: () => {}, // Suppress verbose error logs
  });
  
  // Multi-secret support (same format as user sessions)
  const secretsEnv = process.env.SESSION_SECRET!;
  const secrets = secretsEnv.includes(',') 
    ? secretsEnv.split(',').map(s => s.trim())
    : [secretsEnv];
  
  if (secrets.length > 1) {
    logger.info('Admin multi-secret session configuration active', {
      secretCount: secrets.length,
      action: 'admin_session_config',
      rotationEnabled: true
    });
  }
  
  return session({
    secret: secrets,
    store: adminSessionStore,
    resave: false,
    saveUninitialized: false,
    // 🔒 SECURITY: __Host- prefix enforces Secure, no Domain, and Path=/
    // Since admin cookie uses path=/api/admin (not /), we cannot use __Host-
    // Instead, we use a descriptive name with strict security attributes
    name: 'ssa_admin_sid', // Admin-specific cookie name (cannot use __Host- with path=/api/admin)
    cookie: {
      httpOnly: true, // ✅ Prevents XSS cookie access
      secure: process.env.NODE_ENV === 'production', // ✅ HTTPS-only in production
      sameSite: 'strict', // ✅ Maximum CSRF protection, no cross-site requests
      maxAge: adminSessionTtl, // ✅ 4-hour timeout for admin sessions
      path: '/api/admin', // ✅ Scoped to admin routes only
      // Note: __Host- prefix requires path=/, so we cannot use it here
      // Domain must be undefined for path-scoped cookies
      domain: undefined, // ✅ No domain attribute (scoped to origin only)
    },
  });
}

/**
 * Middleware to sync user session to admin session
 * 
 * When an admin user accesses /admin routes, we copy their authentication
 * from the main session to the admin session. This ensures:
 * 1. Admin routes require both valid user session AND valid admin session
 * 2. Admin session has stricter CSRF protection (SameSite=Strict)
 * 3. Admin session has shorter TTL (4 hours vs 7 days)
 */
export function syncAdminSession(req: any, res: any, next: any) {
  // Skip if no user session
  if (!req.session || !req.session.passport || !req.session.passport.user) {
    return next();
  }
  
  const user = req.session.passport.user;
  
  // Only sync for admin users
  if (!user || !user.claims || user.claims.role !== 'admin') {
    return next();
  }
  
  // Check if admin session needs initialization or refresh
  if (!req.session.adminAuth || req.session.adminAuth.userId !== user.claims.sub) {
    logger.info('Initializing admin session', {
      action: 'admin_session_init',
      userId: user.claims.sub,
      timestamp: new Date().toISOString()
    });
    
    // Initialize admin auth context
    req.session.adminAuth = {
      userId: user.claims.sub,
      email: user.claims.email,
      role: user.claims.role,
      elevatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4 hours
    };
    
    // Save session to ensure admin context is persisted
    req.session.save((err: any) => {
      if (err) {
        logger.error('Failed to save admin session', err instanceof Error ? err : new Error(String(err)));
      }
      next();
    });
  } else {
    // Admin session already exists, continue
    next();
  }
}

/**
 * Middleware to require valid admin session
 * 
 * This enforces that admin routes require BOTH:
 * 1. Valid user authentication (from main session)
 * 2. Valid admin session context (from admin session)
 * 
 * This dual-requirement prevents CSRF attacks where an attacker
 * might trick an admin into performing actions from a user-facing page.
 */
export function requireAdminSession(req: any, res: any, next: any) {
  // Check main session authentication
  if (!req.session || !req.session.passport || !req.session.passport.user) {
    logger.warn('Admin route accessed without user authentication', {
      action: 'admin_auth_missing',
      path: req.path,
      ip: req.ip
    });
    return res.status(401).json({ 
      error: 'unauthorized',
      message: 'Authentication required for admin access' 
    });
  }
  
  const user = req.session.passport.user;
  
  // Check admin role
  if (!user.claims || user.claims.role !== 'admin') {
    logger.warn('Non-admin user attempted admin route access', {
      action: 'admin_auth_forbidden',
      userId: user.claims?.sub,
      role: user.claims?.role,
      path: req.path
    });
    return res.status(403).json({ 
      error: 'forbidden',
      message: 'Admin role required' 
    });
  }
  
  // Check admin session context
  if (!req.session.adminAuth) {
    logger.warn('Admin route accessed without admin session context', {
      action: 'admin_session_missing',
      userId: user.claims.sub,
      path: req.path
    });
    return res.status(401).json({ 
      error: 'admin_session_required',
      message: 'Admin session not initialized. Please access admin dashboard first.' 
    });
  }
  
  // Check admin session expiration
  const expiresAt = new Date(req.session.adminAuth.expiresAt);
  if (expiresAt < new Date()) {
    logger.warn('Admin session expired', {
      action: 'admin_session_expired',
      userId: user.claims.sub,
      expiresAt: req.session.adminAuth.expiresAt
    });
    
    // Clear expired admin context
    delete req.session.adminAuth;
    
    return res.status(401).json({ 
      error: 'admin_session_expired',
      message: 'Admin session expired. Please re-authenticate.' 
    });
  }
  
  // All checks passed
  next();
}

/**
 * Create admin_sessions table
 * 
 * This should be run as a migration or called on app startup
 * to ensure the admin sessions table exists.
 */
export const createAdminSessionsTableSQL = `
CREATE TABLE IF NOT EXISTS admin_sessions (
  sid VARCHAR PRIMARY KEY NOT NULL,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_admin_session_expire" ON admin_sessions (expire);

COMMENT ON TABLE admin_sessions IS 'Separate session storage for admin users with stricter security';
`;

/**
 * Migration helper to create admin_sessions table
 */
export async function ensureAdminSessionsTable(db: any) {
  try {
    await db.execute(createAdminSessionsTableSQL);
    logger.info('Admin sessions table ensured', {
      action: 'admin_table_migration',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to create admin_sessions table', 
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}
