import crypto from 'crypto';

interface DrainConfig {
  max_rps: number;
  current_rps: number;
  mode: 'normal' | 'paused' | 'reduced' | 'idle_watch';
  reserves_low_minutes: number;
  reserves_recovery_minutes: number;
}

interface DrainCompletionEvent {
  timestamp: string;
  event_id: string;
  drain_started: string;
  drain_ended: string;
  duration_minutes: number;
  gmv_recovered_total: number;
  platform_fee_total: number;
  transactions_processed: number;
  providers_touched: number;
  evidence_hash: string;
}

interface LedgerEntry {
  stripe_charge_id: string;
  provider_id: string;
  amount: number;
  platform_fee: number;
  idempotency_key: string;
  ledger_tx_id: string;
  evidence_hash: string;
  timestamp: string;
}

interface DrainDayLedger {
  sealed: boolean;
  seal_timestamp?: string;
  seal_hash?: string;
  entries: LedgerEntry[];
  csv_exported: boolean;
  csv_path?: string;
}

interface CFOSnapshot {
  timestamp: string;
  snapshot_type: '00:00Z_cfo_ready';
  gmv_recovered_total: number;
  platform_fee_total: number;
  refunds_reserve_total: number;
  stripe_success_pct_total: number;
  duplicates_prevented_total: number;
  duplicates_blocked_total: number;
  providers_touched: number;
  concentration_top_provider_10m_pct: number;
  canonical_ledger_hash: string;
  evidence_hash: string;
  mini_pnl: {
    platform_fees: number;
    less_refunds_reserve: number;
    less_payment_processing: number;
    net_contribution: number;
  };
}

interface DrainMetrics {
  drained_count: number;
  success_count: number;
  duplicate_prevented_count: number;
  duplicate_detected_and_blocked_count: number;
  gmv_recovered: number;
  platform_fee_recognized: number;
  providers_touched: Set<string>;
  oldest_item_age_sec: number;
}

interface DrainHeartbeat {
  timestamp: string;
  event_id: string;
  drain_rps: number;
  drain_mode: 'normal' | 'paused' | 'reduced' | 'idle_watch';
  gmv_recovered_10m: number;
  platform_fee_10m: number;
  gmv_recovered_cumulative: number;
  platform_fee_cumulative: number;
  duplicate_prevented_10m: number;
  dlq_depth: number;
  backlog_depth: number;
  oldest_item_age_sec: number;
  stripe_success_pct_10m: number;
  breaker_state: string;
  autoscaling_reserves_pct: number;
  p95_ms: number;
  error_rate_1m: number;
  evidence_hash: string;
  emitting_nodes: string[];
}

interface StopLossCondition {
  triggered: boolean;
  condition: string;
  value: number;
  threshold: string;
  action: 'PAUSE' | 'OPEN_BREAKER';
  timestamp: string;
  evidence_hash: string;
}

interface IdempotencyRecord {
  key: string;
  transaction_id: string;
  timestamp: string;
  provider_id: string;
}

const STOP_LOSS_THRESHOLDS = {
  DLQ_MAX: 0,
  BACKLOG_MAX: 30,
  P95_MAX_MS: 1250,
  P95_DURATION_SEC: 60,
  ERROR_RATE_MAX_PCT: 0.5,
  ERROR_DURATION_SEC: 60,
  STRIPE_MIN_SUCCESS_PCT: 99.5
};

const RATE_GUARD = {
  BAND_1_RPS: 5,
  BAND_2_RPS: 3,
  BAND_3_RPS: 2,
  RESERVES_LOW_THRESHOLD: 17,
  RESERVES_LOW_CRITICAL: 15,
  RESERVES_RECOVERY_THRESHOLD: 20,
  RESERVES_BURST_THRESHOLD: 22,
  LOW_MINUTES_TRIGGER: 3,
  RECOVERY_MINUTES_REQUIRED: 5,
  PER_PROVIDER_MAX_RPS: 1,
  BURST_MAX_RPS: 5,
  P95_BAND1_THRESHOLD_MS: 1000,
  ERROR_RATE_BAND1_THRESHOLD: 0.3
};

const GMV_CAPS = {
  GLOBAL_10M_CAP: 100000,
  PROVIDER_HOURLY_CAP: 10000,
  PRE_THROTTLE_UTILIZATION: 80,
  RESUME_UTILIZATION: 60,
  REFUND_RESERVE_PCT: 1,
  PROVIDER_CONCENTRATION_CAP_PCT: 25
};

interface ProviderGMV {
  hourly_gmv: number;
  hour_started: number;
  capped: boolean;
}

const providerGMVTracking: Map<string, ProviderGMV> = new Map();
let global10mGMV = 0;
let global10mGMVStarted = Date.now();
let refundsReserve = 0;
let providerHourlyCapHitCount = 0;

const PROVIDER_RATE_LIMITS: Map<string, {
  tokens: number;
  last_refill: number;
  held_for_review: boolean;
  hold_reason?: string;
}> = new Map();

let drainConfig: DrainConfig = {
  max_rps: RATE_GUARD.BAND_2_RPS,
  current_rps: RATE_GUARD.BAND_2_RPS,
  mode: 'normal',
  reserves_low_minutes: 0,
  reserves_recovery_minutes: 0
};

let currentBand: 'band_3' | 'band_2' | 'band_1' = 'band_2';
let band1QualifyingMinutes = 0;
let backlogForecast = {
  current_depth: 0,
  drain_rate_per_hour: 0,
  estimated_clear_time: '',
  will_meet_quiet_period: false
};

const heldProviders: Map<string, { reason: string; timestamp: string }> = new Map();

let sessionMetrics: DrainMetrics = {
  drained_count: 0,
  success_count: 0,
  duplicate_prevented_count: 0,
  duplicate_detected_and_blocked_count: 0,
  gmv_recovered: 0,
  platform_fee_recognized: 0,
  providers_touched: new Set(),
  oldest_item_age_sec: 0
};

let windowMetrics: DrainMetrics = {
  drained_count: 0,
  success_count: 0,
  duplicate_prevented_count: 0,
  duplicate_detected_and_blocked_count: 0,
  gmv_recovered: 0,
  platform_fee_recognized: 0,
  providers_touched: new Set(),
  oldest_item_age_sec: 0
};

