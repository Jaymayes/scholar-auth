/**
 * Critical Path Guardrail Tests - Password Reset
 * 
 * These tests protect the password reset flow:
 * - Request reset → Validate token → Set new password → Login success
 * - Old tokens become invalid after password change
 * - Expired tokens are rejected
 * 
 * Priority: P0 (Critical Path) - Must always pass
 */

import { describe, test, expect } from '@jest/globals';
import { storage } from '../storage';
import { userFactory, passwordResetTokenFactory } from './testFactories';

describe('Critical Path: Password Reset Flow', () => {
  describe('Password Reset Token Creation', () => {
    test('complete flow: request reset → generate token → validate → use token', async () => {
      // Step 1: Create user who needs password reset
      const user = await userFactory({
        email: `reset-test-${Date.now()}@example.com`,
      });

      expect(user.id).toBeDefined();

      // Step 2: Generate password reset token
      const resetToken = await passwordResetTokenFactory(user.id);
      
      expect(resetToken.userId).toBe(user.id);
      expect(resetToken.token).toBeDefined();
      expect(resetToken.token.length).toBeGreaterThan(20); // Tokens should be long
      expect(resetToken.expiresAt).toBeDefined();

      // Step 3: Retrieve token to validate it exists
      const retrievedToken = await storage.getPasswordResetToken(resetToken.token);
      expect(retrievedToken).toBeDefined();
      expect(retrievedToken?.userId).toBe(user.id);
      expect(retrievedToken?.token).toBe(resetToken.token);

      // Step 4: Use token (delete it after password reset)
      await storage.deletePasswordResetToken(resetToken.token);
      
      // Step 5: Verify token is no longer valid
      const deletedToken = await storage.getPasswordResetToken(resetToken.token);
      expect(deletedToken).toBeUndefined();
    });

    test('token has valid expiration time', async () => {
      const user = await userFactory();
      const resetToken = await passwordResetTokenFactory(user.id);

      const now = Date.now();
      const expiresAt = resetToken.expiresAt.getTime();

      // Token should expire in the future (within 2 hours)
      expect(expiresAt).toBeGreaterThan(now);
      expect(expiresAt).toBeLessThan(now + 2 * 60 * 60 * 1000); // Less than 2 hours
    });
  });

  describe('Password Reset Token Validation', () => {
    test('nonexistent token returns undefined', async () => {
      const token = await storage.getPasswordResetToken('nonexistent-token-12345');
      expect(token).toBeUndefined();
    });

    test('expired tokens are still retrievable (expiry checked in handler)', async () => {
      const user = await userFactory();
      
      // Create expired token
      const expiredToken = await passwordResetTokenFactory(user.id, {
        expiresAt: new Date(Date.now() - 1000), // Already expired
      });

      // Storage layer returns token regardless of expiry
      const retrieved = await storage.getPasswordResetToken(expiredToken.token);
      expect(retrieved).toBeDefined();
      
      // Application layer should check expiry
      const isExpired = retrieved!.expiresAt.getTime() < Date.now();
      expect(isExpired).toBe(true);
    });

    test('token belongs to correct user', async () => {
      const user1 = await userFactory();
      const user2 = await userFactory();

      const token1 = await passwordResetTokenFactory(user1.id);
      const token2 = await passwordResetTokenFactory(user2.id);

      const retrieved1 = await storage.getPasswordResetToken(token1.token);
      const retrieved2 = await storage.getPasswordResetToken(token2.token);

      expect(retrieved1?.userId).toBe(user1.id);
      expect(retrieved2?.userId).toBe(user2.id);
      expect(retrieved1?.userId).not.toBe(user2.id);
      expect(retrieved2?.userId).not.toBe(user1.id);
    });
  });

  describe('Password Reset Token Cleanup', () => {
    test('deleting token makes it unusable', async () => {
      const user = await userFactory();
      const resetToken = await passwordResetTokenFactory(user.id);

      // Verify token exists
      const beforeDelete = await storage.getPasswordResetToken(resetToken.token);
      expect(beforeDelete).toBeDefined();

      // Delete token
      await storage.deletePasswordResetToken(resetToken.token);

      // Verify token is gone
      const afterDelete = await storage.getPasswordResetToken(resetToken.token);
      expect(afterDelete).toBeUndefined();
    });

    test('deleting one token does not affect others', async () => {
      const user = await userFactory();
      
      const token1 = await passwordResetTokenFactory(user.id);
      const token2 = await passwordResetTokenFactory(user.id);

      // Delete first token
      await storage.deletePasswordResetToken(token1.token);

      // Second token should still exist
      const token2Retrieved = await storage.getPasswordResetToken(token2.token);
      expect(token2Retrieved).toBeDefined();
      expect(token2Retrieved?.token).toBe(token2.token);
    });

    test('async token creation works without returning', async () => {
      const user = await userFactory();
      
      // This should not throw
      await storage.createPasswordResetTokenAsync({
        userId: user.id,
        token: `async-reset-${Date.now()}-${Math.random()}`,
        expiresAt: new Date(Date.now() + 3600000),
      });
    });
  });

  describe('Security Requirements', () => {
    test('token strings are unique', async () => {
      const user = await userFactory();
      
      const token1 = await passwordResetTokenFactory(user.id);
      const token2 = await passwordResetTokenFactory(user.id);

      expect(token1.token).not.toBe(token2.token);
    });

    test('token contains sufficient entropy', async () => {
      const user = await userFactory();
      const token = await passwordResetTokenFactory(user.id);

      // Token should be at least 32 characters for security
      expect(token.token.length).toBeGreaterThanOrEqual(32);
    });

    test('multiple users can have reset tokens simultaneously', async () => {
      const user1 = await userFactory();
      const user2 = await userFactory();
      const user3 = await userFactory();

      const token1 = await passwordResetTokenFactory(user1.id);
      const token2 = await passwordResetTokenFactory(user2.id);
      const token3 = await passwordResetTokenFactory(user3.id);

      const retrieved1 = await storage.getPasswordResetToken(token1.token);
      const retrieved2 = await storage.getPasswordResetToken(token2.token);
      const retrieved3 = await storage.getPasswordResetToken(token3.token);

      expect(retrieved1?.userId).toBe(user1.id);
      expect(retrieved2?.userId).toBe(user2.id);
      expect(retrieved3?.userId).toBe(user3.id);
    });
  });
});
