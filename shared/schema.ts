import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  boolean,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User roles enum
export const userRoleEnum = pgEnum('user_role', ['student', 'admin', 'reviewer', 'provider']);

// User storage table.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  passwordHash: text("password_hash"), // For REST auth adapter (bcrypt)
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: userRoleEnum("role").default('student'),
  isEmailVerified: boolean("is_email_verified").default(false),
  // Clerk authentication
  clerkUserId: varchar("clerk_user_id").unique(),
  // COPPA/FERPA Extensions
  dateOfBirth: date("date_of_birth"), // COPPA age verification
  ageGateStatus: varchar("age_gate_status", { length: 50 }).default('pending'), // 'pending', 'verified', 'under_13_restricted'
  dataProcessingConsent: boolean("data_processing_consent").default(false),
  restrictedProcessing: boolean("restricted_processing").default(true), // Under-13 default restriction
  consentRequiredUntil: timestamp("consent_required_until"), // Clear restriction date
  // FERPA B2B "School Official" Extensions (P0: Dec 2025)
  ferpaProtected: boolean("ferpa_protected").default(false), // B2B accounts require explicit consent for matching
  ferpaAccountType: varchar("ferpa_account_type", { length: 50 }), // 'school_official', 'directory_info', 'personal'
  ferpaInstitutionId: varchar("ferpa_institution_id", { length: 255 }), // School/district ID for DPA tracking
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Email verification tokens
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: varchar("code", { length: 64 }).notNull(), // Full hex token for REST auth
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// REST auth refresh tokens (for rotation and revocation)
export const restRefreshTokens = pgTable("rest_refresh_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of refresh token
  expiresAt: timestamp("expires_at").notNull(),
  revoked: boolean("revoked").default(false),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_rest_refresh_tokens_user").on(table.userId),
  index("idx_rest_refresh_tokens_hash").on(table.tokenHash),
]);

// Enhanced audit logs with FERPA compliance fields
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(),
  details: jsonb("details"),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  // FERPA Compliance Extensions
  dataSubject: varchar("data_subject", { length: 255 }), // User ID for data subject rights
  legalBasis: varchar("legal_basis", { length: 100 }), // 'consent', 'legitimate_interest', 'contract'
  dataCategories: text("data_categories"), // JSON array of PII categories accessed
  retentionReason: varchar("retention_reason", { length: 255 }),
  redactedPayload: text("redacted_payload"), // Sanitized version for audit
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // PERFORMANCE: Index for FERPA data subject rights queries (user audit history)
  index("idx_audit_logs_user_id_created").on(table.userId, table.createdAt),
  // PERFORMANCE: Index for FERPA compliance queries by data subject
  index("idx_audit_logs_data_subject").on(table.dataSubject),
]);

// COPPA Parent Management
export const parents = pgTable("parents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  phoneNumber: varchar("phone_number", { length: 20 }),
  verificationStatus: varchar("verification_status", { length: 50 }).default('pending'), // 'pending', 'verified', 'failed'
  verificationMethod: varchar("verification_method", { length: 100 }), // 'id_check', 'card_verification'
  verificationEvidence: text("verification_evidence"), // JSON metadata (vendor-managed tokens only)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const parentChildLinks = pgTable("parent_child_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentId: varchar("parent_id").references(() => parents.id).notNull(),
  childId: varchar("child_id").references(() => users.id).notNull(),
  relationshipType: varchar("relationship_type", { length: 50 }).notNull(), // 'parent', 'guardian', 'custodian'
  verificationStatus: varchar("verification_status", { length: 50 }).default('pending'),
  createdAt: timestamp("created_at").defaultNow(),
});

// Business Events Table (Central telemetry for KPI tracking)
export const businessEvents = pgTable("business_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: varchar("request_id", { length: 255 }).notNull(), // Correlation ID for tracing
  app: varchar("app", { length: 100 }).notNull(), // 'scholar-auth', 'student-pilot', etc.
  env: varchar("env", { length: 50 }).notNull().default('development'), // 'development', 'production'
  eventName: varchar("event_name", { length: 255 }).notNull(), // 'student_signup', 'credit_purchased', etc.
  ts: timestamp("ts").notNull().defaultNow(), // Event timestamp (ISO 8601)
  userId: varchar("user_id", { length: 255 }), // Subject user ID (who the event is about)
  actorType: varchar("actor_type", { length: 50 }), // 'student', 'provider', 'system', 'admin'
  actorId: varchar("actor_id", { length: 255 }), // Actor user ID (who performed the action)
  orgId: varchar("org_id", { length: 255 }), // Organization ID (for B2B events)
  sessionId: varchar("session_id", { length: 255 }), // Session identifier
  ipAddress: varchar("ip_address", { length: 45 }), // Client IP address (IPv4/IPv6)
  userAgent: text("user_agent"), // Client user agent string
  properties: jsonb("properties"), // Flexible event-specific properties
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Index for querying by app and event name (daily KPI aggregation)
  index("idx_business_events_app_event").on(table.app, table.eventName, table.ts),
  // Index for querying by user (user journey analysis)
  index("idx_business_events_user").on(table.userId, table.ts),
  // Index for querying by actor (actor analysis)
  index("idx_business_events_actor").on(table.actorId, table.ts),
  // Index for time-based queries (daily rollups)
  index("idx_business_events_ts").on(table.ts),
]);