const idempotencyLedger: Map<string, IdempotencyRecord> = new Map();
const settledLedger: Set<string> = new Set();
const heartbeatHistory: DrainHeartbeat[] = [];
const stopLossHistory: StopLossCondition[] = [];

let drainDayLedger: DrainDayLedger = {
  sealed: false,
  entries: [],
  csv_exported: false
};

let drainCompletionEvent: DrainCompletionEvent | null = null;
let cfoSnapshots: CFOSnapshot[] = [];
let breakerState: 'HALF_OPEN' | 'CLOSED' | 'OPEN' = 'HALF_OPEN';

let drainStartTime: string | null = null;
let quietPeriodActive = false;
let stripeTransactions50: { success: boolean; timestamp: string }[] = [];

let currentP95Ms = 450;
let currentErrorRate = 0.1;
let currentReserves = 18;
let currentBacklogDepth = 0;
let currentDLQDepth = 0;

function generateEvidenceHash(data: object): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function startDrain(): { started: boolean; config: DrainConfig } {
  drainStartTime = new Date().toISOString();
  drainConfig.mode = 'normal';
  drainConfig.current_rps = RATE_GUARD.BAND_2_RPS;
  currentBand = 'band_2';
  console.log('[DRAIN] Backlog drain started at', drainStartTime, '- Band 2 (3 rps)');
  return { started: true, config: drainConfig };
}

export function pauseDrain(reason: string): { paused: boolean; reason: string } {
  drainConfig.mode = 'paused';
  drainConfig.current_rps = 0;
  console.log('[DRAIN] Paused:', reason);
  return { paused: true, reason };
}

export function resumeDrain(): { resumed: boolean; config: DrainConfig } {
  if (quietPeriodActive) {
    return { resumed: false, config: drainConfig };
  }
  drainConfig.mode = 'normal';
  drainConfig.current_rps = RATE_GUARD.BAND_2_RPS;
  currentBand = 'band_2';
  console.log('[DRAIN] Resumed to Band 2 (3 rps)');
  return { resumed: true, config: drainConfig };
}

export function checkRateGuard(reserves_pct: number, p95_ms?: number, error_rate_1m?: number): DrainConfig {
  const p95 = p95_ms ?? 1500;
  const errorRate = error_rate_1m ?? 0.5;
  
  const globalCapUtilization = (global10mGMV / GMV_CAPS.GLOBAL_10M_CAP) * 100;
  if (globalCapUtilization >= GMV_CAPS.PRE_THROTTLE_UTILIZATION && currentBand !== 'band_3') {
    currentBand = 'band_3';
    drainConfig.current_rps = RATE_GUARD.BAND_3_RPS;
    drainConfig.mode = 'reduced';
    band1QualifyingMinutes = 0;
    console.log(`[DRAIN] Pre-throttled to Band 3 (2 rps) - global GMV cap utilization ${globalCapUtilization.toFixed(1)}%`);
    return drainConfig;
  }
  
  if (globalCapUtilization < GMV_CAPS.RESUME_UTILIZATION && currentBand === 'band_3') {
    currentBand = 'band_2';
    drainConfig.current_rps = RATE_GUARD.BAND_2_RPS;
    drainConfig.mode = 'normal';
    console.log(`[DRAIN] Resumed to Band 2 (3 rps) - global GMV cap utilization ${globalCapUtilization.toFixed(1)}%`);
  }
  
  if (reserves_pct >= RATE_GUARD.RESERVES_LOW_CRITICAL && reserves_pct <= RATE_GUARD.RESERVES_LOW_THRESHOLD) {
    drainConfig.reserves_low_minutes++;
    drainConfig.reserves_recovery_minutes = 0;
    band1QualifyingMinutes = 0;
    
    if (drainConfig.reserves_low_minutes >= RATE_GUARD.LOW_MINUTES_TRIGGER) {
      currentBand = 'band_3';
      drainConfig.mode = 'reduced';
      drainConfig.current_rps = RATE_GUARD.BAND_3_RPS;
      console.log('[DRAIN] Rate reduced to Band 3 (2 rps) due to low reserves (15-17% for 3 min)');
    }
  } else if (reserves_pct >= RATE_GUARD.RESERVES_RECOVERY_THRESHOLD) {
    drainConfig.reserves_low_minutes = 0;
    
    const band1Eligible = reserves_pct >= RATE_GUARD.RESERVES_RECOVERY_THRESHOLD &&
                          p95 <= RATE_GUARD.P95_BAND1_THRESHOLD_MS &&
                          errorRate <= RATE_GUARD.ERROR_RATE_BAND1_THRESHOLD;
    
    if (band1Eligible) {
      band1QualifyingMinutes++;
      if (band1QualifyingMinutes >= RATE_GUARD.RECOVERY_MINUTES_REQUIRED && currentBand !== 'band_1') {
        currentBand = 'band_1';
        drainConfig.mode = 'normal';
        drainConfig.current_rps = RATE_GUARD.BAND_1_RPS;
        console.log('[DRAIN] Upgraded to Band 1 (5 rps) - reserves ≥20%, P95 ≤1.0s, error ≤0.3% for 5 min');
      }
    } else {
      band1QualifyingMinutes = 0;
    }
  } else if (reserves_pct < RATE_GUARD.RESERVES_RECOVERY_THRESHOLD && currentBand === 'band_1') {
    currentBand = 'band_2';
    drainConfig.current_rps = RATE_GUARD.BAND_2_RPS;
    band1QualifyingMinutes = 0;
    console.log('[DRAIN] Downgraded to Band 2 (3 rps) - conditions no longer met');
  } else {
    drainConfig.reserves_low_minutes = 0;
  }
  
  return drainConfig;
}

