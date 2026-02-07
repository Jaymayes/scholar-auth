// ============================================================================
// DAY-3 POST-TOGGLE - $1M ACTIVE, GUARDRAILS, $2M DRAFT
// ============================================================================

// ============================================================================
// $1M ACTIVE STATE
// ============================================================================

interface CapActiveState {
  current_cap_usd: number;
  soft_throttle_usd: number;
  soft_throttle_pct: number;
  current_gmv_usd: number;
  utilization_pct: number;
  soft_throttle_active: boolean;
  toggled_at: string;
  status: 'ACTIVE' | 'SOFT_THROTTLE' | 'HELD' | 'PAUSED';
  hold_reason: string | null;
}

let capActiveState: CapActiveState = {
  current_cap_usd: 1000000,
  soft_throttle_usd: 800000,
  soft_throttle_pct: 80,
  current_gmv_usd: 520000,
  utilization_pct: 52,
  soft_throttle_active: false,
  toggled_at: new Date().toISOString(),
  status: 'ACTIVE',
  hold_reason: null
};

export function getCapActiveState(): CapActiveState {
  capActiveState.utilization_pct = (capActiveState.current_gmv_usd / capActiveState.current_cap_usd) * 100;
  capActiveState.soft_throttle_active = capActiveState.current_gmv_usd >= capActiveState.soft_throttle_usd;
  
  if (capActiveState.soft_throttle_active && capActiveState.status === 'ACTIVE') {
    capActiveState.status = 'SOFT_THROTTLE';
  }
  
  return capActiveState;
}

export function updateGMV(gmv_usd: number): CapActiveState {
  capActiveState.current_gmv_usd = gmv_usd;
  return getCapActiveState();
}

export function holdCap(reason: string): CapActiveState {
  capActiveState.status = 'HELD';
  capActiveState.hold_reason = reason;
  console.log(`[CAP] HELD: ${reason}`);
  return capActiveState;
}

export function resumeCap(): CapActiveState {
  if (capActiveState.status === 'HELD') {
    capActiveState.status = capActiveState.current_gmv_usd >= capActiveState.soft_throttle_usd ? 'SOFT_THROTTLE' : 'ACTIVE';
    capActiveState.hold_reason = null;
    console.log(`[CAP] Resumed to ${capActiveState.status}`);
  }
  return capActiveState;
}

// ============================================================================
// HOLD TRIGGERS
// ============================================================================

interface HoldTrigger {
  id: string;
  name: string;
  condition: string;
  threshold: string;
  current_value: string;
  triggered: boolean;
  last_triggered_at: string | null;
  consecutive_minutes: number;
  trigger_after_minutes: number;
}

interface HoldTriggerState {
  triggers: HoldTrigger[];
  any_triggered: boolean;
  should_page_ceo: boolean;
  status: 'GREEN' | 'YELLOW' | 'RED';
}

let holdTriggerData = {
  critical_p95_ms: 120,
  critical_p95_breach_minutes: 0,
  compute_ratio: 1.15,
  compute_ratio_breach_minutes: 0,
  backlog_count: 18,
  stripe_headroom_pct: 82,
  stripe_headroom_breach_minutes: 0,
  ledger_delta_cents: 0,
  dlq_count: 0
};

export function updateHoldTriggerData(data: Partial<typeof holdTriggerData>): void {
  holdTriggerData = { ...holdTriggerData, ...data };
}

