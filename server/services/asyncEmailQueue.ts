/**
 * Async Email Queue Service
 * Issue B Implementation: Move email sending off hot path using 202-Accepted + worker pattern
 * 
 * Design:
 * - HTTP endpoints return 202 immediately with idempotency key
 * - Emails are queued in-memory (production should use Redis/PostgreSQL)
 * - Background worker processes queue with exponential backoff
 * - Circuit breaker prevents cascade failures
 */

import { randomUUID } from 'crypto';
import { isFeatureEnabled } from '../config/featureFlags';
import { emailService } from './emailService';

interface EmailJob {
  id: string;
  idempotencyKey: string;
  type: 'verification' | 'password_reset' | 'parent_verification';
  payload: Record<string, any>;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledFor: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  lastError?: string;
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  threshold: number;
  resetTimeoutMs: number;
}

class AsyncEmailQueue {
  private queue: Map<string, EmailJob> = new Map();
  private idempotencyCache: Map<string, string> = new Map(); // idempotencyKey -> jobId
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: 'CLOSED',
    threshold: 5,
    resetTimeoutMs: 60000, // 1 minute
  };
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  constructor() {
    // Start worker if feature is enabled
    if (isFeatureEnabled('ASYNC_EMAIL_PROCESSING')) {
      this.startWorker();
    }
  }

  /**
   * Enqueue email for async processing
   * Returns immediately with job ID for tracking
   */
  enqueue(
    type: EmailJob['type'],
    payload: Record<string, any>,
    idempotencyKey?: string
  ): { jobId: string; status: 'queued' | 'duplicate' } {
    // Check for duplicate using idempotency key
    const key = idempotencyKey || `${type}-${JSON.stringify(payload)}-${Date.now()}`;
    const existingJobId = this.idempotencyCache.get(key);
    
    if (existingJobId) {
      return { jobId: existingJobId, status: 'duplicate' };
    }

    const job: EmailJob = {
      id: randomUUID(),
      idempotencyKey: key,
      type,
      payload,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      scheduledFor: new Date(),
      status: 'pending',
    };

    this.queue.set(job.id, job);
    this.idempotencyCache.set(key, job.id);

    console.log(`[AsyncEmailQueue] Job enqueued: ${job.id} (${type})`);
    return { jobId: job.id, status: 'queued' };
  }

  /**
   * Get job status for tracking
   */
  getJobStatus(jobId: string): EmailJob | null {
    return this.queue.get(jobId) || null;
  }

  /**
   * Start background worker
   */
  private startWorker(): void {
    if (this.processingInterval) return;

    console.log('[AsyncEmailQueue] Worker started');
    this.processingInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[AsyncEmailQueue] Worker error:', err.message);
      });
    }, 1000); // Check every second
  }

  /**
   * Stop background worker
   */
  stopWorker(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('[AsyncEmailQueue] Worker stopped');
    }
  }

  /**
   * Process pending jobs in queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.canProcess()) return;

    this.isProcessing = true;

    try {
      const pendingJobs = Array.from(this.queue.values())
        .filter(job => job.status === 'pending' && job.scheduledFor <= new Date())
        .slice(0, 5); // Process max 5 at a time

      for (const job of pendingJobs) {
        await this.processJob(job);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check if circuit breaker allows processing
   */
  private canProcess(): boolean {
    if (this.circuitBreaker.state === 'CLOSED') return true;
    
    if (this.circuitBreaker.state === 'OPEN') {
      const elapsed = Date.now() - this.circuitBreaker.lastFailureTime;
      if (elapsed >= this.circuitBreaker.resetTimeoutMs) {
        this.circuitBreaker.state = 'HALF_OPEN';
        console.log('[AsyncEmailQueue] Circuit breaker: HALF_OPEN');
        return true;
      }
      return false;
    }

    return true; // HALF_OPEN allows one request through
  }

  /**
   * Process a single email job
   */
  private async processJob(job: EmailJob): Promise<void> {
    job.status = 'processing';
    job.attempts++;

    console.log(`[AsyncEmailQueue] Processing job ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);

    try {
      switch (job.type) {
        case 'verification':
          await emailService.sendVerificationEmail(job.payload.email, job.payload.code);
          break;
        case 'password_reset':
          await emailService.sendPasswordResetEmail(job.payload.email, job.payload.token);
          break;
        case 'parent_verification':
          await emailService.sendParentVerificationEmail(job.payload.email, {
            parentName: job.payload.parentName,
            childUserId: job.payload.childUserId,
            verificationUrl: job.payload.verificationUrl,
          });
          break;
      }

      job.status = 'completed';
      this.recordSuccess();
      console.log(`[AsyncEmailQueue] Job ${job.id} completed successfully`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      job.lastError = errorMessage;
      this.recordFailure();

      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        console.error(`[AsyncEmailQueue] Job ${job.id} failed permanently: ${errorMessage}`);
      } else {
        // Exponential backoff: 2^attempts * 1000ms (2s, 4s, 8s...)
        const backoffMs = Math.pow(2, job.attempts) * 1000;
        job.scheduledFor = new Date(Date.now() + backoffMs);
        job.status = 'pending';
        console.warn(`[AsyncEmailQueue] Job ${job.id} retrying in ${backoffMs}ms`);
      }
    }
  }

  /**
   * Record successful operation (resets circuit breaker)
   * Always resets failure count on success to prevent false opens from accumulated transient errors
   */
  private recordSuccess(): void {
    // Always reset failures on success regardless of state
    // This prevents accumulated transient errors from opening the breaker
    const previousFailures = this.circuitBreaker.failures;
    this.circuitBreaker.failures = 0;
    
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'CLOSED';
      console.log('[AsyncEmailQueue] Circuit breaker: CLOSED (recovered from HALF_OPEN)');
    } else if (previousFailures > 0) {
      console.log(`[AsyncEmailQueue] Circuit breaker: Reset ${previousFailures} accumulated failures on success`);
    }
  }

  /**
   * Record failed operation (may trip circuit breaker)
   */
  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = 'OPEN';
      console.error(`[AsyncEmailQueue] Circuit breaker: OPEN (${this.circuitBreaker.failures} failures)`);
    }
  }

  /**
   * Get queue metrics for monitoring
   */
  getMetrics(): {
    queueSize: number;
    pendingCount: number;
    processingCount: number;
    completedCount: number;
    failedCount: number;
    circuitBreakerState: string;
    circuitBreakerFailures: number;
  } {
    const jobs = Array.from(this.queue.values());
    return {
      queueSize: jobs.length,
      pendingCount: jobs.filter(j => j.status === 'pending').length,
      processingCount: jobs.filter(j => j.status === 'processing').length,
      completedCount: jobs.filter(j => j.status === 'completed').length,
      failedCount: jobs.filter(j => j.status === 'failed').length,
      circuitBreakerState: this.circuitBreaker.state,
      circuitBreakerFailures: this.circuitBreaker.failures,
    };
  }

  /**
   * Clean up old completed/failed jobs (call periodically)
   */
  cleanup(maxAgeMs: number = 3600000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [id, job] of Array.from(this.queue.entries())) {
      if ((job.status === 'completed' || job.status === 'failed') && 
          job.createdAt.getTime() < cutoff) {
        this.queue.delete(id);
        this.idempotencyCache.delete(job.idempotencyKey);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[AsyncEmailQueue] Cleaned up ${cleaned} old jobs`);
    }
    return cleaned;
  }
}

export const asyncEmailQueue = new AsyncEmailQueue();
export default asyncEmailQueue;
