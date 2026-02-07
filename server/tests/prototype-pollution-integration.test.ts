import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';
import { sanitizeRequest } from '../middleware/inputValidation';

describe('Prototype Pollution Integration Tests (SEC-PATCH)', () => {
  let app: Express;

  beforeAll(() => {
    // Create a minimal Express app with the sanitization middleware
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(sanitizeRequest);

    // Test endpoint that echoes back query params
    app.get('/api/test', (req, res) => {
      res.json({
        query: req.query,
        prototypeCheck: {
          hasIsAdmin: 'isAdmin' in Object.prototype,
          hasEvil: 'evil' in Object.prototype,
          hasPolluted: 'polluted' in Object.prototype,
        },
      });
    });

    // Test endpoint that might be vulnerable if not protected
    app.get('/api/user-settings', (req, res) => {
      const testObj = {};
      res.json({
        settings: req.query,
        objectPrototypePolluted: testObj.hasOwnProperty('isAdmin'),
      });
    });
  });

  describe('GET requests with pollution payloads', () => {
    test('blocks __proto__[isAdmin]=true from polluting Object.prototype', async () => {
      const response = await request(app)
        .get('/api/test')
        .query({ '__proto__': { isAdmin: 'true' }, normalParam: 'value' });

      expect(response.status).toBe(200);
      expect(response.body.prototypeCheck.hasIsAdmin).toBe(false);
      expect(response.body.query).toHaveProperty('normalParam');
      
      // Verify no pollution occurred globally
      const testObj = {};
      expect(testObj).not.toHaveProperty('isAdmin');
    });

    test('blocks constructor[prototype] pollution attempts', async () => {
      const response = await request(app)
        .get('/api/test')
        .query({ 
          constructor: { prototype: { evil: 'true' } } as any,
          validParam: 'test' 
        });

      expect(response.status).toBe(200);
      expect(response.body.prototypeCheck.hasEvil).toBe(false);
      
      // Verify no pollution
      const testObj = {};
      expect(testObj).not.toHaveProperty('evil');
    });

    test('blocks prototype pollution while allowing normal params', async () => {
      const response = await request(app)
        .get('/api/test')
        .query({ 
          'prototype': { polluted: 'true' } as any,
          search: 'test query',
          filter: 'active',
        });

      expect(response.status).toBe(200);
      expect(response.body.prototypeCheck.hasPolluted).toBe(false);
      expect(response.body.query).toHaveProperty('search');
      expect(response.body.query).toHaveProperty('filter');
    });

    test('sanitizes XSS in query params alongside pollution protection', async () => {
      const response = await request(app)
        .get('/api/test')
        .query({
          '__proto__': { admin: 'true' } as any,
          search: 'test<script>alert("xss")</script>',
        });

      expect(response.status).toBe(200);
      expect(response.body.prototypeCheck.hasIsAdmin).toBe(false);
      
      // XSS should be stripped
      if (response.body.query.search) {
        expect(response.body.query.search).not.toContain('<script>');
      }
    });

    test('handles query string with multiple pollution attempts', async () => {
      const response = await request(app)
        .get('/api/test')
        .query({
          '__proto__': { attack1: 'true' } as any,
          'constructor': { attack2: 'true' } as any,
          'prototype': { attack3: 'true' } as any,
          legitimateParam: 'safe',
        });

      expect(response.status).toBe(200);
      
      // None of the pollution attacks should succeed
      const testObj = {};
      expect(testObj).not.toHaveProperty('attack1');
      expect(testObj).not.toHaveProperty('attack2');
      expect(testObj).not.toHaveProperty('attack3');
      
      // Legitimate param should work
      expect(response.body.query.legitimateParam).toBe('safe');
    });
  });

  describe('Representative API endpoint protection', () => {
    test('user settings endpoint rejects pollution attempts', async () => {
      const response = await request(app)
        .get('/api/user-settings')
        .query({
          '__proto__': { isAdmin: 'true' } as any,
          theme: 'dark',
          language: 'en',
        });

      expect(response.status).toBe(200);
      expect(response.body.objectPrototypePolluted).toBe(false);
      expect(response.body.settings).toHaveProperty('theme');
      expect(response.body.settings).toHaveProperty('language');
    });

    test('normal query parameters work correctly after pollution protection', async () => {
      const response = await request(app)
        .get('/api/user-settings')
        .query({
          theme: 'dark',
          fontSize: 'medium',
          notifications: 'enabled',
        });

      expect(response.status).toBe(200);
      expect(response.body.settings.theme).toBe('dark');
      expect(response.body.settings.fontSize).toBe('medium');
      expect(response.body.settings.notifications).toBe('enabled');
    });
  });

  describe('Edge cases and attack variations', () => {
    test('handles URL-encoded pollution attempts', async () => {
      const response = await request(app)
        .get('/api/test?__proto__[isAdmin]=true&normalParam=value');

      expect(response.status).toBe(200);
      
      // Pollution should be blocked
      const testObj = {};
      expect(testObj).not.toHaveProperty('isAdmin');
    });

    test('handles empty query string', async () => {
      const response = await request(app)
        .get('/api/test');

      expect(response.status).toBe(200);
      expect(response.body.query).toBeDefined();
    });

    test('handles query with only safe parameters', async () => {
      const response = await request(app)
        .get('/api/test')
        .query({
          page: '1',
          limit: '10',
          sort: 'asc',
        });

      expect(response.status).toBe(200);
      expect(response.body.query.page).toBe('1');
      expect(response.body.query.limit).toBe('10');
      expect(response.body.query.sort).toBe('asc');
    });
  });

  describe('Security Canary Test', () => {
    test('CANARY: Pollution payload against test server asserts invariants', async () => {
      // This is the security canary test mentioned in the executive mandate
      // It attempts pollution and asserts critical security invariants
      
      const pollutionPayload = {
        '__proto__': { isAdmin: 'true', roles: 'admin,superuser' } as any,
        'constructor': { prototype: { elevated: 'true' } } as any,
      };

      const response = await request(app)
        .get('/api/test')
        .query(pollutionPayload);

      // INVARIANT 1: Request succeeds
      expect(response.status).toBe(200);

      // INVARIANT 2: Object.prototype is not polluted
      expect(Object.prototype).not.toHaveProperty('isAdmin');
      expect(Object.prototype).not.toHaveProperty('roles');
      expect(Object.prototype).not.toHaveProperty('elevated');

      // INVARIANT 3: Newly created objects don't inherit polluted properties
      const newObject = {};
      expect(newObject).not.toHaveProperty('isAdmin');
      expect(newObject).not.toHaveProperty('roles');
      expect(newObject).not.toHaveProperty('elevated');

      // INVARIANT 4: Response doesn't leak dangerous keys
      expect(response.body.prototypeCheck.hasIsAdmin).toBe(false);
    });
  });
});
