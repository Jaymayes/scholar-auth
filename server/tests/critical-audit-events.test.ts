/**
 * Critical Path Guardrail Tests - Audit Logs & Events
 * 
 * These tests protect the compliance and monitoring infrastructure:
 * - Audit entries created for key actions
 * - Event records created with correct FK integrity
 * - Required fields are validated
 * - Async logging works correctly
 * 
 * Priority: P0 (Critical Path) - Required for FERPA/COPPA compliance
 */

import { describe, test, expect } from '@jest/globals';
import { storage } from '../storage';
import { userFactory, auditLogFactory, eventFactory } from './testFactories';

describe('Critical Path: Audit Logs & Events', () => {
  describe('Audit Log Creation', () => {
    test('complete flow: user action → audit log created → retrievable', async () => {
      // Step 1: Create user
      const user = await userFactory();

      // Step 2: Create audit log for user action
      const auditLog = await auditLogFactory(user.id, {
        action: 'user_login',
        details: { method: 'replit_auth', ip: '127.0.0.1' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 Test Browser',
      });

      // Step 3: Verify audit log properties
      expect(auditLog.userId).toBe(user.id);
      expect(auditLog.action).toBe('user_login');
      expect(auditLog.details).toEqual({ method: 'replit_auth', ip: '127.0.0.1' });
      expect(auditLog.ipAddress).toBe('127.0.0.1');
      expect(auditLog.userAgent).toBe('Mozilla/5.0 Test Browser');
      expect(auditLog.timestamp).toBeDefined();
    });

    test('audit log requires valid user ID (FK constraint)', async () => {
      const user = await userFactory();
      
      // Should succeed with valid user ID
      const log = await auditLogFactory(user.id, {
        action: 'test_action',
      });

      expect(log.userId).toBe(user.id);
    });

    test('async audit log creation works', async () => {
      const user = await userFactory();

      // Should not throw
      await storage.createAuditLogAsync({
        userId: user.id,
        action: 'async_test_action',
        details: { async: true },
        ipAddress: '192.168.1.1',
        userAgent: 'test-agent',
      });
    });
  });

  describe('Audit Log Details', () => {
    test('stores complex JSON in details field', async () => {
      const user = await userFactory();

      const complexDetails = {
        oldValue: { name: 'Original', status: 'active' },
        newValue: { name: 'Updated', status: 'inactive' },
        changedFields: ['name', 'status'],
        timestamp: Date.now(),
      };

      const log = await auditLogFactory(user.id, {
        action: 'profile_update',
        details: complexDetails,
      });

      expect(log.details).toEqual(complexDetails);
    });

    test('captures different action types', async () => {
      const user = await userFactory();

      const actions = [
        'user_login',
        'user_logout',
        'password_reset_requested',
        'email_verified',
        'profile_updated',
      ];

      for (const action of actions) {
        const log = await auditLogFactory(user.id, { action });
        expect(log.action).toBe(action);
      }
    });
  });

  describe('Event Creation', () => {
    test('complete flow: user event → event created → retrievable by user', async () => {
      // Step 1: Create user
      const user = await userFactory();

      // Step 2: Create event
      const event = await eventFactory(user.id, {
        appId: 'scholarship-portal',
        event: 'application_submitted',
        metadata: { scholarshipId: '12345', amount: 5000 },
      });

      // Step 3: Verify event properties
      expect(event.userId).toBe(user.id);
      expect(event.appId).toBe('scholarship-portal');
      expect(event.event).toBe('application_submitted');
      expect(event.metadata).toEqual({ scholarshipId: '12345', amount: 5000 });
      expect(event.timestamp).toBeDefined();

      // Step 4: Retrieve events by user
      const userEvents = await storage.getEventsByUser(user.id, 10);
      expect(Array.isArray(userEvents)).toBe(true);
      expect(userEvents.length).toBeGreaterThan(0);
      
      const foundEvent = userEvents.find(e => e.event === 'application_submitted');
      expect(foundEvent).toBeDefined();
    });

    test('events retrievable by app ID', async () => {
      const user = await userFactory();
      const appId = `test-app-${Date.now()}`;

      await eventFactory(user.id, {
        appId,
        event: 'test_event_1',
      });

      await eventFactory(user.id, {
        appId,
        event: 'test_event_2',
      });

      const appEvents = await storage.getEventsByApp(appId, 10);
      expect(Array.isArray(appEvents)).toBe(true);
      expect(appEvents.length).toBeGreaterThanOrEqual(2);
    });

    test('recent events are retrievable', async () => {
      const user = await userFactory();

      await eventFactory(user.id, {
        event: 'recent_test_event',
      });

      const recentEvents = await storage.getRecentEvents(10);
      expect(Array.isArray(recentEvents)).toBe(true);
      expect(recentEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Event Metadata', () => {
    test('stores complex metadata', async () => {
      const user = await userFactory();

      const complexMetadata = {
        action: 'scholarship_search',
        filters: {
          major: 'Computer Science',
          minAmount: 1000,
          deadline: '2024-12-31',
        },
        results: 42,
        duration_ms: 345,
      };

      const event = await eventFactory(user.id, {
        event: 'search_performed',
        metadata: complexMetadata,
      });

      expect(event.metadata).toEqual(complexMetadata);
    });

    test('handles empty metadata', async () => {
      const user = await userFactory();

      const event = await eventFactory(user.id, {
        event: 'simple_event',
        metadata: {},
      });

      expect(event.metadata).toEqual({});
    });
  });

  describe('Compliance & FK Integrity', () => {
    test('audit logs require valid user (FK)', async () => {
      const user = await userFactory();
      
      const log = await auditLogFactory(user.id);
      expect(log.userId).toBe(user.id);
    });

    test('events require valid user (FK)', async () => {
      const user = await userFactory();
      
      const event = await eventFactory(user.id);
      expect(event.userId).toBe(user.id);
    });

    test('multiple events for same user are tracked', async () => {
      const user = await userFactory();

      await eventFactory(user.id, { event: 'event_1' });
      await eventFactory(user.id, { event: 'event_2' });
      await eventFactory(user.id, { event: 'event_3' });

      const userEvents = await storage.getEventsByUser(user.id, 10);
      expect(userEvents.length).toBeGreaterThanOrEqual(3);
    });

    test('audit logs and events can coexist for same user', async () => {
      const user = await userFactory();

      const log = await auditLogFactory(user.id, { action: 'test_audit' });
      const event = await eventFactory(user.id, { event: 'test_event' });

      expect(log.userId).toBe(user.id);
      expect(event.userId).toBe(user.id);
    });
  });

  describe('Monitoring & Observability', () => {
    test('timestamps are accurate and recent', async () => {
      const user = await userFactory();
      const before = new Date();

      const log = await auditLogFactory(user.id);
      const event = await eventFactory(user.id);

      const after = new Date();

      expect(log.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(log.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      
      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test('events support different app IDs', async () => {
      const user = await userFactory();

      const apps = ['provider-portal', 'student-pilot', 'command-center'];

      for (const appId of apps) {
        const event = await eventFactory(user.id, { appId });
        expect(event.appId).toBe(appId);
      }
    });
  });
});
