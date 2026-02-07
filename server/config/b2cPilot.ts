/**
 * B2C Pilot Configuration
 * CEO Executive Order SAA-EO-2026-01-19-01
 * Created: 2026-01-19
 */

export type B2CCaptureMode = 'disabled' | 'pilot_only' | 'enabled';

export function getB2CCaptureMode(): B2CCaptureMode {
  const mode = process.env.B2C_CAPTURE_MODE || 'pilot_only';
  if (mode === 'enabled' || mode === 'disabled' || mode === 'pilot_only') {
    return mode;
  }
  return 'pilot_only';
}

export function isB2CCaptureAllowed(userId: string, isPilotUser: boolean): boolean {
  const mode = getB2CCaptureMode();
  
  if (mode === 'disabled') return false;
  if (mode === 'enabled') return true;
  
  if (mode === 'pilot_only') {
    return isPilotUser && isWithinTrafficCap(userId);
  }
  
  return false;
}

function isWithinTrafficCap(userId: string): boolean {
  const trafficCap = b2cPilotConfig.trafficCapPercent;
  const hash = hashUserId(userId);
  return (hash % 100) < trafficCap;
}

function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export interface B2CPilotConfig {
  enabled: boolean;
  trafficCapPercent: number;
  budgetLimitUsd: number;
  budgetLimitUsers: number;
  microchargeAmountCents: number;
  autoRefund: boolean;
  refundSloMinutes: number;
  stripeLiveAttempts6h: number;
  cohortId: string;
  runId: string;
}

export interface B2CPilotMetrics {
  authSuccessRate: number;
  refundSettlementRate: number;
  fpr: number;
  precision: number;
  recall: number;
  p95CoreMs: number;
  p95AuxMs: number;
  visitorToSignupRate: number;
  signupToPurchaseRate: number;
}

export interface B2CPilotGates {
  gate1: {
    trafficPercent: number;
    chargeAmountCents: number;
    fullRefund: boolean;
    requiredHours: number;
  };
  gate2: {
    trafficPercent: number;
    chargeAmountCents: number;
    refundAmountCents: number;
    complaintRateMax: number;
    requiredHours: number;
  };
  gate3: {
    trafficPercent: number;
    safetyLockNarrowed: boolean;
    requiredDays: number;
  };
}

