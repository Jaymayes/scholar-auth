/**
 * Critical Path: REAL HTTP Handler Tests (Day 3-4)
 * 
 * Tests ACTUAL HTTP handlers via supertest with testAuthBypass:
 * - POST /api/test/login - Session creation
 * - POST /api/v2/auth/verify-email - Email verification  
 * - POST /api/v2/auth/request-password-reset - Password reset
 * - GET /api/v2/student - Protected route access
 * - GET /api/v2/admin - RBAC protection
 * - GET /api/v2/reviewer - RBAC protection
 * 
 * **KEY DIFFERENCE from storage tests:**
 * These hit REAL Express routes with middleware, not just storage.*() calls!
 */

// Set test environment variables BEFORE importing anything
process.env.NODE_ENV = 'test';
process.env.TEST_AUTH_BYPASS = '1';

// Mock OIDC modules to avoid ESM import issues
jest.mock('../replitAuth', () => ({
  getOidcConfig: jest.fn(() => Promise.resolve({
    authorization_endpoint: 'https://mock.replit.com/auth',
    token_endpoint: 'https://mock.replit.com/token',
    userinfo_endpoint: 'https://mock.replit.com/userinfo'
  })),
  setupAuth: jest.fn((app: any) => Promise.resolve()),
  // Mock isAuthenticated middleware for tests
  isAuthenticated: (req: any, res: any, next: any) => {
    if (req.user) {
      next();
    } else {
      res.status(401).json({ message: 'Unauthorized' });
    }
  }
}));

// Create stub email service for dependency injection
const stubEmailService = {
  async sendPasswordResetEmail(_email: string, _token: string) {
    return Promise.resolve();
  },
  async sendVerificationEmail(_email: string, _code: string) {
    return Promise.resolve();
  }
};

import request from 'supertest';
import { Express } from 'express';
import { randomUUID } from 'crypto';
import { createApp } from '../createApp';
import { storage } from '../storage';
import { TestStateManager, generateTestEmail } from './testUtils';
import { setTestStateManager, userFactory } from './testFactories';