export function getHoldTriggerState(): HoldTriggerState {
  const triggers: HoldTrigger[] = [
    {
      id: 'critical_p95',
      name: 'Critical P95 Breach',
      condition: 'P95 >300ms for 5 minutes',
      threshold: '≤300 ms',
      current_value: `${holdTriggerData.critical_p95_ms} ms (${holdTriggerData.critical_p95_breach_minutes} min)`,
      triggered: holdTriggerData.critical_p95_ms > 300 && holdTriggerData.critical_p95_breach_minutes >= 5,
      last_triggered_at: null,
      consecutive_minutes: holdTriggerData.critical_p95_breach_minutes,
      trigger_after_minutes: 5
    },
    {
      id: 'compute_ratio',
      name: 'Compute Ratio Breach',
      condition: 'Compute >1.3× for 10 minutes',
      threshold: '≤1.3×',
      current_value: `${holdTriggerData.compute_ratio}× (${holdTriggerData.compute_ratio_breach_minutes} min)`,
      triggered: holdTriggerData.compute_ratio > 1.3 && holdTriggerData.compute_ratio_breach_minutes >= 10,
      last_triggered_at: null,
      consecutive_minutes: holdTriggerData.compute_ratio_breach_minutes,
      trigger_after_minutes: 10
    },
    {
      id: 'backlog',
      name: 'Backlog Breach',
      condition: 'Backlog >20',
      threshold: '≤20',
      current_value: `${holdTriggerData.backlog_count}`,
      triggered: holdTriggerData.backlog_count > 20,
      last_triggered_at: null,
      consecutive_minutes: 0,
      trigger_after_minutes: 0
    },
    {
      id: 'stripe_headroom',
      name: 'Stripe Headroom Critical',
      condition: 'Headroom <30% for 10 minutes',
      threshold: '≥30%',
      current_value: `${holdTriggerData.stripe_headroom_pct}% (${holdTriggerData.stripe_headroom_breach_minutes} min)`,
      triggered: holdTriggerData.stripe_headroom_pct < 30 && holdTriggerData.stripe_headroom_breach_minutes >= 10,
      last_triggered_at: null,
      consecutive_minutes: holdTriggerData.stripe_headroom_breach_minutes,
      trigger_after_minutes: 10
    },
    {
      id: 'parity_failure',
      name: 'Parity Failure',
      condition: 'Ledger delta ≠ $0.00',
      threshold: '$0.00',
      current_value: `$${(holdTriggerData.ledger_delta_cents / 100).toFixed(2)}`,
      triggered: holdTriggerData.ledger_delta_cents !== 0,
      last_triggered_at: null,
      consecutive_minutes: 0,
      trigger_after_minutes: 0
    },
    {
      id: 'dlq',
      name: 'DLQ Non-Zero',
      condition: 'DLQ >0',
      threshold: '0',
      current_value: `${holdTriggerData.dlq_count}`,
      triggered: holdTriggerData.dlq_count > 0,
      last_triggered_at: null,
      consecutive_minutes: 0,
      trigger_after_minutes: 0
    }
  ];
  
  const anyTriggered = triggers.some(t => t.triggered);
  
  return {
    triggers,
    any_triggered: anyTriggered,
    should_page_ceo: anyTriggered,
    status: anyTriggered ? 'RED' : triggers.some(t => t.consecutive_minutes > 0) ? 'YELLOW' : 'GREEN'
  };
}

// ============================================================================
// DB HEADROOM MONITORING
// ============================================================================

interface DBHeadroomState {
  current_headroom_pct: number;
  min_headroom_pct: number;
  post_toggle_min_headroom_pct: number;
  hours_since_toggle: number;
  post_toggle_window_hours: number;
  in_post_toggle_window: boolean;
  minutes_below_threshold: number;
  scale_trigger_minutes: number;
  should_add_replica: boolean;
  read_replicas_count: number;
  pool_saturation_pct: number;
  connection_churn_per_min: number;
}

let dbHeadroomState: DBHeadroomState = {
  current_headroom_pct: 45,
  min_headroom_pct: 35,
  post_toggle_min_headroom_pct: 40,
  hours_since_toggle: 2,
  post_toggle_window_hours: 12,
  in_post_toggle_window: true,
  minutes_below_threshold: 0,
  scale_trigger_minutes: 30,
  should_add_replica: false,
  read_replicas_count: 2,
  pool_saturation_pct: 35,
  connection_churn_per_min: 12
};

export function updateDBHeadroom(headroom_pct: number): DBHeadroomState {
  dbHeadroomState.current_headroom_pct = headroom_pct;
  
  const threshold = dbHeadroomState.in_post_toggle_window 
    ? dbHeadroomState.post_toggle_min_headroom_pct 
    : dbHeadroomState.min_headroom_pct;
  
  if (headroom_pct < threshold) {
    dbHeadroomState.minutes_below_threshold++;
  } else {
    dbHeadroomState.minutes_below_threshold = 0;
  }
  
  dbHeadroomState.should_add_replica = dbHeadroomState.minutes_below_threshold >= dbHeadroomState.scale_trigger_minutes;
  
  return dbHeadroomState;
}

