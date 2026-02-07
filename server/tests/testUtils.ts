/**
 * Test Utilities for State Management and Cleanup
 * 
 * Provides utilities to prevent cross-test contamination
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';
import { 
  users, 
  emailVerificationTokens, 
  passwordResetTokens,
  auditLogs,
  events,
  parents,
  consents,
  dataRequests,
  oidcClients
} from '@shared/schema';

/**
 * Track entities created during tests for cleanup
 */
export class TestStateManager {
  private userIds: Set<string> = new Set();
  private parentIds: Set<string> = new Set();
  private oidcClientIds: Set<string> = new Set();

  /**
   * Register a user ID for cleanup
   */
  registerUser(userId: string) {
    this.userIds.add(userId);
  }

  /**
   * Register a parent ID for cleanup
   */
  registerParent(parentId: string) {
    this.parentIds.add(parentId);
  }

  /**
   * Register an OIDC client ID for cleanup
   */
  registerOidcClient(clientId: string) {
    this.oidcClientIds.add(clientId);
  }

  /**
   * Clean up all registered test data
   * Order matters - delete children before parents to respect FK constraints
   */
  async cleanup() {
    try {
      // Convert Sets to Arrays for iteration
      const userIdArray = Array.from(this.userIds);
      const parentIdArray = Array.from(this.parentIds);
      const clientIdArray = Array.from(this.oidcClientIds);

      // Delete child records first (FK dependencies)
      for (const userId of userIdArray) {
        await db.delete(emailVerificationTokens).where(sql`user_id = ${userId}`);
        await db.delete(passwordResetTokens).where(sql`user_id = ${userId}`);
        await db.delete(auditLogs).where(sql`user_id = ${userId}`);
        await db.delete(events).where(sql`user_id = ${userId}`);
        await db.delete(consents).where(sql`user_id = ${userId}`);
        await db.delete(dataRequests).where(sql`user_id = ${userId}`);
      }

      // Delete parent records
      for (const parentId of parentIdArray) {
        await db.delete(parents).where(sql`id = ${parentId}`);
      }

      // Delete users (no FKs remaining)
      for (const userId of userIdArray) {
        await db.delete(users).where(sql`id = ${userId}`);
      }

      // Delete OIDC clients
      for (const clientId of clientIdArray) {
        await db.delete(oidcClients).where(sql`client_id = ${clientId}`);
      }

      // Clear tracked IDs
      this.userIds.clear();
      this.parentIds.clear();
      this.oidcClientIds.clear();
    } catch (error) {
      console.error('Cleanup error:', error);
      // Don't throw - cleanup failures shouldn't fail tests
    }
  }
}

/**
 * Sleep utility for testing async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate deterministic test email
 */
export function generateTestEmail(prefix: string = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 5);
  return `${prefix}-${timestamp}-${random}@test.example.com`;
}

/**
 * Generate deterministic test phone number
 */
export function generateTestPhone(): string {
  const random = Math.floor(Math.random() * 9000000000) + 1000000000;
  return `+1${random}`;
}

/**
 * Clean up test data by pattern (for emergency cleanup)
 */
export async function cleanupTestDataByPattern(emailPattern: string) {
  try {
    await db.delete(users).where(sql`email LIKE ${emailPattern}`);
  } catch (error) {
    console.error('Pattern cleanup error:', error);
  }
}
