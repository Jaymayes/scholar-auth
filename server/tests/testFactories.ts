import { randomUUID } from 'crypto';
import { storage } from '../storage';
import { TestStateManager } from './testUtils';

/**
 * Test Factories for FK-Safe Entity Creation
 * 
 * These factories ensure all entities have valid foreign key relationships
 * and consistent test data generation.
 * 
 * IMPORTANT: Use TestStateManager to track created entities for cleanup
 */

// Global state manager for tests (reset in afterEach)
let globalStateManager: TestStateManager | null = null;

export function setTestStateManager(manager: TestStateManager) {
  globalStateManager = manager;
}

export function getTestStateManager(): TestStateManager {
  if (!globalStateManager) {
    throw new Error('TestStateManager not initialized. Call setTestStateManager in beforeEach.');
  }
  return globalStateManager;
}

export interface TestUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'student' | 'admin' | 'reviewer';
}

export interface TestParent {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Creates a test user with valid data
 */
export async function userFactory(overrides?: Partial<TestUser>): Promise<TestUser> {
  const timestamp = Date.now();
  const defaults = {
    id: randomUUID(),
    email: `test-user-${timestamp}-${Math.random().toString(36).substr(2, 5)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    role: 'student' as const,
  };

  const userData = { ...defaults, ...overrides };

  const user = await storage.upsertUser({
    ...userData,
    profileImageUrl: null,
    ageGateStatus: null,
    restrictedProcessing: false,
  });

  // Register for cleanup if state manager is available
  if (globalStateManager) {
    globalStateManager.registerUser(user.id);
  }

  return {
    id: user.id,
    email: user.email || defaults.email,
    firstName: user.firstName || defaults.firstName,
    lastName: user.lastName || defaults.lastName,
    role: (user.role || defaults.role) as 'student' | 'admin' | 'reviewer',
  };
}

/**
 * Creates a test parent with valid data
 */
export async function parentFactory(overrides?: Partial<TestParent>): Promise<TestParent> {
  const timestamp = Date.now();
  const defaults = {
    email: `parent-${timestamp}-${Math.random().toString(36).substr(2, 5)}@example.com`,
    firstName: 'Parent',
    lastName: 'Test',
  };

  const parentData = { ...defaults, ...overrides };

  const parent = await storage.createParent({
    ...parentData,
    verificationStatus: 'pending',
    verificationMethod: null,
    verificationEvidence: null,
  });

  // Register for cleanup if state manager is available
  if (globalStateManager) {
    globalStateManager.registerParent(parent.id);
  }

  return {
    id: parent.id,
    email: parent.email || defaults.email,
    firstName: parent.firstName || defaults.firstName,
    lastName: parent.lastName || defaults.lastName,
  };
}

/**
 * Creates a test scholarship with valid data
 */
export async function scholarshipFactory(overrides?: any) {
  const timestamp = Date.now();
  const defaults = {
    name: `Test Scholarship ${timestamp}`,
    description: 'Test scholarship description',
    provider: 'Test Provider',
    awardAmount: '$5000',
    status: 'draft',
    sourceType: 'manual',
    eligibilityCriteria: {},
    requiredMaterials: ['transcript'],
  };

  const scholarshipData = { ...defaults, ...overrides };
  return await storage.createScholarship(scholarshipData);
}

/**
 * Creates a test password reset token for a user
 */
export async function passwordResetTokenFactory(userId: string, overrides?: any) {
  const timestamp = Date.now();
  const defaults = {
    userId,
    token: `reset-${timestamp}-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
  };

  const tokenData = { ...defaults, ...overrides };
  return await storage.createPasswordResetToken(tokenData);
}

/**
 * Creates a test email verification token for a user
 * Note: Code must be exactly 6 characters
 */
export async function emailVerificationTokenFactory(userId: string, overrides?: any) {
  const code = Math.random().toString(36).substr(2, 6).toUpperCase();
  const defaults = {
    userId,
    code,
    expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
  };

  const tokenData = { ...defaults, ...overrides };
  return await storage.createEmailVerificationToken(tokenData);
}

/**
 * Creates a test audit log entry for a user
 */
export async function auditLogFactory(userId: string, overrides?: any) {
  const defaults = {
    userId,
    action: 'test_action',
    details: { test: 'data' },
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
  };

  const logData = { ...defaults, ...overrides };
  return await storage.createAuditLog(logData);
}

/**
 * Creates a test event for a user
 */
export async function eventFactory(userId: string, overrides?: any) {
  const timestamp = Date.now();
  const defaults = {
    appId: 'test-app',
    event: 'test_event',
    userId,
    metadata: { timestamp },
  };

  const eventData = { ...defaults, ...overrides };
  return await storage.createEvent(eventData);
}

/**
 * Creates a test OIDC client
 */
export async function oidcClientFactory(overrides?: any) {
  const timestamp = Date.now();
  const defaults = {
    clientId: `client-${timestamp}-${randomUUID()}`,
    clientSecret: `secret-${randomUUID()}`,
    name: `Test Client ${timestamp}`,
    redirectUris: ['http://localhost:3000/callback'],
    grantTypes: ['authorization_code'],
  };

  const clientData = { ...defaults, ...overrides };
  const client = await storage.createOidcClient(clientData);

  // Register for cleanup if state manager is available
  if (globalStateManager) {
    globalStateManager.registerOidcClient(client.clientId);
  }

  return client;
}

/**
 * Creates a test consent record for a user
 */
export async function consentFactory(userId: string, overrides?: any) {
  const defaults = {
    userId,
    consentType: 'coppa_parental',
    consentStatus: 'granted',
    consentMethod: 'web_form',
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    expiryDate: null,
    revokedDate: null,
  };

  const consentData = { ...defaults, ...overrides };
  return await storage.createConsent(consentData);
}

/**
 * Creates a test data request for a user
 */
export async function dataRequestFactory(userId: string, overrides?: any) {
  const defaults = {
    userId,
    requestType: 'export',
    status: 'pending',
    requestedData: {},
  };

  const requestData = { ...defaults, ...overrides };
  return await storage.createDataRequest(requestData);
}

/**
 * Generates a deterministic 6-character verification code
 */
export function generate6CharCode(): string {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

/**
 * Creates a complete test user context with common related entities
 */
export async function createTestUserContext() {
  const user = await userFactory();
  const passwordResetToken = await passwordResetTokenFactory(user.id);
  const emailVerificationToken = await emailVerificationTokenFactory(user.id);
  const auditLog = await auditLogFactory(user.id, { action: 'user_created' });
  const event = await eventFactory(user.id, { event: 'signup' });

  return {
    user,
    passwordResetToken,
    emailVerificationToken,
    auditLog,
    event,
  };
}
