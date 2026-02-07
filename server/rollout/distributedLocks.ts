// 🔒 CONC-001: DISTRIBUTED LOCKS FOR STEP-UP SCHEDULER
// PostgreSQL advisory locks for preventing race conditions in rollout state management

import { storage } from '../storage';
import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Executive-approved lock keys for different rollout operations
 */
export const LOCK_KEYS = {
  STEP_UP_EVALUATION: 1001,
  ROLLBACK_DECISION: 1002,
  GUARDRAIL_UPDATE: 1003,
  EXECUTIVE_REPORTING: 1004,
  CANARY_TRANSITION: 1005,
  SEGMENT_MONITORING: 1006
} as const;

export type LockKey = typeof LOCK_KEYS[keyof typeof LOCK_KEYS];

/**
 * Distributed lock manager using PostgreSQL advisory locks
 * Ensures only one scheduler instance can modify rollout state at a time
 */
export class DistributedLockManager {
  private static instance: DistributedLockManager;
  private activeLocks = new Set<LockKey>();
  private lockTimeouts = new Map<LockKey, NodeJS.Timeout>();

  static getInstance(): DistributedLockManager {
    if (!DistributedLockManager.instance) {
      DistributedLockManager.instance = new DistributedLockManager();
    }
    return DistributedLockManager.instance;
  }

  /**
   * Acquire a distributed lock with timeout
   * Returns true if lock acquired, false if timeout or already held
   */
  async acquireLock(
    lockKey: LockKey, 
    timeoutMs: number = 30000,
    operation: string = 'unknown'
  ): Promise<boolean> {
    console.log(`🔒 Attempting to acquire lock ${lockKey} for ${operation}`);
    
    try {
      // Use PostgreSQL advisory lock with timeout
      const result = await this.tryAcquireAdvisoryLock(lockKey, timeoutMs);
      
      if (result) {
        this.activeLocks.add(lockKey);
        console.log(`✅ Lock ${lockKey} acquired for ${operation}`);
        
        // Set automatic release after reasonable timeout (safety mechanism)
        const timeoutId = setTimeout(() => {
          if (this.activeLocks.has(lockKey)) {
            console.warn(`⚠️  Auto-releasing lock ${lockKey} after timeout for ${operation}`);
            this.releaseLock(lockKey, operation).catch(console.error);
          }
        }, Math.max(timeoutMs * 2, 60000)); // 2x timeout or 1 minute minimum
        
        // Track timeout for cleanup
        this.lockTimeouts.set(lockKey, timeoutId);
        
        return true;
      } else {
        console.warn(`❌ Failed to acquire lock ${lockKey} for ${operation} - already held or timeout`);
        return false;
      }
    } catch (error) {
      console.error(`🚨 Error acquiring lock ${lockKey} for ${operation}:`, error);
      return false;
    }
  }

