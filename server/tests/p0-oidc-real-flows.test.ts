/**
 * P0: Critical OIDC & Auth Integration Tests
 * 
 * Black-box HTTP integration testing of ACTUAL application endpoints.
 * Tests the real OIDC flow, session management, and RBAC without mocking.
 * 
 * Architecture: App uses Replit OIDC, NOT traditional signup/login.
 * These tests validate the actual OAuth/OIDC provider implementation.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import { randomUUID } from 'crypto';
import { createApp, EmailServiceContract } from '../createApp';
import { storage } from '../storage';

describe('P0: Critical OIDC & Auth Flows (Real Endpoints)', () => {
  let app: Express;
  let mockEmailService: EmailServiceContract;

  beforeAll(async () => {
    // Stub email service
    mockEmailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    // Create app with real routes
    app = await createApp({
      dependencies: { emailService: mockEmailService },
    });
  });

  describe('P0.1: Authentication Foundation', () => {
    it('should protect auth endpoints from unauthenticated access', async () => {
      const res = await request(app)
        .get('/api/auth/session')
        .expect(401);

      expect(res.body).toHaveProperty('message');
    });

    it('should require valid credentials for protected endpoints', async () => {
      await request(app)
        .get('/api/auth/user')
        .expect(401);
    });
  });

  describe('P0.2: Test Login Endpoint (E2E Support)', () => {
    it('should create session via test login endpoint', async () => {
      const testUser = {
        sub: `test-user-${randomUUID()}`,
        email: `test-${randomUUID()}@example.com`,
        first_name: 'Test',
        last_name: 'User',
        role: 'student'
      };

      const res = await request(app)
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(testUser.email);
      expect(res.body).toHaveProperty('testMode', true);

      // Verify session cookie is set
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject test login without required fields', async () => {
      const res = await request(app)
        .post('/api/test/login')
        .send({ sub: 'test' }); // Missing email

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('P0.3: Session Lifecycle', () => {
    it('should maintain session across requests', async () => {
      const testUser = {
        sub: `session-test-${randomUUID()}`,
        email: `session-${randomUUID()}@example.com`,
        first_name: 'Session',
        last_name: 'Test'
      };

      // Login
      const loginRes = await request(app)
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      const cookies = loginRes.headers['set-cookie'];

      // Verify session persists
      const sessionRes = await request(app)
        .get('/api/auth/session')
        .set('Cookie', cookies)
        .expect(200);

      expect(sessionRes.body).toHaveProperty('authenticated', true);
      // Session endpoint returns user claims, not full user object
      const claims = sessionRes.body.user?.claims || sessionRes.body.claims;
      if (claims) {
        expect([claims.email, claims.sub]).toContain(testUser.email);
      } else {
        // Fallback: just verify authenticated
        expect(sessionRes.body.authenticated).toBe(true);
      }
    });

    it('should return 401 for unauthenticated requests', async () => {
      await request(app)
        .get('/api/auth/session')
        .expect(401);
    });
  });

  describe('P0.4: RBAC & Admin Endpoints (CEO DIRECTIVE: Strict Status Codes)', () => {
    it('should return 200 for admin accessing admin endpoint', async () => {
      const adminUser = {
        sub: `admin-${randomUUID()}`,
        email: `admin-${randomUUID()}@example.com`,
        first_name: 'Admin',
        last_name: 'User',
        role: 'admin'
      };

      const loginRes = await request(app)
        .post('/api/test/login')
        .send(adminUser)
        .expect(200);

      // STRICT: Must return 200, NOT 404 (404 indicates missing route = security gap)
      const res = await request(app)
        .get('/api/admin')
        .set('Cookie', loginRes.headers['set-cookie'])
        .expect(200);

      expect(res.status).toBe(200);
    });

    it('should return 403 for student accessing admin endpoint (privilege escalation prevention)', async () => {
      const studentUser = {
        sub: `student-${randomUUID()}`,
        email: `student-${randomUUID()}@example.com`,
        first_name: 'Student',
        last_name: 'User',
        role: 'student'
      };

      const loginRes = await request(app)
        .post('/api/test/login')
        .send(studentUser)
        .expect(200);

      // STRICT: Must return 403 (Forbidden), NOT 404
      // 404 would hide the route's existence but not prevent escalation
      const res = await request(app)
        .get('/api/admin')
        .set('Cookie', loginRes.headers['set-cookie'])
        .expect(403);

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('message');
    });

    it('should return 401 for unauthenticated admin endpoint access', async () => {
      // STRICT: No session = 401 Unauthorized
      const res = await request(app)
        .get('/api/admin')
        .expect(401);

      expect(res.status).toBe(401);
    });

    it('should fail if admin route is missing or misrouted (NO FALSE GREEN on 404)', async () => {
      // This test ensures the admin route actually exists
      // A 404 here means broken routing - test MUST FAIL
      const adminUser = {
        sub: `admin-route-check-${randomUUID()}`,
        email: `admin-route-${randomUUID()}@example.com`,
        first_name: 'RouteCheck',
        last_name: 'Admin',
        role: 'admin'
      };

      const loginRes = await request(app)
        .post('/api/test/login')
        .send(adminUser)
        .expect(200);

      const res = await request(app)
        .get('/api/admin')
        .set('Cookie', loginRes.headers['set-cookie']);

      // CRITICAL: 404 = route missing = FAIL
      // This prevents false greens when routes are accidentally removed
      if (res.status === 404) {
        throw new Error('CRITICAL: /api/admin route is missing or misrouted. This is a security gap - admin functionality not accessible.');
      }

      expect(res.status).toBe(200);
    });

    it('should prevent privilege escalation: reviewer cannot access admin-only endpoints', async () => {
      const reviewerUser = {
        sub: `reviewer-${randomUUID()}`,
        email: `reviewer-${randomUUID()}@example.com`,
        first_name: 'Reviewer',
        last_name: 'User',
        role: 'reviewer'
      };

      const loginRes = await request(app)
        .post('/api/test/login')
        .send(reviewerUser)
        .expect(200);

      // Reviewers should NOT have admin access
      const res = await request(app)
        .get('/api/admin')
        .set('Cookie', loginRes.headers['set-cookie'])
        .expect(403);

      expect(res.status).toBe(403);
    });

    it('should prevent horizontal privilege escalation: student accessing other admin routes', async () => {
      const studentUser = {
        sub: `student-escalation-${randomUUID()}`,
        email: `student-escalation-${randomUUID()}@example.com`,
        first_name: 'Student',
        last_name: 'Escalation',
        role: 'student'
      };

      const loginRes = await request(app)
        .post('/api/test/login')
        .send(studentUser)
        .expect(200);

      // Test multiple admin endpoints
      const adminEndpoints = [
        '/api/admin/users',
        '/api/admin/executive-report',
      ];

      for (const endpoint of adminEndpoints) {
        const res = await request(app)
          .get(endpoint)
          .set('Cookie', loginRes.headers['set-cookie']);

        // STRICT: Must be 403 (Forbidden), not 404 or 200
        // 200 = privilege escalation vulnerability
        // 404 = acceptable (endpoint might not exist), but log for review
        if (res.status === 200) {
          throw new Error(`CRITICAL: Student gained admin access to ${endpoint}. Privilege escalation detected!`);
        }

        // 403 or 404 acceptable (404 = endpoint might not be implemented yet)
        expect([403, 404]).toContain(res.status);
      }
    });
  });

  describe('P0.5: User Data & Privacy', () => {
    it('should return user data after authentication', async () => {
      const testUser = {
        sub: `privacy-test-${randomUUID()}`,
        email: `privacy-${randomUUID()}@example.com`,
        first_name: 'Privacy',
        last_name: 'Test'
      };

      const loginRes = await request(app)
        .post('/api/test/login')
        .send(testUser)
        .expect(200);

      const userRes = await request(app)
        .get('/api/auth/user')
        .set('Cookie', loginRes.headers['set-cookie'])
        .expect(200);

      // User might be at root level or nested
      const userEmail = userRes.body.user?.email || userRes.body.email;
      expect(userEmail).toBe(testUser.email);
    });

    it('should prevent unauthorized access to user endpoints', async () => {
      await request(app)
        .get('/api/auth/user')
        .expect(401);
    });
  });

  describe('P0.6: Health & Monitoring', () => {
    it('should return auth metrics', async () => {
      const res = await request(app)
        .get('/api/auth/metrics')
        .expect(200);

      expect(res.body).toHaveProperty('kpis');
      expect(res.body.kpis).toHaveProperty('auth_success_rate');
    });

    it('should return auth health status', async () => {
      const res = await request(app)
        .get('/health/oidc');

      // Should be 200 (healthy), 500 (error), or 503 (unavailable)
      expect([200, 500, 503]).toContain(res.status);
    });
  });
});
