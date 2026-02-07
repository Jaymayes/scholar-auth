/**
 * Auth and Provider Flow Hygiene - SEV-2 Containment
 * CEO Authorization: 2026-01-19
 * 
 * Normalize error rate: exclude 401/403/429 from auth 5xx KPI
 * Separate policy blocks metric from actual errors
 */

export interface AuthMetricsState {
  auth_5xx_count: number;
  auth_5xx_total: number;
  policy_blocks_401: number;
  policy_blocks_403: number;
  policy_blocks_429: number;
  total_auth_requests: number;
  login_latencies_ms: number[];
  login_p95_ms: number;
  login_p50_ms: number;
  login_avg_ms: number;
  provider_synthetic_p95_ms: number;
  sev1_triggered: boolean;
  sev1_reason: string | null;
  allowlisted_ips: Set<string>;
  db_latencies_ms: number[];
  db_p95_ms: number;
  app_p95_ms: number;
  slow_queries: SlowQueryLog[];
  slow_query_threshold_ms: number;
}

export interface SlowQueryLog {
  query_hash: string;
  duration_ms: number;
  timestamp: string;
  table_name?: string;
}

const authMetrics: AuthMetricsState = {
  auth_5xx_count: 0,
  auth_5xx_total: 0,
  policy_blocks_401: 0,
  policy_blocks_403: 0,
  policy_blocks_429: 0,
  total_auth_requests: 0,
  login_latencies_ms: [],
  login_p95_ms: 0,
  login_p50_ms: 0,
  login_avg_ms: 0,
  provider_synthetic_p95_ms: 0,
  sev1_triggered: false,
  sev1_reason: null,
  allowlisted_ips: new Set([
    '127.0.0.1',
    '::1',
  ]),
  db_latencies_ms: [],
  db_p95_ms: 0,
  app_p95_ms: 0,
  slow_queries: [],
  slow_query_threshold_ms: 80,
};

const MAX_LATENCY_SAMPLES = 1000;
const MAX_SLOW_QUERIES = 100;

export function recordAuthRequest(statusCode: number, latencyMs: number): void {
  authMetrics.total_auth_requests++;
  
  if (statusCode === 401) {
    authMetrics.policy_blocks_401++;
  } else if (statusCode === 403) {
    authMetrics.policy_blocks_403++;
  } else if (statusCode === 429) {
    authMetrics.policy_blocks_429++;
  } else if (statusCode >= 500) {
    authMetrics.auth_5xx_count++;
    authMetrics.auth_5xx_total++;
    checkSEV1Conditions('auth_5xx');
  }
  
  authMetrics.login_latencies_ms.push(latencyMs);
  if (authMetrics.login_latencies_ms.length > MAX_LATENCY_SAMPLES) {
    authMetrics.login_latencies_ms.shift();
  }
  
  updateLoginPercentiles();
}

export function updateLoginPercentiles(): void {
  if (authMetrics.login_latencies_ms.length === 0) return;
  
  const sorted = [...authMetrics.login_latencies_ms].sort((a, b) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);
  const p50Index = Math.floor(sorted.length * 0.50);
  
  authMetrics.login_p95_ms = sorted[p95Index] || 0;
  authMetrics.login_p50_ms = sorted[p50Index] || 0;
  authMetrics.login_avg_ms = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  
  if (authMetrics.login_p95_ms > 200) {
    console.log(`[ALERT] Login P95 ${authMetrics.login_p95_ms}ms > 200ms target`);
  }
}

export function recordProviderSyntheticLatency(p95Ms: number): void {
  authMetrics.provider_synthetic_p95_ms = p95Ms;
  
  if (p95Ms > 500) {
    checkSEV1Conditions('provider_synthetic_p95_exceeded');
  }
}

export function checkSEV1Conditions(reason: string): void {
  const shouldTrigger = 
    reason === 'auth_5xx' || 
    reason === 'provider_synthetic_p95_exceeded';
  
  if (shouldTrigger && !authMetrics.sev1_triggered) {
    authMetrics.sev1_triggered = true;
    authMetrics.sev1_reason = reason;
    console.log(`[SEV-1] DECLARED - Reason: ${reason}`);
  }
}

export function addAllowlistedIP(ip: string): void {
  authMetrics.allowlisted_ips.add(ip);
}

export function isIPAllowlisted(ip: string): boolean {
  return authMetrics.allowlisted_ips.has(ip);
}