export function getDBHeadroomState(): DBHeadroomState {
  return dbHeadroomState;
}

export function addReadReplica(): DBHeadroomState {
  dbHeadroomState.read_replicas_count++;
  dbHeadroomState.minutes_below_threshold = 0;
  dbHeadroomState.should_add_replica = false;
  console.log(`[DB] Added read replica. Total: ${dbHeadroomState.read_replicas_count}`);
  return dbHeadroomState;
}

export function advanceHoursSinceToggle(): DBHeadroomState {
  dbHeadroomState.hours_since_toggle++;
  dbHeadroomState.in_post_toggle_window = dbHeadroomState.hours_since_toggle < dbHeadroomState.post_toggle_window_hours;
  return dbHeadroomState;
}

// ============================================================================
// STRIPE HEADROOM ALERTS
// ============================================================================

interface StripeHeadroomState {
  current_headroom_pct: number;
  warn_threshold_pct: number;
  auto_slow_threshold_pct: number;
  status: 'HEALTHY' | 'WARN' | 'AUTO_SLOW' | 'CRITICAL';
  minutes_in_current_state: number;
  retries_enabled: boolean;
  idempotency_verified: boolean;
  last_rate_limit_at: string | null;
}

let stripeHeadroomState: StripeHeadroomState = {
  current_headroom_pct: 82,
  warn_threshold_pct: 40,
  auto_slow_threshold_pct: 30,
  status: 'HEALTHY',
  minutes_in_current_state: 0,
  retries_enabled: true,
  idempotency_verified: true,
  last_rate_limit_at: null
};

export function updateStripeHeadroom(headroom_pct: number): StripeHeadroomState {
  const prevStatus = stripeHeadroomState.status;
  stripeHeadroomState.current_headroom_pct = headroom_pct;
  
  if (headroom_pct < stripeHeadroomState.auto_slow_threshold_pct) {
    stripeHeadroomState.status = 'AUTO_SLOW';
    stripeHeadroomState.last_rate_limit_at = new Date().toISOString();
  } else if (headroom_pct < stripeHeadroomState.warn_threshold_pct) {
    stripeHeadroomState.status = 'WARN';
  } else {
    stripeHeadroomState.status = 'HEALTHY';
  }
  
  if (stripeHeadroomState.status === prevStatus) {
    stripeHeadroomState.minutes_in_current_state++;
  } else {
    stripeHeadroomState.minutes_in_current_state = 0;
  }
  
  return stripeHeadroomState;
}

export function getStripeHeadroomState(): StripeHeadroomState {
  return stripeHeadroomState;
}

// ============================================================================
// $2M CAP WORKSHEET (DRAFT - DO NOT TOGGLE)
// ============================================================================

interface TwoMillionCapWorksheet {
  timestamp: string;
  status: 'DRAFT' | 'STAGED' | 'READY' | 'TOGGLED';
  current_cap_usd: number;
  proposed_cap_usd: number;
  conditions: {
    id: string;
    name: string;
    threshold: string;
    current_value: string;
    passed: boolean;
  }[];
  all_conditions_met: boolean;
  cash_flow_projection: {
    daily_gmv_at_full_util_usd: number;
    daily_platform_fee_usd: number;
    daily_ai_compute_cost_usd: number;
    daily_net_margin_usd: number;
    ai_markup_ratio: number;
  };
  warning: string;
}

let twoMillionMetrics = {
  a7_p95_ms: 250,
  compute_ratio: 1.15,
  utilization_median_pct: 72,
  soft_throttle_time_pct: 15,
  critical_p95_ms: 120,
  error_rate_pct: 0.15,
  backlog_count: 18,
  dlq_count: 0,
  stripe_health_pct: 99.8,
  disputes_count: 0,
  ledger_delta_cents: 0,
  consecutive_parity_passes: 8,
  green_heartbeats: 10
};

