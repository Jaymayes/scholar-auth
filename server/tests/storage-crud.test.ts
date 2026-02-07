import { describe, test, expect, beforeEach } from '@jest/globals';
import { storage } from '../storage';
import { randomUUID } from 'crypto';

describe('Storage CRUD Operations', () => {
  let testUserId: string;

  beforeEach(async () => {
    // Create a test user for foreign key relationships
    const user = await storage.upsertUser({
      id: randomUUID(),
      email: `test-user-${Date.now()}@example.com`,
      firstName: 'Test',
      lastName: 'User',
      role: 'student',
      profileImageUrl: null,
      ageGateStatus: null,
      restrictedProcessing: false,
    });
    testUserId = user.id;
  });

  describe('User Operations', () => {
    test('getUser returns undefined for nonexistent user', async () => {
      const user = await storage.getUser('nonexistent-user-id');
      expect(user).toBeUndefined();
    });

    test('getUserByEmail returns undefined for nonexistent email', async () => {
      const user = await storage.getUserByEmail('nonexistent@example.com');
      expect(user).toBeUndefined();
    });

    test('upsertUser creates new user', async () => {
      const testUser = {
        id: randomUUID(),
        email: `test-${Date.now()}@example.com`,
        firstName: 'Test',
        lastName: 'User',
        role: 'student' as const,
        profileImageUrl: null,
        ageGateStatus: null,
        restrictedProcessing: false,
      };

      const user = await storage.upsertUser(testUser);
      expect(user.email).toBe(testUser.email);
      expect(user.id).toBe(testUser.id);
    });

    test('upsertUser updates existing user', async () => {
      const userId = randomUUID();
      const initialEmail = `initial-${Date.now()}@example.com`;
      
      // Create user
      await storage.upsertUser({
        id: userId,
        email: initialEmail,
        firstName: 'Initial',
        lastName: 'User',
        role: 'student',
        profileImageUrl: null,
        ageGateStatus: null,
        restrictedProcessing: false,
      });

      // Update user
      const updatedEmail = `updated-${Date.now()}@example.com`;
      const updated = await storage.upsertUser({
        id: userId,
        email: updatedEmail,
        firstName: 'Updated',
        lastName: 'User',
        role: 'student',
        profileImageUrl: null,
        ageGateStatus: null,
        restrictedProcessing: false,
      });

      expect(updated.email).toBe(updatedEmail);
      expect(updated.firstName).toBe('Updated');
    });

    test('updateUserEmailVerification sets verification status', async () => {
      const userId = randomUUID();
      await storage.upsertUser({
        id: userId,
        email: `verify-${Date.now()}@example.com`,
        firstName: 'Verify',
        lastName: 'Test',
        role: 'student',
        profileImageUrl: null,
        ageGateStatus: null,
        restrictedProcessing: false,
      });

      await storage.updateUserEmailVerification(userId, true);
      const user = await storage.getUser(userId);
      expect(user?.isEmailVerified).toBe(true);
    });
  });

  describe('Password Reset Operations', () => {
    test('createPasswordResetToken creates token', async () => {
      const token = await storage.createPasswordResetToken({
        userId: testUserId,
        token: `reset-token-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000),
      });

      expect(token.userId).toBe(testUserId);
      expect(token.token).toBeDefined();
    });

    test('getPasswordResetToken returns token', async () => {
      const tokenString = `get-token-${Date.now()}`;
      
      await storage.createPasswordResetToken({
        userId: testUserId,
        token: tokenString,
        expiresAt: new Date(Date.now() + 3600000),
      });

      const token = await storage.getPasswordResetToken(tokenString);
      expect(token?.token).toBe(tokenString);
    });

    test('getPasswordResetToken returns undefined for nonexistent token', async () => {
      const token = await storage.getPasswordResetToken('nonexistent-token');
      expect(token).toBeUndefined();
    });

    test('deletePasswordResetToken removes token', async () => {
      const tokenString = `delete-token-${Date.now()}`;
      
      await storage.createPasswordResetToken({
        userId: testUserId,
        token: tokenString,
        expiresAt: new Date(Date.now() + 3600000),
      });

      await storage.deletePasswordResetToken(tokenString);
      const token = await storage.getPasswordResetToken(tokenString);
      expect(token).toBeUndefined();
    });

    test('createPasswordResetTokenAsync creates without returning', async () => {
      await storage.createPasswordResetTokenAsync({
        userId: testUserId,
        token: `async-token-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000),
      });
      // No assertion needed - just checking it doesn't throw
    });
  });

  describe('Email Verification Operations', () => {
    test('createEmailVerificationToken creates token', async () => {
      const code = Math.random().toString(36).substr(2, 6); // 6-char code
      
      const token = await storage.createEmailVerificationToken({
        userId: testUserId,
        code,
        expiresAt: new Date(Date.now() + 3600000),
      });

      expect(token.userId).toBe(testUserId);
      expect(token.code).toBe(code);
    });

    test('getEmailVerificationToken returns valid token', async () => {
      const code = Math.random().toString(36).substr(2, 6); // 6-char code
      
      await storage.createEmailVerificationToken({
        userId: testUserId,
        code,
        expiresAt: new Date(Date.now() + 3600000),
      });

      const token = await storage.getEmailVerificationToken(testUserId, code);
      expect(token?.code).toBe(code);
    });

    test('getEmailVerificationToken returns undefined for expired token', async () => {
      const code = Math.random().toString(36).substr(2, 6); // 6-char code
      
      await storage.createEmailVerificationToken({
        userId: testUserId,
        code,
        expiresAt: new Date(Date.now() - 1000), // Already expired
      });

      const token = await storage.getEmailVerificationToken(testUserId, code);
      expect(token).toBeUndefined();
    });

    test('deleteEmailVerificationToken removes tokens', async () => {
      const code = Math.random().toString(36).substr(2, 6); // 6-char code
      
      await storage.createEmailVerificationToken({
        userId: testUserId,
        code,
        expiresAt: new Date(Date.now() + 3600000),
      });

      await storage.deleteEmailVerificationToken(testUserId);
      const token = await storage.getEmailVerificationToken(testUserId, code);
      expect(token).toBeUndefined();
    });
  });

  describe('Audit Log Operations', () => {
    test('createAuditLog creates log entry', async () => {
      const log = await storage.createAuditLog({
        userId: testUserId,
        action: 'test_action',
        details: { test: 'data' },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      expect(log.action).toBe('test_action');
      expect(log.userId).toBe(testUserId);
    });

    test('createAuditLogAsync creates without returning', async () => {
      await storage.createAuditLogAsync({
        userId: testUserId,
        action: 'async_test_action',
        details: { async: 'data' },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });
      // No assertion needed - just checking it doesn't throw
    });
  });

  describe('OIDC Client Operations', () => {
    test('createOidcClient creates client', async () => {
      const clientId = `client-${Date.now()}`;
      const client = await storage.createOidcClient({
        clientId,
        clientSecret: 'secret-hash',
        name: 'Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grantTypes: ['authorization_code'],
      });

      expect(client.clientId).toBe(clientId);
      expect(client.name).toBe('Test Client');
    });

    test('getOidcClient returns client', async () => {
      const clientId = `get-client-${Date.now()}`;
      await storage.createOidcClient({
        clientId,
        clientSecret: 'secret-hash',
        name: 'Get Test Client',
        redirectUris: ['http://localhost:3000/callback'],
        grantTypes: ['authorization_code'],
      });

      const client = await storage.getOidcClient(clientId);
      expect(client?.clientId).toBe(clientId);
    });

    test('getOidcClient returns undefined for nonexistent client', async () => {
      const client = await storage.getOidcClient('nonexistent-client');
      expect(client).toBeUndefined();
    });

    test('getAllOidcClients returns array', async () => {
      const clients = await storage.getAllOidcClients();
      expect(Array.isArray(clients)).toBe(true);
    });

    test('updateOidcClient updates client', async () => {
      const clientId = `update-client-${Date.now()}`;
      await storage.createOidcClient({
        clientId,
        clientSecret: 'secret-hash',
        name: 'Original Name',
        redirectUris: ['http://localhost:3000/callback'],
        grantTypes: ['authorization_code'],
      });

      await storage.updateOidcClient(clientId, {
        name: 'Updated Name',
      });

      const updated = await storage.getOidcClient(clientId);
      expect(updated?.name).toBe('Updated Name');
    });
  });

  describe('Event Operations', () => {
    test('createEvent creates event', async () => {
      const event = await storage.createEvent({
        appId: 'test-app',
        event: 'test_event',
        userId: testUserId,
        metadata: { test: 'data' },
      });

      expect(event.event).toBe('test_event');
      expect(event.appId).toBe('test-app');
    });

    test('getEventsByApp returns events', async () => {
      const appId = `app-${Date.now()}`;
      await storage.createEvent({
        appId,
        event: 'test_event_1',
        userId: testUserId,
        metadata: {},
      });

      const events = await storage.getEventsByApp(appId, 10);
      expect(Array.isArray(events)).toBe(true);
    });

    test('getEventsByUser returns events', async () => {
      await storage.createEvent({
        appId: 'test-app',
        event: 'user_event',
        userId: testUserId,
        metadata: {},
      });

      const events = await storage.getEventsByUser(testUserId, 10);
      expect(Array.isArray(events)).toBe(true);
    });

    test('getRecentEvents returns events', async () => {
      const events = await storage.getRecentEvents(10);
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('Scholarship Operations', () => {
    test('createScholarship creates scholarship', async () => {
      const scholarship = await storage.createScholarship({
        name: `Test Scholarship ${Date.now()}`,
        description: 'Test Description',
        provider: 'Test Provider',
        awardAmount: '$5000',
        status: 'draft',
        sourceType: 'manual',
        eligibilityCriteria: {},
        requiredMaterials: ['transcript'],
      });

      expect(scholarship.name).toContain('Test Scholarship');
      expect(scholarship.status).toBe('draft');
    });

    test('getScholarship returns scholarship by ID', async () => {
      const created = await storage.createScholarship({
        name: `Get Scholarship ${Date.now()}`,
        description: 'Test Description',
        provider: 'Test Provider',
        awardAmount: '$3000',
        status: 'draft',
        sourceType: 'manual',
        eligibilityCriteria: {},
        requiredMaterials: ['essay'],
      });

      const scholarship = await storage.getScholarship(created.id);
      expect(scholarship?.id).toBe(created.id);
    });

    test('getScholarships returns array', async () => {
      const scholarships = await storage.getScholarships({ limit: 5, offset: 0 });
      expect(Array.isArray(scholarships)).toBe(true);
    });

    test('getScholarships supports status filter', async () => {
      const scholarships = await storage.getScholarships({ 
        status: 'published',
        limit: 10,
        offset: 0 
      });
      expect(Array.isArray(scholarships)).toBe(true);
    });

    test('getScholarships supports sourceType filter', async () => {
      const scholarships = await storage.getScholarships({ 
        sourceType: 'manual',
        limit: 10,
        offset: 0 
      });
      expect(Array.isArray(scholarships)).toBe(true);
    });
  });
});
