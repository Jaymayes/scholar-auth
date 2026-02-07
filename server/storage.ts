import {
  users,
  passwordResetTokens,
  emailVerificationTokens,
  auditLogs,
  oidcClients,
  events,
  parents,
  parentChildLinks,
  consents,
  consentEvents,
  dataRequests,
  // Scholarship Data Spine Tables
  scholarships,
  studentProfiles,
  scholarshipMatches,
  essayAssistance,
  ingestionJobs,
  // MFA Tables
  mfaFactors,
  mfaChallenges,
  mfaDecisions,
  // OAuth 2.1 Tables
  oauthCodes,
  type User,
  type UpsertUser,
  type InsertPasswordReset,
  type InsertEmailVerification,
  type InsertAuditLog,
  type InsertOidcClient,
  type InsertEvent,
  type PasswordResetToken,
  type EmailVerificationToken,
  type AuditLog,
  type OidcClient,
  type Event,
  type Parent,
  type ParentChildLink,
  type Consent,
  type ConsentEvent,
  type DataRequest,
  type InsertParent,
  type InsertParentChildLink,
  type InsertConsent,
  type InsertConsentEvent,
  type InsertDataRequest,
  // Scholarship Data Spine Types
  type Scholarship,
  type StudentProfile,
  type ScholarshipMatch,
  type EssayAssistance,
  type IngestionJob,
  type InsertScholarship,
  type InsertStudentProfile,
  // MFA Types
  type MfaFactor,
  type MfaChallenge,
  type MfaDecision,
  type InsertMfaFactor,
  type InsertMfaChallenge,
  type InsertMfaDecision,
  // OAuth 2.1 Types
  type OauthCode,
  type InsertOauthCode,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gt, gte, sql, desc, asc } from "drizzle-orm";
import { createHash } from "crypto";

// PERFORMANCE: In-memory user cache with 60s TTL to avoid repeated DB lookups
interface CacheEntry {
  user: User | undefined;
  timestamp: number;
}

class UserCache {
  private cache = new Map<string, CacheEntry>();
  private ttl = 60 * 1000; // 60 seconds

  get(id: string): User | undefined | null {
    const entry = this.cache.get(id);
    if (!entry) return null; // Not in cache
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(id); // Expired
      return null;
    }
    
