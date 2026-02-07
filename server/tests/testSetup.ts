import express, { Express } from 'express';
import { Server } from 'http';
import { setupAuth } from '../replitAuth';
import { registerRoutes } from '../routes';
import { authMetrics } from '../monitoring/authMetrics';
import { applyFallbackCORS } from '../fallback-cors';
import { storage } from '../storage';

// Mock OIDC config for testing to avoid external calls
const mockOidcConfig = {
  issuer: 'http://localhost:5000/test-oidc',
  authorization_endpoint: 'http://localhost:5000/test-oidc/auth',
  token_endpoint: 'http://localhost:5000/test-oidc/token',
  userinfo_endpoint: 'http://localhost:5000/test-oidc/userinfo',
  jwks_uri: 'http://localhost:5000/test-oidc/.well-known/jwks.json',
  end_session_endpoint: 'http://localhost:5000/test-oidc/logout'
};

export interface TestContext {
  app: Express;
  server: Server;
  authenticateUser: (userId: string, userData?: any) => Promise<string>;
  cleanup: () => Promise<void>;
}

export async function createTestServer(): Promise<TestContext> {
  const app = express();
  
  // Apply same middleware as production
  app.use(express.json());
  applyFallbackCORS(app);
  
  // Mock OIDC provider for testing
  app.get('/test-oidc/.well-known/openid_configuration', (req, res) => {
    res.json(mockOidcConfig);
  });
  
  // Mock JWKS endpoint
  app.get('/test-oidc/.well-known/jwks.json', (req, res) => {
    res.json({
      keys: [{
        kty: 'RSA',
        use: 'sig',
        kid: 'test-key',
        n: 'test-modulus',
        e: 'AQAB'
      }]
    });
  });
  
  // Mock auth endpoints for testing
  app.get('/test-oidc/auth', (req, res) => {
    // In test mode, simulate immediate redirect back to callback
    const callbackUrl = req.query.redirect_uri as string;
    const state = req.query.state as string;
    res.redirect(`${callbackUrl}?code=test-auth-code&state=${state}`);
  });
  
  app.post('/test-oidc/token', (req, res) => {
    res.json({
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: 'test-id-token'
    });
  });
  
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.REPL_ID = 'test-repl-id';
  
  // Mock the OIDC discovery to use our test endpoints
  const originalOidcUrl = process.env.AUTH_ISSUER_URL;
  process.env.AUTH_ISSUER_URL = 'http://localhost:5000/test-oidc';
  
  try {
    // Register ALL routes from routes.ts (includes /api/test/login and all production routes)
    await registerRoutes(app);
  } catch (error) {
    console.warn('Routes registration failed in test mode:', error);
  }
  
  // Start test server
  const server = app.listen(0); // Random port
  
  // Helper function to authenticate a user for testing
  const authenticateUser = async (userId: string, userData: any = {}) => {
    const user = {
      userId,
      email: userData.email || `${userId}@test.com`,
      firstName: userData.firstName || 'Test',
      lastName: userData.lastName || 'User',
      ...userData
    };
    
    // Create a test session cookie
    // This would normally be done through the OIDC flow
    return `test-session-${userId}`;
  };
  
  const cleanup = async () => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        // Restore original environment
        if (originalOidcUrl) {
          process.env.AUTH_ISSUER_URL = originalOidcUrl;
        } else {
          delete process.env.AUTH_ISSUER_URL;
        }
        resolve();
      });
    });
  };
  
  return {
    app,
    server,
    authenticateUser,
    cleanup
  };
}

// Helper to create authenticated test requests
export function createAuthenticatedRequest(request: any, sessionCookie: string) {
  return request.set('Cookie', [`connect.sid=${sessionCookie}`]);
}

// Mock user data for testing
export const testUsers = {
  student: {
    userId: 'test-student-123',
    email: 'student@test.com',
    firstName: 'Test',
    lastName: 'Student',
    role: 'student'
  },
  admin: {
    userId: 'test-admin-456',
    email: 'admin@test.com',
    firstName: 'Test',
    lastName: 'Admin',
    role: 'admin'
  },
  reviewer: {
    userId: 'test-reviewer-789',
    email: 'reviewer@test.com',
    firstName: 'Test',
    lastName: 'Reviewer',
    role: 'reviewer'
  }
};