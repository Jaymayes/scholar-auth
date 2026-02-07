import { logger } from "../middleware/auditLogger";
import { captureError } from "../monitoring/sentry";
import { createHmac } from "crypto";

/**
 * Webhook client for auto_com_center integration
 * Per CEO directive: Sends registration and password reset events
 * with retry logic and proper error handling
 */

interface WebhookEvent {
  event: string;
  payload: Record<string, any>;
  timestamp?: string;
  correlationId?: string;
}

interface WebhookResponse {
  success: boolean;
  statusCode?: number;
  error?: string;
  retries?: number;
}

const WEBHOOK_URL = process.env.AUTO_COM_CENTER_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // CEO DIRECTIVE: HMAC signature secret
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1 second base delay
const TIMEOUT_MS = 5000; // 5 second timeout

/**
 * Send a webhook event to auto_com_center
 * Implements exponential backoff retry logic per CEO directive
 */
export async function sendWebhook(
  eventType: string,
  payload: Record<string, any>,
  correlationId?: string
): Promise<WebhookResponse> {
  if (!WEBHOOK_URL) {
    logger.warn('AUTO_COM_CENTER_WEBHOOK_URL not configured - webhook not sent', {
      eventType,
      correlationId
    });
    return {
      success: false,
      error: 'Webhook URL not configured'
    };
  }

  const event: WebhookEvent = {
    event: eventType,
    payload,
    timestamp: new Date().toISOString(),
    correlationId: correlationId || generateCorrelationId()
  };

  let lastError: Error | null = null;

  // Retry with exponential backoff
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await sendWebhookRequest(event, attempt);
      
      if (response.success) {
        logger.info('Webhook sent successfully', {
          eventType,
          correlationId: event.correlationId,
          attempt: attempt + 1,
          statusCode: response.statusCode
        });
        return response;
      }

      lastError = new Error(response.error || 'Unknown error');
      
      // Don't retry on client errors (4xx)
      if (response.statusCode && response.statusCode >= 400 && response.statusCode < 500) {
        logger.error(`Webhook failed with client error - not retrying: ${eventType}`, new Error(response.error || 'Client error'));
        break;
      }

      // Retry on server errors (5xx) or network errors
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn('Webhook failed - retrying after delay', {
          eventType,
          correlationId: event.correlationId,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          delayMs,
          statusCode: response.statusCode,
          error: response.error
        });
        await sleep(delayMs);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn('Webhook request exception - retrying after delay', {
          eventType,
          correlationId: event.correlationId,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          delayMs,
          error: lastError.message
        });
        await sleep(delayMs);
      }
    }
  }

  // All retries failed
  const failureError = new Error(`Webhook failed after ${MAX_RETRIES} retries for ${eventType}: ${lastError?.message}`);
  logger.error(`Webhook failed after all retries: ${eventType}`, failureError);

  // Capture to Sentry for monitoring
  captureError(failureError, {
    eventType,
    correlationId: event.correlationId,
    retries: MAX_RETRIES
  });

  return {
    success: false,
    error: lastError?.message || 'All retries exhausted',
    retries: MAX_RETRIES
  };
}

/**
 * Generate HMAC signature for webhook payload
 * CEO DIRECTIVE: HMAC verification required for production webhooks
 */
function generateWebhookSignature(payload: string): string | null {
  if (!WEBHOOK_SECRET) {
    logger.warn('WEBHOOK_SECRET not configured - HMAC signature not generated');
    return null;
  }
  
  const hmac = createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('hex');
  
  // Log sample signature (redacted) for CEO evidence
  logger.info('Webhook HMAC signature generated', {
    signaturePrefix: signature.substring(0, 8),
    algorithm: 'sha256',
    payloadSize: payload.length
  });
  
  return signature;
}

/**
 * Internal function to send HTTP request to webhook endpoint
 */
async function sendWebhookRequest(
  event: WebhookEvent,
  attempt: number
): Promise<WebhookResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const payload = JSON.stringify(event);
    const signature = generateWebhookSignature(payload);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': event.correlationId || '',
      'X-Event-Type': event.event,
      'X-Retry-Attempt': String(attempt),
      'User-Agent': 'scholar-auth/1.0.0'
    };
    
    // CEO DIRECTIVE: Add HMAC signature header if secret is configured
    if (signature) {
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
      headers['X-Webhook-Signature-Algorithm'] = 'sha256';
    } else {
      logger.warn('Webhook sent without HMAC signature - WEBHOOK_SECRET not configured', {
        eventType: event.event,
        correlationId: event.correlationId
      });
    }
    
    const response = await fetch(WEBHOOK_URL!, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const statusCode = response.status;
    
    if (response.ok) {
      return {
        success: true,
        statusCode
      };
    }

    // Read error response
    let errorMessage: string;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || `HTTP ${statusCode}`;
    } catch {
      errorMessage = `HTTP ${statusCode} ${response.statusText}`;
    }

    return {
      success: false,
      statusCode,
      error: errorMessage
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      // Check if it's an abort error (timeout)
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timeout after ${TIMEOUT_MS}ms`
        };
      }

      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: false,
      error: 'Unknown error'
    };
  }
}

/**
 * Send user.registered event
 */
export async function sendUserRegisteredEvent(data: {
  user_id: string;
  email: string;
  name: string;
  verification_token: string;
  correlationId?: string;
}): Promise<WebhookResponse> {
  return sendWebhook('user.registered', {
    user_id: data.user_id,
    email: data.email,
    name: data.name,
    verification_token: data.verification_token,
  }, data.correlationId);
}

/**
 * Send user.password_reset_requested event
 */
export async function sendPasswordResetEvent(data: {
  user_id: string;
  email: string;
  reset_token: string;
  expires_at: string;
  correlationId?: string;
}): Promise<WebhookResponse> {
  return sendWebhook('user.password_reset_requested', {
    user_id: data.user_id,
    email: data.email,
    reset_token: data.reset_token,
    expires_at: data.expires_at,
  }, data.correlationId);
}

/**
 * Generate a correlation ID for tracking
 */
function generateCorrelationId(): string {
  return `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Health check for webhook endpoint
 */
export async function checkWebhookHealth(): Promise<{
  configured: boolean;
  url?: string;
  timeout: number;
}> {
  return {
    configured: !!WEBHOOK_URL,
    url: WEBHOOK_URL ? `${WEBHOOK_URL.substring(0, 30)}...` : undefined,
    timeout: TIMEOUT_MS
  };
}