export function recordDBLatency(durationMs: number, queryHash?: string, tableName?: string): void {
  authMetrics.db_latencies_ms.push(durationMs);
  if (authMetrics.db_latencies_ms.length > MAX_LATENCY_SAMPLES) {
    authMetrics.db_latencies_ms.shift();
  }
  
  if (durationMs > authMetrics.slow_query_threshold_ms) {
    authMetrics.slow_queries.push({
      query_hash: queryHash || 'unknown',
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
      table_name: tableName,
    });
    
    if (authMetrics.slow_queries.length > MAX_SLOW_QUERIES) {
      authMetrics.slow_queries.shift();
    }
    
    console.log(`[SLOW_QUERY] ${durationMs}ms > ${authMetrics.slow_query_threshold_ms}ms threshold`);
  }
  
  updateDBPercentiles();
}

export function updateDBPercentiles(): void {
  if (authMetrics.db_latencies_ms.length === 0) return;
  
  const sorted = [...authMetrics.db_latencies_ms].sort((a, b) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);
  authMetrics.db_p95_ms = sorted[p95Index] || 0;
}

export function recordAppLatency(durationMs: number): void {
  const sorted = [...authMetrics.login_latencies_ms, durationMs].sort((a, b) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);
  authMetrics.app_p95_ms = sorted[p95Index] || 0;
}

export function getAuth5xxKPI(): {
  auth_5xx_count: number;
  excludes_policy_blocks: boolean;
  policy_blocks_total: number;
} {
  return {
    auth_5xx_count: authMetrics.auth_5xx_count,
    excludes_policy_blocks: true,
    policy_blocks_total: 
      authMetrics.policy_blocks_401 + 
      authMetrics.policy_blocks_403 + 
      authMetrics.policy_blocks_429,
  };
}

export function getPolicyBlocksMetrics(): {
  total: number;
  by_code: {
    '401': number;
    '403': number;
    '429': number;
  };
} {
  return {
    total: authMetrics.policy_blocks_401 + 
           authMetrics.policy_blocks_403 + 
           authMetrics.policy_blocks_429,
    by_code: {
      '401': authMetrics.policy_blocks_401,
      '403': authMetrics.policy_blocks_403,
      '429': authMetrics.policy_blocks_429,
    },
  };
}

export function getLoginLatencyMetrics(): {
  p50_ms: number;
  p95_ms: number;
  avg_ms: number;
  slo_met: boolean;
  sample_count: number;
} {
  return {
    p50_ms: authMetrics.login_p50_ms,
    p95_ms: authMetrics.login_p95_ms,
    avg_ms: authMetrics.login_avg_ms,
    slo_met: authMetrics.login_p95_ms <= 200,
    sample_count: authMetrics.login_latencies_ms.length,
  };
}

export function getDBLatencyMetrics(): {
  db_p95_ms: number;
  app_p95_ms: number;
  slo_met: boolean;
  slow_queries_count: number;
  recent_slow_queries: SlowQueryLog[];
} {
  return {
    db_p95_ms: authMetrics.db_p95_ms,
    app_p95_ms: authMetrics.app_p95_ms,
    slo_met: authMetrics.db_p95_ms <= 100,
    slow_queries_count: authMetrics.slow_queries.length,
    recent_slow_queries: authMetrics.slow_queries.slice(-10),
  };
}

export function getSEV1Status(): {
  triggered: boolean;
  reason: string | null;
  provider_synthetic_p95_ms: number;
  auth_5xx_count: number;
} {
  return {
    triggered: authMetrics.sev1_triggered,
    reason: authMetrics.sev1_reason,
    provider_synthetic_p95_ms: authMetrics.provider_synthetic_p95_ms,
    auth_5xx_count: authMetrics.auth_5xx_count,
  };
}

export function getFullAuthMetrics(): Record<string, unknown> {
  return {
    auth_5xx: getAuth5xxKPI(),
    policy_blocks: getPolicyBlocksMetrics(),
    login_latency: getLoginLatencyMetrics(),
    db_latency: getDBLatencyMetrics(),
    sev1_status: getSEV1Status(),
    total_requests: authMetrics.total_auth_requests,
    allowlisted_ips_count: authMetrics.allowlisted_ips.size,
  };
}

export function resetAuth5xxCount(): void {
  authMetrics.auth_5xx_count = 0;
}

export function clearSEV1(): void {
  authMetrics.sev1_triggered = false;
  authMetrics.sev1_reason = null;
}

export default {
  recordAuthRequest,
  recordProviderSyntheticLatency,
  recordDBLatency,
  recordAppLatency,
  addAllowlistedIP,
  isIPAllowlisted,
  getAuth5xxKPI,
  getPolicyBlocksMetrics,
  getLoginLatencyMetrics,
  getDBLatencyMetrics,
  getSEV1Status,
  getFullAuthMetrics,
  resetAuth5xxCount,
  clearSEV1,
  checkSEV1Conditions,
};