  /**
   * Release a distributed lock
   */
  async releaseLock(lockKey: LockKey, operation: string = 'unknown'): Promise<boolean> {
    console.log(`🔓 Releasing lock ${lockKey} for ${operation}`);
    
    try {
      const result = await this.releaseAdvisoryLock(lockKey);
      
      // Clear the auto-release timeout
      const timeoutId = this.lockTimeouts.get(lockKey);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.lockTimeouts.delete(lockKey);
      }
      
      if (result) {
        this.activeLocks.delete(lockKey);
        console.log(`✅ Lock ${lockKey} released for ${operation}`);
        return true;
      } else {
        console.warn(`⚠️  Lock ${lockKey} was not held during release for ${operation}`);
        this.activeLocks.delete(lockKey); // Clean up local state anyway
        return false;
      }
    } catch (error) {
      console.error(`🚨 Error releasing lock ${lockKey} for ${operation}:`, error);
      this.activeLocks.delete(lockKey); // Clean up local state
      
      // Clear timeout on error too
      const timeoutId = this.lockTimeouts.get(lockKey);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.lockTimeouts.delete(lockKey);
      }
      return false;
    }
  }

  /**
   * Execute operation with distributed lock (recommended pattern)
   */
  async withLock<T>(
    lockKey: LockKey,
    operation: string,
    fn: () => Promise<T>,
    timeoutMs: number = 30000
  ): Promise<T | null> {
    const lockAcquired = await this.acquireLock(lockKey, timeoutMs, operation);
    
    if (!lockAcquired) {
      console.error(`🚨 Could not acquire lock ${lockKey} for ${operation} - operation skipped`);
      return null;
    }

    try {
      console.log(`🏃 Executing ${operation} with lock ${lockKey}`);
      const result = await fn();
      console.log(`✅ Completed ${operation} with lock ${lockKey}`);
      return result;
    } catch (error) {
      console.error(`🚨 Error during ${operation} with lock ${lockKey}:`, error);
      throw error;
    } finally {
      await this.releaseLock(lockKey, operation);
    }
  }

  /**
   * Check if a lock is currently held
   */
  async isLockHeld(lockKey: LockKey): Promise<boolean> {
    try {
      // Query pg_locks to see if advisory lock is held
      const result = await db.execute(sql`
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' 
        AND objid = ${lockKey}
        AND granted = true
      `);
      
      return result.rows.length > 0;
    } catch (error) {
      console.error('Error checking lock status:', error);
      return false;
    }
  }

  /**
   * Get all currently held locks (for monitoring)
   */
  getActiveLocks(): LockKey[] {
    return Array.from(this.activeLocks);
  }

  /**
   * Emergency release all locks (use with caution)
   */
  async releaseAllLocks(): Promise<void> {
    console.warn('🚨 Emergency release of all distributed locks');
    
    const lockPromises = Array.from(this.activeLocks).map(lockKey => 
      this.releaseLock(lockKey, 'emergency_release')
    );
    
    await Promise.allSettled(lockPromises);
    this.activeLocks.clear();
  }

  // Private methods for PostgreSQL advisory lock implementation

  private async tryAcquireAdvisoryLock(lockKey: LockKey, timeoutMs: number): Promise<boolean> {
    // Try to acquire lock with timeout using pg_try_advisory_lock
    const startTime = Date.now();
    const maxRetries = Math.ceil(timeoutMs / 100); // Check every 100ms
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockKey}) as acquired`);
        
        if (result.rows[0]?.acquired) {
          return true;
        }
        
        // If not acquired, wait before retry
        if (Date.now() - startTime < timeoutMs) {
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          break; // Timeout reached
        }
      } catch (error) {
        console.error('Error in advisory lock attempt:', error);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return false;
  }

  private async releaseAdvisoryLock(lockKey: LockKey): Promise<boolean> {
    try {
      const result = await db.execute(sql`SELECT pg_advisory_unlock(${lockKey}) as released`);
      return Boolean(result.rows[0]?.released);
    } catch (error) {
      console.error('Error releasing advisory lock:', error);
      return false;
    }
  }
}

/**
 * Global distributed lock manager instance
 */
export const distributedLockManager = DistributedLockManager.getInstance();

/**
 * Decorator for automatic lock management in class methods
 */
export function withDistributedLock(lockKey: LockKey, operation?: string) {
  return function(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      const operationName = operation || `${target.constructor.name}.${propertyName}`;
      
      return await distributedLockManager.withLock(
        lockKey,
        operationName,
        () => method.apply(this, args),
        30000 // 30 second timeout
      );
    };
  };
}

/**
 * Utility functions for common lock patterns
 */
export const lockUtils = {
  /**
   * Execute step-up evaluation with proper locking
   */
  async withStepUpLock<T>(fn: () => Promise<T>): Promise<T | null> {
    return distributedLockManager.withLock(
      LOCK_KEYS.STEP_UP_EVALUATION,
      'step_up_evaluation',
      fn,
      45000 // 45 seconds for step-up operations
    );
  },

  /**
   * Execute rollback decision with proper locking
   */
  async withRollbackLock<T>(fn: () => Promise<T>): Promise<T | null> {
    return distributedLockManager.withLock(
      LOCK_KEYS.ROLLBACK_DECISION,
      'rollback_decision',
      fn,
      30000 // 30 seconds for rollback operations
    );
  },

  /**
   * Execute guardrail updates with proper locking
   */
  async withGuardrailLock<T>(fn: () => Promise<T>): Promise<T | null> {
    return distributedLockManager.withLock(
      LOCK_KEYS.GUARDRAIL_UPDATE,
      'guardrail_update',
      fn,
      15000 // 15 seconds for guardrail updates
    );
  },

  /**
   * Execute executive reporting with proper locking
   */
  async withExecutiveLock<T>(fn: () => Promise<T>): Promise<T | null> {
    return distributedLockManager.withLock(
      LOCK_KEYS.EXECUTIVE_REPORTING,
      'executive_reporting',
      fn,
      60000 // 60 seconds for executive reports
    );
  }
};