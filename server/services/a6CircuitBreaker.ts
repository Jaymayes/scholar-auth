import { pool } from '../db';
import { logger } from '../middleware/auditLogger';
import { httpRequestWithRetry } from '../utils/httpClient';
import { isFeatureEnabled } from '../config/featureFlags';

interface A6CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveSuccesses: number;
  openCount1h: number;
  openCountResetTime: number;
}

interface A6TelemetrySnapshot {
  breaker_state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures_last_5m: number;
  open_count_1h: number;
  provider_backlog_depth: number;
  dlq_depth: number;
  a3_call_p95_ms_to_a6: number;
  a3_call_error_rate_to_a6: number;
}

interface BacklogEntry {
  idempotency_key: string;
  payload_json: string;
  endpoint: string;
  method: string;
}

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 60000;
const OPEN_DURATION_MS = 300000;
const HALF_OPEN_PROBE_INTERVAL_MS = 30000;
const HALF_OPEN_SUCCESS_THRESHOLD = 2;
const TIMEOUT_MS = 2000;

const RETRY_BASE_MS = 30000;
const RETRY_CAP_MS = 900000;
const MAX_RETRY_ATTEMPTS = 10;

const A6_BASE_URL = process.env.A6_PROVIDER_APP_URL || 'https://provider-app-jamarrlmayes.replit.app';

const circuitBreaker: A6CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED',
  consecutiveSuccesses: 0,
  openCount1h: 0,
  openCountResetTime: Date.now() + 3600000
};

const recentFailures: number[] = [];
const recentLatencies: number[] = [];
let lastHalfOpenProbeTime = 0;

export function isA6CircuitBreakerEnabled(): boolean {
  return isFeatureEnabled('A6_CIRCUIT_BREAKER');
}

function recordFailure(): void {
  const now = Date.now();
  
  recentFailures.push(now);
  while (recentFailures.length > 0 && recentFailures[0] < now - FAILURE_WINDOW_MS) {
    recentFailures.shift();
  }
  
  circuitBreaker.failures = recentFailures.length;
  circuitBreaker.lastFailureTime = now;
  circuitBreaker.consecutiveSuccesses = 0;
  
  if (circuitBreaker.failures >= FAILURE_THRESHOLD && circuitBreaker.state !== 'OPEN') {
    circuitBreaker.state = 'OPEN';
    circuitBreaker.openCount1h++;
    
    if (now > circuitBreaker.openCountResetTime) {
      circuitBreaker.openCount1h = 1;
      circuitBreaker.openCountResetTime = now + 3600000;
    }
    
    logger.error('A6 Circuit Breaker OPENED', undefined, {
      failures: circuitBreaker.failures,
      threshold: FAILURE_THRESHOLD,
      openCount1h: circuitBreaker.openCount1h
    });
    
    emitTelemetry('breaker_opened');
  }
}

function recordSuccess(): void {
  if (circuitBreaker.state === 'HALF_OPEN') {
    circuitBreaker.consecutiveSuccesses++;
    
    if (circuitBreaker.consecutiveSuccesses >= HALF_OPEN_SUCCESS_THRESHOLD) {
      circuitBreaker.state = 'CLOSED';
      circuitBreaker.failures = 0;
      recentFailures.length = 0;
      lastHalfOpenProbeTime = 0;
      
      logger.info('A6 Circuit Breaker CLOSED (recovered)', {
        consecutiveSuccesses: circuitBreaker.consecutiveSuccesses
      });
      
      emitTelemetry('breaker_closed');
    }
  } else if (circuitBreaker.state === 'CLOSED') {
    circuitBreaker.consecutiveSuccesses++;
  }
}

function recordHalfOpenFailure(): void {
  circuitBreaker.state = 'OPEN';
  circuitBreaker.lastFailureTime = Date.now();
  circuitBreaker.consecutiveSuccesses = 0;
  circuitBreaker.openCount1h++;
  
  logger.warn('A6 Circuit Breaker re-opened (HALF_OPEN probe failed)', {
    openCount1h: circuitBreaker.openCount1h
  });
  
  emitTelemetry('breaker_reopened');
}

function checkCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'HALF_OPEN_WAIT' {
  const now = Date.now();
  
  if (circuitBreaker.state === 'OPEN') {
    if (now - circuitBreaker.lastFailureTime >= OPEN_DURATION_MS) {
      circuitBreaker.state = 'HALF_OPEN';
      circuitBreaker.consecutiveSuccesses = 0;
      lastHalfOpenProbeTime = 0;
      
      logger.info('A6 Circuit Breaker entering HALF_OPEN state');
    }
  }
  
  if (circuitBreaker.state === 'HALF_OPEN') {
    if (now - lastHalfOpenProbeTime < HALF_OPEN_PROBE_INTERVAL_MS) {
      return 'HALF_OPEN_WAIT';
    }
    lastHalfOpenProbeTime = now;
  }
  
  return circuitBreaker.state;
}