// Consent Storage with WORM (Write-Once-Read-Many) integrity
export const consents = pgTable("consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  parentId: varchar("parent_id").references(() => parents.id),
  consentType: varchar("consent_type", { length: 100 }).notNull(), // 'coppa_parental', 'ferpa_educational', 'data_processing'
  consentMethod: varchar("consent_method", { length: 100 }).notNull(), // 'e_signature', 'card_verification'
  consentStatus: varchar("consent_status", { length: 50 }).notNull(), // 'granted', 'denied', 'revoked', 'expired'
  consentDate: timestamp("consent_date"),
  revokedDate: timestamp("revoked_date"),
  expiryDate: timestamp("expiry_date"),
  evidenceUri: text("evidence_uri"), // S3/storage URI for consent artifacts
  evidenceHash: varchar("evidence_hash", { length: 128 }), // SHA-256 hash for integrity
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  verifierSystem: varchar("verifier_system", { length: 100 }), // 'docusign', 'stripe', 'internal'
  verifierTransactionId: varchar("verifier_transaction_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// IMMUTABLE Consent Events - Append-only audit trail with hash chaining
export const consentEvents = pgTable("consent_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  consentId: varchar("consent_id").references(() => consents.id).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(), // 'created', 'granted', 'denied', 'revoked', 'expired'
  eventData: text("event_data"), // JSON payload (PII-redacted)
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  // Hash Chaining for WORM integrity
  hashChain: varchar("hash_chain", { length: 128 }), // Previous record hash
  blockNumber: varchar("block_number", { length: 20 }), // Sequential ordering
  recordHash: varchar("record_hash", { length: 128 }), // SHA-256 of entire record
  externalNotarization: varchar("external_notarization", { length: 255 }), // Blockchain/notary hash
  timestamp: timestamp("timestamp").defaultNow(),
  // NO updated_at - IMMUTABLE records only
});

// FERPA Data Rights Requests
export const dataRequests = pgTable("data_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  requestType: varchar("request_type", { length: 50 }).notNull(), // 'export', 'delete', 'rectification'
  requestStatus: varchar("request_status", { length: 50 }).default('pending'), // 'pending', 'processing', 'completed', 'failed'
  requestorEmail: varchar("requestor_email", { length: 255 }).notNull(),
  verificationToken: varchar("verification_token", { length: 128 }),
  verificationStatus: varchar("verification_status", { length: 50 }).default('pending'),
  requestData: text("request_data"), // JSON with specific data/sections requested
  processingNotes: text("processing_notes"),
  completedAt: timestamp("completed_at"),
  deliveryUri: text("delivery_uri"), // S3 URI for export files
  deletionLog: text("deletion_log"), // JSON log of deleted records/tombstones
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// OIDC Clients for managing registered applications
export const oidcClients = pgTable("oidc_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id", { length: 255 }).notNull().unique(),
  clientSecret: text("client_secret").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  redirectUris: jsonb("redirect_uris").notNull(), // Array of allowed redirect URIs
  postLogoutRedirectUris: jsonb("post_logout_redirect_uris"), // Array of post-logout URIs
  scopes: jsonb("scopes").notNull().default('["openid", "email", "profile"]'), // Allowed scopes
  grantTypes: jsonb("grant_types").notNull().default('["authorization_code", "refresh_token"]'),
  responseTypes: jsonb("response_types").notNull().default('["code"]'),
  tokenEndpointAuthMethod: varchar("token_endpoint_auth_method", { length: 50 }).notNull().default('client_secret_post'),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// OIDC Provider storage for tokens, grants, and authorization codes
// This table stores all OIDC provider data for persistent OAuth flows
export const oidcModels = pgTable("oidc_models", {
  id: varchar("id", { length: 255 }).primaryKey(), // OIDC provider entity ID
  type: varchar("type", { length: 50 }).notNull(), // Model type: AuthorizationCode, AccessToken, RefreshToken, etc.
  payload: jsonb("payload").notNull(), // Full OIDC entity payload
  grantId: varchar("grant_id", { length: 255 }), // Grant ID for token revocation
  userCode: varchar("user_code", { length: 255 }), // For device flow
  uid: varchar("uid", { length: 255 }), // Unique identifier for findByUid
  expiresAt: timestamp("expires_at"), // Expiration timestamp
  consumedAt: timestamp("consumed_at"), // When the entity was consumed
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_oidc_models_grant_id").on(table.grantId),
  index("IDX_oidc_models_user_code").on(table.userCode),
  index("IDX_oidc_models_uid").on(table.uid),
  index("IDX_oidc_models_expires_at").on(table.expiresAt),
]);

// Events table for centralized user activity tracking across apps
export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appId: varchar("app_id", { length: 50 }).notNull(), // 'student', 'provider', 'auth'
  userId: varchar("user_id").references(() => users.id),
  event: varchar("event", { length: 100 }).notNull(), // 'auth.login', 'auth.logout', 'email.verified', etc.
  correlationId: varchar("correlation_id", { length: 255 }),
  metadata: jsonb("metadata"), // Additional event data (role, user_agent, ip_hash, etc.)
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_events_app_id").on(table.appId),
  index("IDX_events_user_id").on(table.userId),
  index("IDX_events_event").on(table.event),
  index("IDX_events_timestamp").on(table.timestamp),
]);

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// COPPA/FERPA Types
export type Parent = typeof parents.$inferSelect;
export type ParentChildLink = typeof parentChildLinks.$inferSelect;
export type Consent = typeof consents.$inferSelect;
export type ConsentEvent = typeof consentEvents.$inferSelect;
export type DataRequest = typeof dataRequests.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  dateOfBirth: true,
  dataProcessingConsent: true,
});

