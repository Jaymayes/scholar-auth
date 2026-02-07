/**
 * B2B Fee Capture Configuration
 * CEO Executive Order SAA-EO-2026-01-19-01
 * Created: 2026-01-19
 */

export interface B2BFeeConfig {
  platformFeePercent: number;
  aiMarkupMultiplier: number;
  feeCaptureTrigger: string;
  netSettlementSchedule: string;
}

export interface FeeLedgerEntry {
  id: string;
  provider_id: string;
  student_id: string;
  scholarship_id: string;
  disbursement_id: string;
  disbursed_amount: number;
  platform_fee: number;
  ai_markup_fee: number;
  total_fee: number;
  evidence_uri: string;
  checksum: string;
  created_at: string;
  settled_at: string | null;
}

export interface B2BActivationKPIs {
  activationToFirstListingHours: number;
  listingToFirstLeadDays: number;
  feeCaptureRate: number;
  disputeRate: number;
}

export const b2bFeeConfig: B2BFeeConfig = {
  platformFeePercent: 3,
  aiMarkupMultiplier: 4,
  feeCaptureTrigger: 'AwardDisbursed',
  netSettlementSchedule: 'monthly',
};

export const b2bActivationKPIs: B2BActivationKPIs = {
  activationToFirstListingHours: 72,
  listingToFirstLeadDays: 7,
  feeCaptureRate: 0.98,
  disputeRate: 0.005,
};

export const b2bLedgerEvents = [
  'ListingCreated',
  'LeadAccepted',
  'ApplicationSubmitted',
  'AwardApproved',
  'AwardDisbursed',
] as const;

export type B2BLedgerEvent = typeof b2bLedgerEvents[number];

export function calculatePlatformFee(disbursedAmount: number): number {
  return Math.round(disbursedAmount * (b2bFeeConfig.platformFeePercent / 100) * 100) / 100;
}

export function calculateAIMarkupFee(baseCost: number): number {
  return baseCost * b2bFeeConfig.aiMarkupMultiplier;
}

export function createFeeLedgerEntry(params: {
  provider_id: string;
  student_id: string;
  scholarship_id: string;
  disbursement_id: string;
  disbursed_amount: number;
  evidence_uri: string;
}): FeeLedgerEntry {
  const platformFee = calculatePlatformFee(params.disbursed_amount);
  const now = new Date().toISOString();
  
  const checksum = generateChecksum({
    provider_id: params.provider_id,
    student_id: params.student_id,
    scholarship_id: params.scholarship_id,
    disbursement_id: params.disbursement_id,
    disbursed_amount: params.disbursed_amount,
    platform_fee: platformFee,
    timestamp: now,
  });

  return {
    id: generateId(),
    provider_id: params.provider_id,
    student_id: params.student_id,
    scholarship_id: params.scholarship_id,
    disbursement_id: params.disbursement_id,
    disbursed_amount: params.disbursed_amount,
    platform_fee: platformFee,
    ai_markup_fee: 0,
    total_fee: platformFee,
    evidence_uri: params.evidence_uri,
    checksum,
    created_at: now,
    settled_at: null,
  };
}

function generateId(): string {
  return `fee_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function generateChecksum(data: Record<string, unknown>): string {
  const crypto = require('crypto');
  const str = JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

export function validateLedgerEvent(event: string): event is B2BLedgerEvent {
  return b2bLedgerEvents.includes(event as B2BLedgerEvent);
}

export default b2bFeeConfig;
