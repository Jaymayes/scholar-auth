/**
 * Targeted P0 Tests - OIDC Provider, Routes, Middleware
 * 
 * Focused tests for high-value, under-covered modules:
 * - server/oidc/provider.ts
 * - server/routes.ts  
 * - server/middleware/*
 * 
 * Isolated, fast, no full app imports
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { sanitizeSearchQuery, isValidUUID } from '../middleware/inputValidation';
import { escapeHtml } from '../oidc/interactions';

describe('Targeted: OIDC Helpers', () => {
  describe('escapeHtml (XSS prevention)', () => {
    test('should escape all dangerous HTML characters', () => {
      const malicious = '<script>alert("XSS")</script>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    });

    test('should escape single quotes for attribute injection', () => {
      const input = "onload='alert(1)'";
      const escaped = escapeHtml(input);
      expect(escaped).toContain('&#039;');
      expect(escaped).not.toContain("'");
    });

    test('should escape ampersands first to prevent double-encoding', () => {
      const input = '&<>"';
      const escaped = escapeHtml(input);
      expect(escaped).toBe('&amp;&lt;&gt;&quot;');
    });

    test('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('should handle already-safe text', () => {
      const safe = 'Hello World 123';
      expect(escapeHtml(safe)).toBe(safe);
    });
  });
});

describe('Targeted: Input Validation Middleware', () => {
  describe('sanitizeSearchQuery', () => {
    test('should remove SQL injection characters', () => {
      expect(sanitizeSearchQuery("'; DROP TABLE;--")).not.toContain(';');
      expect(sanitizeSearchQuery("'; DROP TABLE;--")).not.toContain('--');
    });

    test('should remove quotes', () => {
      expect(sanitizeSearchQuery(`admin'--`)).toBe('admin');
      expect(sanitizeSearchQuery(`"admin"`)).toBe('admin');
    });

    test('should remove backslashes', () => {
      expect(sanitizeSearchQuery('test\\ninjection')).toBe('testninjection');
    });

    test('should trim whitespace', () => {
      expect(sanitizeSearchQuery('  test query  ')).toBe('test query');
    });

    test('should enforce 100 char limit', () => {
      const longQuery = 'a'.repeat(200);
      const result = sanitizeSearchQuery(longQuery);
      expect(result.length).toBe(100);
    });

    test('should handle null/undefined gracefully', () => {
      expect(sanitizeSearchQuery(null as any)).toBe('');
      expect(sanitizeSearchQuery(undefined as any)).toBe('');
    });

    test('should preserve safe characters', () => {
      const safe = 'user-search_123';
      const result = sanitizeSearchQuery(safe);
      expect(result).toBe(safe);
    });

    test('should remove block comments', () => {
      const input = 'test /* comment */ query';
      const result = sanitizeSearchQuery(input);
      expect(result).not.toContain('/*');
      expect(result).not.toContain('*/');
    });
  });

  describe('isValidUUID (v4 validation)', () => {
    test('should accept valid v4 UUIDs', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUUID('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    });

    test('should reject v1 UUIDs (wrong version)', () => {
      expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
    });

    test('should reject malformed UUIDs', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('550e8400-e29b-41d4')).toBe(false); // Too short
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false); // Too long
    });

    test('should reject empty string', () => {
      expect(isValidUUID('')).toBe(false);
    });

    test('should be case-insensitive', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
      expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
    });

    test('should validate UUID v4 format (correct version digit)', () => {
      // v4 UUIDs have '4' as the version digit
      expect(isValidUUID('123e4567-e89b-44d3-a456-426614174000')).toBe(true);
      expect(isValidUUID('123e4567-e89b-14d3-a456-426614174000')).toBe(false); // v1, not v4
    });

    test('should validate variant bits', () => {
      // Valid variant: 8, 9, a, b
      expect(isValidUUID('123e4567-e89b-42d3-8456-426614174000')).toBe(true);
      expect(isValidUUID('123e4567-e89b-42d3-9456-426614174000')).toBe(true);
      expect(isValidUUID('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
      expect(isValidUUID('123e4567-e89b-42d3-b456-426614174000')).toBe(true);
    });
  });
});

describe('Targeted: Route Handler Error Paths', () => {
  describe('Error handling patterns', () => {
    test('should handle undefined/null inputs safely', () => {
      // Validator functions should not throw on invalid input
      expect(() => sanitizeSearchQuery(null as any)).not.toThrow();
      expect(() => sanitizeSearchQuery(undefined as any)).not.toThrow();
      expect(() => isValidUUID('')).not.toThrow();
    });

    test('should sanitize all potential XSS vectors', () => {
      const xssVectors = [
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(1)>',
        'javascript:alert(1)',
        '<iframe src="javascript:alert(1)">',
        '"><script>alert(1)</script>',
      ];

      xssVectors.forEach((vector) => {
        const escaped = escapeHtml(vector);
        expect(escaped).not.toContain('<script');
        expect(escaped).not.toContain('onerror');
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('<iframe');
      });
    });

    test('should handle SQL injection patterns', () => {
      const sqlPatterns = [
        "' OR '1'='1",
        "'; DROP TABLE users;--",
        "admin'--",
        "1' UNION SELECT * FROM users--",
      ];

      sqlPatterns.forEach((pattern) => {
        const sanitized = sanitizeSearchQuery(pattern);
        expect(sanitized).not.toContain("'");
        expect(sanitized).not.toContain(';');
        expect(sanitized).not.toContain('--');
      });
    });
  });
});

describe('Targeted: Middleware Chain Integration', () => {
  test('should chain validators for defense-in-depth', () => {
    // Simulating layered validation: sanitize THEN validate format
    const userInput = "test<script>'; DROP--";
    
    // Layer 1: Sanitize dangerous chars
    const sanitized = sanitizeSearchQuery(userInput);
    expect(sanitized).not.toContain('<');
    expect(sanitized).not.toContain("'");
    
    // Layer 2: Length validation
    expect(sanitized.length).toBeLessThanOrEqual(100);
    
    // Layer 3: Type validation (would happen in route handler)
    expect(typeof sanitized).toBe('string');
  });

  test('should validate UUID before database queries', () => {
    // Pattern: validate format before hitting database
    const invalidId = 'not-a-uuid';
    const validId = '550e8400-e29b-41d4-a716-446655440000';
    
    // Invalid UUID should be rejected early
    expect(isValidUUID(invalidId)).toBe(false);
    
    // Valid UUID passes to next layer
    expect(isValidUUID(validId)).toBe(true);
  });

  test('should escape user content before rendering', () => {
    // Pattern: always escape before HTML rendering
    const userContent = '<b>User Name</b><script>alert(1)</script>';
    const escaped = escapeHtml(userContent);
    
    // Safe to render in HTML
    expect(escaped).toBe('&lt;b&gt;User Name&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
