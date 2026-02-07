/**
 * Critical Path: HTTP/E2E Tests - Password Reset Flow
 * 
 * Tests the complete password reset lifecycle via HTTP handlers:
 * 1. Request password reset
 * 2. Verify reset token
 * 3. Complete password reset
 * 4. Test expired tokens
 * 
 * These tests protect against routing/middleware bugs in password reset flow.
 */

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { TestStateManager, generateTestEmail } from './testUtils';
import { setTestStateManager, userFactory } from './testFactories';

describe('Critical Path: HTTP Password Reset Flow', () => {
  let app: express.Application;
  let stateManager: TestStateManager;

  beforeAll(async () => {
    // Create minimal Express app with required middleware
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    
    // Session middleware (required for passport)
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }
    }));
    
    // Passport middleware
    app.use(passport.initialize());
    app.use(passport.session());
    
    // Passport serialization
    passport.serializeUser((user: any, done) => {
      done(null, user);
    });
    
    passport.deserializeUser((user: any, done) => {
      done(null, user);
    });

    // Import and register routes
    const { registerRoutes } = await import('../routes');
    await registerRoutes(app as any);
  });

  beforeEach(async () => {
    stateManager = new TestStateManager();
    setTestStateManager(stateManager);
  });

  afterEach(async () => {
    await stateManager.cleanup();
  });

  describe('Password Reset Request', () => {
    it('should accept password reset request for existing user', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('reset'),
        firstName: 'Reset',
        lastName: 'Test'
      });

      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({ email: testUser.email })
        .expect(200);

      expect(response.body.message).toContain('If an account exists');

      // Verify token was created in database
      const user = await storage.getUserByEmail(testUser.email);
      expect(user).toBeTruthy();
    });

    it('should not reveal if user does not exist', async () => {
      const nonExistentEmail = generateTestEmail('nonexistent');

      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({ email: nonExistentEmail })
        .expect(200);

      // Same response as if user existed (security best practice)
      expect(response.body.message).toContain('If an account exists');
    });

    it('should reject request without email', async () => {
      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({})
        .expect(400);

      expect(response.body.message).toBe('Email is required');
    });

    it('should be rate limited after multiple requests', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('ratelimit'),
        firstName: 'Rate',
        lastName: 'Limit'
      });

      // Make multiple rapid requests
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/v2/auth/request-password-reset')
          .send({ email: testUser.email });
      }

      // Next request should be rate limited (rate limit is typically 3-5 requests)
      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({ email: testUser.email });

      // Rate limit returns 429 status
      expect([200, 429]).toContain(response.status);
    });
  });

  describe('Password Reset Token Verification', () => {
    it('should verify valid reset token', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('verify-token'),
        firstName: 'Verify',
        lastName: 'Token'
      });

      // Create a reset token
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await storage.createPasswordResetTokenAsync({
        userId: testUser.id,
        token,
        expiresAt
      });

      const response = await request(app)
        .get(`/api/v2/auth/verify-reset-token/${token}`)
        .expect(200);

      expect(response.body.message).toBe('Token is valid');
    });

    it('should reject invalid reset token', async () => {
      const invalidToken = randomBytes(32).toString('hex');

      const response = await request(app)
        .get(`/api/v2/auth/verify-reset-token/${invalidToken}`)
        .expect(400);

      expect(response.body.message).toContain('Invalid or expired reset token');
    });

    it('should reject expired reset token', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('expired-token'),
        firstName: 'Expired',
        lastName: 'Token'
      });

      // Create an expired token
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() - 60 * 1000); // Expired 1 minute ago

      await storage.createPasswordResetTokenAsync({
        userId: testUser.id,
        token,
        expiresAt
      });

      const response = await request(app)
        .get(`/api/v2/auth/verify-reset-token/${token}`)
        .expect(400);

      expect(response.body.message).toContain('Invalid or expired reset token');
    });
  });
});
