import { describe, test, expect } from '@jest/globals';
import {
  sanitizeSearchQuery,
  safeParseInt,
  safeParseFloat,
  isValidUUID,
  querySchemas,
  bodySchemas,
} from '../middleware/inputValidation';

describe('Input Validation Middleware', () => {
  describe('sanitizeSearchQuery', () => {
    test('removes dangerous SQL characters', () => {
      const input = "'; DROP TABLE users;--";
      const result = sanitizeSearchQuery(input);
      expect(result).not.toContain(';');
      expect(result).not.toContain('--');
    });

    test('handles apostrophes safely', () => {
      const input = "O'Brien";
      const result = sanitizeSearchQuery(input);
      expect(result).toBe("OBrien");
    });

    test('removes multiple consecutive spaces', () => {
      const input = "test    search";
      const result = sanitizeSearchQuery(input);
      expect(result.includes('    ')).toBe(false);
    });

    test('trims whitespace', () => {
      const input = "  test  ";
      const result = sanitizeSearchQuery(input);
      expect(result).toBe("test");
    });

    test('handles empty string', () => {
      const result = sanitizeSearchQuery("");
      expect(result).toBe("");
    });

    test('handles null input', () => {
      const result = sanitizeSearchQuery(null as any);
      expect(result).toBe("");
    });

    test('handles undefined input', () => {
      const result = sanitizeSearchQuery(undefined as any);
      expect(result).toBe("");
    });
  });

  describe('safeParseInt', () => {
    test('parses valid integers', () => {
      expect(safeParseInt('42')).toBe(42);
      expect(safeParseInt('0')).toBe(0);
      expect(safeParseInt('-10')).toBe(-10);
    });

    test('returns null for invalid input', () => {
      expect(safeParseInt('abc')).toBeNull();
      expect(safeParseInt('12.5')).toBeNull();
      expect(safeParseInt('')).toBeNull();
    });

    test('respects min bounds', () => {
      expect(safeParseInt('5', 10)).toBeNull();
      expect(safeParseInt('15', 10)).toBe(15);
    });

    test('respects max bounds', () => {
      expect(safeParseInt('150', 0, 100)).toBeNull();
      expect(safeParseInt('50', 0, 100)).toBe(50);
    });

    test('respects both min and max', () => {
      expect(safeParseInt('5', 10, 100)).toBeNull();
      expect(safeParseInt('150', 10, 100)).toBeNull();
      expect(safeParseInt('50', 10, 100)).toBe(50);
    });
  });

  describe('safeParseFloat', () => {
    test('parses valid floats', () => {
      expect(safeParseFloat('42.5')).toBe(42.5);
      expect(safeParseFloat('0.0')).toBe(0);
      expect(safeParseFloat('-10.99')).toBe(-10.99);
    });

    test('returns null for invalid input', () => {
      expect(safeParseFloat('abc')).toBeNull();
      expect(safeParseFloat('')).toBeNull();
    });

    test('respects min bounds', () => {
      expect(safeParseFloat('5.5', 10.0)).toBeNull();
      expect(safeParseFloat('15.5', 10.0)).toBe(15.5);
    });

    test('respects max bounds', () => {
      expect(safeParseFloat('150.5', 0, 100.0)).toBeNull();
      expect(safeParseFloat('50.5', 0, 100.0)).toBe(50.5);
    });

    test('handles precision correctly', () => {
      const result = safeParseFloat('3.14159');
      expect(result).toBeCloseTo(3.14159, 5);
    });
  });

  describe('isValidUUID', () => {
    test('validates correct UUID v4', () => {
      const validUUID = '550e8400-e29b-41d4-a716-446655440000';
      expect(isValidUUID(validUUID)).toBe(true);
    });

    test('rejects invalid UUIDs', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('123')).toBe(false);
      expect(isValidUUID('')).toBe(false);
    });

    test('rejects UUIDs with wrong format', () => {
      expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false); // No dashes
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false); // Too short
    });

    test('handles null and undefined', () => {
      expect(isValidUUID(null as any)).toBe(false);
      expect(isValidUUID(undefined as any)).toBe(false);
    });
  });

  describe('Query Schema Validation', () => {
    describe('pagination schema', () => {
      test('validates valid pagination params', () => {
        const result = querySchemas.pagination.safeParse({ limit: 10, offset: 0 });
        expect(result.success).toBe(true);
      });

      test('coerces string numbers', () => {
        const result = querySchemas.pagination.safeParse({ limit: '25', offset: '10' });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(25);
          expect(result.data.offset).toBe(10);
        }
      });

      test('applies default values', () => {
        const result = querySchemas.pagination.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBeDefined();
          expect(result.data.offset).toBeDefined();
        }
      });

      test('enforces max limit', () => {
        const result = querySchemas.pagination.safeParse({ limit: 1000 });
        expect(result.success).toBe(false);
      });

      test('rejects negative offset', () => {
        const result = querySchemas.pagination.safeParse({ offset: -1 });
        expect(result.success).toBe(false);
      });
    });

    describe('timeRange schema', () => {
      test('validates valid time range', () => {
        const result = querySchemas.timeRange.safeParse({
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
        });
        expect(result.success).toBe(true);
      });

      test('rejects invalid date strings', () => {
        const result = querySchemas.timeRange.safeParse({
          startTime: 'not-a-date',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('safeString schema', () => {
      test('validates safe strings', () => {
        const result = querySchemas.safeString.safeParse({ query: 'test search' });
        expect(result.success).toBe(true);
      });

      test('rejects strings with XSS attempts', () => {
        const result = querySchemas.safeString.safeParse({ query: '<script>alert("XSS")</script>' });
        expect(result.success).toBe(false);
      });

      test('enforces max length', () => {
        const longString = 'a'.repeat(1001);
        const result = querySchemas.safeString.safeParse({ query: longString });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Body Schema Validation', () => {
    describe('userAuth schema', () => {
      test('validates valid user auth data', () => {
        const result = bodySchemas.userAuth.safeParse({
          email: 'test@example.com',
          password: 'SecurePass123!',
        });
        expect(result.success).toBe(true);
      });

      test('rejects invalid email', () => {
        const result = bodySchemas.userAuth.safeParse({
          email: 'not-an-email',
          password: 'SecurePass123!',
        });
        expect(result.success).toBe(false);
      });

      test('enforces password minimum length', () => {
        const result = bodySchemas.userAuth.safeParse({
          email: 'test@example.com',
          password: 'short',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('ageVerification schema', () => {
      test('validates users over 13', () => {
        const result = bodySchemas.ageVerification.safeParse({
          birthDate: '2005-01-01',
        });
        expect(result.success).toBe(true);
      });

      test('validates age gate status', () => {
        const result = bodySchemas.ageVerification.safeParse({
          birthDate: '2005-01-01',
          ageGateStatus: 'verified_adult',
        });
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    test('sanitizeSearchQuery handles special characters', () => {
      const specialChars = "!@#$%^&*()[]{}|\\:\"'<>?/~`";
      const result = sanitizeSearchQuery(specialChars);
      expect(typeof result).toBe('string');
      expect(result.length).toBeLessThanOrEqual(specialChars.length);
    });

    test('safeParseInt handles NaN', () => {
      expect(safeParseInt('NaN')).toBeNull();
    });

    test('safeParseFloat handles Infinity', () => {
      expect(safeParseFloat('Infinity')).toBeNull();
    });
  });
});
