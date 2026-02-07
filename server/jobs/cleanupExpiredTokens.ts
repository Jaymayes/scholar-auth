import { db } from '../db';
import { oidcModels } from '@shared/schema';
import { sql } from 'drizzle-orm';
import { logger } from '../middleware/auditLogger';

/**
 * Automated Cleanup Job - Expired OIDC Tokens & Sessions
 * 
 * Runs hourly to remove expired tokens from oidc_models and sessions tables.
 * This prevents table bloat and maintains database performance.
 * 
 * SLO: Complete within 5 seconds under normal load (<10k expired records)
 */
export class TokenCleanupJob {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Start the cleanup job with hourly execution
   */
  start() {
    if (this.intervalId) {
      logger.warn('Token cleanup job already running');
      return;
    }

    // Run immediately on start
    this.executeCleanup();

    // Schedule hourly execution (3600000 ms = 1 hour)
    this.intervalId = setInterval(() => {
      this.executeCleanup();
    }, 3600000);

    logger.info('Token cleanup job started', { 
      interval: '1 hour',
      nextRun: new Date(Date.now() + 3600000).toISOString()
    });
  }

  /**
   * Stop the cleanup job
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Token cleanup job stopped');
    }
  }

  /**
   * Execute cleanup - removes expired tokens and sessions
   */
  private async executeCleanup() {
    if (this.isRunning) {
      logger.warn('Cleanup job already in progress, skipping this run');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Clean expired OIDC tokens
      const tokensResult = await db
        .delete(oidcModels)
        .where(sql`expires_at IS NOT NULL AND expires_at < NOW()`)
        .returning({ id: oidcModels.id });

      const tokensRemoved = tokensResult.length;

      // Clean expired sessions
      const sessionsResult = await db.execute(sql`
        DELETE FROM sessions 
        WHERE expire < NOW() 
        RETURNING sid
      `);

      const sessionsRemoved = sessionsResult.rowCount || 0;

      const duration = Date.now() - startTime;

      logger.info('Token cleanup completed', {
        tokensRemoved,
        sessionsRemoved,
        durationMs: duration,
        timestamp: new Date().toISOString()
      });

      // Alert if cleanup takes too long (SLO: 5 seconds)
      if (duration > 5000) {
        logger.warn('SLOW token cleanup - consider database optimization', {
          durationMs: duration,
          sloMs: 5000,
          tokensRemoved,
          sessionsRemoved
        });
      }

    } catch (error) {
      logger.error('Token cleanup failed', error as Error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get cleanup job status
   */
  getStatus() {
    return {
      running: this.intervalId !== null,
      currentlyExecuting: this.isRunning,
      interval: '1 hour',
      nextRun: this.intervalId 
        ? new Date(Date.now() + 3600000).toISOString()
        : null
    };
  }
}

// Export singleton instance
export const tokenCleanupJob = new TokenCleanupJob();
