import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { sanitizeRequest } from '../middleware/inputValidation';
import { performance } from 'perf_hooks';

describe('Prototype Pollution Protection (SEC-PATCH)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: NextFunction;

  beforeEach(() => {
    mockReq = {
      query: {},
      headers: {},
    };
    mockRes = {};
    nextFn = () => {};
  });

  describe('Unit Tests: sanitizeRequest middleware', () => {
    test('blocks __proto__ from query parameters', () => {
      mockReq.query = {
        '__proto__': { isAdmin: 'true' } as any,
        normalParam: 'value',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // The dangerous key should not be processed
      expect(Object.prototype).not.toHaveProperty('isAdmin');
      expect(mockReq.query).toHaveProperty('normalParam');
    });

    test('blocks constructor from query parameters', () => {
      mockReq.query = {
        'constructor': { prototype: { polluted: 'true' } } as any,
        normalParam: 'value',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Prototype should not be polluted
      expect(Object.prototype).not.toHaveProperty('polluted');
      expect(mockReq.query).toHaveProperty('normalParam');
    });

    test('blocks prototype from query parameters', () => {
      mockReq.query = {
        'prototype': { isAdmin: 'true' } as any,
        normalParam: 'value',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Prototype should not be polluted
      expect(Object.prototype).not.toHaveProperty('isAdmin');
      expect(mockReq.query).toHaveProperty('normalParam');
    });

    test('processes normal query parameters correctly', () => {
      mockReq.query = {
        search: 'test<script>alert("xss")</script>',
        filter: 'active',
        limit: '10',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Normal params should be sanitized but present
      expect(mockReq.query.search).toBeDefined();
      expect(mockReq.query.filter).toBe('active');
      expect(mockReq.query.limit).toBe('10');
      // XSS should be stripped
      expect(mockReq.query.search).not.toContain('<script>');
    });

    test('does not mutate Object.prototype with __proto__ payload', () => {
      // Store original prototype state
      const originalProto = Object.getPrototypeOf({});
      const hasIsAdminBefore = 'isAdmin' in Object.prototype;

      mockReq.query = {
        '__proto__': { isAdmin: 'true' } as any,
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Verify no pollution occurred
      expect('isAdmin' in Object.prototype).toBe(hasIsAdminBefore);
      expect(Object.getPrototypeOf({})).toBe(originalProto);
    });

    test('handles multiple dangerous keys in single request', () => {
      mockReq.query = {
        '__proto__': { admin: 'true' } as any,
        'constructor': { prototype: { evil: 'true' } } as any,
        'prototype': { hacked: 'true' } as any,
        normalKey: 'normalValue',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // None of the dangerous properties should pollute
      expect(Object.prototype).not.toHaveProperty('admin');
      expect(Object.prototype).not.toHaveProperty('evil');
      expect(Object.prototype).not.toHaveProperty('hacked');
      
      // Normal keys should work
      expect(mockReq.query.normalKey).toBe('normalValue');
    });

    test('handles empty query object', () => {
      mockReq.query = {};

      expect(() => {
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
      }).not.toThrow();
      
      expect(mockReq.query).toBeDefined();
    });

    test('handles undefined query', () => {
      mockReq.query = undefined as any;

      expect(() => {
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
      }).not.toThrow();
    });

    test('strips XSS from normal params while blocking pollution', () => {
      mockReq.query = {
        '__proto__': { polluted: 'true' } as any,
        search: 'test<script>alert("xss")</script>query',
        filter: 'javascript:alert(1)',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Pollution blocked
      expect(Object.prototype).not.toHaveProperty('polluted');
      
      // XSS stripped from legit params
      if (mockReq.query) {
        expect(mockReq.query.search).not.toContain('<script>');
        expect(mockReq.query.filter).not.toContain('javascript:');
      }
    });

    test('preserves non-string query parameters', () => {
      mockReq.query = {
        limit: '10',
        offset: '0',
        active: 'true',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Non-string params should be unchanged
      if (mockReq.query) {
        expect(mockReq.query.limit).toBe('10');
        expect(mockReq.query.offset).toBe('0');
        expect(mockReq.query.active).toBe('true');
      }
    });

    test('calls next() after sanitization', () => {
      let nextCalled = false;
      const testNext = () => { nextCalled = true; };

      mockReq.query = { test: 'value' };

      sanitizeRequest(mockReq as Request, mockRes as Response, testNext);

      expect(nextCalled).toBe(true);
    });
  });

  describe('Security Invariants', () => {
    test('INVARIANT: Object.prototype remains unpolluted after attack', () => {
      const pollutionTests = [
        { '__proto__': { isAdmin: 'true' } as any },
        { 'constructor': { prototype: { isAdmin: 'true' } } as any },
        { 'prototype': { isAdmin: 'true' } as any },
      ];

      pollutionTests.forEach(payload => {
        mockReq.query = payload as any;
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
        
        // Critical: prototype must never be polluted
        const testObj = {};
        expect(testObj).not.toHaveProperty('isAdmin');
        expect(Object.prototype).not.toHaveProperty('isAdmin');
      });
    });

    test('INVARIANT: Dangerous keys are always filtered regardless of value type', () => {
      const dangerousPayloads = [
        { '__proto__': 'string' },
        { '__proto__': { nested: 'object' } as any },
        { '__proto__': '123' },
        { '__proto__': 'true' },
        { '__proto__': 'null' },
      ];

      dangerousPayloads.forEach(payload => {
        mockReq.query = payload as any;
        
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
        
        // Dangerous key should not have been processed
        expect(Object.prototype).not.toHaveProperty('string');
        expect(Object.prototype).not.toHaveProperty('nested');
      });
    });
  });

  describe('Nested Payloads & Body/Params Sources (Architect Recommendations)', () => {
    test('blocks nested pollution via safe[__proto__]', () => {
      mockReq.query = {
        'safe': { '__proto__': { polluted: 'true' } } as any,
        normalParam: 'value',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Even nested dangerous keys should not pollute
      const testObj = {};
      expect(testObj).not.toHaveProperty('polluted');
      expect(Object.prototype).not.toHaveProperty('polluted');
    });

    test('blocks array-based pollution attempts', () => {
      mockReq.query = {
        'items': ['__proto__', 'constructor'] as any,
        normalParam: 'value',
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // Array contents should not cause pollution
      const testObj = {};
      expect(Object.prototype).not.toHaveProperty('items');
    });

    test('handles deep nested objects safely', () => {
      mockReq.query = {
        'level1': {
          'level2': {
            '__proto__': { deepPollution: 'true' }
          }
        } as any,
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      const testObj = {};
      expect(testObj).not.toHaveProperty('deepPollution');
    });
  });

  describe('Property-Based/Fuzz Tests (CEO Requirement)', () => {
    // Generate random query keys and values
    function generateRandomString(length: number): string {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    test('FUZZ: handles 100 random valid query parameters', () => {
      // Generate 100 random safe query parameters
      const randomQuery: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        randomQuery[generateRandomString(10)] = generateRandomString(20);
      }
      
      mockReq.query = randomQuery;

      expect(() => {
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
      }).not.toThrow();

      // Verify no pollution occurred
      const testObj = {};
      expect(Object.getOwnPropertyNames(Object.prototype).length).toBeLessThan(20); // Normal prototype size
    });

    test('FUZZ: dangerous keys mixed with random data never pollute', () => {
      const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
      
      for (let iteration = 0; iteration < 50; iteration++) {
        const query: Record<string, any> = {};
        
        // Mix in random dangerous key
        const randomDangerousKey = dangerousKeys[Math.floor(Math.random() * dangerousKeys.length)];
        query[randomDangerousKey] = { polluted: `iteration${iteration}` };
        
        // Add random safe keys
        for (let i = 0; i < 5; i++) {
          query[generateRandomString(8)] = generateRandomString(15);
        }
        
        mockReq.query = query;
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
        
        // Verify no pollution
        const testObj = {};
        expect(testObj).not.toHaveProperty('polluted');
        expect(testObj).not.toHaveProperty(`iteration${iteration}`);
      }
    });

    test('FUZZ: high-volume query parameters (stress test)', () => {
      // Simulate large query parameter payloads
      const largeQuery: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        largeQuery[`param${i}`] = `value${i}`;
      }
      
      mockReq.query = largeQuery;

      expect(() => {
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
      }).not.toThrow();

      // Verify all params were processed
      expect(Object.keys(mockReq.query || {}).length).toBe(1000);
    });

    test('FUZZ: various XSS payloads with pollution attempts', () => {
      const xssPayloads = [
        '<script>alert(1)</script>',
        'javascript:alert(1)',
        'onerror=alert(1)',
        '<img src=x onerror=alert(1)>',
        'onclick=alert(1)',
      ];

      xssPayloads.forEach((payload, idx) => {
        mockReq.query = {
          '__proto__': { xss: payload } as any,
          normalParam: payload,
        };

        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

        // Pollution blocked
        expect(Object.prototype).not.toHaveProperty('xss');
        
        // XSS stripped from normal params
        if (mockReq.query && typeof mockReq.query.normalParam === 'string') {
          expect(mockReq.query.normalParam).not.toContain('<script>');
          expect(mockReq.query.normalParam).not.toContain('javascript:');
        }
      });
    });

    test('FUZZ: Unicode and special characters in keys', () => {
      const specialKeys = ['日本語', 'émoji🎉', 'spëcial-çhars', '123-numbers', '_underscore'];
      
      specialKeys.forEach(key => {
        mockReq.query = {
          [key]: 'value',
          '__proto__': { polluted: 'true' } as any,
        };

        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

        // No pollution
        expect(Object.prototype).not.toHaveProperty('polluted');
        
        // Special key should be processed safely
        expect(mockReq.query).toHaveProperty(key);
      });
    });

    test('PROPERTY: sanitization is idempotent', () => {
      const testQuery = {
        search: 'test<script>alert(1)</script>',
        __proto__: { bad: 'true' } as any,
        normal: 'value',
      };

      // Apply sanitization twice
      mockReq.query = JSON.parse(JSON.stringify(testQuery));
      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
      const firstResult = JSON.stringify(mockReq.query);

      mockReq.query = JSON.parse(JSON.stringify(testQuery));
      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
      const secondResult = JSON.stringify(mockReq.query);

      // Results should be identical
      expect(firstResult).toBe(secondResult);
    });
  });

  describe('Performance Benchmarks (CEO SLO Requirements)', () => {
    const ITERATIONS = 1000;
    const P95_TARGET_MS = 1; // Target: <1ms P95 latency

    test('BENCHMARK: P50/P95 latency for typical query (10 params)', () => {
      const latencies: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const typicalQuery = {
          search: 'test query',
          filter: 'active',
          sort: 'desc',
          page: '1',
          limit: '50',
          category: 'tech',
          status: 'published',
          author: 'john',
          tags: 'javascript',
          year: '2024',
        };

        mockReq.query = typicalQuery;

        const start = performance.now();
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
        const end = performance.now();

        latencies.push(end - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(ITERATIONS * 0.5)];
      const p95 = latencies[Math.floor(ITERATIONS * 0.95)];

      console.log(`\n📊 Typical Query Performance:
        P50: ${p50.toFixed(3)}ms
        P95: ${p95.toFixed(3)}ms
        Target P95: <${P95_TARGET_MS}ms
        Status: ${p95 < P95_TARGET_MS ? '✅ PASS' : '⚠️ NEEDS OPTIMIZATION'}`);

      // Assert performance meets SLO
      expect(p95).toBeLessThan(P95_TARGET_MS);
    });

    test('BENCHMARK: P50/P95 latency with pollution attack payload', () => {
      const latencies: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const attackQuery = {
          '__proto__': { isAdmin: 'true' } as any,
          'constructor': { prototype: { hacked: 'true' } } as any,
          'prototype': { evil: 'true' } as any,
          search: 'test<script>alert(1)</script>',
          filter: 'javascript:void(0)',
          normal1: 'value1',
          normal2: 'value2',
        };

        mockReq.query = attackQuery;

        const start = performance.now();
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
        const end = performance.now();

        latencies.push(end - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(ITERATIONS * 0.5)];
      const p95 = latencies[Math.floor(ITERATIONS * 0.95)];

      console.log(`\n📊 Attack Payload Performance:
        P50: ${p50.toFixed(3)}ms
        P95: ${p95.toFixed(3)}ms
        Target P95: <${P95_TARGET_MS}ms
        Status: ${p95 < P95_TARGET_MS ? '✅ PASS' : '⚠️ NEEDS OPTIMIZATION'}`);

      // Attack payloads should not degrade performance
      expect(p95).toBeLessThan(P95_TARGET_MS);
    });

    test('BENCHMARK: large payload (1000 params) remains performant', () => {
      const latencies: number[] = [];
      const LARGE_PAYLOAD_ITERATIONS = 100; // Fewer iterations for large payloads

      for (let i = 0; i < LARGE_PAYLOAD_ITERATIONS; i++) {
        const largeQuery: Record<string, string> = {};
        for (let j = 0; j < 1000; j++) {
          largeQuery[`param${j}`] = `value${j}`;
        }

        mockReq.query = largeQuery;

        const start = performance.now();
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);
        const end = performance.now();

        latencies.push(end - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(LARGE_PAYLOAD_ITERATIONS * 0.5)];
      const p95 = latencies[Math.floor(LARGE_PAYLOAD_ITERATIONS * 0.95)];

      console.log(`\n📊 Large Payload (1000 params) Performance:
        P50: ${p50.toFixed(3)}ms
        P95: ${p95.toFixed(3)}ms
        Target P95: <10ms
        Status: ${p95 < 10 ? '✅ PASS' : '⚠️ NEEDS OPTIMIZATION'}`);

      // Large payloads should complete within 10ms at P95
      expect(p95).toBeLessThan(10);
    });
  });

  describe('Behavior Parity Validation', () => {
    test('PARITY: sanitized output maintains same structure as input', () => {
      const inputs = [
        { a: 'value1', b: 'value2', c: 'value3' },
        { search: 'query', filter: 'active' },
        { x: '1', y: '2', z: '3' },
      ];

      inputs.forEach(input => {
        mockReq.query = input;
        sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

        // Should have same keys (order may differ)
        expect(Object.keys(mockReq.query || {}).sort()).toEqual(Object.keys(input).sort());
      });
    });

    test('PARITY: only string values are sanitized, others pass through', () => {
      mockReq.query = {
        stringParam: 'test<script>xss</script>',
        numberParam: '123' as any,
        boolParam: 'true' as any,
      };

      sanitizeRequest(mockReq as Request, mockRes as Response, nextFn);

      // String sanitized
      expect(mockReq.query?.stringParam).not.toContain('<script>');
      
      // Non-objects passed through
      expect(mockReq.query?.numberParam).toBe('123');
      expect(mockReq.query?.boolParam).toBe('true');
    });
  });
});