export const insertPasswordResetSchema = createInsertSchema(passwordResetTokens).pick({
  userId: true,
  token: true,
  expiresAt: true,
});

export const insertEmailVerificationSchema = createInsertSchema(emailVerificationTokens).pick({
  userId: true,
  code: true,
  expiresAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).pick({
  userId: true,
  action: true,
  details: true,
  ipAddress: true,
  userAgent: true,
  dataSubject: true,
  legalBasis: true,
  dataCategories: true,
  retentionReason: true,
  redactedPayload: true,
});

// COPPA/FERPA Insert Schemas
export const insertParentSchema = createInsertSchema(parents).pick({
  email: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  verificationStatus: true,
  verificationMethod: true,
  verificationEvidence: true,
});

export const insertParentChildLinkSchema = createInsertSchema(parentChildLinks).pick({
  parentId: true,
  childId: true,
  relationshipType: true,
  verificationStatus: true,
});

export const insertConsentSchema = createInsertSchema(consents).pick({
  userId: true,
  parentId: true,
  consentType: true,
  consentMethod: true,
  consentStatus: true,
  consentDate: true,
  revokedDate: true,
  expiryDate: true,
  evidenceUri: true,
  evidenceHash: true,
  ipAddress: true,
  userAgent: true,
  verifierSystem: true,
  verifierTransactionId: true,
});

export const insertConsentEventSchema = createInsertSchema(consentEvents).pick({
  consentId: true,
  eventType: true,
  eventData: true,
  ipAddress: true,
  userAgent: true,
  hashChain: true,
  blockNumber: true,
  recordHash: true,
  externalNotarization: true,
});

export const insertDataRequestSchema = createInsertSchema(dataRequests).pick({
  userId: true,
  requestType: true,
  requestStatus: true,
  requestorEmail: true,
  verificationToken: true,
  verificationStatus: true,
  requestData: true,
  processingNotes: true,
  completedAt: true,
  deliveryUri: true,
  deletionLog: true,
});

// OIDC and Events schemas
export const insertOidcClientSchema = createInsertSchema(oidcClients).pick({
  clientId: true,
  clientSecret: true,
  name: true,
  description: true,
  redirectUris: true,
  postLogoutRedirectUris: true,
  scopes: true,
  grantTypes: true,
  responseTypes: true,
  tokenEndpointAuthMethod: true,
  enabled: true,
});

export const insertEventSchema = createInsertSchema(events).pick({
  appId: true,
  userId: true,
  event: true,
  correlationId: true,
  metadata: true,
  timestamp: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertPasswordReset = z.infer<typeof insertPasswordResetSchema>;
export type InsertEmailVerification = z.infer<typeof insertEmailVerificationSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type InsertOidcClient = z.infer<typeof insertOidcClientSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;

// COPPA/FERPA Insert Types
export type InsertParent = z.infer<typeof insertParentSchema>;
export type InsertParentChildLink = z.infer<typeof insertParentChildLinkSchema>;
export type InsertConsent = z.infer<typeof insertConsentSchema>;
export type InsertConsentEvent = z.infer<typeof insertConsentEventSchema>;
export type InsertDataRequest = z.infer<typeof insertDataRequestSchema>;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type OidcClient = typeof oidcClients.$inferSelect;
export type Event = typeof events.$inferSelect;

// SCHOLARSHIP DATA SPINE SCHEMA - MVP v0.9
// Canonical scholarship data for matching engine and student assistance

// Scholarship ingestion sources
export const scholarshipSourceEnum = pgEnum('scholarship_source', ['api', 'partner', 'crawl', 'manual']);

// Scholarship status for lifecycle management
export const scholarshipStatusEnum = pgEnum('scholarship_status', ['active', 'expired', 'draft', 'suspended', 'archived']);

// Core scholarships table with canonical schema
export const scholarships = pgTable("scholarships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Basic scholarship information
  name: varchar("name", { length: 500 }).notNull(),
  description: text("description"),
  provider: varchar("provider", { length: 255 }).notNull(),
  providerWebsite: varchar("provider_website", { length: 500 }),
  
  // Award details
  awardAmount: varchar("award_amount", { length: 100 }).notNull(), // "5000", "1000-5000", "Full Tuition"
  awardAmountMin: varchar("award_amount_min", { length: 20 }), // Normalized minimum for sorting
  awardAmountMax: varchar("award_amount_max", { length: 20 }), // Normalized maximum for sorting
  awardCurrency: varchar("award_currency", { length: 3 }).default('USD'),
  isRenewable: boolean("is_renewable").default(false),
  renewalCriteria: text("renewal_criteria"),
  
  // Application timeline
  applicationDeadline: timestamp("application_deadline"),
  applicationOpenDate: timestamp("application_open_date"),
  awardNotificationDate: timestamp("award_notification_date"),
  
  // Eligibility criteria (structured for matching engine)
  eligibilityCriteria: jsonb("eligibility_criteria").notNull(), // Structured eligibility rules
  targetDemographics: jsonb("target_demographics"), // Array: ["Black", "Hispanic", "Female", "First-generation"]
  academicRequirements: jsonb("academic_requirements"), // {gpa_min: "3.0", sat_min: "1200", majors: ["Computer Science"]}
  geographicRestrictions: jsonb("geographic_restrictions"), // {states: ["GA", "FL"], countries: ["US"]}
  otherRequirements: jsonb("other_requirements"), // Financial need, essays, activities, etc.
  
  // Application requirements
  requiredMaterials: jsonb("required_materials").notNull(), // Array of required documents/materials
  applicationMethod: varchar("application_method", { length: 100 }), // "online", "email", "mail"
  applicationUrl: varchar("application_url", { length: 1000 }),
  hasApplicationFee: boolean("has_application_fee").default(false),
  applicationFeeAmount: varchar("application_fee_amount", { length: 20 }),
  
  // Essay requirements
  essayRequirements: jsonb("essay_requirements"), // Array of essay prompts and requirements
  hasEssayRequirement: boolean("has_essay_requirement").default(false),
  
  // Lifecycle and status
  status: scholarshipStatusEnum("status").notNull().default('active'),
  
  // Data provenance and freshness
  sourceType: scholarshipSourceEnum("source_type").notNull(),
  sourceId: varchar("source_id", { length: 255 }), // External ID from source system
  sourceUrl: varchar("source_url", { length: 1000 }), // Original source URL
  sourceMetadata: jsonb("source_metadata"), // Additional source-specific data
  
  // Freshness tracking
  lastVerified: timestamp("last_verified").defaultNow(),
  lastUpdated: timestamp("last_updated").defaultNow(),
  verificationStatus: varchar("verification_status", { length: 50 }).default('pending'), // 'verified', 'pending', 'failed'
  
  // Search and matching optimization
  searchableText: text("searchable_text"), // Full-text search field
  tags: jsonb("tags"), // Array of categorization tags
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Indexes for matching engine performance
  index("idx_scholarships_deadline").on(table.applicationDeadline),
  index("idx_scholarships_status").on(table.status),
  index("idx_scholarships_source").on(table.sourceType),
  index("idx_scholarships_verified").on(table.lastVerified),
  index("idx_scholarships_amount_min").on(table.awardAmountMin),
]);

// Student profiles for matching (extends users table conceptually)
export const studentProfiles = pgTable("student_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull().unique(),
  
  // Academic profile
  gpa: varchar("gpa", { length: 10 }), // "3.7", "4.0"
  gpaScale: varchar("gpa_scale", { length: 10 }).default('4.0'),
  satScore: varchar("sat_score", { length: 10 }),
  actScore: varchar("act_score", { length: 10 }),
  classRank: varchar("class_rank", { length: 50 }),
  graduationDate: date("graduation_date"),
  intendedMajor: varchar("intended_major", { length: 255 }),
  intendedMinor: varchar("intended_minor", { length: 255 }),
  academicInterests: jsonb("academic_interests"), // Array of interests
  
  // Demographics for matching
  ethnicity: jsonb("ethnicity"), // Array for multi-ethnic students
  gender: varchar("gender", { length: 50 }),
  isFirstGeneration: boolean("is_first_generation").default(false),
  householdIncome: varchar("household_income", { length: 50 }),
  citizenshipStatus: varchar("citizenship_status", { length: 100 }),
  
  // Location
  state: varchar("state", { length: 2 }),
  city: varchar("city", { length: 100 }),
  zipCode: varchar("zip_code", { length: 10 }),
  schoolName: varchar("school_name", { length: 255 }),
  
  // Activities and achievements
  extracurriculars: jsonb("extracurriculars"), // Array of activities
  workExperience: jsonb("work_experience"), // Array of work history
  volunteerHours: varchar("volunteer_hours", { length: 20 }),
  awards: jsonb("awards"), // Array of awards/honors
  
  // College preferences
  preferredStates: jsonb("preferred_states"), // Array of state preferences
  collegeInterests: jsonb("college_interests"), // Array of target schools/types
  
  // Application tracking
  documentsUploaded: jsonb("documents_uploaded"), // Track uploaded docs for reuse
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Scholarship matches generated by the matching engine
export const scholarshipMatches = pgTable("scholarship_matches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studentProfileId: varchar("student_profile_id").references(() => studentProfiles.id).notNull(),
  scholarshipId: varchar("scholarship_id").references(() => scholarships.id).notNull(),
  
  // Matching scores
  fitScore: varchar("fit_score", { length: 10 }).notNull(), // 0-100 compatibility score
  eligibilityScore: varchar("eligibility_score", { length: 10 }).notNull(), // 0-100 eligibility confidence
  competitionLevel: varchar("competition_level", { length: 20 }), // "low", "medium", "high"
  
  // Matching reasoning
  matchReasons: jsonb("match_reasons").notNull(), // Array of why this matches
  eligibilityGaps: jsonb("eligibility_gaps"), // Array of potential issues
  
  // Application tracking
  applicationStatus: varchar("application_status", { length: 50 }).default('not_started'), // 'not_started', 'in_progress', 'submitted', 'declined'
  timeToCompleteEstimate: varchar("time_estimate_minutes", { length: 10 }), // Estimated application time
  
  // Timeline tracking
  matchedAt: timestamp("matched_at").defaultNow(),
  lastUpdated: timestamp("last_updated").defaultNow(),
}, (table) => [
  index("idx_matches_student").on(table.studentProfileId),
  index("idx_matches_scholarship").on(table.scholarshipId),
  index("idx_matches_fit_score").on(table.fitScore),
  index("idx_matches_status").on(table.applicationStatus),
]);

// Essay assistance tracking (ethical AI coach)
export const essayAssistance = pgTable("essay_assistance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studentProfileId: varchar("student_profile_id").references(() => studentProfiles.id).notNull(),
  scholarshipId: varchar("scholarship_id").references(() => scholarships.id),
  
  // Essay prompt and requirements
  essayPrompt: text("essay_prompt").notNull(),
  wordLimit: varchar("word_limit", { length: 20 }),
  essayType: varchar("essay_type", { length: 100 }), // "personal_statement", "why_major", "community_service"
  
  // Assistance provided (NEVER store student's actual essay content)
  assistanceType: varchar("assistance_type", { length: 50 }).notNull(), // "brainstorm", "outline", "structure", "review"
  outlineProvided: text("outline_provided"), // Structured outline/suggestions
  suggestionsGiven: jsonb("suggestions_given"), // Array of improvement suggestions
  
  // Ethical controls
  ghostwritingPrevention: boolean("ghostwriting_prevention").default(true),
  studentAcknowledgment: boolean("student_acknowledgment").default(false), // Student confirmed it's their work
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_essay_assistance_student").on(table.studentProfileId),
  index("idx_essay_assistance_scholarship").on(table.scholarshipId),
]);

// Data ingestion jobs tracking
export const ingestionJobs = pgTable("ingestion_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  jobType: varchar("job_type", { length: 100 }).notNull(), // "daily_refresh", "source_crawl", "partner_sync"
  sourceType: scholarshipSourceEnum("source_type").notNull(),
  sourceName: varchar("source_name", { length: 255 }).notNull(),
  
  // Job status and metrics
  status: varchar("status", { length: 50 }).notNull().default('pending'), // 'pending', 'running', 'completed', 'failed'
  recordsProcessed: varchar("records_processed", { length: 20 }).default('0'),
  recordsCreated: varchar("records_created", { length: 20 }).default('0'),
  recordsUpdated: varchar("records_updated", { length: 20 }).default('0'),
  recordsSkipped: varchar("records_skipped", { length: 20 }).default('0'),
  
  // Error tracking
  errorMessage: text("error_message"),
  errorCount: varchar("error_count", { length: 20 }).default('0'),
  
  // Timing
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ingestion_jobs_status").on(table.status),
  index("idx_ingestion_jobs_source").on(table.sourceType),
  index("idx_ingestion_jobs_created").on(table.createdAt),
]);