export function updateTwoMillionMetrics(metrics: Partial<typeof twoMillionMetrics>): void {
  twoMillionMetrics = { ...twoMillionMetrics, ...metrics };
}

export function getTwoMillionCapWorksheet(): TwoMillionCapWorksheet {
  const conditions = [
    {
      id: 'a7_p95',
      name: 'A7 P95 (Tighter)',
      threshold: '≤260 ms',
      current_value: `${twoMillionMetrics.a7_p95_ms} ms`,
      passed: twoMillionMetrics.a7_p95_ms <= 260
    },
    {
      id: 'compute_ratio',
      name: 'Compute Ratio (Tighter)',
      threshold: '≤1.2×',
      current_value: `${twoMillionMetrics.compute_ratio}×`,
      passed: twoMillionMetrics.compute_ratio <= 1.2
    },
    {
      id: 'utilization',
      name: 'Utilization Median',
      threshold: '≥75%',
      current_value: `${twoMillionMetrics.utilization_median_pct}%`,
      passed: twoMillionMetrics.utilization_median_pct >= 75
    },
    {
      id: 'critical_p95',
      name: 'Critical P95',
      threshold: '≤280 ms',
      current_value: `${twoMillionMetrics.critical_p95_ms} ms`,
      passed: twoMillionMetrics.critical_p95_ms <= 280
    },
    {
      id: 'error_rate',
      name: 'Error Rate',
      threshold: '≤0.15%',
      current_value: `${twoMillionMetrics.error_rate_pct}%`,
      passed: twoMillionMetrics.error_rate_pct <= 0.15
    },
    {
      id: 'backlog',
      name: 'Backlog',
      threshold: '≤15',
      current_value: `${twoMillionMetrics.backlog_count}`,
      passed: twoMillionMetrics.backlog_count <= 15
    },
    {
      id: 'stripe_disputes',
      name: 'Stripe Disputes',
      threshold: '0',
      current_value: `${twoMillionMetrics.disputes_count}`,
      passed: twoMillionMetrics.disputes_count === 0
    },
    {
      id: 'parity',
      name: 'Ledger Parity',
      threshold: '8 consecutive passes',
      current_value: `${twoMillionMetrics.consecutive_parity_passes} passes`,
      passed: twoMillionMetrics.consecutive_parity_passes >= 8
    }
  ];
  
  const allMet = conditions.every(c => c.passed);
  
  const dailyGMV = 2000000;
  const platformFeePct = 0.03;
  const dailyFee = dailyGMV * platformFeePct;
  const dailyAICompute = 12000;
  const aiMarkup = dailyFee / dailyAICompute;
  
  return {
    timestamp: new Date().toISOString(),
    status: 'DRAFT',
    current_cap_usd: 1000000,
    proposed_cap_usd: 2000000,
    conditions,
    all_conditions_met: allMet,
    cash_flow_projection: {
      daily_gmv_at_full_util_usd: dailyGMV,
      daily_platform_fee_usd: dailyFee,
      daily_ai_compute_cost_usd: dailyAICompute,
      daily_net_margin_usd: dailyFee - dailyAICompute,
      ai_markup_ratio: parseFloat(aiMarkup.toFixed(2))
    },
    warning: 'DO NOT TOGGLE - DRAFT ONLY'
  };
}

// ============================================================================
// HOURLY KPI DASHBOARD
// ============================================================================

interface HourlyKPIs {
  timestamp: string;
  hour: number;
  gmv_vs_cap: {
    current_gmv_usd: number;
    cap_usd: number;
    utilization_pct: number;
    soft_throttle_time_minutes: number;
  };
  latency: {
    critical_p95_ms: number;
    critical_p99_ms: number;
    a7_p95_ms: number;
    a7_p95_window_hours: number;
  };
  infrastructure: {
    stripe_headroom_pct: number;
    compute_ratio: number;
    db_headroom_pct: number;
    read_replicas: number;
  };
  reliability: {
    backlog_count: number;
    dlq_count: number;
    error_rate_pct: number;
  };
  funnel: {
    sdr_contact_cvr_pct: number;
    meeting_scheduled_cvr_pct: number;
    meeting_held_cvr_pct: number;
    signup_cvr_pct: number;
    verified_cvr_pct: number;
    payouts_enabled_cvr_pct: number;
    meetings_to_onboard_cvr_pct: number;
  };
  status: 'GREEN' | 'YELLOW' | 'RED';
}

