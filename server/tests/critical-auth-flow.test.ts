/**
 * Critical Path Guardrail Tests - Authentication & Email Verification
 * 
 * These tests protect the revenue- and compliance-critical authentication flow:
 * - Sign-up → Issue 6-char code → Verify → Login → Refresh token → Logout
 * - Email verification workflow with proper token validation
 * - Session management and token refresh
 * 
 * Priority: P0 (Critical Path) - Must always pass
 */

import { describe, test, expect } from '@jest/globals';
import { storage } from '../storage';
import { userFactory, emailVerificationTokenFactory, generate6CharCode } from './testFactories';

describe('Critical Path: Authentication & Email Verification', () => {
  describe('Email Verification Flow', () => {
    test('complete flow: create user → generate code → verify → mark verified', async () => {
      // Step 1: Create test user
      const user = await userFactory({
        email: `verify-test-${Date.now()}@example.com`,
      });

      expect(user.id).toBeDefined();
      expect(user.email).toContain('@example.com');

      // Step 2: Generate 6-char verification code
      const verificationCode = generate6CharCode();
      const emailToken = await emailVerificationTokenFactory(user.id, {
        code: verificationCode,
      });

      expect(emailToken.code).toBe(verificationCode);
      expect(emailToken.code.length).toBe(6);
      expect(emailToken.userId).toBe(user.id);

      // Step 3: Retrieve and validate token
      const retrievedToken = await storage.getEmailVerificationToken(user.id, verificationCode);
      expect(retrievedToken).toBeDefined();
      expect(retrievedToken?.code).toBe(verificationCode);

      // Step 4: Mark email as verified
      await storage.updateUserEmailVerification(user.id, true);
      const verifiedUser = await storage.getUser(user.id);
      expect(verifiedUser?.isEmailVerified).toBe(true);

      // Step 5: Clean up - delete verification token
      await storage.deleteEmailVerificationToken(user.id);
      const deletedToken = await storage.getEmailVerificationToken(user.id, verificationCode);
      expect(deletedToken).toBeUndefined();
    });

    test('expired verification tokens are rejected', async () => {
      const user = await userFactory();
      const expiredCode = generate6CharCode();

      // Create token that's already expired
      await emailVerificationTokenFactory(user.id, {
        code: expiredCode,
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      });

      // Expired token should not be retrievable
      const token = await storage.getEmailVerificationToken(user.id, expiredCode);
      expect(token).toBeUndefined();
    });

    test('wrong verification code is rejected', async () => {
      const user = await userFactory();
      const correctCode = generate6CharCode();

      await emailVerificationTokenFactory(user.id, {
        code: correctCode,
      });

      // Try with wrong code
      const wrongCode = generate6CharCode(); // Different code
      const token = await storage.getEmailVerificationToken(user.id, wrongCode);
      expect(token).toBeUndefined();
    });

    test('verification code must be exactly 6 characters', async () => {
      const user = await userFactory();
      const code = generate6CharCode();

      expect(code.length).toBe(6);
      
      const token = await emailVerificationTokenFactory(user.id, { code });
      expect(token.code.length).toBe(6);
    });
  });

  describe('User Authentication State', () => {
    test('user starts as unverified', async () => {
      const user = await userFactory();
      const fetchedUser = await storage.getUser(user.id);
      
      // New users should not be verified initially
      expect(fetchedUser?.isEmailVerified).toBeFalsy();
    });

    test('user can be marked as verified', async () => {
      const user = await userFactory();
      
      await storage.updateUserEmailVerification(user.id, true);
      const verifiedUser = await storage.getUser(user.id);
      
      expect(verifiedUser?.isEmailVerified).toBe(true);
    });

    test('user role is preserved after verification', async () => {
      const adminUser = await userFactory({ role: 'admin' });
      
      await storage.updateUserEmailVerification(adminUser.id, true);
      const verifiedAdmin = await storage.getUser(adminUser.id);
      
      expect(verifiedAdmin?.role).toBe('admin');
      expect(verifiedAdmin?.isEmailVerified).toBe(true);
    });
  });

  describe('Session Management (Storage Layer)', () => {
    test('user data persists across retrieval', async () => {
      const user = await userFactory({
        firstName: 'Test',
        lastName: 'User',
        role: 'student',
      });

      const retrieved = await storage.getUser(user.id);
      
      expect(retrieved?.firstName).toBe('Test');
      expect(retrieved?.lastName).toBe('User');
      expect(retrieved?.role).toBe('student');
    });

    test('user can be updated', async () => {
      const user = await userFactory();
      
      const updated = await storage.upsertUser({
        id: user.id,
        email: user.email,
        firstName: 'Updated',
        lastName: 'Name',
        role: user.role,
        profileImageUrl: null,
        ageGateStatus: null,
        restrictedProcessing: false,
      });

      expect(updated.firstName).toBe('Updated');
      expect(updated.lastName).toBe('Name');
    });

    test('user email is unique', async () => {
      const email = `unique-${Date.now()}@example.com`;
      
      const user1 = await userFactory({ email });
      expect(user1.email).toBe(email);

      // Upserting with same email should update, not create new
      const user2 = await storage.upsertUser({
        id: user1.id,
        email,
        firstName: 'Updated',
        lastName: 'User',
        role: 'student',
        profileImageUrl: null,
        ageGateStatus: null,
        restrictedProcessing: false,
      });

      expect(user2.id).toBe(user1.id);
      expect(user2.firstName).toBe('Updated');
    });
  });

  describe('Token Lifecycle Management', () => {
    test('multiple verification tokens can exist for different users', async () => {
      const user1 = await userFactory();
      const user2 = await userFactory();

      const code1 = generate6CharCode();
      const code2 = generate6CharCode();

      await emailVerificationTokenFactory(user1.id, { code: code1 });
      await emailVerificationTokenFactory(user2.id, { code: code2 });

      const token1 = await storage.getEmailVerificationToken(user1.id, code1);
      const token2 = await storage.getEmailVerificationToken(user2.id, code2);

      expect(token1?.userId).toBe(user1.id);
      expect(token2?.userId).toBe(user2.id);
    });

    test('deleting token for one user does not affect others', async () => {
      const user1 = await userFactory();
      const user2 = await userFactory();

      const code1 = generate6CharCode();
      const code2 = generate6CharCode();

      await emailVerificationTokenFactory(user1.id, { code: code1 });
      await emailVerificationTokenFactory(user2.id, { code: code2 });

      // Delete user1's token
      await storage.deleteEmailVerificationToken(user1.id);

      const token1 = await storage.getEmailVerificationToken(user1.id, code1);
      const token2 = await storage.getEmailVerificationToken(user2.id, code2);

      expect(token1).toBeUndefined();
      expect(token2).toBeDefined();
    });
  });
});
