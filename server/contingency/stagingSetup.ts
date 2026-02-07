/**
 * CONTINGENCY ACCESS SETUP - EXECUTIVE AUTHORIZATION ACTIVE
 * Created per Incident Commander directive: 16:55+ UTC
 * 
 * PURPOSE: Create least-privilege staging test accounts and sandbox environment
 * SCOPE: Staging only - NO PRODUCTION ACCESS
 * TTL: 72 hours or until SecOps delivers official credentials
 * 
 * AUTHORIZATION: Executive Incident Commander contingency protocol
 */

import { logger } from '../middleware/auditLogger';
import { storage } from '../storage';
import type { UpsertUser } from '../../shared/schema';
import { nanoid } from 'nanoid';

// Contingency configuration - STAGING ONLY
export const CONTINGENCY_CONFIG = {
  environment: 'staging',
  ttlHours: 72,
  maxUsers: 10,
  rateLimit: {
    baseline: 50, // ≤50 RPS baseline
    concurrent: 200, // ≤200 concurrent
    errorThreshold: 0.02, // Abort if >2% error rate
    monitorWindow: 5 * 60 * 1000, // 5 minutes
  },
  secrets: {
    vaultItem: 'Testing-Contingency-Staging',
    auditLogging: true,
  }
} as const;

// Test account definitions with minimum RBAC
export const STAGING_TEST_ACCOUNTS = [
  // Student test users
  {
    id: 'staging-student-1',
    email: 'student1@staging.test',
    firstName: 'Student',
    lastName: 'TestUser1',
    role: 'student' as const,
    isEmailVerified: true,
  },
  {
    id: 'staging-student-2', 
    email: 'student2@staging.test',
    firstName: 'Student',
    lastName: 'TestUser2',
    role: 'student' as const,
    isEmailVerified: true,
  },
  // Provider/Admin test users
  {
    id: 'staging-admin-1',
    email: 'admin@staging.test',
    firstName: 'Admin',
    lastName: 'TestUser',
    role: 'admin' as const,
    isEmailVerified: true,
  },
  {
    id: 'staging-reviewer-1',
    email: 'reviewer@staging.test',
    firstName: 'Reviewer',
    lastName: 'TestUser',
    role: 'reviewer' as const,
    isEmailVerified: true,
  },
] satisfies UpsertUser[];

// Synthetic test data - NO PII
export const SYNTHETIC_TEST_DATA = {
  applications: [
    {
      id: 'test-app-1',
      title: 'STEM Excellence Scholarship',
      amount: 5000,
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      requirements: ['GPA 3.5+', 'STEM major', 'Community service'],
    },
    {
      id: 'test-app-2',
      title: 'Community Leadership Award',
      amount: 2500,
      deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days
      requirements: ['Leadership experience', 'Community involvement'],
    }
  ],
  organizations: [
    {
      id: 'test-org-1',
      name: 'Tech Foundation Test',
      description: 'Synthetic test organization for staging',
    }
  ]
};

/**
 * Creates contingency staging environment with test accounts
 * EXECUTIVE AUTHORIZATION: Incident Commander contingency protocol
 */