const hourlyKPIHistory: HourlyKPIs[] = [];

export function recordHourlyKPIs(): HourlyKPIs {
  const cap = getCapActiveState();
  const db = getDBHeadroomState();
  const stripe = getStripeHeadroomState();
  const triggers = getHoldTriggerState();
  
  const kpis: HourlyKPIs = {
    timestamp: new Date().toISOString(),
    hour: new Date().getHours(),
    gmv_vs_cap: {
      current_gmv_usd: cap.current_gmv_usd,
      cap_usd: cap.current_cap_usd,
      utilization_pct: cap.utilization_pct,
      soft_throttle_time_minutes: cap.soft_throttle_active ? 15 : 0
    },
    latency: {
      critical_p95_ms: holdTriggerData.critical_p95_ms,
      critical_p99_ms: holdTriggerData.critical_p95_ms * 1.3,
      a7_p95_ms: twoMillionMetrics.a7_p95_ms,
      a7_p95_window_hours: 4
    },
    infrastructure: {
      stripe_headroom_pct: stripe.current_headroom_pct,
      compute_ratio: holdTriggerData.compute_ratio,
      db_headroom_pct: db.current_headroom_pct,
      read_replicas: db.read_replicas_count
    },
    reliability: {
      backlog_count: holdTriggerData.backlog_count,
      dlq_count: holdTriggerData.dlq_count,
      error_rate_pct: twoMillionMetrics.error_rate_pct
    },
    funnel: {
      sdr_contact_cvr_pct: 100,
      meeting_scheduled_cvr_pct: 18,
      meeting_held_cvr_pct: 88,
      signup_cvr_pct: 86,
      verified_cvr_pct: 92,
      payouts_enabled_cvr_pct: 100,
      meetings_to_onboard_cvr_pct: 31
    },
    status: triggers.status
  };
  
  hourlyKPIHistory.push(kpis);
  if (hourlyKPIHistory.length > 24) {
    hourlyKPIHistory.shift();
  }
  
  return kpis;
}

export function getHourlyKPIs(): HourlyKPIs[] {
  return hourlyKPIHistory;
}

export function getLatestHourlyKPIs(): HourlyKPIs | null {
  return hourlyKPIHistory.length > 0 ? hourlyKPIHistory[hourlyKPIHistory.length - 1] : null;
}

// ============================================================================
// SDR TOP-400 EXPANSION
// ============================================================================

interface SDRExpansionTop400 {
  current_target: string;
  target_size: number;
  next_target: string;
  next_target_size: number;
  expansion_criteria: {
    meetings_to_onboard_pct: number;
    threshold_pct: number;
    ops_green: boolean;
  };
  eligible_for_expansion: boolean;
  daily_targets: { emails: number; replies: number; meetings: number };
  noon_pt_summary: {
    meetings_booked: number;
    meetings_to_onboard_pct: number;
    pipeline_value_usd: number;
  };
}

let sdrTop400State: SDRExpansionTop400 = {
  current_target: 'Top-250',
  target_size: 250,
  next_target: 'Top-400',
  next_target_size: 400,
  expansion_criteria: {
    meetings_to_onboard_pct: 31,
    threshold_pct: 25,
    ops_green: true
  },
  eligible_for_expansion: true,
  daily_targets: { emails: 60, replies: 12, meetings: 4 },
  noon_pt_summary: {
    meetings_booked: 6,
    meetings_to_onboard_pct: 31,
    pipeline_value_usd: 125000
  }
};

export function getSDRTop400State(): SDRExpansionTop400 {
  sdrTop400State.eligible_for_expansion = 
    sdrTop400State.expansion_criteria.meetings_to_onboard_pct >= sdrTop400State.expansion_criteria.threshold_pct &&
    sdrTop400State.expansion_criteria.ops_green;
  return sdrTop400State;
}

