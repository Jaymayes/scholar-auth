/**
 * Critical Path: HTTP/E2E Tests - Signup → Verify → Login Flow
 * 
 * Tests the complete authentication lifecycle via HTTP handlers:
 * 1. Create user via test endpoint
 * 2. Verify email with code
 * 3. Check session/auth state
 * 4. Logout
 * 
 * These tests protect against routing/middleware/session bugs that storage-only tests miss.
 */

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { randomUUID } from 'crypto';
import { storage } from '../storage';
import { TestStateManager, generateTestEmail } from './testUtils';
import { setTestStateManager } from './testFactories';

describe('Critical Path: HTTP Auth - Signup → Verify → Login', () => {
  let app: express.Application;
  let stateManager: TestStateManager;
  let agent: ReturnType<typeof request.agent>;

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
    
    // Create a new agent for each test to maintain session isolation
    agent = request.agent(app);
  });

  afterEach(async () => {
    await stateManager.cleanup();
  });

  describe('Test Login Endpoint (E2E Helper)', () => {
    it('should create authenticated session via /api/test/login', async () => {
      const testEmail = generateTestEmail('signup');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Test User',
        given_name: 'Test',
        family_name: 'User'
      };

      const response = await agent
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        testMode: true,
        user: {
          email: testEmail,
          firstName: 'Test',
          lastName: 'User',
          role: 'student'
        }
      });

      // Verify user was created in database
      const dbUser = await storage.getUserByEmail(testEmail);
      expect(dbUser).toBeTruthy();
      expect(dbUser?.email).toBe(testEmail);

      // Track for cleanup
      if (dbUser) {
        stateManager.registerUser(dbUser.id);
      }
    });

    it('should return 404 in production environment', async () => {
      // Temporarily set NODE_ENV to production
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const testUser = {
          sub: randomUUID(),
          email: generateTestEmail('prod'),
          name: 'Prod Test',
          given_name: 'Prod',
          family_name: 'Test'
        };

        await agent
          .post('/api/test/login')
          .send(testUser)
          .expect(404);
      } finally {
        // Restore original NODE_ENV
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('Email Verification Flow', () => {
    let authenticatedAgent: ReturnType<typeof request.agent>;
    let testUserId: string;
    let verificationCode: string;

    beforeEach(async () => {
      // Create authenticated session
      const testEmail = generateTestEmail('verify');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Verify User',
        given_name: 'Verify',
        family_name: 'User'
      };

      const loginResponse = await agent
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      testUserId = loginResponse.body.user.id;
      stateManager.registerUser(testUserId);
      authenticatedAgent = agent;

      // Create verification token
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
      
      await storage.createEmailVerificationToken({
        userId: testUserId,
        code: verificationCode,
        expiresAt
      });
    });

    it('should verify email with valid code', async () => {
      const response = await authenticatedAgent
        .post('/api/v2/auth/verify-email')
        .send({ code: verificationCode })
        .expect(200);

      expect(response.body.message).toBe('Email verified successfully');

      // Verify user's email is now verified
      const user = await storage.getUser(testUserId);
      expect(user?.isEmailVerified).toBe(true);
    });

    it('should reject invalid verification code', async () => {
      const response = await authenticatedAgent
        .post('/api/v2/auth/verify-email')
        .send({ code: '999999' })
        .expect(400);

      expect(response.body.message).toContain('Invalid or expired verification code');
    });

    it('should reject malformed verification code', async () => {
      const response = await authenticatedAgent
        .post('/api/v2/auth/verify-email')
        .send({ code: '123' }) // Too short
        .expect(400);

      expect(response.body.message).toBe('Invalid verification code');
    });
  });

  describe('Session State Checks', () => {
    let authenticatedAgent: ReturnType<typeof request.agent>;
    let testUserId: string;

    beforeEach(async () => {
      const testEmail = generateTestEmail('session');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Session User',
        given_name: 'Session',
        family_name: 'User'
      };

      const loginResponse = await agent
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      testUserId = loginResponse.body.user.id;
      stateManager.registerUser(testUserId);
      authenticatedAgent = agent;
    });

    it('should access protected /api/v2/student route when authenticated', async () => {
      const response = await authenticatedAgent
        .get('/api/v2/student')
        .expect(200);

      expect(response.body.message).toBe('Student dashboard data');
      expect(response.body.user).toBeTruthy();
      expect(response.body.user.id).toBe(testUserId);
    });

    it('should reject unauthenticated access to protected routes', async () => {
      // Create a new agent without authentication
      const unauthenticatedAgent = request.agent(app);
      
      await unauthenticatedAgent
        .get('/api/v2/student')
        .expect(401);
    });
  });
});
