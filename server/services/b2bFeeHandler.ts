/**
 * B2B Fee Handler Service
 * CEO Executive Order SAA-EO-2026-01-19-01
 * Created: 2026-01-19
 * 
 * Wires B2B fee capture config to actual event handling
 */

import {
  b2bFeeConfig,
  b2bLedgerEvents,
  calculatePlatformFee,
  createFeeLedgerEntry,
  validateLedgerEvent,
  type B2BLedgerEvent,
  type FeeLedgerEntry,
} from '../config/b2bFeeCapture';
import { isFeatureEnabled } from '../config/featureFlags';

const A8_TELEMETRY_URL = process.env.A8_TELEMETRY_URL || 'https://auto-com-center-jamarrlmayes.replit.app/api/events';

export interface DisbursementEvent {
  event_type: string;
  provider_id: string;
  student_id: string;
  scholarship_id: string;
  disbursement_id: string;
  disbursed_amount: number;
  evidence_uri: string;
  timestamp: string;
}

export interface FeeHandlerResult {
  success: boolean;
  fee_entry?: FeeLedgerEntry;
  event_id?: string;
  error?: string;
}

export async function handleB2BEvent(event: DisbursementEvent): Promise<FeeHandlerResult> {
  if (!isFeatureEnabled('B2B_FEE_CAPTURE')) {
    return { success: false, error: 'B2B_FEE_CAPTURE feature flag is disabled' };
  }

  if (!validateLedgerEvent(event.event_type)) {
    return { success: false, error: `Invalid ledger event type: ${event.event_type}` };
  }

  if (event.event_type !== b2bFeeConfig.feeCaptureTrigger) {
    return { success: true };
  }

  const feeEntry = createFeeLedgerEntry({
    provider_id: event.provider_id,
    student_id: event.student_id,
    scholarship_id: event.scholarship_id,
    disbursement_id: event.disbursement_id,
    disbursed_amount: event.disbursed_amount,
    evidence_uri: event.evidence_uri,
  });

  const telemetryResult = await postFeeEventToA8(event, feeEntry);

  return {
    success: true,
    fee_entry: feeEntry,
    event_id: telemetryResult.event_id,
  };
}

async function postFeeEventToA8(
  event: DisbursementEvent,
  feeEntry: FeeLedgerEntry
): Promise<{ event_id: string; persisted: boolean }> {
  try {
    const response = await fetch(A8_TELEMETRY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': `b2b_fee_${Date.now()}`,
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        kind: 'b2b_fee_capture',
        source: 'b2b_fee_handler',
        run_id: 'ZT3G-056',
        event_type: event.event_type,
        provider_id: event.provider_id,
        student_id: event.student_id,
        scholarship_id: event.scholarship_id,
        disbursement_id: event.disbursement_id,
        disbursed_amount: event.disbursed_amount,
        platform_fee: feeEntry.platform_fee,
        total_fee: feeEntry.total_fee,
        evidence_uri: feeEntry.evidence_uri,
        checksum: feeEntry.checksum,
        fee_entry_id: feeEntry.id,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('[B2B_FEE] A8 telemetry failed:', response.status);
      return { event_id: '', persisted: false };
    }

    const result = await response.json();
    return {
      event_id: result.event_id,
      persisted: result.persisted,
    };
  } catch (error) {
    console.error('[B2B_FEE] Telemetry error:', error);
    return { event_id: '', persisted: false };
  }
}

export function validateDisbursementEvent(data: unknown): data is DisbursementEvent {
  if (typeof data !== 'object' || data === null) return false;
  
  const event = data as Record<string, unknown>;
  
  return (
    typeof event.event_type === 'string' &&
    typeof event.provider_id === 'string' &&
    typeof event.student_id === 'string' &&
    typeof event.scholarship_id === 'string' &&
    typeof event.disbursement_id === 'string' &&
    typeof event.disbursed_amount === 'number' &&
    typeof event.evidence_uri === 'string'
  );
}

export default handleB2BEvent;
