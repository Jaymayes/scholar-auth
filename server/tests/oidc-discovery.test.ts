/**
 * OIDC Discovery & JWKS Tests (P0)
 * 
 * Tests RFC 8414 compliant discovery endpoints and JWKS key handling
 * 
 * Coverage targets:
 * - Discovery endpoint metadata validation
 * - JWKS endpoint structure and key fields
 * - PKCE S256 enforcement in discovery
 * - OAuth 2.0 metadata endpoint
 */

// Mock openid-client to prevent ESM import issues
jest.mock('openid-client', () => ({
  Strategy: class MockStrategy {
    authenticate() {}
  },
  generators: {
    state: jest.fn(() => 'mock-state'),
    codeVerifier: jest.fn(() => 'mock-verifier'),
    codeChallenge: jest.fn(() => 'mock-challenge'),
  },
}));

// Mock replitAuth module
jest.mock('../replitAuth', () => ({
  setupAuth: jest.fn().mockResolvedValue(undefined),
  isAuthenticated: jest.fn((req: any, res: any, next: any) => next()),
  getOidcConfig: jest.fn().mockResolvedValue({
    issuerUrl: 'http://localhost:5000',
    clientId: 'test-client',
    clientSecret: 'test-secret'
  })
}));

import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../createApp';

describe('P0: OIDC Discovery & JWKS Endpoints', () => {
  let app: Express;

  beforeAll(async () => {
    // No test bypass needed - these are public endpoints
    app = await createApp({ skipRoutes: false });
  });

  describe('GET /.well-known/openid-configuration', () => {
    it('should return RFC 8414 compliant discovery document', async () => {
      const response = await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200)
        .expect('Content-Type', /json/);

      const discovery = response.body;

      // Required OIDC fields
      expect(discovery.issuer).toBeDefined();
      expect(discovery.authorization_endpoint).toBeDefined();
      expect(discovery.token_endpoint).toBeDefined();
      expect(discovery.jwks_uri).toBeDefined();

      // Verify PKCE S256 enforcement
      expect(discovery.code_challenge_methods_supported).toContain('S256');
      
      // Verify supported grant types
      expect(discovery.grant_types_supported).toContain('authorization_code');
      expect(discovery.grant_types_supported).toContain('refresh_token');

      // Verify supported scopes
      expect(discovery.scopes_supported).toContain('openid');
      expect(discovery.scopes_supported).toContain('email');
      expect(discovery.scopes_supported).toContain('profile');
      expect(discovery.scopes_supported).toContain('roles');

      // Verify response types (authorization code flow only)
      expect(discovery.response_types_supported).toContain('code');
      
      // Verify signing algorithms
      expect(discovery.id_token_signing_alg_values_supported).toContain('RS256');
    });

    it('should include userinfo and logout endpoints', async () => {
      const response = await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200);

      const discovery = response.body;
      
      expect(discovery.userinfo_endpoint).toBeDefined();
      expect(discovery.end_session_endpoint).toBeDefined();
    });

    it('should declare supported claims', async () => {
      const response = await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200);

      const discovery = response.body;
      
      expect(discovery.claims_supported).toContain('sub');
      expect(discovery.claims_supported).toContain('email');
      expect(discovery.claims_supported).toContain('email_verified');
      expect(discovery.claims_supported).toContain('roles');
    });
  });

  describe('GET /.well-known/oauth-authorization-server', () => {
    it('should return OAuth 2.0 metadata document', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200)
        .expect('Content-Type', /json/);

      const metadata = response.body;

      // Required OAuth 2.0 fields
      expect(metadata.issuer).toBeDefined();
      expect(metadata.authorization_endpoint).toBeDefined();
      expect(metadata.token_endpoint).toBeDefined();
      expect(metadata.jwks_uri).toBeDefined();
      
      // Verify PKCE support
      expect(metadata.code_challenge_methods_supported).toContain('S256');
    });

    it('should include token endpoint auth methods', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      const metadata = response.body;
      
      expect(metadata.token_endpoint_auth_methods_supported).toContain('client_secret_post');
      expect(metadata.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
    });
  });

  describe('GET /.well-known/jwks.json', () => {
    it('should return valid JWKS with RSA keys', async () => {
      const response = await request(app)
        .get('/.well-known/jwks.json')
        .expect(200)
        .expect('Content-Type', /json/);

      const jwks = response.body;

      // JWKS structure
      expect(jwks).toHaveProperty('keys');
      expect(Array.isArray(jwks.keys)).toBe(true);
      expect(jwks.keys.length).toBeGreaterThan(0);
    });

    it('should include required RSA key fields', async () => {
      const response = await request(app)
        .get('/.well-known/jwks.json')
        .expect(200);

      const jwks = response.body;
      const firstKey = jwks.keys[0];

      // Required fields for RSA public keys
      expect(firstKey.kty).toBe('RSA');
      expect(firstKey.kid).toBeDefined();
      expect(firstKey.use).toBe('sig');
      expect(firstKey.alg).toBe('RS256');
      expect(firstKey.n).toBeDefined(); // Public modulus
      expect(firstKey.e).toBeDefined(); // Public exponent
    });

    it('should NOT expose private key components', async () => {
      const response = await request(app)
        .get('/.well-known/jwks.json')
        .expect(200);

      const jwks = response.body;
      const firstKey = jwks.keys[0];

      // Private key components should NOT be in public JWKS
      expect(firstKey.d).toBeUndefined(); // Private exponent
      expect(firstKey.p).toBeUndefined();
      expect(firstKey.q).toBeUndefined();
      expect(firstKey.dp).toBeUndefined();
      expect(firstKey.dq).toBeUndefined();
      expect(firstKey.qi).toBeUndefined();
    });
  });

  describe('Security: Invalid algorithm handling', () => {
    it('should only advertise RS256 signing algorithm', async () => {
      const response = await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200);

      const discovery = response.body;
      
      // Should NOT support weak algorithms
      expect(discovery.id_token_signing_alg_values_supported).not.toContain('none');
      expect(discovery.id_token_signing_alg_values_supported).not.toContain('HS256');
      
      // Should ONLY support RS256
      expect(discovery.id_token_signing_alg_values_supported).toEqual(['RS256']);
    });
  });

  describe('Performance: Discovery caching hints', () => {
    it('should return discovery document quickly', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200);
      
      const elapsed = Date.now() - start;
      
      // Discovery should be fast (under 500ms even in test env)
      expect(elapsed).toBeLessThan(500);
    });
  });
});
