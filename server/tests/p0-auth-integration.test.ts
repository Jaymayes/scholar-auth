/**
 * P0 Integration Tests - Critical Auth & Middleware Flows
 * 
 * Business-critical paths covering:
 * - Signup/Login with validation
 * - Password Reset lifecycle
 * - OIDC Provider (discovery, JWKS, authorization)
 * - Session/Token lifecycle
 * - Middleware/RBAC chain
 * - Routes & error handling
 * 
 * Uses in-memory storage, stubbed email, deterministic fixtures.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import { randomUUID } from 'crypto';
import { createApp, EmailServiceContract } from '../createApp';
import { storage } from '../storage';
import { TestStateManager, generateTestEmail } from './testUtils';

// Mock OIDC provider for ESM
jest.unstable_mockModule('oidc-provider', () => ({
  Provider: class MockProvider {
    callback() {}
    interactionDetails() {
      return Promise.resolve({
        uid: 'test-uid',
        prompt: { name: 'login' },
        params: {
          client_id: 'test-client',
          redirect_uri: 'https://example.com/callback',
          scope: 'openid email profile',
        },
      });
    }
    interactionFinished() {
      return Promise.resolve();
    }
  },
}));

describe('P0: Critical Auth & Middleware Integration', () => {
  let app: Express;
  let stateManager: TestStateManager;
  let capturedEmails: Array<{ to: string; subject: string; body: string }> = [];

  beforeAll(async () => {
    // Stub email service
    const stubEmailService: EmailServiceContract = {
      sendVerificationEmail: async (email: string, code: string) => {
        capturedEmails.push({
          to: email,
          subject: 'Email Verification',
          body: `Verification code: ${code}`,
        });
        return Promise.resolve();
      },
      sendPasswordResetEmail: async (email: string, token: string) => {
        capturedEmails.push({
          to: email,
          subject: 'Password Reset',
          body: `Reset token: ${token}`,
        });
        return Promise.resolve();
      },
    };

    // Create app with stub email service
    app = await createApp({
      enableTestAuthBypass: true,
      dependencies: {
        emailService: stubEmailService,
      },
    });
  });

  afterAll(async () => {
    // Close any open database connections
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  beforeEach(() => {
    stateManager = new TestStateManager();
    capturedEmails = [];
  });

  afterEach(async () => {
    await stateManager.cleanup();
  });

  describe('P0.1: Signup/Login Flow', () => {
    it('should signup with email verification, then login successfully', async () => {
      const email = generateTestEmail('signup');
      const password = 'SecurePass123!';

      // Step 1: Signup
      const signupRes = await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password,
          firstName: 'Test',
          lastName: 'User',
          dateOfBirth: '2000-01-01',
        })
        .expect(201);

      expect(signupRes.body).toMatchObject({
        message: expect.stringContaining('verification'),
      });

      // Verify email was sent
      expect(capturedEmails).toHaveLength(1);
      expect(capturedEmails[0].to).toBe(email);
      expect(capturedEmails[0].subject).toContain('Verification');

      // Extract verification code from email
      const codeMatch = capturedEmails[0].body.match(/code:\s*([A-Z0-9]+)/i);
      expect(codeMatch).toBeTruthy();
      const verificationCode = codeMatch![1];

      // Step 2: Verify email
      await request(app)
        .post('/api/auth/verify-email')
        .send({ email, code: verificationCode })
        .expect(200);

      // Step 3: Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      expect(loginRes.body).toMatchObject({
        user: {
          email,
          firstName: 'Test',
          lastName: 'User',
        },
      });

      // Step 4: Access protected route
      const meRes = await request(app)
        .get('/api/users/me')
        .set('Cookie', loginRes.headers['set-cookie'])
        .expect(200);

      expect(meRes.body.email).toBe(email);

      // Cleanup
      const user = await storage.getUserByEmail(email);
      if (user) stateManager.registerUser(user.id);
    });

    it('should reject signup with duplicate email', async () => {
      const email = generateTestEmail('duplicate');
      const password = 'SecurePass123!';

      // First signup
      await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password,
          firstName: 'First',
          lastName: 'User',
          dateOfBirth: '2000-01-01',
        })
        .expect(201);

      // Duplicate signup
      await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password,
          firstName: 'Second',
          lastName: 'User',
          dateOfBirth: '2000-01-01',
        })
        .expect(409);

      // Cleanup
      const user = await storage.getUserByEmail(email);
      if (user) stateManager.registerUser(user.id);
    });

    it('should reject login with weak password (validator test)', async () => {
      const email = generateTestEmail('weakpass');

      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password: '123',  // Too weak
          firstName: 'Test',
          lastName: 'User',
          dateOfBirth: '2000-01-01',
        })
        .expect(400);

      expect(res.body.message).toMatch(/password/i);
    });
  });

  describe('P0.2: Password Reset Flow', () => {
    it('should reset password with valid token, reject old password', async () => {
      const email = generateTestEmail('reset');
      const oldPassword = 'OldPass123!';
      const newPassword = 'NewPass456!';

      // Create verified user
      await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password: oldPassword,
          firstName: 'Reset',
          lastName: 'User',
          dateOfBirth: '2000-01-01',
        });

      const user = await storage.getUserByEmail(email);
      if (user) {
        await storage.updateUserEmailVerification(user.id, true);
        stateManager.registerUser(user.id);
      }

      // Step 1: Request password reset
      capturedEmails = [];
      await request(app)
        .post('/api/auth/password-reset/request')
        .send({ email })
        .expect(200);

      // Extract reset token
      expect(capturedEmails).toHaveLength(1);
      const urlMatch = capturedEmails[0].body.match(/token=([a-f0-9-]+)/i);
      expect(urlMatch).toBeTruthy();
      const resetToken = urlMatch![1];

      // Step 2: Confirm password reset
      await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({ token: resetToken, newPassword })
        .expect(200);

      // Step 3: Login with new password works
      await request(app)
        .post('/api/auth/login')
        .send({ email, password: newPassword })
        .expect(200);

      // Step 4: Login with old password fails
      await request(app)
        .post('/api/auth/login')
        .send({ email, password: oldPassword })
        .expect(401);
    });

    it('should reject invalid/expired reset token', async () => {
      const fakeToken = randomUUID();

      await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({ token: fakeToken, newPassword: 'NewPass123!' })
        .expect(400);
    });
  });

  describe('P0.3: OIDC Provider Endpoints', () => {
    it('should return OIDC discovery metadata (RFC 8414)', async () => {
      const res = await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200);

      expect(res.body).toMatchObject({
        issuer: expect.any(String),
        authorization_endpoint: expect.stringContaining('/oidc/auth'),
        token_endpoint: expect.stringContaining('/oidc/token'),
        jwks_uri: expect.stringContaining('/oidc/jwks'),
        userinfo_endpoint: expect.stringContaining('/oidc/me'),
        response_types_supported: expect.arrayContaining(['code']),
        grant_types_supported: expect.arrayContaining(['authorization_code', 'refresh_token']),
        code_challenge_methods_supported: expect.arrayContaining(['S256']),
      });
    });

    it('should return JWKS with RSA public keys', async () => {
      const res = await request(app)
        .get('/oidc/jwks')
        .expect(200);

      expect(res.body).toHaveProperty('keys');
      expect(Array.isArray(res.body.keys)).toBe(true);
      expect(res.body.keys.length).toBeGreaterThan(0);
      expect(res.body.keys[0]).toMatchObject({
        kty: 'RSA',
        use: 'sig',
        kid: expect.any(String),
        n: expect.any(String),
        e: expect.any(String),
      });
    });

    it('should require authentication for userinfo endpoint', async () => {
      await request(app)
        .get('/oidc/me')
        .expect(401);
    });
  });

  describe('P0.4: Session/Token Lifecycle', () => {
    it('should invalidate session on logout', async () => {
      const email = generateTestEmail('logout');
      const password = 'Pass123!';

      // Create and login user
      await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password,
          firstName: 'Logout',
          lastName: 'Test',
          dateOfBirth: '2000-01-01',
        });

      const user = await storage.getUserByEmail(email);
      if (user) {
        await storage.updateUserEmailVerification(user.id, true);
        stateManager.registerUser(user.id);
      }

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      const cookies = loginRes.headers['set-cookie'];

      // Verify session works
      await request(app)
        .get('/api/users/me')
        .set('Cookie', cookies)
        .expect(200);

      // Logout
      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookies)
        .expect(200);

      // Subsequent request should fail
      await request(app)
        .get('/api/users/me')
        .set('Cookie', cookies)
        .expect(401);
    });
  });

  describe('P0.5: Middleware/RBAC Chain', () => {
    it('should require authentication for protected routes', async () => {
      await request(app)
        .get('/api/users/me')
        .expect(401);
    });

    it('should enforce RBAC: admin-only endpoint returns 403 for non-admin', async () => {
      const email = generateTestEmail('rbac');
      const password = 'Pass123!';

      // Create student user
      await request(app)
        .post('/api/auth/signup')
        .send({
          email,
          password,
          firstName: 'Student',
          lastName: 'User',
          dateOfBirth: '2000-01-01',
        });

      const user = await storage.getUserByEmail(email);
      if (user) {
        await storage.updateUserEmailVerification(user.id, true);
        stateManager.registerUser(user.id);
      }

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      // Try to access admin endpoint
      await request(app)
        .get('/api/admin/users')
        .set('Cookie', loginRes.headers['set-cookie'])
        .expect(403);
    });

    it('should allow admin access for admin role', async () => {
      const email = generateTestEmail('admin');
      const testUser = {
        sub: randomUUID(),
        email,
        name: 'Admin User',
        given_name: 'Admin',
        family_name: 'User',
        role: 'admin',
      };

      // Use test auth bypass to create admin session
      const loginRes = await request(app)
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      const user = await storage.getUserByEmail(email);
      if (user) {
        stateManager.registerUser(user.id);
      }

      // Access admin endpoint
      await request(app)
        .get('/api/admin/users')
        .set('Cookie', loginRes.headers['set-cookie'])
        .expect(200);
    });
  });

  describe('P0.6: Routes & Error Handling', () => {
    it('should return 200 for health check', async () => {
      await request(app)
        .get('/api/health')
        .expect(200);
    });

    it('should return 404 for unknown routes', async () => {
      await request(app)
        .get('/api/nonexistent/route')
        .expect(404);
    });

    it('should return standardized error envelope', async () => {
      const res = await request(app)
        .get('/api/nonexistent/route')
        .expect(404);

      expect(res.body).toHaveProperty('message');
      expect(typeof res.body.message).toBe('string');
    });
  });
});