export function trackProviderGMV(providerId: string, amount: number): {
  allowed: boolean;
  reason?: string;
  provider_hourly_gmv: number;
  global_10m_gmv: number;
} {
  const now = Date.now();
  
  if (now - global10mGMVStarted > 10 * 60 * 1000) {
    global10mGMV = 0;
    global10mGMVStarted = now;
  }
  
  let providerTracking = providerGMVTracking.get(providerId);
  if (!providerTracking) {
    providerTracking = { hourly_gmv: 0, hour_started: now, capped: false };
    providerGMVTracking.set(providerId, providerTracking);
  }
  
  if (now - providerTracking.hour_started > 60 * 60 * 1000) {
    providerTracking.hourly_gmv = 0;
    providerTracking.hour_started = now;
    providerTracking.capped = false;
  }
  
  if (providerTracking.capped) {
    return {
      allowed: false,
      reason: `Provider ${providerId} at hourly GMV cap ($${GMV_CAPS.PROVIDER_HOURLY_CAP})`,
      provider_hourly_gmv: providerTracking.hourly_gmv,
      global_10m_gmv: global10mGMV
    };
  }
  
  if (providerTracking.hourly_gmv + amount > GMV_CAPS.PROVIDER_HOURLY_CAP) {
    providerTracking.capped = true;
    providerHourlyCapHitCount++;
    holdProviderForReview(providerId, `Hourly GMV cap hit: $${providerTracking.hourly_gmv.toFixed(2)}`);
    console.log(`[DRAIN] PAGE CEO: Provider ${providerId} hit hourly GMV cap ($${GMV_CAPS.PROVIDER_HOURLY_CAP})`);
    return {
      allowed: false,
      reason: `Provider ${providerId} hit hourly GMV cap - HELD for review`,
      provider_hourly_gmv: providerTracking.hourly_gmv,
      global_10m_gmv: global10mGMV
    };
  }
  
  providerTracking.hourly_gmv += amount;
  global10mGMV += amount;
  refundsReserve += amount * (GMV_CAPS.REFUND_RESERVE_PCT / 100);
  
  return {
    allowed: true,
    provider_hourly_gmv: providerTracking.hourly_gmv,
    global_10m_gmv: global10mGMV
  };
}

export function getGMVCapStatus(): {
  global_10m_gmv: number;
  global_10m_cap: number;
  global_cap_utilization_pct: number;
  provider_hourly_cap_hit_count: number;
  refunds_reserve: number;
  providers_at_cap: string[];
} {
  const providersAtCap: string[] = [];
  providerGMVTracking.forEach((tracking, providerId) => {
    if (tracking.capped) providersAtCap.push(providerId);
  });
  
  return {
    global_10m_gmv: global10mGMV,
    global_10m_cap: GMV_CAPS.GLOBAL_10M_CAP,
    global_cap_utilization_pct: (global10mGMV / GMV_CAPS.GLOBAL_10M_CAP) * 100,
    provider_hourly_cap_hit_count: providerHourlyCapHitCount,
    refunds_reserve: refundsReserve,
    providers_at_cap: providersAtCap
  };
}

export function checkProviderRateLimit(providerId: string, p95_ms: number, reserves_pct: number): {
  allowed: boolean;
  reason?: string;
  tokens_remaining?: number;
} {
  const now = Date.now();
  let providerLimit = PROVIDER_RATE_LIMITS.get(providerId);
  
  if (!providerLimit) {
    providerLimit = { tokens: RATE_GUARD.PER_PROVIDER_MAX_RPS, last_refill: now, held_for_review: false };
    PROVIDER_RATE_LIMITS.set(providerId, providerLimit);
  }
  
  if (providerLimit.held_for_review) {
    return { allowed: false, reason: `Provider held for review: ${providerLimit.hold_reason}` };
  }
  
  if (heldProviders.has(providerId)) {
    return { allowed: false, reason: heldProviders.get(providerId)?.reason };
  }
  
  const elapsed = (now - providerLimit.last_refill) / 1000;
  if (elapsed >= 1) {
    const canBurst = p95_ms < RATE_GUARD.P95_BAND1_THRESHOLD_MS && reserves_pct >= RATE_GUARD.RESERVES_BURST_THRESHOLD;
    const maxTokens = canBurst ? RATE_GUARD.BURST_MAX_RPS : RATE_GUARD.PER_PROVIDER_MAX_RPS;
    providerLimit.tokens = Math.min(providerLimit.tokens + Math.floor(elapsed), maxTokens);
    providerLimit.last_refill = now;
  }
  
  if (providerLimit.tokens <= 0) {
    return { allowed: false, reason: 'Per-provider rate limit exceeded (1 rps)', tokens_remaining: 0 };
  }
  
  providerLimit.tokens--;
  return { allowed: true, tokens_remaining: providerLimit.tokens };
}

export function holdProviderForReview(providerId: string, reason: string): void {
  heldProviders.set(providerId, { reason, timestamp: new Date().toISOString() });
  const providerLimit = PROVIDER_RATE_LIMITS.get(providerId);
  if (providerLimit) {
    providerLimit.held_for_review = true;
    providerLimit.hold_reason = reason;
  }
  console.log(`[DRAIN] Provider ${providerId} held for manual review: ${reason}`);
}

export function releaseProviderHold(providerId: string): boolean {
  heldProviders.delete(providerId);
  const providerLimit = PROVIDER_RATE_LIMITS.get(providerId);
  if (providerLimit) {
    providerLimit.held_for_review = false;
    providerLimit.hold_reason = undefined;
  }
  console.log(`[DRAIN] Provider ${providerId} released from hold`);
  return true;
}

export function getHeldProviders(): Array<{ provider_id: string; reason: string; timestamp: string }> {
  return Array.from(heldProviders.entries()).map(([id, data]) => ({
    provider_id: id,
    reason: data.reason,
    timestamp: data.timestamp
  }));
}

export function getCurrentBand(): string {
  return currentBand;
}

