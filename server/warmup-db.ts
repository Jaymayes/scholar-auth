/**
 * Database Warmup Utility
 * 
 * Purpose: Prime Neon connection pool before gate windows to prevent cold-start latency
 * 
 * Root Cause (Nov 8, 02:09 UTC): Canary restart drained pool, every gate sample paid
 * ~200ms Neon cold-start penalty, causing 70-100% latency regression (95-115ms → 183-223ms)
 * 
 * Solution: Run this script 10-15 minutes before gate windows to ensure warm connections
 * 
 * Usage:
 *   npm run warmup     # Manual execution
 *   node -r tsx/register server/warmup-db.ts  # Direct execution
 */

import { pool, db } from './db';
import { sql } from 'drizzle-orm';
import { logger } from './middleware/auditLogger';

interface WarmupResult {
  success: boolean;
  duration: number;
  activeConnections: number;
  error?: string;
}

async function warmupDatabase(): Promise<WarmupResult> {
  const startTime = Date.now();
  
  try {
    logger.info('🔥 DATABASE WARMUP: Starting connection pool prime...');
    
    // Execute CONCURRENT DB queries to hydrate Neon pool and establish multiple connections
    // This ensures Neon serverless compute is HOT before gate testing
    const concurrentQueries = 10;
    const queryPromises = Array.from({ length: concurrentQueries }, async (_, i) => {
      const queryStart = Date.now();
      await db.execute(sql`SELECT 1 as warmup_check, ${i} as query_id`);
      const queryDuration = Date.now() - queryStart;
      return queryDuration;
    });
    
    const queryDurations = await Promise.all(queryPromises);
    const avgQueryDuration = Math.round(queryDurations.reduce((a, b) => a + b, 0) / queryDurations.length);
    const maxQueryDuration = Math.max(...queryDurations);
    
    // Get pool stats
    const totalCount = pool.totalCount;
    const idleCount = pool.idleCount;
    const waitingCount = pool.waitingCount;
    const activeConnections = totalCount - idleCount;
    
    const duration = Date.now() - startTime;
    
    logger.info('✅ DATABASE WARMUP: Complete', {
      duration: `${duration}ms`,
      totalConnections: totalCount,
      activeConnections,
      idleConnections: idleCount,
      waitingRequests: waitingCount,
      concurrentQueries,
      avgQueryDuration: `${avgQueryDuration}ms`,
      maxQueryDuration: `${maxQueryDuration}ms`
    });
    
    return {
      success: true,
      duration,
      activeConnections
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('❌ DATABASE WARMUP: Failed', {
      duration: `${duration}ms`,
      error: errorMsg
    });
    
    return {
      success: false,
      duration,
      activeConnections: 0,
      error: errorMsg
    };
  }
}

async function warmupWithRetry(maxRetries: number = 3): Promise<WarmupResult> {
  let lastResult: WarmupResult | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`🔥 DATABASE WARMUP: Attempt ${attempt}/${maxRetries}`);
    
    lastResult = await warmupDatabase();
    
    if (lastResult.success) {
      return lastResult;
    }
    
    if (attempt < maxRetries) {
      const backoffMs = attempt * 1000;
      logger.warn(`⏳ DATABASE WARMUP: Retry in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  return lastResult!;
}

// Execute warmup if run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  warmupWithRetry(3)
    .then(result => {
      if (result.success) {
        console.log('\n✅ Database warmup successful');
        console.log(`   Duration: ${result.duration}ms`);
        console.log(`   Active connections: ${result.activeConnections}`);
        process.exit(0);
      } else {
        console.error('\n❌ Database warmup failed');
        console.error(`   Error: ${result.error}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Unexpected warmup error:', error);
      process.exit(1);
    });
}

export { warmupDatabase, warmupWithRetry };