// Insert schemas for scholarship system
export const insertScholarshipSchema = createInsertSchema(scholarships).pick({
  name: true,
  description: true,
  provider: true,
  providerWebsite: true,
  awardAmount: true,
  awardAmountMin: true,
  awardAmountMax: true,
  awardCurrency: true,
  isRenewable: true,
  renewalCriteria: true,
  applicationDeadline: true,
  applicationOpenDate: true,
  awardNotificationDate: true,
  eligibilityCriteria: true,
  targetDemographics: true,
  academicRequirements: true,
  geographicRestrictions: true,
  otherRequirements: true,
  requiredMaterials: true,
  applicationMethod: true,
  applicationUrl: true,
  hasApplicationFee: true,
  applicationFeeAmount: true,
  essayRequirements: true,
  hasEssayRequirement: true,
  status: true,
  sourceType: true,
  sourceId: true,
  sourceUrl: true,
  sourceMetadata: true,
  verificationStatus: true,
  searchableText: true,
  tags: true,
});

export const insertStudentProfileSchema = createInsertSchema(studentProfiles).pick({
  userId: true,
  gpa: true,
  gpaScale: true,
  satScore: true,
  actScore: true,
  classRank: true,
  graduationDate: true,
  intendedMajor: true,
  intendedMinor: true,
  academicInterests: true,
  ethnicity: true,
  gender: true,
  isFirstGeneration: true,
  householdIncome: true,
  citizenshipStatus: true,
  state: true,
  city: true,
  zipCode: true,
  schoolName: true,
  extracurriculars: true,
  workExperience: true,
  volunteerHours: true,
  awards: true,
  preferredStates: true,
  collegeInterests: true,
  documentsUploaded: true,
});

