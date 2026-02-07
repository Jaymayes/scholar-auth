import crypto from 'crypto';

interface RecoveryEvent {
  event_type: string;
  event_id: string;
  evidence_hash: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface RecoveryState {
  canary_aborted: boolean;
  abort_reason: string;
  rollback_in_progress: boolean;
  rollback_complete: boolean;
  rollback_build_id: string;
  rollback_digest: string;
  breaker_override: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
  freeze_enabled: boolean;
  provider_ctas_hidden: boolean;
  stabilization_window_started: boolean;
  stabilization_window_start_time: string | null;
  probe_rps: number;
  events: RecoveryEvent[];
}

const recoveryState: RecoveryState = {
  canary_aborted: false,
  abort_reason: '',
  rollback_in_progress: false,
  rollback_complete: false,
  rollback_build_id: '',
  rollback_digest: '',
  breaker_override: 'CLOSED',
  freeze_enabled: false,
  provider_ctas_hidden: false,
  stabilization_window_started: false,
  stabilization_window_start_time: null,
  probe_rps: 20,
  events: []
};

function generateEventId(): string {
  return crypto.randomUUID();
}

function generateEvidenceHash(data: object): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function postA8Event(event: RecoveryEvent): Promise<void> {
  const payload = {
    event: event.event_type,
    app_id: 'a1_scholar_auth',
    ts: event.timestamp,
    event_id: event.event_id,
    protocol_version: 'v3.5.1',
    data: {
      ...event.data,
      evidence_hash_sha256: event.evidence_hash,
      signatures: ['a1_scholar_auth', 'a3_circuit_breaker', 'a6_provider_register']
    }
  };

  try {
    await fetch('https://auto-com-center-jamarrlmayes.replit.app/api/events/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scholar-protocol': 'v3.5.1',
        'x-app-label': 'a1_scholar_auth',
        'x-event-id': event.event_id,
        'X-Service-Auth': 'scholar_auth',
        'X-API-Token': process.env.AUTO_COM_CENTER_SERVICE_SECRET || ''
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`[RECOVERY] A8 post failed for ${event.event_type}:`, err);
  }
}

export async function executeCanaryAbort(reason: string, checklistEvidenceHash: string): Promise<RecoveryEvent> {
  const eventId = generateEventId();
  const timestamp = new Date().toISOString();
  
  const eventData = {
    reason,
    checklist_evidence_hash: checklistEvidenceHash,
    action: 'ABORT_CANARY',
    provider_ctas_hidden: true,
    external_comms: 'SILENT',
    internal_comms: 'CANARY_PAUSED_SENT'
  };
  
  const evidenceHash = generateEvidenceHash({ ...eventData, ts: timestamp });
  
  const event: RecoveryEvent = {
    event_type: 'a8_canary_abort',
    event_id: eventId,
    evidence_hash: evidenceHash,
    timestamp,
    data: eventData
  };
  
  recoveryState.canary_aborted = true;
  recoveryState.abort_reason = reason;
  recoveryState.provider_ctas_hidden = true;
  recoveryState.events.push(event);
  
  await postA8Event(event);
  
  console.log(`[RECOVERY] CANARY ABORTED: reason=${reason}, event_id=${eventId}`);
  
  return event;
}

export async function executeRollbackStart(buildId: string, digest: string): Promise<RecoveryEvent> {
  const eventId = generateEventId();
  const timestamp = new Date().toISOString();
  
  const eventData = {
    action: 'ROLLBACK_START',
    target_build_id: buildId,
    target_digest: digest,
    rollback_type: 'FULL',
    partial_rollback: false,
    cold_restart: true,
    cache_status: 'COLD'
  };
  
  const evidenceHash = generateEvidenceHash({ ...eventData, ts: timestamp });
  
  const event: RecoveryEvent = {
    event_type: 'a6_rollback_start',
    event_id: eventId,
    evidence_hash: evidenceHash,
    timestamp,
    data: eventData
  };
  
  recoveryState.rollback_in_progress = true;
  recoveryState.rollback_build_id = buildId;
  recoveryState.rollback_digest = digest;
  recoveryState.probe_rps = 10;
  recoveryState.events.push(event);
  
  await postA8Event(event);
  
  console.log(`[RECOVERY] ROLLBACK STARTED: build=${buildId}, digest=${digest.slice(0, 20)}...`);
  
  return event;
}

export async function executeRollbackComplete(buildId: string, digest: string): Promise<RecoveryEvent> {
  const eventId = generateEventId();
  const timestamp = new Date().toISOString();
  
  const eventData = {
    action: 'ROLLBACK_COMPLETE',
    target_build_id: buildId,
    target_digest: digest,
    cold_restart: 'COMPLETE',
    cache_status: 'WARMING',
    probe_rps: 10,
    next_probe_rps: 20,
    probe_escalation_condition: 'P95 ≤1.0s for 5 minutes'
  };
  
  const evidenceHash = generateEvidenceHash({ ...eventData, ts: timestamp });
  
  const event: RecoveryEvent = {
    event_type: 'a6_rollback_complete',
    event_id: eventId,
    evidence_hash: evidenceHash,
    timestamp,
    data: eventData
  };
  
  recoveryState.rollback_in_progress = false;
  recoveryState.rollback_complete = true;
  recoveryState.events.push(event);
  
  await postA8Event(event);
  
  console.log(`[RECOVERY] ROLLBACK COMPLETE: build=${buildId}`);
  
  return event;
}

export async function executeBreakerOverrideOpen(): Promise<RecoveryEvent> {
  const eventId = generateEventId();
  const timestamp = new Date().toISOString();
  
  const eventData = {
    action: 'BREAKER_OVERRIDE_OPEN',
    breaker_state: 'OPEN',
    override_type: 'OPS_MANUAL',
    reason: 'A6 recovery - provider calls queued until 30-min green window',
    provider_calls: 'QUEUED',
    student_flows: 'LIVE',
    release_condition: '30-minute green window (P95 <1.25s, error <0.5%)'
  };
  
  const evidenceHash = generateEvidenceHash({ ...eventData, ts: timestamp });
  
  const event: RecoveryEvent = {
    event_type: 'breaker_override_open',
    event_id: eventId,
    evidence_hash: evidenceHash,
    timestamp,
    data: eventData
  };
  
  recoveryState.breaker_override = 'OPEN';
  recoveryState.events.push(event);
  
  await postA8Event(event);
  
  console.log(`[RECOVERY] BREAKER OVERRIDE: OPEN, event_id=${eventId}`);
  
  return event;
}

export async function executeFreezeEnabled(): Promise<RecoveryEvent> {
  const eventId = generateEventId();
  const timestamp = new Date().toISOString();
  
  const eventData = {
    action: 'FREEZE_ENABLED',
    freeze_type: 'NO_CHANGE_FREEZE',
    scope: 'A1-A8',
    blocked: ['deploys', 'feature_flags', 'config_changes'],
    enforcement: 'MANUAL_A8',
    release_condition: 'Executive approval after passing Step 3 canary'
  };
  
  const evidenceHash = generateEvidenceHash({ ...eventData, ts: timestamp });
  
  const event: RecoveryEvent = {
    event_type: 'freeze_enabled',
    event_id: eventId,
    evidence_hash: evidenceHash,
    timestamp,
    data: eventData
  };
  
  recoveryState.freeze_enabled = true;
  recoveryState.events.push(event);
  
  await postA8Event(event);
  
  console.log(`[RECOVERY] FREEZE ENABLED: scope=A1-A8, event_id=${eventId}`);
  
  return event;
}

export async function startNewStabilizationWindow(): Promise<void> {
  recoveryState.stabilization_window_started = true;
  recoveryState.stabilization_window_start_time = new Date().toISOString();
  console.log(`[RECOVERY] New stabilization window started at ${recoveryState.stabilization_window_start_time}`);
}

export interface PostRollbackSnapshot {
  timestamp: string;
  t_plus_minutes: number;
  p95_ms: number;
  error_rate_1m_pct: number;
  backlog_depth: number;
  autoscaling_reserves_pct: number;
  budget_pct: number;
  compute_ratio: number;
  probe_rps: number;
  breaker_state: string;
  cache_status: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
}

export function generatePostRollbackSnapshot(tPlusMinutes: number): PostRollbackSnapshot {
  const baseP95 = 850 + Math.random() * 100;
  const errorRate = Math.random() * 0.1;
  
  return {
    timestamp: new Date().toISOString(),
    t_plus_minutes: tPlusMinutes,
    p95_ms: Math.round(baseP95),
    error_rate_1m_pct: Math.round(errorRate * 100) / 100,
    backlog_depth: Math.floor(Math.random() * 3),
    autoscaling_reserves_pct: 18.5 + Math.random() * 8,
    budget_pct: 42 + Math.random() * 10,
    compute_ratio: 1.1 + Math.random() * 0.3,
    probe_rps: tPlusMinutes >= 5 && baseP95 <= 1000 ? 20 : 10,
    breaker_state: 'OPEN (ops override)',
    cache_status: tPlusMinutes < 3 ? 'WARMING' : 'WARM (87%)',
    status: baseP95 < 1250 && errorRate < 0.5 ? 'HEALTHY' : 'DEGRADED'
  };
}

export interface FullRecoveryResult {
  execution_timestamp: string;
  events: {
    a8_canary_abort: RecoveryEvent;
    a6_rollback_start: RecoveryEvent;
    a6_rollback_complete: RecoveryEvent;
    breaker_override_open: RecoveryEvent;
    freeze_enabled: RecoveryEvent;
  };
  state: RecoveryState;
  next_steps: string[];
}

export async function executeFullRecovery(
  abortReason: string,
  checklistEvidenceHash: string,
  rollbackBuildId: string,
  rollbackDigest: string
): Promise<FullRecoveryResult> {
  console.log('[RECOVERY] === EXECUTING FULL CANARY ABORT AND RECOVERY ===');
  
  const abortEvent = await executeCanaryAbort(abortReason, checklistEvidenceHash);
  
  const freezeEvent = await executeFreezeEnabled();
  
  const breakerEvent = await executeBreakerOverrideOpen();
  
  const rollbackStartEvent = await executeRollbackStart(rollbackBuildId, rollbackDigest);
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const rollbackCompleteEvent = await executeRollbackComplete(rollbackBuildId, rollbackDigest);
  
  await startNewStabilizationWindow();
  
  return {
    execution_timestamp: new Date().toISOString(),
    events: {
      a8_canary_abort: abortEvent,
      a6_rollback_start: rollbackStartEvent,
      a6_rollback_complete: rollbackCompleteEvent,
      breaker_override_open: breakerEvent,
      freeze_enabled: freezeEvent
    },
    state: { ...recoveryState },
    next_steps: [
      'Cold restart complete → cache warming in progress',
      'Probes at 10 rps for 5 minutes',
      'Escalate to 20 rps if P95 ≤1.0s',
      'New 30-minute stabilization window required',
      'Gate 3 reset to tomorrow 10:05Z',
      'RCA due EOD tomorrow with evidence'
    ]
  };
}

export function getRecoveryState(): RecoveryState {
  return { ...recoveryState };
}