describe('Critical Path: REAL HTTP Handler Tests', () => {
  let app: Express;
  let stateManager: TestStateManager;

  beforeAll(async () => {
    // Create app with test auth bypass and stub email service
    app = await createApp({ 
      enableTestAuthBypass: true,
      dependencies: {
        emailService: stubEmailService
      }
    });
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
      const testEmail = generateTestEmail('http-real');
      const testUser = {
        sub: randomUUID(),
        email: testEmail,
        name: 'Test User',
        given_name: 'Test',
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
          firstName: 'Test',
          lastName: 'User',
          role: 'student'
        }
      });

      // Verify user was created in database
      const dbUser = await storage.getUserByEmail(testEmail);
      expect(dbUser).toBeTruthy();

      if (dbUser) {
        stateManager.registerUser(dbUser.id);
      }
    });
  });

  describe('HTTP POST /api/v2/auth/verify-email - Email Verification', () => {
    it('should return 200 with valid 6-digit code via testAuthBypass', async () => {
      // Create user
      const testUser = await userFactory({
        email: generateTestEmail('verify-http'),
        firstName: 'Verify',
        lastName: 'HTTP'
      });

      // Create verification token
      const code = '123456';
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      
      await storage.createEmailVerificationToken({
        userId: testUser.id,
        code,
        expiresAt
      });

      // Use test auth bypass to simulate authenticated request
      const response = await request(app)
        .post('/api/v2/auth/verify-email')
        .set('x-test-user', JSON.stringify({ 
          id: testUser.id, 
          email: testUser.email,
          firstName: testUser.firstName,
          lastName: testUser.lastName
        }))
        .send({ code })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toBe('Email verified successfully');

      // Verify database state changed
      const user = await storage.getUser(testUser.id);
      expect(user?.isEmailVerified).toBe(true);
    });

    it('should return 400 with invalid code format', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('verify-invalid'),
        firstName: 'Invalid',
        lastName: 'Code'
      });

      const response = await request(app)
        .post('/api/v2/auth/verify-email')
        .set('x-test-user', JSON.stringify({ 
          id: testUser.id, 
          email: testUser.email 
        }))
        .send({ code: '123' }) // Too short
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body.message).toBe('Invalid verification code');
    });

    it('should return 401 when not authenticated', async () => {
      await request(app)
        .post('/api/v2/auth/verify-email')
        .send({ code: '123456' })
        .expect(401);
    });
  });

  describe('HTTP POST /api/v2/auth/request-password-reset', () => {
    it('should return 200 for existing user (no user enumeration)', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('reset-http'),
        firstName: 'Reset',
        lastName: 'HTTP'
      });

      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({ email: testUser.email })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toContain('If an account exists');
    });

    it('should return 200 for non-existent user (prevents enumeration)', async () => {
      const response = await request(app)
        .post('/api/v2/auth/request-password-reset')
        .send({ email: 'nonexistent@test.example.com' })
        .expect('Content-Type', /json/)
        .expect(200);

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

  describe('HTTP GET /api/v2/student - Protected Route', () => {
    it('should return 200 for authenticated student via testAuthBypass', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('student-http'),
        firstName: 'Student',
        lastName: 'HTTP'
      });

      const response = await request(app)
        .get('/api/v2/student')
        .set('x-test-user', JSON.stringify({ 
          id: testUser.id, 
          email: testUser.email,
          name: `${testUser.firstName} ${testUser.lastName}`
        }))
        .set('x-test-roles', 'student')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toBe('Student dashboard data');
      expect(response.body.user).toBeTruthy();
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .get('/api/v2/student')
        .expect(401);
    });
  });

  describe('HTTP GET /api/v2/admin - RBAC Protection', () => {
    it('should return 200 for admin user', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('admin-http'),
        firstName: 'Admin',
        lastName: 'HTTP'
      });

      // Update role to admin
      const user = await storage.getUser(testUser.id);
      if (user) {
        await storage.upsertUser({ ...user, role: 'admin' });
      }

      const response = await request(app)
        .get('/api/v2/admin')
        .set('x-test-user', JSON.stringify({ 
          id: testUser.id, 
          email: testUser.email,
          name: `${testUser.firstName} ${testUser.lastName}`
        }))
        .set('x-test-roles', 'admin')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toBe('Admin dashboard data');
    });

    it('should return 403 for student user', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('student-denied-http'),
        firstName: 'Student',
        lastName: 'Denied'
      });

      const response = await request(app)
        .get('/api/v2/admin')
        .set('x-test-user', JSON.stringify({ 
          id: testUser.id, 
          email: testUser.email,
          name: `${testUser.firstName} ${testUser.lastName}`
        }))
        .set('x-test-roles', 'student')
        .expect('Content-Type', /json/)
        .expect(403);

      expect(response.body.message).toBe('Admin access required');
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .get('/api/v2/admin')
        .expect(401);
    });
  });

  describe('HTTP GET /api/v2/reviewer - RBAC Protection', () => {
    it('should return 200 for reviewer user', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('reviewer-http'),
        firstName: 'Reviewer',
        lastName: 'HTTP'
      });

      // Update role to reviewer
      const user = await storage.getUser(testUser.id);
      if (user) {
        await storage.upsertUser({ ...user, role: 'reviewer' });
      }

      const response = await request(app)
        .get('/api/v2/reviewer')
        .set('x-test-user', JSON.stringify({ 
          id: testUser.id, 
          email: testUser.email,
          name: `${testUser.firstName} ${testUser.lastName}`
        }))
        .set('x-test-roles', 'reviewer')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.message).toBe('Reviewer dashboard data');
    });

    it('should return 403 for student user', async () => {
      const testUser = await userFactory({
        email: generateTestEmail('student-reviewer-denied'),
        firstName: 'Student',
        lastName: 'ReviewerDenied'
      });

      const response = await request(app)
        .get('/api/v2/reviewer')
        .set('x-test-user', JSON.stringify({ 
          id: testUser.id, 
          email: testUser.email,
          name: `${testUser.firstName} ${testUser.lastName}`
        }))
        .set('x-test-roles', 'student')
        .expect('Content-Type', /json/)
        .expect(403);

      expect(response.body.message).toBe('Reviewer access required');
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app)
        .get('/api/v2/reviewer')
        .expect(401);
    });
  });
});