// Business Events insert schema
export const insertBusinessEventSchema = createInsertSchema(businessEvents).omit({
  id: true,
  createdAt: true,
}).extend({
  requestId: z.string().uuid(),
  app: z.string().min(1),
  env: z.enum(['development', 'staging', 'production']).default('development'),
  eventName: z.string().min(1),
  actorType: z.enum(['student', 'provider', 'system', 'admin', 'parent']).optional(),
  actorId: z.string().optional(),
  orgId: z.string().optional(),
  sessionId: z.string().optional(),
  properties: z.record(z.any()).optional(),
});

// Export types
export type Scholarship = typeof scholarships.$inferSelect;
export type StudentProfile = typeof studentProfiles.$inferSelect;
export type ScholarshipMatch = typeof scholarshipMatches.$inferSelect;
export type EssayAssistance = typeof essayAssistance.$inferSelect;
export type IngestionJob = typeof ingestionJobs.$inferSelect;
export type BusinessEvent = typeof businessEvents.$inferSelect;

export type InsertScholarship = z.infer<typeof insertScholarshipSchema>;
export type InsertStudentProfile = z.infer<typeof insertStudentProfileSchema>;
export type InsertBusinessEvent = z.infer<typeof insertBusinessEventSchema>;

// ================================================================================
// MFA (MULTI-FACTOR AUTHENTICATION) SCHEMA
// CEO DIRECTIVE: Voluntary MFA enrollment for TOTP/WebAuthn (Nov 10, 2025)
// ================================================================================

