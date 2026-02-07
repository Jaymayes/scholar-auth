/**
 * Test-Only Auth Bypass Middleware
 * 
 * **SECURITY CRITICAL:**
 * - Only active when NODE_ENV === 'test' AND TEST_AUTH_BYPASS=1
 * - Hard fail-fast if bypass attempted in production
 * - Allows HTTP tests to simulate authenticated users without full OIDC flow
 * 
 * **Deprecation Plan:**
 * This is a tactical seam for HTTP testing. Will be removed when router factories
 * are implemented (next sprint). See ADR: Test Auth Bypass for HTTP Testing.
 * 
 * **Usage in Tests:**
 * ```typescript
 * const response = await request(app)
 *   .get('/api/v2/student')
 *   .set('x-test-user', JSON.stringify({ id: userId, email: 'test@example.com' }))
 *   .set('x-test-roles', 'student')
 *   .expect(200);
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from './auditLogger';

/**
 * Hard security check: Prevent bypass from being enabled in non-test environments
 */
export function validateTestAuthBypassSafety() {
  const bypassEnabled = process.env.TEST_AUTH_BYPASS === '1';
  const isTestEnv = process.env.NODE_ENV === 'test';

  if (bypassEnabled && !isTestEnv) {
    const error = new Error('SECURITY VIOLATION: TEST_AUTH_BYPASS enabled in non-test environment');
    logger.error('SECURITY VIOLATION', error);
    
    // FAIL FAST - Do not allow server to start
    console.error('❌ FATAL SECURITY ERROR: TEST_AUTH_BYPASS=1 detected outside NODE_ENV=test');
    console.error('❌ Server startup aborted to prevent security bypass in production');
    process.exit(1);
  }

  if (bypassEnabled && isTestEnv) {
    logger.warn('Test auth bypass enabled (test environment only)', {
      NODE_ENV: process.env.NODE_ENV,
      warning: 'This bypass is ONLY for HTTP testing and will be removed in future sprint'
    });
  }
}

/**
 * Test-only auth bypass middleware
 * 
 * Populates req.user from x-test-user and x-test-roles headers when:
 * - NODE_ENV === 'test'
 * - TEST_AUTH_BYPASS=1
 * 
 * Otherwise, this is a complete no-op.
 */
export function testAuthBypass(req: Request, res: Response, next: NextFunction) {
  // Only active in test environment with explicit bypass flag
  const bypassEnabled = process.env.TEST_AUTH_BYPASS === '1';
  const isTestEnv = process.env.NODE_ENV === 'test';

  if (!bypassEnabled || !isTestEnv) {
    return next();
  }

  // Check for test auth headers
  const testUserHeader = req.get('x-test-user');
  const testRolesHeader = req.get('x-test-roles');

  if (testUserHeader) {
    try {
      const userData = JSON.parse(testUserHeader);
      const role = testRolesHeader || 'student';

      // Populate req.user with test data (mimics passport session)
      (req as any).user = {
        userId: userData.id,
        claims: {
          sub: userData.id,
          email: userData.email,
          name: userData.name || `${userData.firstName} ${userData.lastName}`,
          exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
        },
        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
        access_token: `test_access_${userData.id}`,
        refresh_token: `test_refresh_${userData.id}`,
        role
      };

      logger.info('Test auth bypass applied', {
        userId: userData.id,
        email: userData.email,
        role,
        testMode: true
      });
    } catch (error) {
      logger.error('Test auth bypass failed to parse headers', error as Error);
      return res.status(400).json({ error: 'Invalid x-test-user header format' });
    }
  }

  next();
}
