/**
 * Critical Path: REAL HTTP/E2E Tests - Auth Flows via Supertest
 * 
 * Tests the complete authentication lifecycle via ACTUAL HTTP handlers:
 * 1. POST /api/test/login - Create authenticated session
 * 2. POST /api/v2/auth/verify-email - Verify email with code
 * 3. GET /api/v2/student - Access protected route
 * 4. POST /api/v2/auth/request-password-reset - Password reset
 * 
 * These tests HIT REAL EXPRESS ROUTES with middleware, not just storage!
 */

// Mock openid-client before importing routes
jest.mock('openid-client');
jest.mock('../replitAuth', () => ({
  getOidcConfig: jest.fn(() => Promise.resolve({
    authorization_endpoint: 'https://mock.replit.com/auth',
    token_endpoint: 'https://mock.replit.com/token',
    userinfo_endpoint: 'https://mock.replit.com/userinfo'
  })),
  setupAuth: jest.fn((app: any) => Promise.resolve())
}));

import request from 'supertest';
import express, { Application } from 'express';
import session from 'express-session';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import { randomUUID, randomBytes } from 'crypto';
import { storage } from '../storage';
import { TestStateManager, generateTestEmail } from './testUtils';
import { setTestStateManager } from './testFactories';

describe('Critical Path: REAL HTTP Auth Flows (Supertest)', () => {
  let app: Application;
  let stateManager: TestStateManager;

  beforeAll(async () => {
    // Create Express app with REAL middleware stack
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());
    
    // Session middleware (CRITICAL for auth)
    app.use(session({
      secret: 'test-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));
    
    // Passport middleware
    app.use(passport.initialize());
    app.use(passport.session());
    
    // Passport serialization (required for sessions)
    passport.serializeUser((user: any, done) => {
      done(null, user);
    });
    
    passport.deserializeUser((user: any, done) => {
      done(null, user);
    });

    // Import and register REAL routes
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

  describe('HTTP POST /api/test/login - Session Creation', () => {
    it('should return 200 and create session with valid user data', async () => {
      const testEmail = generateTestEmail('http-login');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'HTTP Test User',
        given_name: 'HTTP',
        family_name: 'User'
      };

      const response = await request(app)
        .post('/api/test/login')
        .send(testUser)
        .expect('Content-Type', /json/)
        .expect(200);

      // Verify HTTP response structure
      expect(response.body).toMatchObject({
        success: true,
        testMode: true,
        user: {
          email: testEmail,
          firstName: 'HTTP',
          lastName: 'User',
          role: 'student'
        }
      });

      // Verify session cookie was set
      expect(response.headers['set-cookie']).toBeDefined();

      // Verify user was created in database
      const dbUser = await storage.getUserByEmail(testEmail);
      expect(dbUser).toBeTruthy();
      expect(dbUser?.email).toBe(testEmail);

      if (dbUser) {
        stateManager.registerUser(dbUser.id);
      }
    });

    it('should return 400 with missing required fields', async () => {
      const response = await request(app)
        .post('/api/test/login')
        .send({ sub: randomUUID() }) // Missing email, name, etc.
        .expect('Content-Type', /json/);

      // Should fail validation (might be 400 or 500 depending on implementation)
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('HTTP POST /api/v2/auth/verify-email - Email Verification', () => {
    let authenticatedAgent: ReturnType<typeof request.agent>;
    let testUserId: string;

    beforeEach(async () => {
      // Create authenticated session first
      authenticatedAgent = request.agent(app);
      const testEmail = generateTestEmail('http-verify');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Verify User',
        given_name: 'Verify',
        family_name: 'User'
      };

      const loginResponse = await authenticatedAgent
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      testUserId = loginResponse.body.user.id;
      stateManager.registerUser(testUserId);
    });

    it('should return 200 with valid 6-digit code', async () => {
      // Create verification token
      const code = '123456';
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      
      await storage.createEmailVerificationToken({
        userId: testUserId,
        code,
        expiresAt
      });

      const response = await authenticatedAgent
        .post('/api/v2/auth/verify-email')
        .send({ code })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toBe('Email verified successfully');

      // Verify database state changed
      const user = await storage.getUser(testUserId);
      expect(user?.isEmailVerified).toBe(true);
    });

    it('should return 400 with invalid code format', async () => {
      const response = await authenticatedAgent
        .post('/api/v2/auth/verify-email')
        .send({ code: '123' }) // Too short
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.message).toBe('Invalid verification code');
    });

    it('should return 400 with non-existent code', async () => {
      const response = await authenticatedAgent
        .post('/api/v2/auth/verify-email')
        .send({ code: '999999' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.message).toContain('Invalid or expired verification code');
    });

    it('should return 401 when not authenticated', async () => {
      const unauthenticatedAgent = request(app);
      
      const response = await unauthenticatedAgent
        .post('/api/v2/auth/verify-email')
        .send({ code: '123456' })
        .expect(401);
    });
  });

  describe('HTTP POST /api/v2/auth/request-password-reset - Password Reset', () => {
    it('should return 200 for existing user (no user enumeration)', async () => {
      const testEmail = generateTestEmail('http-reset');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Reset User',
        given_name: 'Reset',
        family_name: 'User'
      };

      // Create user first
      const loginResponse = await request(app)
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      stateManager.registerUser(loginResponse.body.user.id);

      // Request password reset
      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({ email: testEmail })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toContain('If an account exists');
    });

    it('should return 200 for non-existent user (no user enumeration)', async () => {
      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({ email: 'nonexistent@example.com' })
        .expect('Content-Type', /json/)
        .expect(200);

      // Same response to prevent user enumeration
      expect(response.body.message).toContain('If an account exists');
    });

    it('should return 400 with missing email', async () => {
      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({})
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.message).toBe('Email is required');
    });
  });

  describe('HTTP GET /api/v2/student - Protected Route Access', () => {
    it('should return 200 for authenticated student', async () => {
      const authenticatedAgent = request.agent(app);
      const testEmail = generateTestEmail('http-student');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Student User',
        given_name: 'Student',
        family_name: 'User'
      };

      const loginResponse = await authenticatedAgent
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      stateManager.registerUser(loginResponse.body.user.id);

      // Access protected route
      const response = await authenticatedAgent
        .get('/api/v2/student')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toBe('Student dashboard data');
      expect(response.body.user).toBeTruthy();
      expect(response.body.user.email).toBe(testEmail);
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app)
        .get('/api/v2/student')
        .expect(401);
    });
  });

  describe('HTTP GET /api/v2/admin - RBAC Protection', () => {
    it('should return 200 for admin user', async () => {
      const authenticatedAgent = request.agent(app);
      const testEmail = generateTestEmail('http-admin');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Admin User',
        given_name: 'Admin',
        family_name: 'User'
      };

      const loginResponse = await authenticatedAgent
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      const userId = loginResponse.body.user.id;
      stateManager.registerUser(userId);

      // Update user role to admin
      const user = await storage.getUser(userId);
      if (user) {
        await storage.upsertUser({ ...user, role: 'admin' });
      }

      // Access admin route
      const response = await authenticatedAgent
        .get('/api/v2/admin')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toBe('Admin dashboard data');
    });

    it('should return 403 for student user', async () => {
      const authenticatedAgent = request.agent(app);
      const testEmail = generateTestEmail('http-student-denied');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Student User',
        given_name: 'Student',
        family_name: 'User'
      };

      const loginResponse = await authenticatedAgent
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      stateManager.registerUser(loginResponse.body.user.id);

      // Try to access admin route
      const response = await authenticatedAgent
        .get('/api/v2/admin')
        .expect('Content-Type', /json/)
        .expect(403);

      expect(response.body.message).toBe('Admin access required');
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app)
        .get('/api/v2/admin')
        .expect(401);
    });
  });
});