// MFA factor types enum
export const mfaFactorTypeEnum = pgEnum('mfa_factor_type', ['totp', 'webauthn']);

// MFA factor status enum
export const mfaFactorStatusEnum = pgEnum('mfa_factor_status', ['active', 'inactive', 'revoked']);

// MFA decision types enum
export const mfaDecisionTypeEnum = pgEnum('mfa_decision_type', ['skip', 'enroll']);

// MFA Factors table - stores enrolled MFA factors for users
export const mfaFactors = pgTable("mfa_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type: mfaFactorTypeEnum("type").notNull(), // 'totp' or 'webauthn'
  label: varchar("label", { length: 255 }).notNull(), // User-friendly name: "Google Authenticator", "YubiKey"
  // Secret for TOTP or credential data for WebAuthn (encrypted at rest)
  secretOrCredential: jsonb("secret_or_credential").notNull(), // { secret: "..." } or { credentialId: "...", publicKey: "..." }
  status: mfaFactorStatusEnum("status").notNull().default('active'),
  enrolledAt: timestamp("enrolled_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_mfa_factors_user_id").on(table.userId),
  index("idx_mfa_factors_status").on(table.status),
]);

// MFA Challenges table - tracks active challenges for verification
export const mfaChallenges = pgTable("mfa_challenges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  factorId: varchar("factor_id").references(() => mfaFactors.id, { onDelete: 'cascade' }),
  type: mfaFactorTypeEnum("type").notNull(),
  issuedAt: timestamp("issued_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  metadata: jsonb("metadata"), // Challenge-specific data (e.g., WebAuthn challenge)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_mfa_challenges_user_id").on(table.userId),
  index("idx_mfa_challenges_expires_at").on(table.expiresAt),
]);

// MFA Decisions table - audit trail for enrollment decisions
export const mfaDecisions = pgTable("mfa_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  decisionType: mfaDecisionTypeEnum("decision_type").notNull(), // 'skip' or 'enroll'
  factorType: mfaFactorTypeEnum("factor_type"), // null for 'skip', 'totp' or 'webauthn' for 'enroll'
  reason: text("reason"), // User-provided reason for skip or failure reason
  role: userRoleEnum("role"), // User role at time of decision
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  correlationId: varchar("correlation_id", { length: 255 }), // Request correlation ID
  timestamp: timestamp("timestamp").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_mfa_decisions_user_id").on(table.userId),
  index("idx_mfa_decisions_timestamp").on(table.timestamp),
  index("idx_mfa_decisions_decision_type").on(table.decisionType),
]);

// MFA insert schemas
export const insertMfaFactorSchema = createInsertSchema(mfaFactors).pick({
  userId: true,
  type: true,
  label: true,
  secretOrCredential: true,
  status: true,
});

export const insertMfaChallengeSchema = createInsertSchema(mfaChallenges).pick({
  userId: true,
  factorId: true,
  type: true,
  expiresAt: true,
  metadata: true,
});

export const insertMfaDecisionSchema = createInsertSchema(mfaDecisions).pick({
  userId: true,
  decisionType: true,
  factorType: true,
  reason: true,
  role: true,
  ipAddress: true,
  userAgent: true,
  correlationId: true,
});

