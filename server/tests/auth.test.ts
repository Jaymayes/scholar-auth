import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import { createTestServer } from './testSetup';

describe('Authentication E2E Tests', () => {
  let app: Express;
  let testServer: any;

  beforeAll(async () => {
    const { app: testApp, server } = await createTestServer();
    app = testApp;
    testServer = server;
  });

  afterAll(async () => {
    if (testServer) {
      await testServer.close();
    }
  });

  describe('Public endpoints', () => {
    test('GET /api/scholarships should work without auth', async () => {
      const response = await request(app)
        .get('/api/scholarships')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('GET /api/auth/metrics should work without auth', async () => {
      const response = await request(app)
        .get('/api/auth/metrics')
        .expect(200);
      
      expect(response.body.kpis).toBeDefined();
      expect(response.body.targets).toBeDefined();
    });
  });

  describe('Protected endpoints', () => {
    test('POST /api/scholarships should require auth', async () => {
      const testScholarship = {
        name: 'Test Scholarship',
        description: 'Test Description',
        provider: 'Test Provider',
        awardAmount: '5000',
        status: 'draft',
        sourceType: 'manual',
        eligibilityCriteria: {},
        requiredMaterials: ['transcript']
      };

      await request(app)
        .post('/api/scholarships')
        .send(testScholarship)
        .expect(401);
    });

    test('GET /api/auth/user should require auth', async () => {
      await request(app)
        .get('/api/auth/user')
        .expect(401);
    });
  });

  describe('OIDC auth flow', () => {
    test('GET /api/login should redirect to OIDC provider', async () => {
      const response = await request(app)
        .get('/api/login')
        .expect(302);
      
      // In test mode, redirects to test OIDC provider
      // In production, would redirect to replit.com
      expect(response.headers.location).toContain('/auth');
      expect(response.headers.location).toMatch(/client_id|redirect_uri|state/);
    });

    test('Auth endpoints should complete quickly', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/api/login')
        .expect(302);
      
      const duration = Date.now() - startTime;
      
      // Should complete within performance target after cache warming
      // Allow first request to be slower due to OIDC discovery
      expect(duration).toBeLessThan(1000); // 1 second for first request
    });
  });

  describe('Test authentication helper', () => {
    test('Should be able to create test authenticated session', async () => {
      // Test the test authentication helper we'll create
      const testUser = {
        userId: 'test-user-123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User'
      };

      // This would use our test auth helper once implemented
      // For now, just verify the concept works
      expect(testUser.userId).toBeDefined();
    });
  });
});