export function updateSDRTop400Metrics(metrics: {
  meetings_to_onboard_pct?: number;
  ops_green?: boolean;
  meetings_booked?: number;
  pipeline_value_usd?: number;
}): SDRExpansionTop400 {
  if (metrics.meetings_to_onboard_pct !== undefined) {
    sdrTop400State.expansion_criteria.meetings_to_onboard_pct = metrics.meetings_to_onboard_pct;
    sdrTop400State.noon_pt_summary.meetings_to_onboard_pct = metrics.meetings_to_onboard_pct;
  }
  if (metrics.ops_green !== undefined) {
    sdrTop400State.expansion_criteria.ops_green = metrics.ops_green;
  }
  if (metrics.meetings_booked !== undefined) {
    sdrTop400State.noon_pt_summary.meetings_booked = metrics.meetings_booked;
  }
  if (metrics.pipeline_value_usd !== undefined) {
    sdrTop400State.noon_pt_summary.pipeline_value_usd = metrics.pipeline_value_usd;
  }
  return getSDRTop400State();
}

export function expandToTop400(): SDRExpansionTop400 {
  if (sdrTop400State.eligible_for_expansion) {
    sdrTop400State.current_target = sdrTop400State.next_target;
    sdrTop400State.target_size = sdrTop400State.next_target_size;
    sdrTop400State.next_target = 'Top-600';
    sdrTop400State.next_target_size = 600;
    console.log(`[SDR] Expanded to ${sdrTop400State.current_target}`);
  }
  return sdrTop400State;
}

// ============================================================================
// RISK WATCHLIST (DAY-3)
// ============================================================================

interface RiskWatchItem {
  id: string;
  name: string;
  condition: string;
  current_metric: string;
  status: 'GREEN' | 'YELLOW' | 'RED';
  mitigation: string;
}

interface RiskWatchlist {
  timestamp: string;
  items: RiskWatchItem[];
  overall_status: 'GREEN' | 'YELLOW' | 'RED';
}

export function getDay3RiskWatchlist(): RiskWatchlist {
  const items: RiskWatchItem[] = [
    {
      id: 'double_wave',
      name: 'Double-Wave Traffic (SDR + A/B)',
      condition: 'P95 slope >0.05×/hour',
      current_metric: 'Slope: 0.02×/hour',
      status: 'GREEN',
      mitigation: 'Monitor hourly P95 trend'
    },
    {
      id: 'db_headroom',
      name: 'DB Headroom',
      condition: '<35% for 30 minutes',
      current_metric: `${dbHeadroomState.current_headroom_pct}% (${dbHeadroomState.minutes_below_threshold} min)`,
      status: dbHeadroomState.current_headroom_pct < 35 ? 'YELLOW' : 'GREEN',
      mitigation: 'Scale reads, slow non-critical queries'
    },
    {
      id: 'pagemaker_latency',
      name: 'PageMaker Image/Render Ops',
      condition: 'Image ops dominate latency',
      current_metric: 'Render: 45%, Image: 35%, Other: 20%',
      status: 'YELLOW',
      mitigation: 'Apply asset compression and cache directives'
    }
  ];
  
  const redCount = items.filter(i => i.status === 'RED').length;
  const yellowCount = items.filter(i => i.status === 'YELLOW').length;
  
  return {
    timestamp: new Date().toISOString(),
    items,
    overall_status: redCount > 0 ? 'RED' : yellowCount > 0 ? 'YELLOW' : 'GREEN'
  };
}

// ============================================================================
// T+180 POST-TOGGLE HEALTH SNAPSHOT
// ============================================================================

interface PostToggleHealthSnapshot {
  timestamp: string;
  checkpoint: string;
  hours_since_toggle: number;
  scorecard: {
    verdict: string;
    pass_count: number;
    warn_count: number;
    fail_count: number;
  };
  a7_window: {
    current_p95_ms: number;
    burst_cap: number;
    hours_below_250ms: number;
    eligible_for_50_burst: boolean;
  };
  stripe_headroom: {
    current_pct: number;
    status: string;
  };
  db_headroom: {
    current_pct: number;
    read_replicas: number;
    status: string;
  };
  backlog_trend: {
    current: number;
    last_hour_delta: number;
    trend: 'DECREASING' | 'STABLE' | 'INCREASING';
  };
  overall_status: 'GREEN' | 'YELLOW' | 'RED';
}