    return entry.user;
  }

  set(id: string, user: User | undefined): void {
    this.cache.set(id, { user, timestamp: Date.now() });
  }

  invalidate(id: string): void {
    this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Interface for storage operations
export interface IStorage {
  // User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(userId: string, updates: Partial<User>): Promise<User>;
  updateUserEmailVerification(userId: string, isVerified: boolean): Promise<void>;
  
  // Password reset operations
  createPasswordResetToken(data: InsertPasswordReset): Promise<PasswordResetToken>;
  createPasswordResetTokenAsync(data: InsertPasswordReset): Promise<void>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  deletePasswordResetToken(token: string): Promise<void>;
  
  // Email verification operations
  createEmailVerificationToken(data: InsertEmailVerification): Promise<EmailVerificationToken>;
  getEmailVerificationToken(userId: string, code: string): Promise<EmailVerificationToken | undefined>;
  deleteEmailVerificationToken(userId: string): Promise<void>;
  
  // Audit logging
  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;
  createAuditLogAsync(data: InsertAuditLog): Promise<void>;
  
  // OIDC Client operations
  createOidcClient(data: InsertOidcClient): Promise<OidcClient>;
  getOidcClient(clientId: string): Promise<OidcClient | undefined>;
  getAllOidcClients(): Promise<OidcClient[]>;
  updateOidcClient(clientId: string, data: Partial<InsertOidcClient>): Promise<OidcClient>;
  
  // SCHOLARSHIP DATA SPINE OPERATIONS - MVP v0.9
  
  // Scholarship operations
  createScholarship(data: InsertScholarship): Promise<Scholarship>;
  getScholarship(id: string): Promise<Scholarship | undefined>;
  getScholarships(filters?: {
    status?: string;
    sourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<Scholarship[]>;
  updateScholarship(id: string, data: Partial<InsertScholarship>): Promise<void>;
  deleteScholarship(id: string): Promise<void>;
  
  // Student profile operations
  createStudentProfile(data: InsertStudentProfile): Promise<StudentProfile>;
  getStudentProfile(userId: string): Promise<StudentProfile | undefined>;
  updateStudentProfile(userId: string, data: Partial<InsertStudentProfile>): Promise<void>;
  
  // Scholarship matching operations
  generateMatches(studentProfileId: string): Promise<ScholarshipMatch[]>;
  getMatches(studentProfileId: string, filters?: {
    fitScoreMin?: number;
    limit?: number;
  }): Promise<ScholarshipMatch[]>;
  updateMatchStatus(matchId: string, status: string): Promise<void>;
  createScholarshipMatch(data: {
    studentProfileId: string;
    scholarshipId: string;
    fitScore: string;
    eligibilityScore: string;
    competitionLevel: string;
    matchReasons: string[];
    eligibilityGaps: string[];
    applicationStatus: string;
    timeToCompleteEstimate: string;
  }): Promise<ScholarshipMatch>;
  
  // Essay assistance operations
  createEssayAssistance(data: {
    studentProfileId: string;
    scholarshipId?: string;
    essayPrompt: string;
    wordLimit?: string;
    essayType?: string;
    assistanceType: string;
    outlineProvided?: string;
    suggestionsGiven?: any[];
  }): Promise<EssayAssistance>;
  getEssayAssistance(studentProfileId: string): Promise<EssayAssistance[]>;
  
  // Data ingestion operations
  createIngestionJob(data: {
    jobType: string;
    sourceType: string;
    sourceName: string;
  }): Promise<IngestionJob>;
  getIngestionJobs(filters?: {
    status?: string;
    sourceType?: string;
    limit?: number;
  }): Promise<IngestionJob[]>;
  updateIngestionJob(id: string, data: Partial<{
    status: string;
    recordsProcessed: string;
    recordsCreated: string;
    recordsUpdated: string;
    recordsSkipped: string;
    errorMessage?: string;
    errorCount: string;
    startedAt?: Date;
    completedAt?: Date;
  }>): Promise<void>;
  
  // Event tracking operations
  createEvent(data: InsertEvent): Promise<Event>;
  createEventAsync(data: InsertEvent): Promise<void>;
  getEventsByApp(appId: string, limit?: number): Promise<Event[]>;
  getEventsByUser(userId: string, limit?: number): Promise<Event[]>;
  getRecentEvents(limit?: number): Promise<Event[]>;
  getAppMetrics(appId: string): Promise<{ dau: number; wau: number; newUsers24h: number; lastLogin: Date | null }>;

  // COPPA Parent Management
  createParent(data: InsertParent): Promise<Parent>;
  getParent(id: string): Promise<Parent | undefined>;
  getParentByEmail(email: string): Promise<Parent | undefined>;
  getParentByVerificationToken(token: string): Promise<Parent | undefined>;
  updateParentVerification(id: string, status: string, method: string, evidence: string): Promise<Parent>;
  
  // Parent-Child Links
  createParentChildLink(data: InsertParentChildLink): Promise<ParentChildLink>;
  getParentChildLinks(parentId: string): Promise<ParentChildLink[]>;
  getChildParents(childId: string): Promise<ParentChildLink[]>;
  
  // Consent Management with WORM Storage
  createConsent(data: InsertConsent): Promise<Consent>;
  getConsent(id: string): Promise<Consent | undefined>;
  getUserConsents(userId: string): Promise<Consent[]>;
  hasValidParentalConsent(userId: string): Promise<boolean>;
  revokeConsent(consentId: string, reason: string): Promise<void>;
  
  // Immutable Consent Events (WORM)
  createConsentEvent(data: Omit<InsertConsentEvent, 'hashChain' | 'blockNumber' | 'recordHash'>): Promise<ConsentEvent>;
  getConsentEvents(consentId: string): Promise<ConsentEvent[]>;
  verifyConsentEventChain(consentId: string): Promise<boolean>;
  
  // FERPA Data Rights
  createDataRequest(data: InsertDataRequest): Promise<DataRequest>;
  getDataRequest(id: string): Promise<DataRequest | undefined>;
  getUserDataRequests(userId: string): Promise<DataRequest[]>;
  updateDataRequestStatus(id: string, status: string, notes?: string): Promise<DataRequest>;
  
  // Age Verification & COPPA Utilities
  calculateAge(dateOfBirth: Date): number;
  isUserUnder13(userId: string): Promise<boolean>;
  updateUserAgeStatus(userId: string, ageGateStatus: string): Promise<void>;
  
  // MFA Operations (CEO DIRECTIVE: Nov 10, 2025)
  // MFA Factor operations
  createMfaFactor(data: InsertMfaFactor): Promise<MfaFactor>;
  getMfaFactorsByUser(userId: string): Promise<MfaFactor[]>;
  getMfaFactor(id: string): Promise<MfaFactor | undefined>;
  updateMfaFactorLastUsed(id: string): Promise<void>;
  revokeMfaFactor(id: string): Promise<void>;
  
  // MFA Challenge operations
  createMfaChallenge(data: InsertMfaChallenge): Promise<MfaChallenge>;
  getMfaChallenge(id: string): Promise<MfaChallenge | undefined>;
  consumeMfaChallenge(id: string): Promise<void>;
  cleanupExpiredChallenges(): Promise<void>;
  
  // MFA Decision tracking (audit trail)
  createMfaDecision(data: InsertMfaDecision): Promise<MfaDecision>;
  createMfaDecisionAsync(data: InsertMfaDecision): Promise<void>;
  getMfaDecisionsByUser(userId: string, limit?: number): Promise<MfaDecision[]>;
  
  // OAuth 2.1 Authorization Code Operations (CEO DIRECTIVE: Dec 7, 2025)
  createOauthCode(data: InsertOauthCode): Promise<OauthCode>;
  getOauthCode(code: string): Promise<OauthCode | undefined>;
  consumeOauthCode(code: string): Promise<OauthCode | undefined>;
  deleteExpiredOauthCodes(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // PERFORMANCE: Cache instance for user lookups
  private userCache = new UserCache();

  // User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.

  async getUser(id: string): Promise<User | undefined> {
    // PERFORMANCE: Check cache first - saves 40-60ms P95 on hot paths
    const cached = this.userCache.get(id);
    if (cached !== null) return cached;

    // Cache miss - fetch from database
    const [user] = await db.select().from(users).where(eq(users.id, id));
    
    // Cache the result (including undefined for non-existent users)
    this.userCache.set(id, user);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,  // Fix: Use id as conflict target since the error shows primary key violation
        set: {
          // Security: Only update safe fields, exclude id to prevent overwrites
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          // CRITICAL SECURITY FIX: Only update role if explicitly provided to preserve existing admin/reviewer roles during login
          ...(userData.role !== undefined && { role: userData.role }),
          isEmailVerified: userData.isEmailVerified,
          updatedAt: new Date(),
        },
      })
      .returning();
    
    // PERFORMANCE: Invalidate cache after user modification
    this.userCache.invalidate(user.id);
    return user;
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const sanitizedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined && value !== null)
    );
    
    if (Object.keys(sanitizedUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }
    
    const [user] = await db
      .update(users)
      .set({ ...sanitizedUpdates, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    this.userCache.invalidate(userId);
    return user;
  }

  async updateUserEmailVerification(userId: string, isVerified: boolean): Promise<void> {
    await db
      .update(users)
      .set({ isEmailVerified: isVerified, updatedAt: new Date() })
      .where(eq(users.id, userId));
    
    // PERFORMANCE: Invalidate cache after user modification
    this.userCache.invalidate(userId);
  }

  // Password reset operations
  async createPasswordResetToken(data: InsertPasswordReset): Promise<PasswordResetToken> {
    const [token] = await db
      .insert(passwordResetTokens)
      .values(data)
      .returning();
    return token;
  }
  
  // PERFORMANCE: Optimized password reset token creation without RETURNING
  async createPasswordResetTokenAsync(data: InsertPasswordReset): Promise<void> {
    await db
      .insert(passwordResetTokens)
      .values(data);
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.token, token),
        gt(passwordResetTokens.expiresAt, new Date())
      ));
    return resetToken;
  }

  async deletePasswordResetToken(token: string): Promise<void> {
    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
  }

  // Email verification operations
  async createEmailVerificationToken(data: InsertEmailVerification): Promise<EmailVerificationToken> {
    const [token] = await db
      .insert(emailVerificationTokens)
      .values(data)
      .returning();
    return token;
  }

  async getEmailVerificationToken(userId: string, code: string): Promise<EmailVerificationToken | undefined> {
    const [token] = await db
      .select()
      .from(emailVerificationTokens)
      .where(and(
        eq(emailVerificationTokens.userId, userId),
        eq(emailVerificationTokens.code, code),
        gt(emailVerificationTokens.expiresAt, new Date())
      ));
    return token;
  }

  async deleteEmailVerificationToken(userId: string): Promise<void> {
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId));
  }

  // Audit logging
  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db
      .insert(auditLogs)
      .values(data)
      .returning();
    return log;
  }
  
  // PERFORMANCE: Optimized audit logging without RETURNING for async operations
  async createAuditLogAsync(data: InsertAuditLog): Promise<void> {
    await db
      .insert(auditLogs)
      .values(data);
  }
  
  // OIDC Client operations
  async createOidcClient(data: InsertOidcClient): Promise<OidcClient> {
    const [client] = await db
      .insert(oidcClients)
      .values(data)
      .returning();
    return client;
  }
  
  async getOidcClient(clientId: string): Promise<OidcClient | undefined> {
    const [client] = await db
      .select()
      .from(oidcClients)
      .where(eq(oidcClients.clientId, clientId));
    return client;
  }
  
  async getAllOidcClients(): Promise<OidcClient[]> {
    return await db.select().from(oidcClients).where(eq(oidcClients.enabled, true));
  }
  
  async updateOidcClient(clientId: string, data: Partial<InsertOidcClient>): Promise<OidcClient> {
    const [client] = await db
      .update(oidcClients)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(oidcClients.clientId, clientId))
      .returning();
    return client;
  }
  
  // Event tracking operations
  async createEvent(data: InsertEvent): Promise<Event> {
    const [event] = await db
      .insert(events)
      .values(data)
      .returning();
    return event;
  }
  
  // PERFORMANCE: Optimized event creation without RETURNING for tracking
  async createEventAsync(data: InsertEvent): Promise<void> {
    await db
      .insert(events)
      .values(data);
  }
  
  async getEventsByApp(appId: string, limit: number = 50): Promise<Event[]> {
    return await db
      .select()
      .from(events)
      .where(eq(events.appId, appId))
      .orderBy(events.timestamp)
      .limit(limit);
  }
  
  async getEventsByUser(userId: string, limit: number = 50): Promise<Event[]> {
    return await db
      .select()
      .from(events)
      .where(eq(events.userId, userId))
      .orderBy(events.timestamp)
      .limit(limit);
  }
  
  async getRecentEvents(limit: number = 100): Promise<Event[]> {
    return await db
      .select()
      .from(events)
      .orderBy(events.timestamp)
      .limit(limit);
  }
  
  async getAppMetrics(appId: string): Promise<{ dau: number; wau: number; newUsers24h: number; lastLogin: Date | null }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // PERFORMANCE: Single optimized query with CTE for all metrics (4 queries → 1 query)
    const metricsResult = await db.execute(sql`
      WITH app_metrics AS (
        SELECT 
          COUNT(DISTINCT CASE WHEN timestamp > ${oneDayAgo} THEN user_id END) as dau,
          COUNT(DISTINCT CASE WHEN timestamp > ${oneWeekAgo} THEN user_id END) as wau,
          MAX(timestamp) as last_login
        FROM events 
        WHERE app_id = ${appId} AND event = 'auth.login'
      ),
      new_users AS (
        SELECT COUNT(*) as new_users_24h
        FROM users 
        WHERE created_at > ${oneDayAgo}
      )
      SELECT 
        COALESCE(dau, 0) as dau,
        COALESCE(wau, 0) as wau, 
        COALESCE(new_users_24h, 0) as new_users_24h,
        last_login
      FROM app_metrics, new_users
    `);
    
    const result = metricsResult.rows[0];
    return {
      dau: Number(result.dau || 0),
      wau: Number(result.wau || 0),
      newUsers24h: Number(result.new_users_24h || 0),
      lastLogin: result.last_login ? new Date(result.last_login as string | number) : null,
    };
  }

  // COPPA Parent Management
  async createParent(data: InsertParent): Promise<Parent> {
    const [parent] = await db
      .insert(parents)
      .values(data)
      .returning();
    return parent;
  }

  async getParent(id: string): Promise<Parent | undefined> {
    const [parent] = await db
      .select()
      .from(parents)
      .where(eq(parents.id, id));
    return parent;
  }

  async getParentByEmail(email: string): Promise<Parent | undefined> {
    const [parent] = await db
      .select()
      .from(parents)
      .where(eq(parents.email, email));
    return parent;
  }

  async getParentByVerificationToken(token: string): Promise<Parent | undefined> {
    // Scan all pending parents and check their verificationEvidence for matching token
    const pendingParents = await db
      .select()
      .from(parents)
      .where(eq(parents.verificationStatus, 'pending'));
    
    for (const parent of pendingParents) {
      if (!parent.verificationEvidence) continue;
      
      try {
        const evidence = JSON.parse(parent.verificationEvidence);
        
        // Check if token matches
        if (evidence.verificationToken === token) {
          // Check token expiry (24 hours)
          const tokenExpiry = new Date(evidence.tokenExpiry);
          const now = new Date();
          
          if (tokenExpiry > now) {
            return parent;
          }
        }
      } catch (error) {
        // Skip parents with invalid JSON
        console.error('Invalid verificationEvidence JSON for parent:', parent.id, error);
        continue;
      }
    }
    
    return undefined;
  }

  async updateParentVerification(id: string, status: string, method: string, evidence: string): Promise<Parent> {
    const [parent] = await db
      .update(parents)
      .set({
        verificationStatus: status,
        verificationMethod: method,
        verificationEvidence: evidence,
        updatedAt: new Date(),
      })
      .where(eq(parents.id, id))
      .returning();
    return parent;
  }

  // Parent-Child Links
  async createParentChildLink(data: InsertParentChildLink): Promise<ParentChildLink> {
    const [link] = await db
      .insert(parentChildLinks)
      .values(data)
      .returning();
    return link;
  }

  async getParentChildLinks(parentId: string): Promise<ParentChildLink[]> {
    return await db
      .select()
      .from(parentChildLinks)
      .where(eq(parentChildLinks.parentId, parentId));
  }

  async getChildParents(childId: string): Promise<ParentChildLink[]> {
    return await db
      .select()
      .from(parentChildLinks)
      .where(eq(parentChildLinks.childId, childId));
  }

  // Consent Management with WORM Storage
  async createConsent(data: InsertConsent): Promise<Consent> {
    // SECURITY FIX: Use transaction to ensure atomicity - consent and event created together or both fail
    return await db.transaction(async (trx) => {
      const [consent] = await trx
        .insert(consents)
        .values(data)
        .returning();

      // Create initial consent event within same transaction
      await this.createConsentEventInTransaction(trx, {
        consentId: consent.id,
        eventType: 'created',
        eventData: JSON.stringify({ consentType: data.consentType, method: data.consentMethod }),
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      });

      return consent;
    });
  }

  async getConsent(id: string): Promise<Consent | undefined> {
    const [consent] = await db
      .select()
      .from(consents)
      .where(eq(consents.id, id));
    return consent;
  }

  async getUserConsents(userId: string): Promise<Consent[]> {
    return await db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId));
  }

  async hasValidParentalConsent(userId: string): Promise<boolean> {
    // SECURITY FIX: Check for revoked consent and expiry dates to prevent false positives
    const now = new Date();
    const validConsents = await db
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.userId, userId),
          eq(consents.consentStatus, 'granted'),
          eq(consents.consentType, 'coppa_parental'),
          // SECURITY: Ensure consent is not revoked
          sql`revoked_date IS NULL`,
          // SECURITY: Check expiry date if present
          sql`(expiry_date IS NULL OR expiry_date > ${now})`
        )
      );
    return validConsents.length > 0;
  }

  async revokeConsent(consentId: string, reason: string): Promise<void> {
    // SECURITY FIX: Use transaction to ensure atomicity - consent update and event created together or both fail
    await db.transaction(async (trx) => {
      const revokedAt = new Date();
      
      // Update consent status
      await trx
        .update(consents)
        .set({
          consentStatus: 'revoked',
          revokedDate: revokedAt,
          updatedAt: revokedAt,
        })
        .where(eq(consents.id, consentId));

      // Create revocation event within same transaction
      await this.createConsentEventInTransaction(trx, {
        consentId,
        eventType: 'revoked',
        eventData: JSON.stringify({ reason, timestamp: revokedAt }),
        ipAddress: null,
        userAgent: null,
      });
    });
  }

  // Immutable Consent Events (WORM) with Hash Chaining
  async createConsentEvent(data: Omit<InsertConsentEvent, 'hashChain' | 'blockNumber' | 'recordHash'>): Promise<ConsentEvent> {
    // SECURITY FIX: Pre-compute timestamp for both hash computation AND database insertion
    const timestamp = new Date();
    
    // Get the last event for hash chaining - SECURITY FIX: Use numeric ordering to prevent corruption
    const lastEvent = await db
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.consentId, data.consentId))
      .orderBy(sql`CAST(block_number AS BIGINT) DESC`)
      .limit(1);

    const previousHash = lastEvent[0]?.recordHash || '0';
    const blockNumber = String(lastEvent.length > 0 ? Number(lastEvent[0].blockNumber) + 1 : 1);

    // SECURITY FIX: Create record hash with explicit timestamp to match database insertion
    const recordData = JSON.stringify({ ...data, blockNumber, timestamp });
    const recordHash = createHash('sha256').update(recordData).digest('hex');
    const hashChain = createHash('sha256').update(previousHash + recordData).digest('hex');

    // SECURITY FIX: Explicitly set timestamp to ensure hash verification works
    const [event] = await db
      .insert(consentEvents)
      .values({
        ...data,
        hashChain,
        blockNumber,
        recordHash,
        timestamp, // Explicit timestamp prevents hash mismatch
      })
      .returning();

    return event;
  }

  // SECURITY FIX: Transaction-aware version of createConsentEvent for atomic operations
  private async createConsentEventInTransaction(trx: any, data: Omit<InsertConsentEvent, 'hashChain' | 'blockNumber' | 'recordHash'>): Promise<ConsentEvent> {
    // SECURITY FIX: Pre-compute timestamp for both hash computation AND database insertion
    const timestamp = new Date();
    
    // Get the last event for hash chaining - SECURITY FIX: Use numeric ordering to prevent corruption
    const lastEvent = await trx
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.consentId, data.consentId))
      .orderBy(sql`CAST(block_number AS BIGINT) DESC`)
      .limit(1);

    const previousHash = lastEvent[0]?.recordHash || '0';
    const blockNumber = String(lastEvent.length > 0 ? Number(lastEvent[0].blockNumber) + 1 : 1);

    // SECURITY FIX: Create record hash with explicit timestamp to match database insertion
    const recordData = JSON.stringify({ ...data, blockNumber, timestamp });
    const recordHash = createHash('sha256').update(recordData).digest('hex');
    const hashChain = createHash('sha256').update(previousHash + recordData).digest('hex');

    // SECURITY FIX: Explicitly set timestamp to ensure hash verification works
    const [event] = await trx
      .insert(consentEvents)
      .values({
        ...data,
        hashChain,
        blockNumber,
        recordHash,
        timestamp, // Explicit timestamp prevents hash mismatch
      })
      .returning();

    return event;
  }

  async getConsentEvents(consentId: string): Promise<ConsentEvent[]> {
    // SECURITY FIX: Use numeric ordering to prevent chain corruption
    return await db
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.consentId, consentId))
      .orderBy(sql`CAST(block_number AS BIGINT) ASC`);
  }

  async verifyConsentEventChain(consentId: string): Promise<boolean> {
    const events = await this.getConsentEvents(consentId);
    if (events.length === 0) return true;

    let previousHash = '0';
    for (const event of events) {
      const recordData = JSON.stringify({
        consentId: event.consentId,
        eventType: event.eventType,
        eventData: event.eventData,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        blockNumber: event.blockNumber,
        timestamp: event.timestamp,
      });

      const expectedRecordHash = createHash('sha256').update(recordData).digest('hex');
      const expectedHashChain = createHash('sha256').update(previousHash + recordData).digest('hex');

      if (event.recordHash !== expectedRecordHash || event.hashChain !== expectedHashChain) {
        return false; // Chain integrity violated
      }

      previousHash = event.recordHash;
    }

    return true; // Chain integrity verified
  }

  // FERPA Data Rights
  async createDataRequest(data: InsertDataRequest): Promise<DataRequest> {
    const [request] = await db
      .insert(dataRequests)
      .values(data)
      .returning();
    return request;
  }

  async getDataRequest(id: string): Promise<DataRequest | undefined> {
    const [request] = await db
      .select()
      .from(dataRequests)
      .where(eq(dataRequests.id, id));
    return request;
  }

  async getUserDataRequests(userId: string): Promise<DataRequest[]> {
    return await db
      .select()
      .from(dataRequests)
      .where(eq(dataRequests.userId, userId))
      .orderBy(sql`created_at DESC`);
  }

  async updateDataRequestStatus(id: string, status: string, notes?: string): Promise<DataRequest> {
    const [request] = await db
      .update(dataRequests)
      .set({
        requestStatus: status,
        processingNotes: notes,
        updatedAt: new Date(),
        ...(status === 'completed' && { completedAt: new Date() }),
      })
      .where(eq(dataRequests.id, id))
      .returning();
    return request;
  }

  // Age Verification & COPPA Utilities
  calculateAge(dateOfBirth: Date): number {
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = today.getMonth() - dateOfBirth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
      age--;
    }

    return age;
  }

  async isUserUnder13(userId: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user?.dateOfBirth) return false;

    const dateOfBirth = new Date(user.dateOfBirth);
    return this.calculateAge(dateOfBirth) < 13;
  }

  async updateUserAgeStatus(userId: string, ageGateStatus: string): Promise<void> {
    await db
      .update(users)
      .set({
        ageGateStatus,
        restrictedProcessing: ageGateStatus === 'under_13_restricted',
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // PERFORMANCE: Invalidate cache after user modification
    this.userCache.invalidate(userId);
  }

  // 🚀 PERFORMANCE OPTIMIZATION: Consolidated age verification update (Fixed: No RETURNING)
  async updateUserAgeVerification(userId: string, dateOfBirth: string, ageGateStatus: string): Promise<User> {
    // Separate UPDATE and SELECT to avoid RETURNING performance penalty on Neon
    await db
      .update(users)
      .set({
        dateOfBirth,
        ageGateStatus,
        restrictedProcessing: ageGateStatus === 'under_13_restricted',
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Targeted SELECT with covering index  
    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    // PERFORMANCE: Invalidate and repopulate cache
    this.userCache.invalidate(userId);
    this.userCache.set(userId, updatedUser);
    
    return updatedUser;
  }

  // SCHOLARSHIP DATA SPINE OPERATIONS - MVP v0.9
  
  // Scholarship operations
  async createScholarship(data: InsertScholarship): Promise<Scholarship> {
    const [scholarship] = await db
      .insert(scholarships)
      .values(data)
      .returning();
    return scholarship;
  }

  async getScholarship(id: string): Promise<Scholarship | undefined> {
    const [scholarship] = await db
      .select()
      .from(scholarships)
      .where(eq(scholarships.id, id));
    return scholarship;
  }

  async getScholarships(filters?: {
    status?: string;
    sourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<Scholarship[]> {
    let query = db.select().from(scholarships).$dynamic();
    
    // CRITICAL FIX: Combine multiple filters with and() instead of overwriting
    const conditions = [];
    if (filters?.status) {
      conditions.push(eq(scholarships.status, filters.status as any));
    }
    if (filters?.sourceType) {
      conditions.push(eq(scholarships.sourceType, filters.sourceType as any));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.offset(filters.offset);
    }

    return await query;
  }

  async updateScholarship(id: string, data: Partial<InsertScholarship>): Promise<void> {
    await db
      .update(scholarships)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scholarships.id, id));
  }

  async deleteScholarship(id: string): Promise<void> {
    await db.delete(scholarships).where(eq(scholarships.id, id));
  }

  // Student profile operations
  async createStudentProfile(data: InsertStudentProfile): Promise<StudentProfile> {
    const [profile] = await db
      .insert(studentProfiles)
      .values(data)
      .returning();
    return profile;
  }

  async getStudentProfile(userId: string): Promise<StudentProfile | undefined> {
    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId));
    return profile;
  }

  async updateStudentProfile(userId: string, data: Partial<InsertStudentProfile>): Promise<void> {
    await db
      .update(studentProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(studentProfiles.userId, userId));
  }

  // Scholarship matching operations
  async generateMatches(studentProfileId: string): Promise<ScholarshipMatch[]> {
    // TODO: Implement actual matching logic here
    // This is a placeholder for the MVP
    return [];
  }

  async getMatches(studentProfileId: string, filters?: {
    fitScoreMin?: number;
    limit?: number;
  }): Promise<ScholarshipMatch[]> {
    // FERPA enforcement is now at the route level (before profile retrieval)
    const conditions = [eq(scholarshipMatches.studentProfileId, studentProfileId)];
    
    if (filters?.fitScoreMin) {
      conditions.push(gte(scholarshipMatches.fitScore, filters.fitScoreMin.toString()));
    }
    
    let query = db.select().from(scholarshipMatches)
      .where(and(...conditions)).$dynamic();
    
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    return await query;
  }

  async updateMatchStatus(matchId: string, status: string): Promise<void> {
    await db
      .update(scholarshipMatches)
      .set({ applicationStatus: status, lastUpdated: new Date() })
      .where(eq(scholarshipMatches.id, matchId));
  }

  // Essay assistance operations
  async createEssayAssistance(data: {
    studentProfileId: string;
    scholarshipId?: string;
    essayPrompt: string;
    wordLimit?: string;
    essayType?: string;
    assistanceType: string;
    outlineProvided?: string;
    suggestionsGiven?: any[];
  }): Promise<EssayAssistance> {
    const [assistance] = await db
      .insert(essayAssistance)
      .values({ ...data, suggestionsGiven: data.suggestionsGiven || [] })
      .returning();
    return assistance;
  }

  async getEssayAssistance(studentProfileId: string): Promise<EssayAssistance[]> {
    return await db
      .select()
      .from(essayAssistance)
      .where(eq(essayAssistance.studentProfileId, studentProfileId))
      .orderBy(desc(essayAssistance.createdAt));
  }

  // Data ingestion operations
  async createIngestionJob(data: {
    jobType: string;
    sourceType: string;
    sourceName: string;
  }): Promise<IngestionJob> {
    const [job] = await db
      .insert(ingestionJobs)
      .values({ ...data, sourceType: data.sourceType as any })
      .returning();
    return job;
  }

  async getIngestionJobs(filters?: {
    status?: string;
    sourceType?: string;
    limit?: number;
  }): Promise<IngestionJob[]> {
    let query = db.select().from(ingestionJobs).$dynamic();

    if (filters?.status) {
      query = query.where(eq(ingestionJobs.status, filters.status));
    }
    if (filters?.sourceType) {
      query = query.where(eq(ingestionJobs.sourceType, filters.sourceType as any));
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    return await query.orderBy(desc(ingestionJobs.createdAt));
  }

  async updateIngestionJob(id: string, data: Partial<{
    status: string;
    recordsProcessed: string;
    recordsCreated: string;
    recordsUpdated: string;
    recordsSkipped: string;
    errorMessage?: string;
    errorCount: string;
    startedAt?: Date;
    completedAt?: Date;
  }>): Promise<void> {
    await db
      .update(ingestionJobs)
      .set(data)
      .where(eq(ingestionJobs.id, id));
  }

  // Scholarship matching storage operations
  async createScholarshipMatch(data: {
    studentProfileId: string;
    scholarshipId: string;
    fitScore: string;
    eligibilityScore: string;
    competitionLevel: string;
    matchReasons: string[];
    eligibilityGaps: string[];
    applicationStatus: string;
    timeToCompleteEstimate: string;
  }): Promise<ScholarshipMatch> {
    const [match] = await db
      .insert(scholarshipMatches)
      .values(data)
      .returning();
    return match;
  }

  // ================================================================================
  // MFA OPERATIONS (CEO DIRECTIVE: Nov 10, 2025)
  // ================================================================================

  // MFA Factor operations
  async createMfaFactor(data: InsertMfaFactor): Promise<MfaFactor> {
    const [factor] = await db
      .insert(mfaFactors)
      .values(data)
      .returning();
    return factor;
  }

  async getMfaFactorsByUser(userId: string): Promise<MfaFactor[]> {
    return await db
      .select()
      .from(mfaFactors)
      .where(and(
        eq(mfaFactors.userId, userId),
        eq(mfaFactors.status, 'active')
      ))
      .orderBy(desc(mfaFactors.enrolledAt));
  }

  async getMfaFactor(id: string): Promise<MfaFactor | undefined> {
    const [factor] = await db
      .select()
      .from(mfaFactors)
      .where(eq(mfaFactors.id, id));
    return factor;
  }

  async updateMfaFactorLastUsed(id: string): Promise<void> {
    await db
      .update(mfaFactors)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(mfaFactors.id, id));
  }

  async revokeMfaFactor(id: string): Promise<void> {
    await db
      .update(mfaFactors)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(mfaFactors.id, id));
  }

  // MFA Challenge operations
  async createMfaChallenge(data: InsertMfaChallenge): Promise<MfaChallenge> {
    const [challenge] = await db
      .insert(mfaChallenges)
      .values(data)
      .returning();
    return challenge;
  }

  async getMfaChallenge(id: string): Promise<MfaChallenge | undefined> {
    const [challenge] = await db
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.id, id));
    return challenge;
  }

  async consumeMfaChallenge(id: string): Promise<void> {
    await db
      .update(mfaChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(mfaChallenges.id, id));
  }

  async cleanupExpiredChallenges(): Promise<void> {
    // Delete challenges older than current time
    await db
      .delete(mfaChallenges)
      .where(gt(new Date(), mfaChallenges.expiresAt));
  }

  // MFA Decision tracking (audit trail)
  async createMfaDecision(data: InsertMfaDecision): Promise<MfaDecision> {
    const [decision] = await db
      .insert(mfaDecisions)
      .values(data)
      .returning();
    return decision;
  }

  async createMfaDecisionAsync(data: InsertMfaDecision): Promise<void> {
    // Non-blocking insert for audit trail (fire and forget)
    db.insert(mfaDecisions)
      .values(data)
      .catch((err) => {
        console.error('Failed to create MFA decision audit log:', err);
      });
  }

  async getMfaDecisionsByUser(userId: string, limit: number = 50): Promise<MfaDecision[]> {
    return await db
      .select()
      .from(mfaDecisions)
      .where(eq(mfaDecisions.userId, userId))
      .orderBy(desc(mfaDecisions.timestamp))
      .limit(limit);
  }

  // ================================================================================
  // OAuth 2.1 Authorization Code Operations (CEO DIRECTIVE: Dec 7, 2025)
  // ================================================================================

  async createOauthCode(data: InsertOauthCode): Promise<OauthCode> {
    const [oauthCode] = await db
      .insert(oauthCodes)
      .values(data)
      .returning();
    return oauthCode;
  }

  async getOauthCode(code: string): Promise<OauthCode | undefined> {
    const [oauthCode] = await db
      .select()
      .from(oauthCodes)
      .where(and(
        eq(oauthCodes.code, code),
        gt(oauthCodes.expiresAt, new Date())
      ));
    return oauthCode;
  }

  async consumeOauthCode(code: string): Promise<OauthCode | undefined> {
    const [oauthCode] = await db
      .update(oauthCodes)
      .set({ usedAt: new Date() })
      .where(and(
        eq(oauthCodes.code, code),
        gt(oauthCodes.expiresAt, new Date()),
        sql`${oauthCodes.usedAt} IS NULL`
      ))
      .returning();
    return oauthCode;
  }

  async deleteExpiredOauthCodes(): Promise<void> {
    await db
      .delete(oauthCodes)
      .where(gt(new Date(), oauthCodes.expiresAt));
  }
}

export const storage = new DatabaseStorage();
