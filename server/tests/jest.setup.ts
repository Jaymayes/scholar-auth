// Jest setup file for test environment configuration
import { jest, beforeAll, afterAll, expect } from '@jest/globals';

// Extend test timeout for integration tests
jest.setTimeout(30000);

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.SESSION_SECRET = 'test-session-secret-key-for-testing-only';
process.env.REPL_ID = 'test-repl-id';

// Mock console methods to reduce noise during testing
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  // Suppress specific warning messages during tests
  console.warn = jest.fn((message, ...args) => {
    if (typeof message === 'string' && (
      message.includes('SECURITY WARNING') ||
      message.includes('oidc-provider WARNING') ||
      message.includes('Auth setup failed')
    )) {
      return; // Suppress these warnings in tests
    }
    originalWarn(message, ...args);
  });
  
  console.error = jest.fn((message, ...args) => {
    if (typeof message === 'string' && (
      message.includes('Auth setup failed') ||
      message.includes('OIDC')
    )) {
      return; // Suppress these errors in tests
    }
    originalError(message, ...args);
  });
});

afterAll(() => {
  // Restore original console methods
  console.error = originalError;
  console.warn = originalWarn;
});

// Global test helpers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(min: number, max: number): R;
    }
  }
}

// Custom matcher for performance testing
expect.extend({
  toBeWithinRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${min}-${max}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${min}-${max}`,
        pass: false,
      };
    }
  },
});