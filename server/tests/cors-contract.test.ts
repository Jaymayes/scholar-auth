// CORS Contract Tests - Hardening Requirements
// Tests must pass before deploy to ensure proper CORS behavior

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';
import { applyFallbackCORS } from '../fallback-cors';

describe('CORS Contract Tests - P0 Hardening', () => {
  let app: Express;
  let server: any;

  beforeAll(() => {
    app = express();
    applyFallbackCORS(app);
    
    // Add a test API endpoint
    app.get('/api/test', (req, res) => {
      res.json({ message: 'test endpoint' });
    });
    
    server = app.listen(0); // Use random port for testing
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
  });

  describe('Allowed Origins (Production)', () => {
    const allowedOrigins = [
      'https://app.scholarshipai.com',
      'https://scholarshipai.com',
      'https://provider-register-jamarrlmayes.replit.app',
      'https://student-pilot-jamarrlmayes.replit.app',
      'https://auto-com-center-jamarrlmayes.replit.app',
      'https://scholar-auth-jamarrlmayes.replit.app'
    ];

    allowedOrigins.forEach(origin => {
      it(`should allow ${origin} with credentials`, async () => {
        const response = await request(app)
          .get('/api/test')
          .set('Origin', origin);
        
        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['vary']).toContain('Origin');
      });

      it(`should handle preflight for ${origin}`, async () => {
        const response = await request(app)
          .options('/api/test')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET');
        
        expect(response.status).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['access-control-allow-methods']).toContain('GET');
        expect(response.headers['access-control-max-age']).toBeDefined();
      });
    });
  });

  describe('Development Patterns (when NODE_ENV=development)', () => {
    beforeAll(() => {
      process.env.NODE_ENV = 'development';
    });

    const devOrigins = [
      'https://f642cf4b-b3d9-49fe-a544-dfb972fc2d8e.replit.dev',
      'https://test-abc123.spock.replit.dev',
      'https://f642cf4b-b3d9-49fe-a544-dfb972fc2d8e-00-2gen0d18dnyfy.spock.replit.dev',
      'https://my-app-abc123.vercel.app'
    ];

    devOrigins.forEach(origin => {
      it(`should allow dev pattern ${origin} in development`, async () => {
        const response = await request(app)
          .get('/api/test')
          .set('Origin', origin);
        
        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe(origin);
        expect(response.headers['access-control-allow-credentials']).toBe('true');
      });
    });
  });

  describe('Disallowed Origins', () => {
    const disallowedOrigins = [
      'https://evil.com',
      'https://localhost:3000',
      'https://malicious-site.example.com',
      'https://not-allowed.replit.dev', // Wrong subdomain format
      'http://insecure.com' // HTTP not HTTPS
    ];

    disallowedOrigins.forEach(origin => {
      it(`should block ${origin} for API requests`, async () => {
        const response = await request(app)
          .get('/api/test')
          .set('Origin', origin);
        
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CORS_ORIGIN_BLOCKED');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      });

      it(`should block ${origin} preflight requests`, async () => {
        const response = await request(app)
          .options('/api/test')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET');
        
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CORS_ORIGIN_BLOCKED');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      });
    });
  });

  describe('/healthz/cors endpoint', () => {
    it('should report allowed status for valid origins', async () => {
      const response = await request(app)
        .get('/healthz/cors')
        .set('Origin', 'https://app.scholarshipai.com');
      
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.originEcho).toBe('https://app.scholarshipai.com');
      expect(response.body.originAllowed).toBe(true);
      expect(response.body.fallbackActive).toBe(true);
    });

    it('should report blocked status for invalid origins', async () => {
      const response = await request(app)
        .get('/healthz/cors')
        .set('Origin', 'https://evil.com');
      
      expect(response.status).toBe(200);
      expect(response.body.originEcho).toBe('https://evil.com');
      expect(response.body.originAllowed).toBe(false);
    });
  });

  describe('/healthz/cors-policy endpoint (P1 Strict Monitoring)', () => {
    describe('Allowed Origins', () => {
      it('should return 204 for OPTIONS with CORS headers', async () => {
        const response = await request(app)
          .options('/healthz/cors-policy')
          .set('Origin', 'https://app.scholarshipai.com')
          .set('Access-Control-Request-Method', 'GET')
          .set('Access-Control-Request-Headers', 'content-type,authorization');
        
        expect(response.status).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe('https://app.scholarshipai.com');
        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['access-control-allow-methods']).toContain('GET');
        expect(response.headers['access-control-allow-headers']).toContain('content-type');
        expect(response.headers['access-control-max-age']).toBeDefined();
        expect(response.headers['vary']).toContain('Origin');
      });

      it('should return 200 for GET with CORS headers', async () => {
        const response = await request(app)
          .get('/healthz/cors-policy')
          .set('Origin', 'https://app.scholarshipai.com');
        
        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.originAllowed).toBe(true);
        expect(response.headers['access-control-allow-origin']).toBe('https://app.scholarshipai.com');
        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['vary']).toContain('Origin');
      });
    });

    describe('Disallowed Origins', () => {
      it('should return 403 for OPTIONS with no CORS headers', async () => {
        const response = await request(app)
          .options('/healthz/cors-policy')
          .set('Origin', 'https://evil.com')
          .set('Access-Control-Request-Method', 'GET');
        
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CORS_ORIGIN_BLOCKED');
        expect(response.body.message).toBe('Origin not allowed');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      });

      it('should return 403 for GET with no CORS headers', async () => {
        const response = await request(app)
          .get('/healthz/cors-policy')
          .set('Origin', 'https://evil.com');
        
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CORS_ORIGIN_BLOCKED');
        expect(response.body.message).toBe('Origin not allowed for API access');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      });
    });
  });

  describe('CORS Headers Validation', () => {
    it('should include Access-Control-Max-Age for development (600s)', async () => {
      process.env.NODE_ENV = 'development';
      
      const response = await request(app)
        .options('/api/test')
        .set('Origin', 'https://app.scholarshipai.com')
        .set('Access-Control-Request-Method', 'GET');
      
      expect(response.headers['access-control-max-age']).toBe('600');
    });

    it('should include Vary: Origin header', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('Origin', 'https://app.scholarshipai.com');
      
      expect(response.headers['vary']).toContain('Origin');
    });

    it('should never emit wildcards for credentialed requests', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('Origin', 'https://app.scholarshipai.com');
      
      expect(response.headers['access-control-allow-origin']).not.toBe('*');
      expect(response.headers['access-control-allow-origin']).toBe('https://app.scholarshipai.com');
    });
  });
});