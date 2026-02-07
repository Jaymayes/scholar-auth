import { describe, test, expect } from '@jest/globals';
import {
  safeParseInt,
  safeParseFloat,
  sanitizeSearchQuery,
  isValidUUID,
  querySchemas,
  bodySchemas,
} from '../middleware/inputValidation';

describe('Validator Utility Functions', () => {
  describe('safeParseInt', () => {
    test('should parse valid integers', () => {
      expect(safeParseInt('123')).toBe(123);
      expect(safeParseInt(456)).toBe(456);
      expect(safeParseInt('0')).toBe(0);
    });

    test('should return null for invalid inputs', () => {
      expect(safeParseInt(null)).toBe(null);
      expect(safeParseInt(undefined)).toBe(null);
      expect(safeParseInt('')).toBe(null);
      expect(safeParseInt('abc')).toBe(null);
      expect(safeParseInt('12.34')).toBe(12); // Parses as int
    });

    test('should respect min bounds', () => {
      expect(safeParseInt('5', 10, 100)).toBe(null);
      expect(safeParseInt('10', 10, 100)).toBe(10);
      expect(safeParseInt('15', 10, 100)).toBe(15);
    });

    test('should respect max bounds', () => {
      expect(safeParseInt('150', 10, 100)).toBe(null);
      expect(safeParseInt('100', 10, 100)).toBe(100);
      expect(safeParseInt('99', 10, 100)).toBe(99);
    });

    test('should handle edge cases', () => {
      expect(safeParseInt(0)).toBe(0);
      expect(safeParseInt(-5)).toBe(null); // Default min is 0
      expect(safeParseInt(-5, -10, 10)).toBe(-5);
    });
  });

  describe('safeParseFloat', () => {
    test('should parse valid floats', () => {
      expect(safeParseFloat('123.45')).toBe(123.45);
      expect(safeParseFloat(456.78)).toBe(456.78);
      expect(safeParseFloat('0.5')).toBe(0.5);
    });

    test('should return null for invalid inputs', () => {
      expect(safeParseFloat(null)).toBe(null);
      expect(safeParseFloat(undefined)).toBe(null);
      expect(safeParseFloat('')).toBe(null);
      expect(safeParseFloat('abc')).toBe(null);
    });

    test('should respect min bounds', () => {
      expect(safeParseFloat('5.5', 10.0, 100.0)).toBe(null);
      expect(safeParseFloat('10.0', 10.0, 100.0)).toBe(10.0);
      expect(safeParseFloat('50.5', 10.0, 100.0)).toBe(50.5);
    });

    test('should respect max bounds', () => {
      expect(safeParseFloat('150.5', 10.0, 100.0)).toBe(null);
      expect(safeParseFloat('100.0', 10.0, 100.0)).toBe(100.0);
      expect(safeParseFloat('99.9', 10.0, 100.0)).toBe(99.9);
    });
  });

  describe('sanitizeSearchQuery', () => {
    test('should sanitize SQL injection attempts', () => {
      expect(sanitizeSearchQuery("'; DROP TABLE users;--")).toBe('DROP TABLE users');
      expect(sanitizeSearchQuery("admin'--")).toBe('admin');
      expect(sanitizeSearchQuery("1' OR '1'='1")).toBe('1 OR 1=1');
    });

    test('should remove block comments', () => {
      expect(sanitizeSearchQuery('test /* comment */ query')).toBe('test  comment  query');
    });

    test('should trim and limit length', () => {
      const longQuery = 'a'.repeat(200);
      const result = sanitizeSearchQuery(longQuery);
      expect(result.length).toBe(100);
    });

    test('should handle empty inputs', () => {
      expect(sanitizeSearchQuery('')).toBe('');
      expect(sanitizeSearchQuery(null as any)).toBe('');
      expect(sanitizeSearchQuery(undefined as any)).toBe('');
    });

    test('should preserve safe characters', () => {
      expect(sanitizeSearchQuery('hello world')).toBe('hello world');
      expect(sanitizeSearchQuery('test-query_123')).toBe('test-query_123');
    });
  });

  describe('isValidUUID', () => {
    test('should validate correct UUIDs (v4 only)', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUUID('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    });

    test('should reject invalid UUIDs', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false); // Too short
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false); // Too long
      expect(isValidUUID('')).toBe(false);
      expect(isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false); // Wrong version (v1 not v4)
      expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false); // UUID v1, not v4
    });

    test('should be case insensitive', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
      expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
    });
  });

  describe('querySchemas', () => {
    describe('pagination', () => {
      test('should validate correct pagination params', () => {
        const result = querySchemas.pagination.parse({ limit: 10, offset: 0 });
        expect(result).toEqual({ limit: 10, offset: 0 });
      });

      test('should apply defaults', () => {
        const result = querySchemas.pagination.parse({});
        expect(result).toEqual({ limit: 50, offset: 0 });
      });

      test('should coerce strings to numbers', () => {
        const result = querySchemas.pagination.parse({ limit: '25', offset: '10' });
        expect(result).toEqual({ limit: 25, offset: 10 });
      });

      test('should enforce min limit', () => {
        expect(() => querySchemas.pagination.parse({ limit: 0 })).toThrow();
      });

      test('should enforce max limit', () => {
        expect(() => querySchemas.pagination.parse({ limit: 1001 })).toThrow();
      });

      test('should enforce max offset', () => {
        expect(() => querySchemas.pagination.parse({ offset: 100001 })).toThrow();
      });
    });

    describe('timeRange', () => {
      test('should validate datetime strings', () => {
        const result = querySchemas.timeRange.parse({
          startTime: '2025-10-23T12:00:00Z',
          endTime: '2025-10-23T14:00:00Z',
        });
        expect(result.startTime).toBe('2025-10-23T12:00:00Z');
        expect(result.endTime).toBe('2025-10-23T14:00:00Z');
      });

      test('should apply default limitMinutes', () => {
        const result = querySchemas.timeRange.parse({});
        expect(result.limitMinutes).toBe(60);
      });

      test('should enforce max limitMinutes (1 week)', () => {
        expect(() => querySchemas.timeRange.parse({ limitMinutes: 10081 })).toThrow();
      });
    });

    describe('segment', () => {
      test('should validate segment IDs with alphanumeric regex', () => {
        const result = querySchemas.segment.parse({ segmentId: 'seg-123', cohortId: 'cohort_456' });
        expect(result.segmentId).toBe('seg-123');
        expect(result.cohortId).toBe('cohort_456');
      });

      test('should reject invalid characters', () => {
        expect(() => querySchemas.segment.parse({ segmentId: 'seg@123' })).toThrow();
        expect(() => querySchemas.segment.parse({ cohortId: 'cohort$456' })).toThrow();
      });

      test('should validate percentage bounds', () => {
        const result = querySchemas.segment.parse({ percentage: 50 });
        expect(result.percentage).toBe(50);
        
        expect(() => querySchemas.segment.parse({ percentage: -1 })).toThrow();
        expect(() => querySchemas.segment.parse({ percentage: 101 })).toThrow();
      });
    });

    describe('executive', () => {
      test('should validate digest types', () => {
        const result = querySchemas.executive.parse({ digestType: 'morning' });
        expect(result.digestType).toBe('morning');
      });

      test('should apply boolean defaults', () => {
        const result = querySchemas.executive.parse({});
        expect(result.includeMetrics).toBe(true);
        expect(result.includeAlerts).toBe(true);
        expect(result.format).toBe('json');
      });

      test('should validate format enum', () => {
        expect(() => querySchemas.executive.parse({ format: 'xml' })).toThrow();
      });
    });

    describe('safeString', () => {
      test('should validate safe search query', () => {
        const result = querySchemas.safeString.parse({ q: 'test-query_123' });
        expect(result.q).toBe('test-query_123');
      });

      test('should reject unsafe characters in query', () => {
        expect(() => querySchemas.safeString.parse({ q: 'test<script>' })).toThrow();
        expect(() => querySchemas.safeString.parse({ q: 'test$query' })).toThrow();
      });

      test('should enforce max length', () => {
        const longQuery = 'a'.repeat(101);
        expect(() => querySchemas.safeString.parse({ q: longQuery })).toThrow();
      });

      test('should validate sort enum', () => {
        const result = querySchemas.safeString.parse({ sort: 'asc' });
        expect(result.sort).toBe('asc');
        
        expect(() => querySchemas.safeString.parse({ sort: 'invalid' })).toThrow();
      });
    });
  });

  describe('bodySchemas', () => {
    describe('userAuth', () => {
      test('should validate correct auth credentials', () => {
        const result = bodySchemas.userAuth.parse({
          email: 'user@example.com',
          password: 'SecurePass123!',
        });
        expect(result.email).toBe('user@example.com');
        expect(result.password).toBe('SecurePass123!');
      });

      test('should reject invalid email', () => {
        expect(() => bodySchemas.userAuth.parse({
          email: 'not-an-email',
          password: 'password123',
        })).toThrow();
      });

      test('should enforce password min length', () => {
        expect(() => bodySchemas.userAuth.parse({
          email: 'user@example.com',
          password: 'short',
        })).toThrow();
      });

      test('should enforce password max length', () => {
        const longPassword = 'a'.repeat(129);
        expect(() => bodySchemas.userAuth.parse({
          email: 'user@example.com',
          password: longPassword,
        })).toThrow();
      });

      test('should accept optional rememberMe', () => {
        const result = bodySchemas.userAuth.parse({
          email: 'user@example.com',
          password: 'password123',
          rememberMe: true,
        });
        expect(result.rememberMe).toBe(true);
      });
    });

    describe('ageVerification', () => {
      test('should validate age verification data', () => {
        const result = bodySchemas.ageVerification.parse({
          isOver13: true,
          isOver18: false,
        });
        expect(result.isOver13).toBe(true);
        expect(result.isOver18).toBe(false);
      });

      test('should require isOver13 boolean', () => {
        expect(() => bodySchemas.ageVerification.parse({})).toThrow();
      });

      test('should accept parental consent', () => {
        const result = bodySchemas.ageVerification.parse({
          isOver13: false,
          parentalConsent: true,
          verificationToken: 'token-123',
        });
        expect(result.parentalConsent).toBe(true);
        expect(result.verificationToken).toBe('token-123');
      });
    });

    describe('executiveConfig', () => {
      test('should validate executive configuration', () => {
        const result = bodySchemas.executiveConfig.parse({
          alertThreshold: 85,
          reportingFrequency: 'daily',
          enableRealTimeAlerts: true,
          metricFilters: ['revenue', 'engagement'],
        });
        expect(result.alertThreshold).toBe(85);
        expect(result.reportingFrequency).toBe('daily');
      });

      test('should enforce alertThreshold bounds', () => {
        expect(() => bodySchemas.executiveConfig.parse({
          alertThreshold: -1,
          reportingFrequency: 'daily',
          enableRealTimeAlerts: true,
          metricFilters: [],
        })).toThrow();

        expect(() => bodySchemas.executiveConfig.parse({
          alertThreshold: 101,
          reportingFrequency: 'daily',
          enableRealTimeAlerts: true,
          metricFilters: [],
        })).toThrow();
      });

      test('should enforce max metricFilters count', () => {
        const tooManyFilters = Array(21).fill('metric');
        expect(() => bodySchemas.executiveConfig.parse({
          alertThreshold: 50,
          reportingFrequency: 'daily',
          enableRealTimeAlerts: true,
          metricFilters: tooManyFilters,
        })).toThrow();
      });
    });

    describe('guardrailConfig', () => {
      test('should validate guardrail configuration', () => {
        const result = bodySchemas.guardrailConfig.parse({
          metricName: 'ERROR_RATE',
          threshold: 5,
          windowMinutes: 15,
          severity: 'HIGH',
        });
        expect(result.metricName).toBe('ERROR_RATE');
        expect(result.severity).toBe('HIGH');
      });

      test('should enforce metricName regex (uppercase with underscores)', () => {
        expect(() => bodySchemas.guardrailConfig.parse({
          metricName: 'lowercase',
          threshold: 5,
          windowMinutes: 15,
          severity: 'HIGH',
        })).toThrow();

        expect(() => bodySchemas.guardrailConfig.parse({
          metricName: 'INVALID-NAME',
          threshold: 5,
          windowMinutes: 15,
          severity: 'HIGH',
        })).toThrow();
      });

      test('should enforce windowMinutes max (24 hours)', () => {
        expect(() => bodySchemas.guardrailConfig.parse({
          metricName: 'ERROR_RATE',
          threshold: 5,
          windowMinutes: 1441,
          severity: 'HIGH',
        })).toThrow();
      });

      test('should validate severity enum', () => {
        expect(() => bodySchemas.guardrailConfig.parse({
          metricName: 'ERROR_RATE',
          threshold: 5,
          windowMinutes: 15,
          severity: 'INVALID',
        })).toThrow();
      });
    });
  });
});
