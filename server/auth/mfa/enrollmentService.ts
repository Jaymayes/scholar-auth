import { storage } from '../../storage';
import type { User, InsertMfaDecision } from '@shared/schema';
import type { Request } from 'express';

export interface EnrollmentStatus {
  hasTotp: boolean;
  hasWebAuthn: boolean;
  hasAnyFactor: boolean;
  factors: Array<{
    id: string;
    type: 'totp' | 'webauthn';
    label: string;
    enrolledAt: Date | null;
    lastUsedAt: Date | null;
  }>;
}

export interface MfaStatusResponse {
  success: boolean;
  status: {
    enrolled: boolean;
    hasTotp: boolean;
    hasWebAuthn: boolean;
    shouldPrompt: boolean;
    enforcementRequired: boolean;
    factors: Array<{
      id: string;
      type: 'totp' | 'webauthn';
      label: string;
      enrolledAt: Date | null;
      lastUsedAt: Date | null;
    }>;
  };
}

export interface EnrollmentDecisionData {
  userId: string;
  decisionType: 'skip' | 'enroll';
  factorType?: 'totp' | 'webauthn';
  reason?: string;
  role?: 'student' | 'admin' | 'reviewer';
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export class EnrollmentService {
  async getEnrollmentStatus(userId: string): Promise<EnrollmentStatus> {
    const factors = await storage.getMfaFactorsByUser(userId);

    const totpFactors = factors.filter((f) => f.type === 'totp');
    const webauthnFactors = factors.filter((f) => f.type === 'webauthn');

    return {
      hasTotp: totpFactors.length > 0,
      hasWebAuthn: webauthnFactors.length > 0,
      hasAnyFactor: factors.length > 0,
      factors: factors.map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label,
        enrolledAt: f.enrolledAt,
        lastUsedAt: f.lastUsedAt,
      })),
    };
  }

  async logDecision(data: EnrollmentDecisionData): Promise<void> {
    const decisionData: InsertMfaDecision = {
      userId: data.userId,
      decisionType: data.decisionType,
      factorType: data.factorType,
      reason: data.reason,
      role: data.role,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      correlationId: data.correlationId,
    };

    await storage.createMfaDecisionAsync(decisionData);

    const action =
      data.decisionType === 'skip'
        ? 'MFA_SKIP'
        : `MFA_ENROLL_COMPLETE_${data.factorType?.toUpperCase()}`;

    await storage.createAuditLogAsync({
      userId: data.userId,
      action,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      details: {
        resourceType: 'mfa_enrollment',
        resourceId: data.userId,
        decisionType: data.decisionType,
        factorType: data.factorType,
        reason: data.reason,
        correlationId: data.correlationId,
      },
    });
  }

  async logEnrollmentStart(user: User, req: Request): Promise<void> {
    await storage.createAuditLogAsync({
      userId: user.id,
      action: 'MFA_ENROLL_START',
      ipAddress: this.getIpAddress(req),
      userAgent: req.get('user-agent'),
      details: {
        resourceType: 'mfa_enrollment',
        resourceId: user.id,
        role: user.role,
        correlationId: this.getCorrelationId(req),
      },
    });
  }

  async logEnrollmentFailure(
    userId: string,
    factorType: 'totp' | 'webauthn',
    error: string,
    req: Request
  ): Promise<void> {
    await storage.createAuditLogAsync({
      userId,
      action: 'MFA_FAIL',
      ipAddress: this.getIpAddress(req),
      userAgent: req.get('user-agent'),
      details: {
        resourceType: 'mfa_enrollment',
        resourceId: userId,
        factorType,
        error,
        correlationId: this.getCorrelationId(req),
      },
    });
  }

  shouldShowEnrollmentPrompt(user: User, status: EnrollmentStatus): boolean {
    if (status.hasAnyFactor) {
      return false;
    }

    return true;
  }

  isEnforcementRequired(user: User, currentDate: Date = new Date()): boolean {
    // 🚨 CEO GATE 0 DIRECTIVE (Nov 15, 2025): Immediate MFA enforcement for admin/provider_admin
    // Changed from date-based to role-based enforcement per CEO escalation order
    // Enforcement policy:
    // - admin: REQUIRED (immediate enforcement)
    // - provider_admin: REQUIRED (immediate enforcement)
    // - reviewer: VOLUNTARY (delayed enforcement)
    // - student: VOLUNTARY (delayed enforcement)
    
    const roleEnforcementPolicy: Record<string, boolean> = {
      'admin': true,           // ✅ ENFORCED NOW per CEO order
      'provider_admin': true,  // ✅ ENFORCED NOW per CEO order
      'reviewer': false,       // ⏳ Voluntary (Nov 25)
      'student': false,        // ⏳ Voluntary (Nov 25)
    };

    // Check if user role requires MFA enforcement
    // Handle null/undefined role gracefully
    const userRole = user.role;
    if (!userRole) {
      return false; // No enforcement for users without defined role
    }
    
    return roleEnforcementPolicy[userRole] ?? false;
  }

  getIpAddress(req: Request): string | undefined {
    const forwarded = req.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip;
  }

  getCorrelationId(req: Request): string | undefined {
    return req.get('x-correlation-id') || req.get('x-request-id');
  }

  extractRequestMetadata(req: Request) {
    return {
      ipAddress: this.getIpAddress(req),
      userAgent: req.get('user-agent'),
      correlationId: this.getCorrelationId(req),
    };
  }
}

export const enrollmentService = new EnrollmentService();
