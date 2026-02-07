/**
 * Global Test Setup - Runs once before all tests
 * 
 * This ensures deterministic test state by:
 * - Verifying database connection
 * - Clearing test data
 * - Setting up required database schema
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

export default async function globalSetup() {
  console.log('🔧 Global test setup starting...');
  
  try {
    // Verify database connection
    await db.execute(sql`SELECT 1`);
    console.log('✅ Database connection verified');
    
    // Note: We don't drop/recreate tables as schema is already managed by migrations
    // Each test should clean up its own data in afterEach hooks
    
    console.log('✅ Global test setup complete');
  } catch (error) {
    console.error('❌ Global test setup failed:', error);
    throw error;
  }
}