// MFA types
export type MfaFactor = typeof mfaFactors.$inferSelect;
export type MfaChallenge = typeof mfaChallenges.$inferSelect;
export type MfaDecision = typeof mfaDecisions.$inferSelect;

export type InsertMfaFactor = z.infer<typeof insertMfaFactorSchema>;
export type InsertMfaChallenge = z.infer<typeof insertMfaChallengeSchema>;
export type InsertMfaDecision = z.infer<typeof insertMfaDecisionSchema>;

// ================================================================================
// OAUTH 2.1 AUTHORIZATION CODES TABLE
// CEO DIRECTIVE: Cross-domain OAuth handshake for A5/A6 (Dec 7, 2025)
// ================================================================================

export const oauthCodes = pgTable("oauth_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 128 }).notNull().unique(),
  clientId: varchar("client_id", { length: 255 }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
  codeChallengeMethod: varchar("code_challenge_method", { length: 10 }).notNull().default('S256'),
  scope: text("scope").default('openid email profile'),
  state: text("state"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_oauth_codes_code").on(table.code),
  index("idx_oauth_codes_expires_at").on(table.expiresAt),
  index("idx_oauth_codes_client_id").on(table.clientId),
]);

export const insertOauthCodeSchema = createInsertSchema(oauthCodes).pick({
  code: true,
  clientId: true,
  userId: true,
  redirectUri: true,
  codeChallenge: true,
  codeChallengeMethod: true,
  scope: true,
  state: true,
  expiresAt: true,
});

export type OauthCode = typeof oauthCodes.$inferSelect;
export type InsertOauthCode = z.infer<typeof insertOauthCodeSchema>;

// ================================================================================
// SECURE TOKEN STORAGE TABLE
// CEO DIRECTIVE: Separate token storage for security hardening (Dec 17, 2025)
// Tokens stored server-side; only minimal claims (sub) in JWT cookie
// ================================================================================

export const userTokenStore = pgTable("user_token_store", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jti: varchar("jti", { length: 64 }).notNull().unique(),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  revoked: boolean("revoked").default(false),
  revokedAt: timestamp("revoked_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_token_store_jti").on(table.jti),
  index("idx_user_token_store_user_id").on(table.userId),
  index("idx_user_token_store_expires_at").on(table.expiresAt),
]);

export const insertUserTokenStoreSchema = createInsertSchema(userTokenStore).pick({
  jti: true,
  userId: true,
  accessToken: true,
  refreshToken: true,
  tokenExpiresAt: true,
  expiresAt: true,
});

export type UserTokenStore = typeof userTokenStore.$inferSelect;
export type InsertUserTokenStore = z.infer<typeof insertUserTokenStoreSchema>;

// ================================================================================
// PROVIDER BACKLOG TABLE (A3→A6 Circuit Breaker Queue)
// CEO DIRECTIVE: A3→A6 Circuit Breaker with provider_backlog queue (Jan 15, 2026)
// Stores failed A6 calls for retry with exponential backoff
// ================================================================================

export const providerBacklogStatusEnum = pgEnum('provider_backlog_status', ['pending', 'completed', 'dead_letter']);

export const providerBacklog = pgTable("provider_backlog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
  payloadJson: text("payload_json").notNull(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull().default('POST'),
  firstSeenAt: timestamp("first_seen_at").defaultNow(),
  nextRetryAt: timestamp("next_retry_at").notNull(),
  attempts: varchar("attempts", { length: 10 }).notNull().default('0'), // Will be cast to integer by SQL
  status: providerBacklogStatusEnum("status").default('pending'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_provider_backlog_status_retry").on(table.status, table.nextRetryAt),
  index("idx_provider_backlog_idempotency").on(table.idempotencyKey),
]);

export const insertProviderBacklogSchema = createInsertSchema(providerBacklog).pick({
  idempotencyKey: true,
  payloadJson: true,
  endpoint: true,
  method: true,
  nextRetryAt: true,
});

export type ProviderBacklog = typeof providerBacklog.$inferSelect;
export type InsertProviderBacklog = z.infer<typeof insertProviderBacklogSchema>;

// ================================================================================
// DATASERVICE V2 SCHEMA - V2 Sprint-2 (Jan 21, 2026)
// CEO DIRECTIVE: DataService microservice with FERPA compliance
// ================================================================================

// Provider status enum
export const providerStatusEnum = pgEnum('provider_status', ['active', 'pending', 'suspended', 'inactive']);

// Providers table - B2B scholarship providers
export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  website: varchar("website", { length: 500 }),
  description: text("description"),
  logoUrl: varchar("logo_url", { length: 500 }),
  
  // FERPA Compliance
  isFerpaCovered: boolean("is_ferpa_covered").default(false),
  ferpaAccountType: varchar("ferpa_account_type", { length: 50 }), // 'school_official', 'directory_info', 'commercial'
  institutionId: varchar("institution_id", { length: 255 }),
  dpaSignedAt: timestamp("dpa_signed_at"),
  
  // Business details
  status: providerStatusEnum("status").default('pending'),
  tier: varchar("tier", { length: 50 }).default('standard'), // 'standard', 'premium', 'enterprise'
  platformFeePercent: varchar("platform_fee_percent", { length: 10 }).default('3.0'),
  
  // Contact info
  contactName: varchar("contact_name", { length: 255 }),
  contactEmail: varchar("contact_email", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  
  // Privacy
  doNotSell: boolean("do_not_sell").default(false),
  privacyMode: varchar("privacy_mode", { length: 50 }).default('standard'), // 'standard', 'restricted'
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_providers_status").on(table.status),
  index("idx_providers_slug").on(table.slug),
  index("idx_providers_ferpa").on(table.isFerpaCovered),
]);

