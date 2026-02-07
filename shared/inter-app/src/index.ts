import crypto from 'crypto';

export interface InterAppConfig {
  sourceApp: string;
  secret: string;
  timeout?: number;
  retries?: number;
}

export type AppRegistry = Record<string, string>;

export interface InterAppResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export class InterAppClient {
  private config: Required<InterAppConfig>;
  private registry: AppRegistry;

  constructor(config: InterAppConfig, registry: AppRegistry) {
    this.config = {
      sourceApp: config.sourceApp,
      secret: config.secret,
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 2,
    };
    this.registry = registry;
  }

  private getBaseUrl(targetApp: string): string {
    const url = this.registry[targetApp];
    if (!url) {
      throw new Error(`Unknown target app: ${targetApp}. Available: ${Object.keys(this.registry).join(', ')}`);
    }
    return url.replace(/\/$/, '');
  }

  private generateSignature(payload: string, timestamp: number): string {
    const message = `${timestamp}.${payload}`;
    return crypto
      .createHmac('sha256', this.config.secret)
      .update(message)
      .digest('hex');
  }

  private buildHeaders(body?: unknown): Record<string, string> {
    const timestamp = Date.now();
    const payload = body ? JSON.stringify(body) : '';
    const signature = this.generateSignature(payload, timestamp);

    return {
      'Content-Type': 'application/json',
      'X-Source-App': this.config.sourceApp,
      'X-Timestamp': timestamp.toString(),
      'X-Signature': signature,
      'X-Scholar-Protocol': 'v3.5.1',
    };
  }

  private async fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    retriesLeft: number
  ): Promise<InterAppResponse<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type');
      let data: T | undefined;

      if (contentType?.includes('application/json')) {
        data = await response.json() as T;
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: (data as any)?.error || response.statusText,
        };
      }

      return { ok: true, status: response.status, data };
    } catch (error: any) {
      if (retriesLeft > 0 && this.isRetryable(error)) {
        await this.delay(1000 * (this.config.retries - retriesLeft + 1));
        return this.fetchWithRetry<T>(url, options, retriesLeft - 1);
      }

      return {
        ok: false,
        status: 0,
        error: error.message || 'Network error',
      };
    }
  }

  private isRetryable(error: any): boolean {
    return (
      error.name === 'AbortError' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND'
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async get<T = unknown>(targetApp: string, path: string): Promise<InterAppResponse<T>> {
    const url = `${this.getBaseUrl(targetApp)}${path}`;
    const headers = this.buildHeaders();

    return this.fetchWithRetry<T>(url, { method: 'GET', headers }, this.config.retries);
  }

  async post<T = unknown, B = unknown>(
    targetApp: string,
    path: string,
    body: B
  ): Promise<InterAppResponse<T>> {
    const url = `${this.getBaseUrl(targetApp)}${path}`;
    const headers = this.buildHeaders(body);

    return this.fetchWithRetry<T>(
      url,
      { method: 'POST', headers, body: JSON.stringify(body) },
      this.config.retries
    );
  }

  async put<T = unknown, B = unknown>(
    targetApp: string,
    path: string,
    body: B
  ): Promise<InterAppResponse<T>> {
    const url = `${this.getBaseUrl(targetApp)}${path}`;
    const headers = this.buildHeaders(body);

    return this.fetchWithRetry<T>(
      url,
      { method: 'PUT', headers, body: JSON.stringify(body) },
      this.config.retries
    );
  }

  async delete<T = unknown>(targetApp: string, path: string): Promise<InterAppResponse<T>> {
    const url = `${this.getBaseUrl(targetApp)}${path}`;
    const headers = this.buildHeaders();

    return this.fetchWithRetry<T>(url, { method: 'DELETE', headers }, this.config.retries);
  }
}

export function verifyInterAppSignature(
  secret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const ts = parseInt(timestamp, 10);
  const now = Date.now();
  
  if (Math.abs(now - ts) > 300000) {
    return false;
  }

  const message = `${ts}.${body}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export const APP_REGISTRY: AppRegistry = {
  A1: process.env.A1_URL || 'https://scholar-auth-jamarrlmayes.replit.app',
  A2: process.env.A2_URL || 'https://scholarship-api-jamarrlmayes.replit.app',
  A3: process.env.A3_URL || 'https://scholarship-agent-jamarrlmayes.replit.app',
  A4: process.env.A4_URL || 'https://scholarship-sage-jamarrlmayes.replit.app',
  A5: process.env.A5_URL || 'https://student-pilot-jamarrlmayes.replit.app',
  A6: process.env.A6_URL || 'https://provider-register-jamarrlmayes.replit.app',
  A7: process.env.A7_URL || 'https://auto-page-maker-jamarrlmayes.replit.app',
  A8: process.env.A8_URL || 'https://auto-com-center-jamarrlmayes.replit.app',
};
