import { pool } from '../db';
import { logger as baseLogger } from '../middleware/auditLogger';

const logger = {
  ...baseLogger,
  debug: (message: string, meta: Record<string, any> = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(JSON.stringify({
        level: 'debug',
        message,
        timestamp: new Date().toISOString(),
        ...meta,
      }));
    }
  }
};

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED'
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_TIMEOUT = 30000;
const RETRY_DELAYS = [50, 150, 350];

function updateCircuitBreaker(success: boolean): void {
  const now = Date.now();
  
  if (success) {
    if (circuitBreaker.state === 'HALF_OPEN') {
      logger.info('Circuit breaker: Recovered, closing circuit', {
        previousFailures: circuitBreaker.failures,
        timestamp: new Date().toISOString()
      });
    }
    circuitBreaker.failures = 0;
    circuitBreaker.state = 'CLOSED';
    return;
  }
  
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = now;
  
  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.state = 'OPEN';
    logger.error('Circuit breaker: OPENED - too many DB failures', undefined, {
      failures: circuitBreaker.failures,
      threshold: CIRCUIT_BREAKER_THRESHOLD,
      timestamp: new Date().toISOString()
    });
  }
}

function checkCircuitBreaker(): boolean {
  const now = Date.now();
  
  if (circuitBreaker.state === 'CLOSED') {
    return true;
  }
  
  if (circuitBreaker.state === 'OPEN') {
    if (now - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
      circuitBreaker.state = 'HALF_OPEN';
      logger.info('Circuit breaker: Attempting recovery (HALF_OPEN)', {
        timestamp: new Date().toISOString()
      });
      return true;
    }
    return false;
  }
  
  return true;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  const code = error.code;
  const message = error.message || '';
  
  return (
    code === 'XX000' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('ENOTFOUND')
  );
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  correlationId?: string
): Promise<T> {
  if (!checkCircuitBreaker()) {
    const error = new Error('Circuit breaker OPEN - database degraded');
    (error as any).code = 'CIRCUIT_OPEN';
    logger.error('Circuit breaker rejected request', error, {
      correlationId,
      operationName,
      circuitState: circuitBreaker.state,
      failures: circuitBreaker.failures
    });
    throw error;
  }
  
  let lastError: any;
  
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const startTime = Date.now();
      const result = await operation();
      const duration = Date.now() - startTime;
      
      logger.debug('Database operation succeeded', {
        correlationId,
        operationName,
        attempt: attempt + 1,
        duration,
        timestamp: new Date().toISOString()
      });
      
      updateCircuitBreaker(true);
      
      return result;
    } catch (error: any) {
      lastError = error;
      const isRetryable = isRetryableError(error);
      
      logger.warn('Database operation failed', {
        correlationId,
        operationName,
        attempt: attempt + 1,
        maxAttempts: RETRY_DELAYS.length + 1,
        errorCode: error.code,
        errorMessage: error.message,
        retryable: isRetryable,
        timestamp: new Date().toISOString()
      });
      
      if (!isRetryable || attempt >= RETRY_DELAYS.length) {
        updateCircuitBreaker(false);
        break;
      }
      
      const delay = RETRY_DELAYS[attempt];
      logger.debug(`Retrying in ${delay}ms...`, {
        correlationId,
        operationName,
        attempt: attempt + 1
      });
      
      await sleep(delay);
    }
  }
  
  updateCircuitBreaker(false);
  
  logger.error('Database operation failed after all retries', lastError, {
    correlationId,
    operationName,
    attempts: RETRY_DELAYS.length + 1,
    errorCode: lastError.code,
    circuitState: circuitBreaker.state,
    timestamp: new Date().toISOString()
  });
  
  throw lastError;
}

export function getCircuitBreakerStatus() {
  return {
    state: circuitBreaker.state,
    failures: circuitBreaker.failures,
    lastFailureTime: circuitBreaker.lastFailureTime,
    isHealthy: circuitBreaker.state === 'CLOSED'
  };
}

export async function healthCheck(): Promise<boolean> {
  let client: any = null;
  try {
    client = await withRetry(
      () => pool.connect(),
      'health_check_connection'
    );
    
    await withRetry(
      () => client.query('SELECT 1'),
      'health_check_query'
    );
    
    return true;
  } catch (error) {
    logger.error('Database health check failed', error instanceof Error ? error : undefined, {
      errorMessage: error instanceof Error ? error.message : String(error),
      circuitState: circuitBreaker.state
    });
    return false;
  } finally {
    // 🔒 CEO 6-HOUR DEADLINE (Nov 10, 01:15 UTC): Fix connection leak
    // ARCHITECT FINDING: Client must be released even if query fails
    // CRITICAL: This prevents pool starvation under circuit breaker failures
    if (client) {
      client.release();
    }
  }
}