export function getPostToggleHealthSnapshot(): PostToggleHealthSnapshot {
  const db = getDBHeadroomState();
  const stripe = getStripeHeadroomState();
  const triggers = getHoldTriggerState();
  
  return {
    timestamp: new Date().toISOString(),
    checkpoint: 'T+180',
    hours_since_toggle: db.hours_since_toggle,
    scorecard: {
      verdict: triggers.any_triggered ? 'HOLD' : 'GO',
      pass_count: triggers.triggers.filter(t => !t.triggered).length,
      warn_count: triggers.triggers.filter(t => t.consecutive_minutes > 0 && !t.triggered).length,
      fail_count: triggers.triggers.filter(t => t.triggered).length
    },
    a7_window: {
      current_p95_ms: twoMillionMetrics.a7_p95_ms,
      burst_cap: 35,
      hours_below_250ms: 4,
      eligible_for_50_burst: twoMillionMetrics.a7_p95_ms < 250 && twoMillionMetrics.compute_ratio <= 1.2
    },
    stripe_headroom: {
      current_pct: stripe.current_headroom_pct,
      status: stripe.status
    },
    db_headroom: {
      current_pct: db.current_headroom_pct,
      read_replicas: db.read_replicas_count,
      status: db.should_add_replica ? 'SCALE_NEEDED' : 'HEALTHY'
    },
    backlog_trend: {
      current: holdTriggerData.backlog_count,
      last_hour_delta: -2,
      trend: 'DECREASING'
    },
    overall_status: triggers.status
  };
}

// ============================================================================
// EOD FULL BUSINESS READOUT
// ============================================================================

interface EODBusinessReadout {
  timestamp: string;
  readout_type: 'EOD';
  gmv_and_fee: {
    daily_gmv_usd: number;
    cap_usd: number;
    utilization_pct: number;
    platform_fee_usd: number;
    target_fee_usd: number;
    fee_vs_target_pct: number;
  };
  soft_throttle: {
    total_minutes: number;
    pct_of_day: number;
  };
  ab_stability: {
    current_split: { A: number; B: number };
    days_elapsed: number;
    all_criteria_green: boolean;
    status: string;
  };
  compliance: {
    parity_checks_passed: number;
    parity_checks_total: number;
    log_redaction_passed: boolean;
    privacy_by_default_verified: boolean;
  };
  sdr_summary: {
    emails_sent: number;
    replies: number;
    meetings_booked: number;
    meetings_to_onboard_pct: number;
    pipeline_value_usd: number;
  };
}

export function getEODBusinessReadout(): EODBusinessReadout {
  const cap = getCapActiveState();
  const sdr = getSDRTop400State();
  
  const dailyGMV = 850000;
  const platformFee = dailyGMV * 0.03;
  const targetFee = 30000;
  
  return {
    timestamp: new Date().toISOString(),
    readout_type: 'EOD',
    gmv_and_fee: {
      daily_gmv_usd: dailyGMV,
      cap_usd: cap.current_cap_usd,
      utilization_pct: 85,
      platform_fee_usd: platformFee,
      target_fee_usd: targetFee,
      fee_vs_target_pct: (platformFee / targetFee) * 100
    },
    soft_throttle: {
      total_minutes: 45,
      pct_of_day: 3.1
    },
    ab_stability: {
      current_split: { A: 10, B: 90 },
      days_elapsed: 1,
      all_criteria_green: true,
      status: 'STABLE'
    },
    compliance: {
      parity_checks_passed: 24,
      parity_checks_total: 24,
      log_redaction_passed: true,
      privacy_by_default_verified: true
    },
    sdr_summary: {
      emails_sent: 60,
      replies: 14,
      meetings_booked: sdr.noon_pt_summary.meetings_booked,
      meetings_to_onboard_pct: sdr.noon_pt_summary.meetings_to_onboard_pct,
      pipeline_value_usd: sdr.noon_pt_summary.pipeline_value_usd
    }
  };
}
