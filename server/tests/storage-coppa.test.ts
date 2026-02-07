import { describe, test, expect, beforeEach } from '@jest/globals';
import { storage } from '../storage';
import { randomUUID } from 'crypto';

describe('Storage COPPA & Parent Consent Operations', () => {
  describe('Parent Management', () => {
    test('createParent creates new parent', async () => {
      const parent = await storage.createParent({
        email: `parent-${Date.now()}@example.com`,
        firstName: 'Parent',
        lastName: 'Test',
        verificationStatus: 'pending',
        verificationMethod: null,
        verificationEvidence: null,
      });

      expect(parent.email).toContain('@example.com');
      expect(parent.verificationStatus).toBe('pending');
    });

    test('getParent returns parent by ID', async () => {
      const created = await storage.createParent({
        email: `get-parent-${Date.now()}@example.com`,
        firstName: 'Get',
        lastName: 'Parent',
        verificationStatus: 'pending',
        verificationMethod: null,
        verificationEvidence: null,
      });

      const parent = await storage.getParent(created.id);
      expect(parent?.id).toBe(created.id);
    });

    test('getParent returns undefined for nonexistent parent', async () => {
      const parent = await storage.getParent('nonexistent-parent-id');
      expect(parent).toBeUndefined();
    });

    test('getParentByEmail returns parent by email', async () => {
      const email = `email-parent-${Date.now()}@example.com`;
      await storage.createParent({
        email,
        firstName: 'Email',
        lastName: 'Test',
        verificationStatus: 'pending',
        verificationMethod: null,
        verificationEvidence: null,
      });

      const parent = await storage.getParentByEmail(email);
      expect(parent?.email).toBe(email);
    });

    test('getParentByEmail returns undefined for nonexistent email', async () => {
      const parent = await storage.getParentByEmail('nonexistent@example.com');
      expect(parent).toBeUndefined();
    });

    test('updateParentVerification updates verification status', async () => {
      const created = await storage.createParent({
        email: `verify-parent-${Date.now()}@example.com`,
        firstName: 'Verify',
        lastName: 'Parent',
        verificationStatus: 'pending',
        verificationMethod: null,
        verificationEvidence: null,
      });

      const updated = await storage.updateParentVerification(
        created.id,
        'verified',
        'credit_card',
        'Last 4 digits: 1234'
      );

      expect(updated.verificationStatus).toBe('verified');
      expect(updated.verificationMethod).toBe('credit_card');
      expect(updated.verificationEvidence).toBe('Last 4 digits: 1234');
    });
  });

  describe('Parent-Child Links', () => {
    test('createParentChildLink creates link', async () => {
      const parentId = randomUUID();
      const childId = randomUUID();

      const link = await storage.createParentChildLink({
        parentId,
        childId,
        relationship: 'parent',
        verificationStatus: 'verified',
      });

      expect(link.parentId).toBe(parentId);
      expect(link.childId).toBe(childId);
      expect(link.relationship).toBe('parent');
    });

    test('getParentChildLinks returns links for parent', async () => {
      const parentId = randomUUID();
      const childId1 = randomUUID();
      const childId2 = randomUUID();

      await storage.createParentChildLink({
        parentId,
        childId: childId1,
        relationship: 'parent',
        verificationStatus: 'verified',
      });

      await storage.createParentChildLink({
        parentId,
        childId: childId2,
        relationship: 'guardian',
        verificationStatus: 'pending',
      });

      const links = await storage.getParentChildLinks(parentId);
      expect(links.length).toBeGreaterThanOrEqual(2);
      expect(links.some(l => l.childId === childId1)).toBe(true);
      expect(links.some(l => l.childId === childId2)).toBe(true);
    });

    test('getChildParents returns links for child', async () => {
      const childId = randomUUID();
      const parentId1 = randomUUID();
      const parentId2 = randomUUID();

      await storage.createParentChildLink({
        parentId: parentId1,
        childId,
        relationship: 'parent',
        verificationStatus: 'verified',
      });

      await storage.createParentChildLink({
        parentId: parentId2,
        childId,
        relationship: 'guardian',
        verificationStatus: 'verified',
      });

      const links = await storage.getChildParents(childId);
      expect(links.length).toBeGreaterThanOrEqual(2);
      expect(links.some(l => l.parentId === parentId1)).toBe(true);
      expect(links.some(l => l.parentId === parentId2)).toBe(true);
    });
  });

  describe('Consent Management', () => {
    test('createConsent creates consent with event', async () => {
      const userId = randomUUID();
      const consent = await storage.createConsent({
        userId,
        consentType: 'coppa_parental',
        consentStatus: 'granted',
        consentMethod: 'web_form',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiryDate: null,
        revokedDate: null,
      });

      expect(consent.userId).toBe(userId);
      expect(consent.consentType).toBe('coppa_parental');
      expect(consent.consentStatus).toBe('granted');
    });

    test('getConsent returns consent by ID', async () => {
      const userId = randomUUID();
      const created = await storage.createConsent({
        userId,
        consentType: 'terms_of_service',
        consentStatus: 'granted',
        consentMethod: 'web_form',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiryDate: null,
        revokedDate: null,
      });

      const consent = await storage.getConsent(created.id);
      expect(consent?.id).toBe(created.id);
    });

    test('getConsent returns undefined for nonexistent consent', async () => {
      const consent = await storage.getConsent('nonexistent-consent-id');
      expect(consent).toBeUndefined();
    });

    test('getUserConsents returns all consents for user', async () => {
      const userId = randomUUID();

      await storage.createConsent({
        userId,
        consentType: 'coppa_parental',
        consentStatus: 'granted',
        consentMethod: 'web_form',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiryDate: null,
        revokedDate: null,
      });

      await storage.createConsent({
        userId,
        consentType: 'marketing',
        consentStatus: 'denied',
        consentMethod: 'web_form',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiryDate: null,
        revokedDate: null,
      });

      const consents = await storage.getUserConsents(userId);
      expect(consents.length).toBeGreaterThanOrEqual(2);
      expect(consents.some(c => c.consentType === 'coppa_parental')).toBe(true);
      expect(consents.some(c => c.consentType === 'marketing')).toBe(true);
    });

    test('hasValidParentalConsent returns true for valid consent', async () => {
      const userId = randomUUID();
      await storage.createConsent({
        userId,
        consentType: 'coppa_parental',
        consentStatus: 'granted',
        consentMethod: 'web_form',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiryDate: null,
        revokedDate: null,
      });

      const hasConsent = await storage.hasValidParentalConsent(userId);
      expect(hasConsent).toBe(true);
    });

    test('hasValidParentalConsent returns false for no consent', async () => {
      const userId = randomUUID();
      const hasConsent = await storage.hasValidParentalConsent(userId);
      expect(hasConsent).toBe(false);
    });

    test('hasValidParentalConsent returns false for revoked consent', async () => {
      const userId = randomUUID();
      const consent = await storage.createConsent({
        userId,
        consentType: 'coppa_parental',
        consentStatus: 'granted',
        consentMethod: 'web_form',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiryDate: null,
        revokedDate: null,
      });

      await storage.revokeConsent(consent.id, 'user_requested');

      const hasConsent = await storage.hasValidParentalConsent(userId);
      expect(hasConsent).toBe(false);
    });

    test('revokeConsent updates status and creates event', async () => {
      const userId = randomUUID();
      const consent = await storage.createConsent({
        userId,
        consentType: 'coppa_parental',
        consentStatus: 'granted',
        consentMethod: 'web_form',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiryDate: null,
        revokedDate: null,
      });

      await storage.revokeConsent(consent.id, 'parent_requested');

      const updated = await storage.getConsent(consent.id);
      expect(updated?.consentStatus).toBe('revoked');
      expect(updated?.revokedDate).toBeDefined();
    });
  });

  describe('Data Requests (GDPR/CCPA)', () => {
    test('createDataRequest creates request', async () => {
      const userId = randomUUID();
      const request = await storage.createDataRequest({
        userId,
        requestType: 'export',
        status: 'pending',
        requestedData: { types: ['profile', 'events'] },
      });

      expect(request.userId).toBe(userId);
      expect(request.requestType).toBe('export');
      expect(request.status).toBe('pending');
    });

    test('getDataRequest returns request by ID', async () => {
      const userId = randomUUID();
      const created = await storage.createDataRequest({
        userId,
        requestType: 'deletion',
        status: 'pending',
        requestedData: {},
      });

      const request = await storage.getDataRequest(created.id);
      expect(request?.id).toBe(created.id);
    });

    test('getDataRequest returns undefined for nonexistent request', async () => {
      const request = await storage.getDataRequest('nonexistent-request-id');
      expect(request).toBeUndefined();
    });

    test('getUserDataRequests returns all requests for user', async () => {
      const userId = randomUUID();

      await storage.createDataRequest({
        userId,
        requestType: 'export',
        status: 'pending',
        requestedData: {},
      });

      await storage.createDataRequest({
        userId,
        requestType: 'deletion',
        status: 'completed',
        requestedData: {},
      });

      const requests = await storage.getUserDataRequests(userId);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(requests.some(r => r.requestType === 'export')).toBe(true);
      expect(requests.some(r => r.requestType === 'deletion')).toBe(true);
    });

    test('updateDataRequestStatus updates status', async () => {
      const userId = randomUUID();
      const created = await storage.createDataRequest({
        userId,
        requestType: 'export',
        status: 'pending',
        requestedData: {},
      });

      await storage.updateDataRequestStatus(created.id, 'processing');

      const updated = await storage.getDataRequest(created.id);
      expect(updated?.status).toBe('processing');
    });

    test('updateDataRequestStatus sets fulfilled date on completion', async () => {
      const userId = randomUUID();
      const created = await storage.createDataRequest({
        userId,
        requestType: 'export',
        status: 'pending',
        requestedData: {},
      });

      await storage.updateDataRequestStatus(created.id, 'completed');

      const updated = await storage.getDataRequest(created.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.fulfilledAt).toBeDefined();
    });
  });
});
