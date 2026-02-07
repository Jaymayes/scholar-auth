import { logger } from "../middleware/auditLogger";

export interface HttpRetryOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  retryDelays?: number[];
  body?: any;
}

export interface HttpRetryResult {
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  attemptedRetries: number;
  finalError: string | null;
  data?: any;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function httpRequestWithRetry(
  options: HttpRetryOptions
): Promise<HttpRetryResult> {
  const {
    url,
    method = 'GET',
    headers = {},
    timeout = 2000,
    maxRetries = 3,
    retryDelays = [200, 500, 1000],
    body,
  } = options;

  const startTime = Date.now();
  let lastError: Error | null = null;
  let statusCode: number | null = null;
  let attemptedRetries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStartTime = Date.now();
    
    try {
      logger.info(`HTTP request attempt ${attempt + 1}/${maxRetries + 1}`, {
        url,
        method,
        timeout,
      });

      const requestOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ScholarAuth/1.0',
          ...headers,
        },
      };

      if (body && method !== 'GET') {
        requestOptions.body = JSON.stringify(body);
      }

      const response = await fetchWithTimeout(url, requestOptions, timeout);
      statusCode = response.status;
      
      const attemptLatency = Date.now() - attemptStartTime;
      const totalLatency = Date.now() - startTime;

      logger.info(`HTTP request attempt ${attempt + 1} completed`, {
        url,
        statusCode,
        attemptLatency,
        totalLatency,
      });

      if (response.ok) {
        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            data = await response.json();
          } catch (parseError) {
            data = null;
          }
        }

        return {
          success: true,
          statusCode,
          latencyMs: totalLatency,
          attemptedRetries: attempt,
          finalError: null,
          data,
        };
      }

      lastError = new Error(`HTTP ${statusCode}: ${response.statusText}`);
      
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        logger.warn(`HTTP request failed with client error (no retry)`, {
          url,
          statusCode,
          attempt: attempt + 1,
        });
        break;
      }

    } catch (error: any) {
      const attemptLatency = Date.now() - attemptStartTime;
      lastError = error;

      logger.warn(`HTTP request attempt ${attempt + 1} failed`, {
        url,
        errorMessage: error.message,
        attemptLatency,
        attempt: attempt + 1,
      });

      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${timeout}ms`);
      }
    }

    if (attempt < maxRetries) {
      attemptedRetries++;
      const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
      
      logger.info(`Retrying HTTP request after ${delay}ms`, {
        url,
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        delay,
      });

      await sleep(delay);
    }
  }

  const totalLatency = Date.now() - startTime;

  logger.error(`HTTP request failed after ${maxRetries + 1} attempts`, {
    url,
    attemptedRetries,
    totalLatency,
    finalError: lastError?.message,
    statusCode,
  });

  return {
    success: false,
    statusCode,
    latencyMs: totalLatency,
    attemptedRetries,
    finalError: lastError?.message || 'Unknown error',
  };
}
