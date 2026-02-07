/**
 * Critical Path: HTTP/E2E Tests - RBAC & Middleware Protection
 * 
 * Tests role-based access control and middleware protection:
 * 1. Admin-only routes (403 for non-admin)
 * 2. Reviewer routes (403 for students)
 * 3. Student routes (accessible to all authenticated users)
 * 4. Unauthenticated access (401 for all protected routes)
 * 
 * These tests protect against authorization bypass bugs.
 */

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { randomUUID } from 'crypto';
import { storage } from '../storage';
import { TestStateManager, generateTestEmail } from './testUtils';
import { setTestStateManager, userFactory } from './testFactories';

describe('Critical Path: HTTP RBAC & Middleware Protection', () => {
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

  describe('Admin Route Protection', () => {
    it('should allow admin access to /api/v2/admin', async () => {
      const adminAgent = request.agent(app);
      
      // Create admin user via test login
      const testAdmin = {
        sub: randomUUID(),
        email: generateTestEmail('admin'),
        name: 'Admin User',
        given_name: 'Admin',
        family_name: 'User'
      };

      await adminAgent
        .post('/api/test/login')
        .send(testAdmin)
        .expect(200);

      // Update user role to admin
      const user = await storage.getUserByEmail(testAdmin.email);
      if (user) {
        await storage.upsertUser({ ...user, role: 'admin' });
        stateManager.registerUser(user.id);
      }

      const response = await adminAgent
        .get('/api/v2/admin')
        .expect(200);

      expect(response.body.message).toBe('Admin dashboard data');
    });

    it('should deny student access to /api/v2/admin', async () => {
      const studentAgent = request.agent(app);
      
      const testStudent = {
        sub: randomUUID(),
        email: generateTestEmail('student-denied'),
        name: 'Student User',
        given_name: 'Student',
        family_name: 'User'
      };

      await studentAgent
        .post('/api/test/login')
        .send(testStudent)
        .expect(200);

      const user = await storage.getUserByEmail(testStudent.email);
      if (user) {
        stateManager.registerUser(user.id);
      }

      const response = await studentAgent
        .get('/api/v2/admin')
        .expect(403);

      expect(response.body.message).toBe('Admin access required');
    });
  });

  describe('Reviewer Route Protection', () => {
    it('should allow reviewer access to /api/v2/reviewer', async () => {
      const reviewerAgent = request.agent(app);
      
      const testReviewer = {
        sub: randomUUID(),
        email: generateTestEmail('reviewer'),
        name: 'Reviewer User',
        given_name: 'Reviewer',
        family_name: 'User'
      };

      await reviewerAgent
        .post('/api/test/login')
        .send(testReviewer)
        .expect(200);

      const user = await storage.getUserByEmail(testReviewer.email);
      if (user) {
        await storage.upsertUser({ ...user, role: 'reviewer' });
        stateManager.registerUser(user.id);
      }

      const response = await reviewerAgent
        .get('/api/v2/reviewer')
        .expect(200);

      expect(response.body.message).toBe('Reviewer dashboard data');
    });

    it('should allow admin access to /api/v2/reviewer', async () => {
      const adminAgent = request.agent(app);
      
      const testAdmin = {
        sub: randomUUID(),
        email: generateTestEmail('admin-reviewer'),
        name: 'Admin User',
        given_name: 'Admin',
        family_name: 'User'
      };

      await adminAgent
        .post('/api/test/login')
        .send(testAdmin)
        .expect(200);

      const user = await storage.getUserByEmail(testAdmin.email);
      if (user) {
        await storage.upsertUser({ ...user, role: 'admin' });
        stateManager.registerUser(user.id);
      }

      const response = await adminAgent
        .get('/api/v2/reviewer')
        .expect(200);

      expect(response.body.message).toBe('Reviewer dashboard data');
    });

    it('should deny student access to /api/v2/reviewer', async () => {
      const studentAgent = request.agent(app);
      
      const testStudent = {
        sub: randomUUID(),
        email: generateTestEmail('student-reviewer-denied'),
        name: 'Student User',
        given_name: 'Student',
        family_name: 'User'
      };

      await studentAgent
        .post('/api/test/login')
        .send(testStudent)
        .expect(200);

      const user = await storage.getUserByEmail(testStudent.email);
      if (user) {
        stateManager.registerUser(user.id);
      }

      const response = await studentAgent
        .get('/api/v2/reviewer')
        .expect(403);

      expect(response.body.message).toBe('Reviewer access required');
    });
  });

  describe('Student Route Protection', () => {
    it('should allow any authenticated user access to /api/v2/student', async () => {
      const studentAgent = request.agent(app);
      
      const testStudent = {
        sub: randomUUID(),
        email: generateTestEmail('student'),
        name: 'Student User',
        given_name: 'Student',
        family_name: 'User'
      };

      await studentAgent
        .post('/api/test/login')
        .send(testStudent)
        .expect(200);

      const user = await storage.getUserByEmail(testStudent.email);
      if (user) {
        stateManager.registerUser(user.id);
      }

      const response = await studentAgent
        .get('/api/v2/student')
        .expect(200);

      expect(response.body.message).toBe('Student dashboard data');
      expect(response.body.user).toBeTruthy();
    });
  });

  describe('Unauthenticated Access', () => {
    it('should deny unauthenticated access to /api/v2/admin', async () => {
      const response = await request(app)
        .get('/api/v2/admin')
        .expect(401);
    });

    it('should deny unauthenticated access to /api/v2/reviewer', async () => {
      const response = await request(app)
        .get('/api/v2/reviewer')
        .expect(401);
    });

    it('should deny unauthenticated access to /api/v2/student', async () => {
      const response = await request(app)
        .get('/api/v2/student')
        .expect(401);
    });
  });
});