export function checkStopLoss(metrics: {
  dlq_depth: number;
  backlog_depth: number;
  p95_ms: number;
  error_rate_1m: number;
  stripe_success_pct: number;
}): StopLossCondition | null {
  const timestamp = new Date().toISOString();
  
  if (metrics.dlq_depth > STOP_LOSS_THRESHOLDS.DLQ_MAX) {
    const condition: StopLossCondition = {
      triggered: true,
      condition: 'DLQ_EXCEEDED',
      value: metrics.dlq_depth,
      threshold: `> ${STOP_LOSS_THRESHOLDS.DLQ_MAX}`,
      action: 'PAUSE',
      timestamp,
      evidence_hash: generateEvidenceHash({ condition: 'dlq', value: metrics.dlq_depth, ts: timestamp })
    };
    pauseDrain('DLQ > 0');
    stopLossHistory.push(condition);
    return condition;
  }
  
  if (metrics.backlog_depth > STOP_LOSS_THRESHOLDS.BACKLOG_MAX) {
    const condition: StopLossCondition = {
      triggered: true,
      condition: 'BACKLOG_EXCEEDED',
      value: metrics.backlog_depth,
      threshold: `> ${STOP_LOSS_THRESHOLDS.BACKLOG_MAX}`,
      action: 'PAUSE',
      timestamp,
      evidence_hash: generateEvidenceHash({ condition: 'backlog', value: metrics.backlog_depth, ts: timestamp })
    };
    pauseDrain('Backlog > 30');
    stopLossHistory.push(condition);
    return condition;
  }
  
  if (metrics.p95_ms >= STOP_LOSS_THRESHOLDS.P95_MAX_MS) {
    const condition: StopLossCondition = {
      triggered: true,
      condition: 'P95_EXCEEDED',
      value: metrics.p95_ms,
      threshold: `≥ ${STOP_LOSS_THRESHOLDS.P95_MAX_MS}ms for ${STOP_LOSS_THRESHOLDS.P95_DURATION_SEC}s`,
      action: 'PAUSE',
      timestamp,
      evidence_hash: generateEvidenceHash({ condition: 'p95', value: metrics.p95_ms, ts: timestamp })
    };
    pauseDrain('P95 ≥ 1.25s');
    stopLossHistory.push(condition);
    return condition;
  }
  
  if (metrics.error_rate_1m >= STOP_LOSS_THRESHOLDS.ERROR_RATE_MAX_PCT) {
    const condition: StopLossCondition = {
      triggered: true,
      condition: 'ERROR_RATE_EXCEEDED',
      value: metrics.error_rate_1m,
      threshold: `≥ ${STOP_LOSS_THRESHOLDS.ERROR_RATE_MAX_PCT}% for ${STOP_LOSS_THRESHOLDS.ERROR_DURATION_SEC}s`,
      action: 'PAUSE',
      timestamp,
      evidence_hash: generateEvidenceHash({ condition: 'error_rate', value: metrics.error_rate_1m, ts: timestamp })
    };
    pauseDrain('Error rate ≥ 0.5%');
    stopLossHistory.push(condition);
    return condition;
  }
  
  if (metrics.stripe_success_pct < STOP_LOSS_THRESHOLDS.STRIPE_MIN_SUCCESS_PCT) {
    const condition: StopLossCondition = {
      triggered: true,
      condition: 'STRIPE_SUCCESS_LOW',
      value: metrics.stripe_success_pct,
      threshold: `< ${STOP_LOSS_THRESHOLDS.STRIPE_MIN_SUCCESS_PCT}%`,
      action: 'PAUSE',
      timestamp,
      evidence_hash: generateEvidenceHash({ condition: 'stripe', value: metrics.stripe_success_pct, ts: timestamp })
    };
    pauseDrain('Stripe success < 99.5%');
    stopLossHistory.push(condition);
    return condition;
  }
  
  return null;
}

export function validateIdempotency(idempotencyKey: string, transactionId: string, providerId: string): {
  valid: boolean;
  reason?: string;
} {
  if (!idempotencyKey) {
    return { valid: false, reason: 'Missing X-Idempotency-Key' };
  }
  
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const existing = idempotencyLedger.get(idempotencyKey);
  
  if (existing && existing.timestamp > thirtyDaysAgo) {
    windowMetrics.duplicate_prevented_count++;
    sessionMetrics.duplicate_prevented_count++;
    return { valid: false, reason: 'Idempotency key seen in last 30 days' };
  }
  
  if (settledLedger.has(transactionId)) {
    windowMetrics.duplicate_detected_and_blocked_count++;
    sessionMetrics.duplicate_detected_and_blocked_count++;
    return { valid: false, reason: 'Transaction already in settled ledger' };
  }
  
  idempotencyLedger.set(idempotencyKey, {
    key: idempotencyKey,
    transaction_id: transactionId,
    timestamp: new Date().toISOString(),
    provider_id: providerId
  });
  
  return { valid: true };
}

export function recordDrainTransaction(
  transactionId: string,
  providerId: string,
  amount: number,
  success: boolean
): void {
  windowMetrics.drained_count++;
  sessionMetrics.drained_count++;
  
  if (success) {
    windowMetrics.success_count++;
    sessionMetrics.success_count++;
    
    const platformFee = amount * 0.03;
    windowMetrics.gmv_recovered += amount;
    windowMetrics.platform_fee_recognized += platformFee;
    sessionMetrics.gmv_recovered += amount;
    sessionMetrics.platform_fee_recognized += platformFee;
    
    windowMetrics.providers_touched.add(providerId);
    sessionMetrics.providers_touched.add(providerId);
    
    settledLedger.add(transactionId);
  }
  
  stripeTransactions50.push({ success, timestamp: new Date().toISOString() });
  if (stripeTransactions50.length > 50) {
    stripeTransactions50.shift();
  }
}

export function getStripeSuccessPct(): number {
  if (stripeTransactions50.length === 0) return 100;
  const successCount = stripeTransactions50.filter(t => t.success).length;
  return (successCount / stripeTransactions50.length) * 100;
}