const parseEnvNumber = (envVar: string | undefined, defaultValue: number): number => {
  if (envVar === undefined) return defaultValue;
  const parsed = parseInt(envVar, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const parseEnvBoolean = (envVar: string | undefined, defaultValue: boolean): boolean => {
  if (envVar === undefined) return defaultValue;
  return envVar.toLowerCase() === 'true' || envVar === '1';
};

export const b2cPilotConfig: B2CPilotConfig = {
  enabled: parseEnvBoolean(process.env.B2C_PILOT_ENABLED, false),
  trafficCapPercent: parseEnvNumber(process.env.B2C_TRAFFIC_CAP_PERCENT, 2),
  budgetLimitUsd: parseEnvNumber(process.env.B2C_BUDGET_LIMIT_USD, 50),
  budgetLimitUsers: parseEnvNumber(process.env.B2C_BUDGET_LIMIT_USERS, 100),
  microchargeAmountCents: parseEnvNumber(process.env.B2C_MICROCHARGE_CENTS, 50),
  autoRefund: parseEnvBoolean(process.env.B2C_AUTO_REFUND, true),
  refundSloMinutes: parseEnvNumber(process.env.B2C_REFUND_SLO_MINUTES, 10),
  stripeLiveAttempts6h: parseEnvNumber(process.env.B2C_STRIPE_ATTEMPTS_6H, 4),
  cohortId: process.env.B2C_COHORT_ID || 'B2C-PILOT-001',
  runId: process.env.B2C_RUN_ID || 'ZT3G-056',
};

export const b2cPilotThresholds: B2CPilotMetrics = {
  authSuccessRate: 0.97,
  refundSettlementRate: 1.0,
  fpr: 0.035,
  precision: 0.95,
  recall: 0.75,
  p95CoreMs: 120,
  p95AuxMs: 200,
  visitorToSignupRate: 0.05,
  signupToPurchaseRate: 0.02,
};

export const b2cPilotGates: B2CPilotGates = {
  gate1: {
    trafficPercent: 5,
    chargeAmountCents: 100,
    fullRefund: true,
    requiredHours: 24,
  },
  gate2: {
    trafficPercent: 25,
    chargeAmountCents: 100,
    refundAmountCents: 50,
    complaintRateMax: 0.005,
    requiredHours: 72,
  },
  gate3: {
    trafficPercent: 100,
    safetyLockNarrowed: true,
    requiredDays: 7,
  },
};

export const b2cTelemetryFields = [
  'run_id',
  'cohort_id',
  'event_type',
  'status',
  'trace_id',
  'checksum',
  'latency_ms',
  'refund_settled_at',
] as const;

export function validateB2CTelemetryPayload(payload: Record<string, unknown>): boolean {
  for (const field of b2cTelemetryFields) {
    if (!(field in payload)) {
      return false;
    }
  }
  return true;
}

export function isWithinPilotBudget(
  currentSpendUsd: number,
  currentUsers: number
): boolean {
  return (
    currentSpendUsd < b2cPilotConfig.budgetLimitUsd &&
    currentUsers < b2cPilotConfig.budgetLimitUsers
  );
}

export function meetsRampCriteria(metrics: B2CPilotMetrics): boolean {
  return (
    metrics.authSuccessRate >= b2cPilotThresholds.authSuccessRate &&
    metrics.refundSettlementRate >= b2cPilotThresholds.refundSettlementRate &&
    metrics.fpr <= b2cPilotThresholds.fpr &&
    metrics.precision >= b2cPilotThresholds.precision &&
    metrics.recall >= b2cPilotThresholds.recall &&
    metrics.p95CoreMs <= b2cPilotThresholds.p95CoreMs &&
    metrics.p95AuxMs <= b2cPilotThresholds.p95AuxMs &&
    metrics.visitorToSignupRate >= b2cPilotThresholds.visitorToSignupRate &&
    metrics.signupToPurchaseRate >= b2cPilotThresholds.signupToPurchaseRate
  );
}

export function createB2CTelemetryPayload(params: {
  event_type: 'charge' | 'refund';
  status: 'success' | 'failed' | 'pending';
  latency_ms: number;
  refund_settled_at?: string;
}): Record<string, unknown> {
  const crypto = require('crypto');
  const payload = {
    run_id: b2cPilotConfig.runId,
    cohort_id: b2cPilotConfig.cohortId,
    event_type: params.event_type,
    status: params.status,
    trace_id: `b2c_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    latency_ms: params.latency_ms,
    refund_settled_at: params.refund_settled_at || null,
    timestamp: new Date().toISOString(),
    checksum: '',
  };
  
  payload.checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...payload, checksum: undefined }))
    .digest('hex')
    .substring(0, 16);
  
  return payload;
}

export async function postB2CTelemetryToA8(payload: Record<string, unknown>): Promise<{ event_id: string; persisted: boolean }> {
  const A8_URL = process.env.A8_TELEMETRY_URL || 'https://auto-com-center-jamarrlmayes.replit.app/api/events';
  
  try {
    const response = await fetch(A8_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': payload.trace_id as string,
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        kind: 'b2c_pilot_event',
        source: 'b2c_pilot',
        ...payload,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`A8 telemetry failed: ${response.status}`);
    }
    
    const result = await response.json();
    return {
      event_id: result.event_id,
      persisted: result.persisted,
    };
  } catch (error) {
    console.error('[B2C_PILOT] Telemetry error:', error);
    return { event_id: '', persisted: false };
  }
}

export default b2cPilotConfig;