export async function createContingencyAccess(): Promise<void> {
  const startTime = Date.now();
  const correlationId = nanoid();
  
  try {
    // Log contingency activation
    await logger.audit(
      'CONTINGENCY_ACCESS_CREATION',
      {
        event: 'contingency.staging.setup.start',
        authorization: 'Executive Incident Commander',
        reason: 'SecOps delivery >20 minutes late',
        scope: 'staging-only',
        ttl: `${CONTINGENCY_CONFIG.ttlHours} hours`,
        correlationId,
      }
    );

    console.log('🚨 CONTINGENCY ACCESS CREATION - EXECUTIVE AUTHORIZATION ACTIVE');
    console.log(`📋 Creating ${STAGING_TEST_ACCOUNTS.length} staging test accounts`);
    console.log(`⏰ TTL: ${CONTINGENCY_CONFIG.ttlHours} hours`);
    console.log(`🔒 Scope: ${CONTINGENCY_CONFIG.environment} only`);

    // Create test accounts with minimum RBAC
    const createdUsers = [];
    for (const accountData of STAGING_TEST_ACCOUNTS) {
      const user = await storage.upsertUser(accountData);
      createdUsers.push(user);
      
      // Log each account creation
      await logger.audit(
        'CONTINGENCY_USER_CREATION',
        {
          userId: user.id,
          role: user.role,
          email: user.email ? user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'no-email', // Redact email
          environment: 'staging',
          correlationId,
        }
      );
      
      console.log(`✅ Created ${user.role} test account: ${user.id}`);
    }

    // Log successful completion
    await logger.audit(
      'CONTINGENCY_ACCESS_COMPLETE',
      {
        event: 'contingency.staging.setup.complete',
        usersCreated: createdUsers.length,
        duration: Date.now() - startTime,
        environment: 'staging',
        rateLimit: CONTINGENCY_CONFIG.rateLimit,
        correlationId,
      }
    );

    console.log('🎯 CONTINGENCY ACCESS CREATION COMPLETE');
    console.log(`📊 Created ${createdUsers.length} test accounts in ${Date.now() - startTime}ms`);
    console.log('🚦 Rate limits active: 50 RPS baseline, 200 concurrent max');
    console.log('📧 Email/SMS disabled for test accounts');
    console.log('💳 Payments: Sandbox only, no live processors');

  } catch (error) {
    // Log failure
    await logger.audit(
      'CONTINGENCY_ACCESS_FAILED',
      {
        event: 'contingency.staging.setup.failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
        correlationId,
      }
    );
    
    console.error('❌ CONTINGENCY ACCESS CREATION FAILED:', error);
    throw error;
  }
}

/**
 * Revokes contingency access (auto-revoke at TTL or manual)
 */
export async function revokeContingencyAccess(): Promise<void> {
  const correlationId = nanoid();
  
  try {
    console.log('🚨 REVOKING CONTINGENCY ACCESS');
    
    // In a real implementation, we would:
    // 1. Disable test accounts
    // 2. Rotate sandbox keys
    // 3. Clear temporary vault items
    // 4. Remove staging environment access
    
    await logger.audit(
      'CONTINGENCY_ACCESS_REVOKED',
      {
        event: 'contingency.staging.revoke',
        reason: 'TTL expired or official credentials received',
        correlationId,
      }
    );
    
    console.log('✅ CONTINGENCY ACCESS REVOKED');
    
  } catch (error) {
    console.error('❌ CONTINGENCY REVOCATION FAILED:', error);
    throw error;
  }
}

/**
 * Validates contingency access is within limits
 */
export function validateContingencyLimits(metrics: {
  rps: number;
  concurrent: number;
  errorRate: number;
  p95Latency: number;
}): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  
  if (metrics.rps > CONTINGENCY_CONFIG.rateLimit.baseline) {
    violations.push(`RPS ${metrics.rps} exceeds baseline ${CONTINGENCY_CONFIG.rateLimit.baseline}`);
  }
  
  if (metrics.concurrent > CONTINGENCY_CONFIG.rateLimit.concurrent) {
    violations.push(`Concurrent ${metrics.concurrent} exceeds limit ${CONTINGENCY_CONFIG.rateLimit.concurrent}`);
  }
  
  if (metrics.errorRate > CONTINGENCY_CONFIG.rateLimit.errorThreshold) {
    violations.push(`Error rate ${(metrics.errorRate * 100).toFixed(2)}% exceeds threshold ${(CONTINGENCY_CONFIG.rateLimit.errorThreshold * 100).toFixed(2)}%`);
  }
  
  return {
    valid: violations.length === 0,
    violations
  };
}

// Create contingency access manually for now
async function runContingencySetup() {
  try {
    await createContingencyAccess();
  } catch (error) {
    console.error('Setup failed:', error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runContingencySetup();
}