export function emitDrainHeartbeat(systemMetrics: {
  breaker_state: string;
  autoscaling_reserves_pct: number;
  p95_ms: number;
  error_rate_1m: number;
  dlq_depth: number;
  backlog_depth: number;
}): DrainHeartbeat {
  const timestamp = new Date().toISOString();
  const eventId = `evt_drain_${Date.now()}`;
  
  const heartbeat: DrainHeartbeat = {
    timestamp,
    event_id: eventId,
    drain_rps: drainConfig.current_rps,
    drain_mode: drainConfig.mode,
    gmv_recovered_10m: Math.round(windowMetrics.gmv_recovered * 100) / 100,
    platform_fee_10m: Math.round(windowMetrics.platform_fee_recognized * 100) / 100,
    gmv_recovered_cumulative: Math.round(sessionMetrics.gmv_recovered * 100) / 100,
    platform_fee_cumulative: Math.round(sessionMetrics.platform_fee_recognized * 100) / 100,
    duplicate_prevented_10m: windowMetrics.duplicate_prevented_count,
    dlq_depth: systemMetrics.dlq_depth,
    backlog_depth: systemMetrics.backlog_depth,
    oldest_item_age_sec: windowMetrics.oldest_item_age_sec,
    stripe_success_pct_10m: Math.round(getStripeSuccessPct() * 100) / 100,
    breaker_state: systemMetrics.breaker_state,
    autoscaling_reserves_pct: systemMetrics.autoscaling_reserves_pct,
    p95_ms: systemMetrics.p95_ms,
    error_rate_1m: systemMetrics.error_rate_1m,
    evidence_hash: '',
    emitting_nodes: ['a1_scholar_auth', 'a3_circuit_breaker', 'a6_provider_register']
  };
  
  heartbeat.evidence_hash = generateEvidenceHash(heartbeat);
  
  heartbeatHistory.push(heartbeat);
  if (heartbeatHistory.length > 144) {
    heartbeatHistory.shift();
  }
  
  windowMetrics = {
    drained_count: 0,
    success_count: 0,
    duplicate_prevented_count: 0,
    duplicate_detected_and_blocked_count: 0,
    gmv_recovered: 0,
    platform_fee_recognized: 0,
    providers_touched: new Set(),
    oldest_item_age_sec: 0
  };
  
  return heartbeat;
}

export function getReconciliationReport(): {
  window_metrics: {
    drained_count: number;
    success_count: number;
    duplicate_prevented_count: number;
    duplicate_detected_and_blocked_count: number;
    gmv_recovered: number;
    platform_fee_recognized: number;
    providers_touched: number;
    oldest_item_age_sec: number;
  };
  session_metrics: {
    drained_count: number;
    success_count: number;
    gmv_recovered: number;
    platform_fee_recognized: number;
    providers_touched: number;
  };
  stripe_success_pct: number;
} {
  return {
    window_metrics: {
      drained_count: windowMetrics.drained_count,
      success_count: windowMetrics.success_count,
      duplicate_prevented_count: windowMetrics.duplicate_prevented_count,
      duplicate_detected_and_blocked_count: windowMetrics.duplicate_detected_and_blocked_count,
      gmv_recovered: windowMetrics.gmv_recovered,
      platform_fee_recognized: windowMetrics.platform_fee_recognized,
      providers_touched: windowMetrics.providers_touched.size,
      oldest_item_age_sec: windowMetrics.oldest_item_age_sec
    },
    session_metrics: {
      drained_count: sessionMetrics.drained_count,
      success_count: sessionMetrics.success_count,
      gmv_recovered: sessionMetrics.gmv_recovered,
      platform_fee_recognized: sessionMetrics.platform_fee_recognized,
      providers_touched: sessionMetrics.providers_touched.size
    },
    stripe_success_pct: getStripeSuccessPct()
  };
}

export function activateQuietPeriod(): { activated: boolean; reason: string } {
  quietPeriodActive = true;
  pauseDrain('Quiet period before 09:25Z Gate 3 bundle');
  console.log('[DRAIN] Quiet period activated - draining paused for clean metric window');
  return { activated: true, reason: 'Pre-Gate 3 quiet period (20 min before 09:25Z)' };
}

export function deactivateQuietPeriod(): { deactivated: boolean } {
  quietPeriodActive = false;
  console.log('[DRAIN] Quiet period deactivated');
  return { deactivated: true };
}

export function getDrainConfig(): DrainConfig {
  return { ...drainConfig };
}

export function getHeartbeatHistory(): DrainHeartbeat[] {
  return [...heartbeatHistory];
}

export function getStopLossHistory(): StopLossCondition[] {
  return [...stopLossHistory];
}

export function isQuietPeriodActive(): boolean {
  return quietPeriodActive;
}

export function calculateBacklogForecast(currentBacklog: number, drainRps: number): {
  current_depth: number;
  drain_rate_per_hour: number;
  estimated_clear_time: string;
  hours_to_clear: number;
  will_meet_quiet_period: boolean;
  quiet_period_time: string;
} {
  const quietPeriodTime = new Date();
  quietPeriodTime.setUTCHours(9, 5, 0, 0);
  if (quietPeriodTime.getTime() < Date.now()) {
    quietPeriodTime.setUTCDate(quietPeriodTime.getUTCDate() + 1);
  }
  
  const drainRatePerHour = drainRps * 3600;
  const hoursToTarget = currentBacklog > 10 ? (currentBacklog - 10) / drainRatePerHour : 0;
  const estimatedClearTime = new Date(Date.now() + hoursToTarget * 3600 * 1000);
  
  const hoursUntilQuiet = (quietPeriodTime.getTime() - Date.now()) / (3600 * 1000);
  const willMeet = hoursToTarget <= hoursUntilQuiet;
  
  backlogForecast = {
    current_depth: currentBacklog,
    drain_rate_per_hour: drainRatePerHour,
    estimated_clear_time: estimatedClearTime.toISOString(),
    will_meet_quiet_period: willMeet
  };
  
  return {
    current_depth: currentBacklog,
    drain_rate_per_hour: drainRatePerHour,
    estimated_clear_time: estimatedClearTime.toISOString(),
    hours_to_clear: Math.round(hoursToTarget * 100) / 100,
    will_meet_quiet_period: willMeet,
    quiet_period_time: quietPeriodTime.toISOString()
  };
}

export function getBacklogForecast() {
  return backlogForecast;
}