function recordLatency(latencyMs: number): void {
  recentLatencies.push(latencyMs);
  if (recentLatencies.length > 100) {
    recentLatencies.shift();
  }
}

function calculateP95(): number {
  if (recentLatencies.length === 0) return 0;
  const sorted = [...recentLatencies].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[index] || 0;
}

function calculateErrorRate(): number {
  const now = Date.now();
  const recent = recentFailures.filter(t => t > now - 300000);
  const totalCalls = recentLatencies.length || 1;
  return recent.length / totalCalls;
}

async function emitTelemetry(eventType: string): Promise<void> {
  try {
    const snapshot = await getTelemetrySnapshot();
    const a8Url = process.env.AUTO_COM_CENTER_URL || 'https://auto-com-center-jamarrlmayes.replit.app';
    
    await fetch(`${a8Url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: `a6_circuit_breaker_${eventType}`,
        component: 'a3_to_a6_breaker',
        payload: snapshot
      })
    });
  } catch (error) {
    logger.warn('Failed to emit A6 circuit breaker telemetry', { eventType });
  }
}

export async function callA6WithBreaker<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
  payload?: any,
  idempotencyKey?: string
): Promise<{ success: boolean; data?: T; queued?: boolean }> {
  if (!isA6CircuitBreakerEnabled()) {
    const result = await httpRequestWithRetry({
      url: `${A6_BASE_URL}${endpoint}`,
      method,
      body: payload,
      timeout: TIMEOUT_MS
    });
    return { success: result.success, data: result.data };
  }
  
  const state = checkCircuitState();
  const isHalfOpen = state === 'HALF_OPEN';
  
  if (state === 'OPEN' || state === 'HALF_OPEN_WAIT') {
    if (idempotencyKey && payload) {
      await enqueueToBacklog({
        idempotency_key: idempotencyKey,
        payload_json: JSON.stringify(payload),
        endpoint,
        method
      });
    }
    
    logger.info('A6 call queued (circuit OPEN/WAIT)', { endpoint, idempotencyKey, state });
    return { success: false, queued: true };
  }
  
  const startTime = Date.now();
  
  try {
    const result = await httpRequestWithRetry({
      url: `${A6_BASE_URL}${endpoint}`,
      method,
      body: payload,
      timeout: TIMEOUT_MS,
      maxRetries: isHalfOpen ? 0 : 2
    });
    
    const latency = Date.now() - startTime;
    recordLatency(latency);
    
    if (result.success) {
      recordSuccess();
      return { success: true, data: result.data };
    } else {
      if (result.statusCode && result.statusCode >= 500) {
        if (isHalfOpen) {
          recordHalfOpenFailure();
        } else {
          recordFailure();
        }
      } else if (!result.statusCode) {
        if (isHalfOpen) {
          recordHalfOpenFailure();
        } else {
          recordFailure();
        }
      }
      
      if (idempotencyKey && payload && circuitBreaker.state === 'OPEN') {
        await enqueueToBacklog({
          idempotency_key: idempotencyKey,
          payload_json: JSON.stringify(payload),
          endpoint,
          method
        });
        return { success: false, queued: true };
      }
      
      return { success: false };
    }
  } catch (error: any) {
    const latency = Date.now() - startTime;
    recordLatency(latency);
    
    if (isHalfOpen) {
      recordHalfOpenFailure();
    } else {
      recordFailure();
    }
    
    logger.error('A6 call failed', error, { endpoint, latency });
    
    if (idempotencyKey && payload && circuitBreaker.state === 'OPEN') {
      await enqueueToBacklog({
        idempotency_key: idempotencyKey,
        payload_json: JSON.stringify(payload),
        endpoint,
        method
      });
      return { success: false, queued: true };
    }
    
    return { success: false };
  }
}

async function enqueueToBacklog(entry: BacklogEntry): Promise<void> {
  const nextRetryAt = new Date(Date.now() + RETRY_BASE_MS);
  
  try {
    await pool.query(`
      INSERT INTO provider_backlog (idempotency_key, payload_json, endpoint, method, next_retry_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [entry.idempotency_key, entry.payload_json, entry.endpoint, entry.method, nextRetryAt]);
    
    logger.info('Enqueued to provider backlog', { idempotencyKey: entry.idempotency_key });
  } catch (error) {
    logger.error('Failed to enqueue to provider backlog', error instanceof Error ? error : undefined);
  }
}

export async function processBacklog(maxItems: number = 5): Promise<number> {
  if (circuitBreaker.state !== 'CLOSED') {
    return 0;
  }
  
  let processed = 0;
  
  try {
    const result = await pool.query(`
      SELECT id, idempotency_key, payload_json, endpoint, method, attempts
      FROM provider_backlog
      WHERE status = 'pending' AND next_retry_at <= NOW()
      ORDER BY first_seen_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `, [maxItems]);
    
    for (const row of result.rows) {
      const { id, idempotency_key, payload_json, endpoint, method, attempts } = row;
      
      const callResult = await callA6WithBreaker(
        endpoint,
        method as any,
        JSON.parse(payload_json)
      );
      
      if (callResult.success) {
        await pool.query(`
          UPDATE provider_backlog SET status = 'completed', updated_at = NOW()
          WHERE id = $1
        `, [id]);
        processed++;
      } else if (callResult.queued) {
        break;
      } else {
        const newAttempts = attempts + 1;
        
        if (newAttempts >= MAX_RETRY_ATTEMPTS) {
          await pool.query(`
            UPDATE provider_backlog SET status = 'dead_letter', attempts = $2, updated_at = NOW()
            WHERE id = $1
          `, [id, newAttempts]);
          
          logger.error('Provider backlog entry moved to dead letter', undefined, { idempotency_key });
          emitTelemetry('dlq_entry');
        } else {
          const jitter = Math.random();
          const delay = Math.min(RETRY_BASE_MS * Math.pow(2, newAttempts) * jitter, RETRY_CAP_MS);
          const nextRetry = new Date(Date.now() + delay);
          
          await pool.query(`
            UPDATE provider_backlog SET attempts = $2, next_retry_at = $3, updated_at = NOW()
            WHERE id = $1
          `, [id, newAttempts, nextRetry]);
        }
      }
    }
  } catch (error) {
    logger.error('Failed to process provider backlog', error instanceof Error ? error : undefined);
  }
  
  return processed;
}

export async function getBacklogDepth(): Promise<{ pending: number; deadLetter: number }> {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter
      FROM provider_backlog
    `);
    
    return {
      pending: parseInt(result.rows[0]?.pending || '0'),
      deadLetter: parseInt(result.rows[0]?.dead_letter || '0')
    };
  } catch (error) {
    return { pending: 0, deadLetter: 0 };
  }
}

export async function getTelemetrySnapshot(): Promise<A6TelemetrySnapshot> {
  const backlog = await getBacklogDepth();
  
  return {
    breaker_state: circuitBreaker.state,
    failures_last_5m: recentFailures.filter(t => t > Date.now() - 300000).length,
    open_count_1h: circuitBreaker.openCount1h,
    provider_backlog_depth: backlog.pending,
    dlq_depth: backlog.deadLetter,
    a3_call_p95_ms_to_a6: calculateP95(),
    a3_call_error_rate_to_a6: calculateErrorRate()
  };
}

export function getCircuitBreakerStatus(): {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  consecutiveSuccesses: number;
  openCount1h: number;
  enabled: boolean;
} {
  return {
    state: circuitBreaker.state,
    failures: circuitBreaker.failures,
    consecutiveSuccesses: circuitBreaker.consecutiveSuccesses,
    openCount1h: circuitBreaker.openCount1h,
    enabled: isA6CircuitBreakerEnabled()
  };
}

let telemetryInterval: NodeJS.Timeout | null = null;
let backlogProcessorInterval: NodeJS.Timeout | null = null;

export function startTelemetryEmitter(intervalMs: number = 60000): void {
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
  }
  
  telemetryInterval = setInterval(async () => {
    await emitTelemetry('snapshot');
  }, intervalMs);
  
  logger.info('A6 Circuit Breaker telemetry emitter started', { intervalMs });
}

export function startBacklogProcessor(intervalMs: number = 5000): void {
  if (backlogProcessorInterval) {
    clearInterval(backlogProcessorInterval);
  }
  
  backlogProcessorInterval = setInterval(async () => {
    if (circuitBreaker.state === 'CLOSED') {
      await processBacklog(5);
    }
  }, intervalMs);
  
  logger.info('A6 Circuit Breaker backlog processor started', { intervalMs });
}

export function stopA6CircuitBreaker(): void {
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
  if (backlogProcessorInterval) {
    clearInterval(backlogProcessorInterval);
    backlogProcessorInterval = null;
  }
}