// Upload status enum
export const uploadStatusEnum = pgEnum('upload_status', ['pending', 'processing', 'completed', 'failed', 'deleted']);

// Uploads table - Document upload metadata
export const uploads = pgTable("uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  ownerType: varchar("owner_type", { length: 50 }).notNull().default('user'), // 'user', 'provider', 'system'
  
  // File metadata
  filename: varchar("filename", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: varchar("size_bytes", { length: 20 }).notNull(),
  storageKey: varchar("storage_key", { length: 500 }), // S3/storage key
  checksum: varchar("checksum", { length: 128 }), // SHA-256
  
  // Classification
  documentType: varchar("document_type", { length: 100 }), // 'transcript', 'essay', 'recommendation', 'financial_aid'
  isFerpaCovered: boolean("is_ferpa_covered").default(false),
  isConfidential: boolean("is_confidential").default(false),
  
  // Processing
  status: uploadStatusEnum("status").default('pending'),
  processingMetadata: jsonb("processing_metadata"), // NLP scoring results, etc.
  
  // Audit
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  deletedAt: timestamp("deleted_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_uploads_owner").on(table.ownerId),
  index("idx_uploads_status").on(table.status),
  index("idx_uploads_type").on(table.documentType),
  index("idx_uploads_ferpa").on(table.isFerpaCovered),
]);

// Ledger entry type enum
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', ['debit', 'credit']);

// Ledger account type enum
export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', [
  'revenue', 'expense', 'asset', 'liability', 'equity',
  'platform_fee', 'ai_markup', 'provider_payout', 'student_payment', 'refund'
]);

// Ledgers table - Double-entry financial ledger
export const ledgers = pgTable("ledgers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  traceId: varchar("trace_id", { length: 255 }).notNull(), // X-Trace-Id for lineage
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
  
  // Entry details
  entryType: ledgerEntryTypeEnum("entry_type").notNull(),
  accountType: ledgerAccountTypeEnum("account_type").notNull(),
  amount: varchar("amount", { length: 20 }).notNull(), // Store as string for precision
  currency: varchar("currency", { length: 3 }).default('USD'),
  
  // References
  userId: varchar("user_id").references(() => users.id),
  providerId: varchar("provider_id").references(() => providers.id),
  transactionRef: varchar("transaction_ref", { length: 255 }), // Stripe payment_intent, etc.
  
  // Balancing
  balanceGroupId: varchar("balance_group_id", { length: 255 }).notNull(), // Groups debit/credit pairs
  isBalanced: boolean("is_balanced").default(false),
  
  // Metadata
  description: text("description"),
  metadata: jsonb("metadata"),
  
  // Audit
  postedAt: timestamp("posted_at").defaultNow(),
  reversedAt: timestamp("reversed_at"),
  reversalRef: varchar("reversal_ref", { length: 255 }),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ledgers_trace").on(table.traceId),
  index("idx_ledgers_balance_group").on(table.balanceGroupId),
  index("idx_ledgers_user").on(table.userId),
  index("idx_ledgers_provider").on(table.providerId),
  index("idx_ledgers_posted").on(table.postedAt),
  index("idx_ledgers_account_type").on(table.accountType),
]);

// DataService Insert Schemas
export const insertProviderSchema = createInsertSchema(providers).pick({
  name: true,
  slug: true,
  email: true,
  website: true,
  description: true,
  logoUrl: true,
  isFerpaCovered: true,
  ferpaAccountType: true,
  institutionId: true,
  status: true,
  tier: true,
  platformFeePercent: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  doNotSell: true,
  privacyMode: true,
});

export const insertUploadSchema = createInsertSchema(uploads).pick({
  ownerId: true,
  ownerType: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  storageKey: true,
  checksum: true,
  documentType: true,
  isFerpaCovered: true,
  isConfidential: true,
  status: true,
  expiresAt: true,
});

export const insertLedgerSchema = createInsertSchema(ledgers).pick({
  traceId: true,
  idempotencyKey: true,
  entryType: true,
  accountType: true,
  amount: true,
  currency: true,
  userId: true,
  providerId: true,
  transactionRef: true,
  balanceGroupId: true,
  description: true,
  metadata: true,
});

// DataService Types
export type Provider = typeof providers.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type Ledger = typeof ledgers.$inferSelect;

export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type InsertLedger = z.infer<typeof insertLedgerSchema>;