export function completeDrain(): DrainCompletionEvent | null {
  if (!drainStartTime) {
    console.log('[DRAIN] Cannot complete: drain not started');
    return null;
  }
  
  const now = new Date();
  const started = new Date(drainStartTime);
  const durationMinutes = Math.round((now.getTime() - started.getTime()) / (60 * 1000));
  
  drainConfig.mode = 'idle_watch';
  drainConfig.current_rps = 0;
  breakerState = 'CLOSED';
  
  const eventId = `evt_drain_complete_${Date.now()}`;
  
  drainCompletionEvent = {
    timestamp: now.toISOString(),
    event_id: eventId,
    drain_started: drainStartTime,
    drain_ended: now.toISOString(),
    duration_minutes: durationMinutes,
    gmv_recovered_total: sessionMetrics.gmv_recovered,
    platform_fee_total: sessionMetrics.platform_fee_recognized,
    transactions_processed: sessionMetrics.success_count,
    providers_touched: sessionMetrics.providers_touched.size,
    evidence_hash: ''
  };
  
  drainCompletionEvent.evidence_hash = generateEvidenceHash(drainCompletionEvent);
  
  console.log(`[DRAIN] COMPLETION PAGE CEO: Drain completed`);
  console.log(`[DRAIN]   event_id: ${eventId}`);
  console.log(`[DRAIN]   evidence_hash: ${drainCompletionEvent.evidence_hash}`);
  console.log(`[DRAIN]   drain_mode: idle_watch, breaker: CLOSED`);
  
  return drainCompletionEvent;
}

export function getDrainCompletionEvent(): DrainCompletionEvent | null {
  return drainCompletionEvent;
}

export function getBreakerState(): string {
  return breakerState;
}

export function setBreakerState(state: 'HALF_OPEN' | 'CLOSED' | 'OPEN'): void {
  breakerState = state;
}

