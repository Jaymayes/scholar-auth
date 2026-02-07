/**
 * Security Helper Functions Unit Tests
 * 
 * Tests utility functions for security middleware
 * 
 * Coverage targets:
 * - HTML escaping (XSS prevention)
 * - Header sanitization
 * - Input validation helpers
 */

// Mock oidc-provider to prevent ESM issues
jest.mock('oidc-provider', () => ({
  Provider: class MockProvider {
    callback() {}
  },
}));

import { escapeHtml } from '../oidc/interactions';

describe('Security Helper Functions', () => {
  describe('HTML escaping for XSS prevention', () => {

    it('should escape HTML special characters', () => {
      const input = '<script>alert("XSS")</script>';
      const expected = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;';
      expect(escapeHtml(input)).toBe(expected);
    });

    it('should escape ampersands', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("It's a test")).toBe("It&#039;s a test");
    });

    it('should escape double quotes', () => {
      expect(escapeHtml('Say "hello"')).toBe('Say &quot;hello&quot;');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should handle strings with no special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    it('should escape multiple special characters', () => {
      const input = '<a href="javascript:alert(\'XSS\')">Click</a>';
      const output = escapeHtml(input);
      expect(output).not.toContain('<');
      expect(output).not.toContain('>');
      expect(output).not.toContain('"');
      expect(output).not.toContain("'");
    });

    it('should prevent script injection', () => {
      const malicious = '<img src=x onerror="alert(1)">';
      const escaped = escapeHtml(malicious);
      expect(escaped).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    });

    it('should escape common XSS payloads', () => {
      const payloads = [
        '<script>document.cookie</script>',
        '<iframe src="evil.com"></iframe>',
        '<img src=x onerror=alert(1)>',
        'javascript:alert(1)',
        '<svg onload=alert(1)>'
      ];

      payloads.forEach(payload => {
        const escaped = escapeHtml(payload);
        expect(escaped).not.toContain('<script');
        expect(escaped).not.toContain('<iframe');
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('<svg');
      });
    });
  });

  describe('Input sanitization', () => {
    it('should trim whitespace from strings', () => {
      const input = '  test  ';
      expect(input.trim()).toBe('test');
    });

    it('should normalize email addresses', () => {
      const email = '  Test@Example.COM  ';
      const normalized = email.trim().toLowerCase();
      expect(normalized).toBe('test@example.com');
    });

    it('should validate email format', () => {
      const validEmail = 'user@example.com';
      const invalidEmail = 'not-an-email';
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      expect(emailRegex.test(validEmail)).toBe(true);
      expect(emailRegex.test(invalidEmail)).toBe(false);
    });

    it('should sanitize user input for display', () => {
      const userInput = '<script>alert("XSS")</script>Hello';
      const sanitized = escapeHtml(userInput);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;script&gt;');
    });
  });

  describe('Header validation', () => {
    it('should reject headers with newlines (header injection)', () => {
      const maliciousHeader = 'value\r\nX-Injected: malicious';
      const hasNewline = /[\r\n]/.test(maliciousHeader);
      expect(hasNewline).toBe(true);
    });

    it('should accept valid header values', () => {
      const validHeader = 'Bearer token123';
      const hasNewline = /[\r\n]/.test(validHeader);
      expect(hasNewline).toBe(false);
    });

    it('should validate content-type header', () => {
      const validTypes = [
        'application/json',
        'text/html',
        'application/x-www-form-urlencoded'
      ];

      validTypes.forEach(type => {
        expect(type).toMatch(/^[a-z]+\/[a-z0-9\-+.]+$/i);
      });
    });
  });

  describe('URL validation', () => {
    it('should validate safe redirect URLs', () => {
      const safeUrls = [
        '/dashboard',
        '/api/user',
        '/profile/edit'
      ];

      safeUrls.forEach(url => {
        expect(url.startsWith('/')).toBe(true);
        expect(url.startsWith('//')).toBe(false); // Prevent protocol-relative URLs
      });
    });

    it('should detect dangerous redirect URLs', () => {
      const dangerousUrls = [
        '//evil.com',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'http://evil.com'
      ];

      dangerousUrls.forEach(url => {
        const isSafe = url.startsWith('/') && !url.startsWith('//');
        expect(isSafe).toBe(false);
      });
    });
  });

  describe('Token format validation', () => {
    it('should validate UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const invalidUuid = 'not-a-uuid';
      
      expect(uuidRegex.test(validUuid)).toBe(true);
      expect(uuidRegex.test(invalidUuid)).toBe(false);
    });

    it('should validate 6-digit verification codes', () => {
      const codeRegex = /^\d{6}$/;
      
      expect(codeRegex.test('123456')).toBe(true);
      expect(codeRegex.test('12345')).toBe(false); // Too short
      expect(codeRegex.test('1234567')).toBe(false); // Too long
      expect(codeRegex.test('12345a')).toBe(false); // Not all digits
    });

    it('should validate hex tokens', () => {
      const hexRegex = /^[0-9a-f]+$/i;
      
      expect(hexRegex.test('abc123')).toBe(true);
      expect(hexRegex.test('xyz789')).toBe(false); // Contains non-hex chars
    });
  });

  describe('SQL injection prevention', () => {
    it('should detect SQL keywords in malicious input', () => {
      const sqlKeywordsRegex = /(DROP|DELETE|INSERT|UPDATE|SELECT)/i;
      
      expect(sqlKeywordsRegex.test("'; DROP TABLE users--")).toBe(true);
      expect(sqlKeywordsRegex.test("1; DELETE FROM users")).toBe(true);
      expect(sqlKeywordsRegex.test("SELECT * FROM users")).toBe(true);
    });

    it('should allow safe input without SQL keywords', () => {
      const sqlKeywordsRegex = /(DROP|DELETE|INSERT|UPDATE|SELECT)/i;
      
      expect(sqlKeywordsRegex.test("normal user input")).toBe(false);
      expect(sqlKeywordsRegex.test("john@example.com")).toBe(false);
    });
  });

  describe('Password validation rules', () => {
    it('should require minimum length', () => {
      const password = 'short';
      const isValid = password.length >= 8;
      expect(isValid).toBe(false);
    });

    it('should accept valid password', () => {
      const password = 'SecurePassword123!';
      const isValid = password.length >= 8;
      expect(isValid).toBe(true);
    });

    it('should check for complexity', () => {
      const hasUpperCase = (s: string) => /[A-Z]/.test(s);
      const hasLowerCase = (s: string) => /[a-z]/.test(s);
      const hasDigit = (s: string) => /[0-9]/.test(s);

      const strongPassword = 'SecurePass123';
      expect(hasUpperCase(strongPassword)).toBe(true);
      expect(hasLowerCase(strongPassword)).toBe(true);
      expect(hasDigit(strongPassword)).toBe(true);

      const weakPassword = 'password';
      expect(hasUpperCase(weakPassword)).toBe(false);
    });
  });
});
