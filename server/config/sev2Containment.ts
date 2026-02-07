/**
 * SEV-2 Containment Configuration
 * CEO Kill Switch Order: 2026-01-19
 * 
 * Kill switch: B2C capture paused. TRAFFIC_CAP_B2C_PILOT = 0%.
 * Change freeze: Block non-emergency deploys to A1-A8 until SEV-2 closed.
 */

export interface SEV2ContainmentState {
  active: boolean;
  activatedAt: string;
  killSwitchEngaged: boolean;
  changeFreezeActive: boolean;
  b2cCaptureDisabled: boolean;
  trafficCapPercent: number;
  circuitBreakerState: 'open' | 'half_open' | 'closed';
  incidentId: string;
  errorCodes: string[];
  a8AttestationId: string | null;
}

export const sev2State: SEV2ContainmentState = {
  active: process.env.SEV2_ACTIVE === 'true',
  activatedAt: new Date().toISOString(),
  killSwitchEngaged: process.env.TRAFFIC_CAP_B2C_PILOT === '0',
  changeFreezeActive: process.env.CHANGE_FREEZE_ACTIVE === 'true',
  b2cCaptureDisabled: process.env.B2C_CAPTURE_MODE === 'disabled',
  trafficCapPercent: parseInt(process.env.TRAFFIC_CAP_B2C_PILOT || '0', 10),
  circuitBreakerState: (process.env.CIRCUIT_BREAKER_STATE as 'open' | 'half_open' | 'closed') || 'open',
  incidentId: `SEV2-${Date.now()}`,
  errorCodes: ['AUTH_DB_UNREACHABLE', 'RETRY_STORM_SUPPRESSED'],
  a8AttestationId: null,
};

export function isSEV2Active(): boolean {
  return sev2State.active;
}

export function isKillSwitchEngaged(): boolean {
  return sev2State.killSwitchEngaged;
}

export function isChangeFreezeActive(): boolean {
  return sev2State.changeFreezeActive;
}

export function getCircuitBreakerState(): 'open' | 'half_open' | 'closed' {
  return sev2State.circuitBreakerState;
}

export function setCircuitBreakerState(state: 'open' | 'half_open' | 'closed'): void {
  sev2State.circuitBreakerState = state;
  console.log(`[SEV-2] Circuit breaker state changed to: ${state}`);
}

export function recordA8Attestation(attestationId: string): void {
  sev2State.a8AttestationId = attestationId;
}

export interface ExitCriteria {
  a1_green_60min: boolean;
  db_connected: boolean;
  pool_utilization_under_80: boolean;
  auth_5xx_count: number;
  a3_retry_storm_events: number;
  breaker_metrics_normal: boolean;
  queue_depth_stable: boolean;
  p95_core_ms: number;
  p95_aux_ms: number;
  golden_path_compliant: boolean;
  confirmations_3_of_3: boolean;
}

export function checkExitCriteria(metrics: Partial<ExitCriteria>): {
  canExit: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  
  if (!metrics.a1_green_60min) failures.push('A1 not green for 60 minutes');
  if (!metrics.db_connected) failures.push('Database not connected');
  if (metrics.pool_utilization_under_80 === false) failures.push('Pool utilization >= 80%');
  if (metrics.auth_5xx_count && metrics.auth_5xx_count > 0) failures.push(`Auth 5xx count: ${metrics.auth_5xx_count}`);
  if (metrics.a3_retry_storm_events && metrics.a3_retry_storm_events > 0) failures.push(`A3 retry storm events: ${metrics.a3_retry_storm_events}`);
  if (!metrics.breaker_metrics_normal) failures.push('Circuit breaker metrics abnormal');
  if (!metrics.queue_depth_stable) failures.push('Queue depth unstable');
  if (metrics.p95_core_ms && metrics.p95_core_ms > 120) failures.push(`P95 core > 120ms: ${metrics.p95_core_ms}ms`);
  if (metrics.p95_aux_ms && metrics.p95_aux_ms > 200) failures.push(`P95 aux > 200ms: ${metrics.p95_aux_ms}ms`);
  if (!metrics.golden_path_compliant) failures.push('Golden Path non-compliant');
  if (!metrics.confirmations_3_of_3) failures.push('Missing 3-of-3 confirmations');
  
  return {
    canExit: failures.length === 0,
    failures,
  };
}

export function getSEV2Summary(): Record<string, unknown> {
  return {
    sev2_active: sev2State.active,
    incident_id: sev2State.incidentId,
    activated_at: sev2State.activatedAt,
    kill_switch_engaged: sev2State.killSwitchEngaged,
    change_freeze_active: sev2State.changeFreezeActive,
    b2c_capture_disabled: sev2State.b2cCaptureDisabled,
    traffic_cap_percent: sev2State.trafficCapPercent,
    circuit_breaker_state: sev2State.circuitBreakerState,
    error_codes: sev2State.errorCodes,
    a8_attestation_id: sev2State.a8AttestationId,
  };
}

export default sev2State;