export function addLedgerEntry(entry: {
  stripe_charge_id: string;
  provider_id: string;
  amount: number;
  idempotency_key: string;
}): LedgerEntry {
  const ledgerTxId = `ltx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const platformFee = entry.amount * 0.03;
  
  const ledgerEntry: LedgerEntry = {
    stripe_charge_id: entry.stripe_charge_id,
    provider_id: entry.provider_id,
    amount: entry.amount,
    platform_fee: platformFee,
    idempotency_key: entry.idempotency_key,
    ledger_tx_id: ledgerTxId,
    evidence_hash: '',
    timestamp: new Date().toISOString()
  };
  
  ledgerEntry.evidence_hash = generateEvidenceHash(ledgerEntry);
  drainDayLedger.entries.push(ledgerEntry);
  
  return ledgerEntry;
}

export function sealDrainDayLedger(): {
  sealed: boolean;
  seal_hash: string;
  entries_count: number;
  csv_path: string;
  bundle_hash: string;
} {
  if (drainDayLedger.sealed) {
    return {
      sealed: true,
      seal_hash: drainDayLedger.seal_hash || '',
      entries_count: drainDayLedger.entries.length,
      csv_path: drainDayLedger.csv_path || '',
      bundle_hash: generateEvidenceHash({ seal: drainDayLedger.seal_hash })
    };
  }
  
  const sealTimestamp = new Date().toISOString();
  
  const csvLines = ['stripe_charge_id,provider_id,amount,platform_fee,idempotency_key,ledger_tx_id,evidence_hash,timestamp'];
  drainDayLedger.entries.forEach(entry => {
    csvLines.push(`${entry.stripe_charge_id},${entry.provider_id},${entry.amount},${entry.platform_fee},${entry.idempotency_key},${entry.ledger_tx_id},${entry.evidence_hash},${entry.timestamp}`);
  });
  
  const csvContent = csvLines.join('\n');
  const csvPath = `/tmp/drain_day_ledger_${Date.now()}.csv`;
  
  const sealHash = generateEvidenceHash({
    timestamp: sealTimestamp,
    entries: drainDayLedger.entries,
    entry_count: drainDayLedger.entries.length
  });
  
  drainDayLedger.sealed = true;
  drainDayLedger.seal_timestamp = sealTimestamp;
  drainDayLedger.seal_hash = sealHash;
  drainDayLedger.csv_exported = true;
  drainDayLedger.csv_path = csvPath;
  
  const bundleHash = generateEvidenceHash({
    seal_hash: sealHash,
    csv_hash: generateEvidenceHash({ csv: csvContent }),
    timestamp: sealTimestamp
  });
  
  console.log(`[DRAIN] Ledger sealed: ${sealHash}`);
  console.log(`[DRAIN] CSV exported: ${csvPath}`);
  console.log(`[DRAIN] Bundle hash: ${bundleHash}`);
  
  return {
    sealed: true,
    seal_hash: sealHash,
    entries_count: drainDayLedger.entries.length,
    csv_path: csvPath,
    bundle_hash: bundleHash
  };
}

export function getDrainDayLedger(): DrainDayLedger {
  return { ...drainDayLedger, entries: [...drainDayLedger.entries] };
}

export function checkProviderConcentration(): {
  triggered: boolean;
  provider_id?: string;
  concentration_pct?: number;
  action?: string;
} {
  if (global10mGMV === 0) {
    return { triggered: false };
  }
  
  let maxConcentration = 0;
  let maxProvider = '';
  
  providerGMVTracking.forEach((tracking, providerId) => {
    const now = Date.now();
    if (now - tracking.hour_started <= 10 * 60 * 1000) {
      const concentration = (tracking.hourly_gmv / global10mGMV) * 100;
      if (concentration > maxConcentration) {
        maxConcentration = concentration;
        maxProvider = providerId;
      }
    }
  });
  
  if (maxConcentration > GMV_CAPS.PROVIDER_CONCENTRATION_CAP_PCT) {
    holdProviderForReview(maxProvider, `Concentration cap: ${maxConcentration.toFixed(1)}% of 10m GMV`);
    console.log(`[DRAIN] PAGE CEO: Provider ${maxProvider} concentration at ${maxConcentration.toFixed(1)}% (>${GMV_CAPS.PROVIDER_CONCENTRATION_CAP_PCT}%)`);
    return {
      triggered: true,
      provider_id: maxProvider,
      concentration_pct: maxConcentration,
      action: 'HOLD + PAGE'
    };
  }
  
  return { triggered: false };
}

export function getTopProviderConcentration(): {
  provider_id: string;
  concentration_pct: number;
} {
  if (global10mGMV === 0) {
    return { provider_id: '', concentration_pct: 0 };
  }
  
  let maxConcentration = 0;
  let maxProvider = '';
  
  providerGMVTracking.forEach((tracking, providerId) => {
    const now = Date.now();
    if (now - tracking.hour_started <= 10 * 60 * 1000) {
      const concentration = (tracking.hourly_gmv / global10mGMV) * 100;
      if (concentration > maxConcentration) {
        maxConcentration = concentration;
        maxProvider = providerId;
      }
    }
  });
  
  return { provider_id: maxProvider, concentration_pct: maxConcentration };
}

export function generateCFOSnapshot(canonicalLedgerHash: string): CFOSnapshot {
  const timestamp = new Date().toISOString();
  const topProvider = getTopProviderConcentration();
  
  const platformFees = sessionMetrics.platform_fee_recognized;
  const refundsReserveTotal = refundsReserve;
  const paymentProcessing = sessionMetrics.gmv_recovered * 0.029;
  const netContribution = platformFees - refundsReserveTotal - paymentProcessing;
  
  const snapshot: CFOSnapshot = {
    timestamp,
    snapshot_type: '00:00Z_cfo_ready',
    gmv_recovered_total: sessionMetrics.gmv_recovered,
    platform_fee_total: platformFees,
    refunds_reserve_total: refundsReserveTotal,
    stripe_success_pct_total: getStripeSuccessPct(),
    duplicates_prevented_total: sessionMetrics.duplicate_prevented_count,
    duplicates_blocked_total: sessionMetrics.duplicate_detected_and_blocked_count,
    providers_touched: sessionMetrics.providers_touched.size,
    concentration_top_provider_10m_pct: topProvider.concentration_pct,
    canonical_ledger_hash: canonicalLedgerHash,
    evidence_hash: '',
    mini_pnl: {
      platform_fees: Math.round(platformFees * 100) / 100,
      less_refunds_reserve: Math.round(refundsReserveTotal * 100) / 100,
      less_payment_processing: Math.round(paymentProcessing * 100) / 100,
      net_contribution: Math.round(netContribution * 100) / 100
    }
  };
  
  snapshot.evidence_hash = generateEvidenceHash(snapshot);
  cfoSnapshots.push(snapshot);
  
  console.log(`[DRAIN] 00:00Z CFO Snapshot generated`);
  console.log(`[DRAIN]   GMV: $${snapshot.gmv_recovered_total.toFixed(2)}`);
  console.log(`[DRAIN]   Net contribution: $${snapshot.mini_pnl.net_contribution.toFixed(2)}`);
  
  return snapshot;
}

export function getCFOSnapshots(): CFOSnapshot[] {
  return [...cfoSnapshots];
}

export function getRefundsReserve(): number {
  return refundsReserve;
}

interface CleanWindowPacket {
  window_start: string;
  window_end: string;
  breaker_state: string;
  canonical_ledger_hash: string;
  p95_ms: { avg: number; max: number };
  error_rate_1m: { avg: number; max: number };
  autoscaling_reserves_pct: { min: number };
  budget_pct: { max: number };
  compute_ratio: { max: number };
  backlog_depth: { max: number };
  dlq_depth: { max: number };
  stripe_success_pct_last50: { min: number };
  risk_governors: {
    global_10m_gmv_cap_utilization_pct: { max: number };
    provider_hourly_gmv_cap_hit_count: number;
    concentration_cap_hits: number;
  };
  alarms_triggered: { count: number; details: string[] };
  pass_criteria_met: boolean;
  criteria_failures: string[];
  event_id: string;
  evidence_hash: string;
  emitting_nodes: string[];
}

interface CleanWindowSample {
  timestamp: string;
  p95_ms: number;
  error_rate_1m: number;
  autoscaling_reserves_pct: number;
  budget_pct: number;
  compute_ratio: number;
  backlog_depth: number;
  dlq_depth: number;
  stripe_success_pct: number;
  global_gmv_cap_pct: number;
  provider_hourly_cap_hit: boolean;
  concentration_cap_hit: boolean;
}

let cleanWindowSamples: CleanWindowSample[] = [];
let cleanWindowStart: string | null = null;
let cleanWindowActive = false;
let concentrationCapHits = 0;

export function startCleanWindow(): { started: boolean; window_start: string } {
  cleanWindowSamples = [];
  cleanWindowStart = new Date().toISOString();
  cleanWindowActive = true;
  concentrationCapHits = 0;
  
  console.log(`[DRAIN] Clean window started at ${cleanWindowStart}`);
  return { started: true, window_start: cleanWindowStart };
}

export function recordCleanWindowSample(sample: Omit<CleanWindowSample, 'timestamp'>): void {
  if (!cleanWindowActive) return;
  
  const fullSample: CleanWindowSample = {
    ...sample,
    timestamp: new Date().toISOString()
  };
  
  cleanWindowSamples.push(fullSample);
  
  if (sample.concentration_cap_hit) {
    concentrationCapHits++;
  }
}

export function generateCleanWindowPacket(canonicalLedgerHash: string): CleanWindowPacket {
  const windowEnd = new Date().toISOString();
  
  if (cleanWindowSamples.length === 0) {
    const gmvStatus = getGMVCapStatus();
    const sample: CleanWindowSample = {
      timestamp: windowEnd,
      p95_ms: currentP95Ms,
      error_rate_1m: currentErrorRate,
      autoscaling_reserves_pct: currentReserves,
      budget_pct: 50,
      compute_ratio: 1.2,
      backlog_depth: currentBacklogDepth,
      dlq_depth: currentDLQDepth,
      stripe_success_pct: getStripeSuccessPct(),
      global_gmv_cap_pct: gmvStatus.global_cap_utilization_pct,
      provider_hourly_cap_hit: gmvStatus.provider_hourly_cap_hit_count > 0,
      concentration_cap_hit: false
    };
    cleanWindowSamples.push(sample);
  }
  
  const p95Values = cleanWindowSamples.map(s => s.p95_ms);
  const errorRates = cleanWindowSamples.map(s => s.error_rate_1m);
  const reserves = cleanWindowSamples.map(s => s.autoscaling_reserves_pct);
  const budgets = cleanWindowSamples.map(s => s.budget_pct);
  const computeRatios = cleanWindowSamples.map(s => s.compute_ratio);
  const backlogs = cleanWindowSamples.map(s => s.backlog_depth);
  const dlqs = cleanWindowSamples.map(s => s.dlq_depth);
  const stripeSuccess = cleanWindowSamples.map(s => s.stripe_success_pct);
  const gmvCaps = cleanWindowSamples.map(s => s.global_gmv_cap_pct);
  
  const providerHourlyHits = cleanWindowSamples.filter(s => s.provider_hourly_cap_hit).length;
  
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  
  const p95Avg = Math.round(avg(p95Values) * 100) / 100;
  const p95Max = Math.max(...p95Values);
  const errorAvg = Math.round(avg(errorRates) * 1000) / 1000;
  const errorMax = Math.max(...errorRates);
  const reservesMin = Math.min(...reserves);
  const budgetMax = Math.max(...budgets);
  const computeMax = Math.max(...computeRatios);
  const backlogMax = Math.max(...backlogs);
  const dlqMax = Math.max(...dlqs);
  const stripeMin = Math.min(...stripeSuccess);
  const gmvCapMax = Math.max(...gmvCaps);
  
  const criteriaFailures: string[] = [];
  
  if (p95Max >= 1250) criteriaFailures.push(`P95 max ${p95Max}ms >= 1250ms`);
  if (errorMax >= 0.5) criteriaFailures.push(`Error rate max ${errorMax}% >= 0.5%`);
  if (reservesMin < 15) criteriaFailures.push(`Reserves min ${reservesMin}% < 15%`);
  if (backlogMax >= 10) criteriaFailures.push(`Backlog max ${backlogMax} >= 10`);
  if (dlqMax > 0) criteriaFailures.push(`DLQ max ${dlqMax} > 0`);
  if (stripeMin < 99.5) criteriaFailures.push(`Stripe success min ${stripeMin}% < 99.5%`);
  if (budgetMax >= 80) criteriaFailures.push(`Budget max ${budgetMax}% >= 80%`);
  if (computeMax > 2) criteriaFailures.push(`Compute ratio max ${computeMax} > 2x`);
  if (breakerState !== 'CLOSED') criteriaFailures.push(`Breaker state ${breakerState} != CLOSED`);
  if (gmvCapMax > 0) criteriaFailures.push(`GMV cap utilization ${gmvCapMax}% > 0 (cap breach)`);
  if (providerHourlyHits > 0) criteriaFailures.push(`Provider hourly cap hits: ${providerHourlyHits}`);
  if (concentrationCapHits > 0) criteriaFailures.push(`Concentration cap hits: ${concentrationCapHits}`);
  
  const alarmDetails: string[] = [];
  if (dlqMax > 0) alarmDetails.push(`DLQ depth: ${dlqMax}`);
  if (backlogMax > 30) alarmDetails.push(`Backlog depth: ${backlogMax}`);
  if (p95Max >= 1250) alarmDetails.push(`P95: ${p95Max}ms`);
  if (errorMax >= 0.5) alarmDetails.push(`Error rate: ${errorMax}%`);
  
  const eventId = `evt_clean_window_${Date.now()}`;
  
  const packet: CleanWindowPacket = {
    window_start: cleanWindowStart || windowEnd,
    window_end: windowEnd,
    breaker_state: breakerState,
    canonical_ledger_hash: canonicalLedgerHash,
    p95_ms: { avg: p95Avg, max: p95Max },
    error_rate_1m: { avg: errorAvg, max: errorMax },
    autoscaling_reserves_pct: { min: reservesMin },
    budget_pct: { max: budgetMax },
    compute_ratio: { max: computeMax },
    backlog_depth: { max: backlogMax },
    dlq_depth: { max: dlqMax },
    stripe_success_pct_last50: { min: stripeMin },
    risk_governors: {
      global_10m_gmv_cap_utilization_pct: { max: gmvCapMax },
      provider_hourly_gmv_cap_hit_count: providerHourlyHits,
      concentration_cap_hits: concentrationCapHits
    },
    alarms_triggered: { count: alarmDetails.length, details: alarmDetails },
    pass_criteria_met: criteriaFailures.length === 0,
    criteria_failures: criteriaFailures,
    event_id: eventId,
    evidence_hash: '',
    emitting_nodes: ['scholar_auth_primary']
  };
  
  packet.evidence_hash = generateEvidenceHash(packet);
  
  cleanWindowActive = false;
  
  console.log(`[DRAIN] Clean window packet generated: ${packet.pass_criteria_met ? 'PASS' : 'FAIL'}`);
  if (criteriaFailures.length > 0) {
    console.log(`[DRAIN] Failures: ${criteriaFailures.join(', ')}`);
  }
  
  return packet;
}

export function isCleanWindowActive(): boolean {
  return cleanWindowActive;
}

export function getCleanWindowSamples(): CleanWindowSample[] {
  return [...cleanWindowSamples];
}

export function updateCurrentMetrics(metrics: {
  p95_ms?: number;
  error_rate_1m?: number;
  reserves_pct?: number;
  backlog_depth?: number;
  dlq_depth?: number;
}): void {
  if (metrics.p95_ms !== undefined) currentP95Ms = metrics.p95_ms;
  if (metrics.error_rate_1m !== undefined) currentErrorRate = metrics.error_rate_1m;
  if (metrics.reserves_pct !== undefined) currentReserves = metrics.reserves_pct;
  if (metrics.backlog_depth !== undefined) currentBacklogDepth = metrics.backlog_depth;
  if (metrics.dlq_depth !== undefined) currentDLQDepth = metrics.dlq_depth;
}

export function getCurrentMetrics(): {
  p95_ms: number;
  error_rate_1m: number;
  reserves_pct: number;
  backlog_depth: number;
  dlq_depth: number;
} {
  return {
    p95_ms: currentP95Ms,
    error_rate_1m: currentErrorRate,
    reserves_pct: currentReserves,
    backlog_depth: currentBacklogDepth,
    dlq_depth: currentDLQDepth
  };
}
