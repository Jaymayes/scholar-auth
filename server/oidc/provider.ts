import Provider from 'oidc-provider';
import { randomUUID } from 'crypto';
import { storage } from '../storage';
import { logger } from '../middleware/auditLogger';
import type { Request } from 'express';
import { PostgresAdapter, ClientAdapter } from './postgresAdapter';
import { db } from '../db';
import { oidcModels } from '@shared/schema';
import bcrypt from 'bcryptjs';

// 🔧 UNIFIED ISSUER RESOLUTION - SINGLE SOURCE OF TRUTH
// SEV-1 FIX: OIDC_PUBLIC_BASE_URL is now the PRIMARY source
// When oidc-provider is mounted at app.use('/oidc', provider.callback()),
// the issuer MUST include the /oidc path to match the discovery endpoint.
// This function is exported and used by ALL modules to ensure consistency
// across discovery endpoints, error pages, OAuth flows, and client validation.
export function getIssuerUrl(): string {
  // Priority: OIDC_PUBLIC_BASE_URL > OIDC_ISSUER > PUBLIC_BASE_URL > environment detection
  let baseIssuerUrl = process.env.OIDC_PUBLIC_BASE_URL
    || process.env.OIDC_ISSUER 
    || process.env.PUBLIC_BASE_URL
    || (process.env.NODE_ENV === 'production'
      ? 'https://scholar-auth-jamarrlmayes.replit.app'
      : (process.env.REPLIT_DEV_DOMAIN 
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : 'http://localhost:5000'));
  
  // FORCE /oidc suffix if missing (required for provider mounted at /oidc)
  return baseIssuerUrl.endsWith('/oidc') ? baseIssuerUrl : `${baseIssuerUrl}/oidc`;
}

// 🔒 CEO NOV 13: RBAC Permissions Mapping
// Maps roles to their default permissions (used for user tokens only)
// CEO MANDATE: Updated to enterprise role naming (provider_admin, reviewer, super_admin)
function getRolePermissions(role: string): string[] {
  const permissionsMap: Record<string, string[]> = {
    student: [
      'profile.read',
      'profile.write',
      'applications.submit',
      'applications.read',
      'recommendations.read',
    ],
    provider_admin: [
      'profile.read',
      'profile.write',
      'scholarships.create',
      'scholarships.manage',
      'applications.read',
      'applications.update',
    ],
    reviewer: [
      'profile.read',
      'applications.read',
      'scholarships.read',
      'users.read',
    ],
    super_admin: [
      'profile.read',
      'profile.write',
      'applications.read',
      'applications.update',
      'scholarships.read',
      'scholarships.manage',
      'users.read',
      'users.manage',
    ],
    // Legacy role name support (backward compatibility during migration)
    provider: [
      'profile.read',
      'profile.write',
      'scholarships.create',
      'scholarships.manage',
      'applications.read',
      'applications.update',
    ],
    staff: [
      'profile.read',
      'applications.read',
      'scholarships.read',
      'users.read',
    ],
    admin: [
      'profile.read',
      'profile.write',
      'applications.read',
      'applications.update',
      'scholarships.read',
      'scholarships.manage',
      'users.read',
      'users.manage',
    ],
  };
  
  return permissionsMap[role] || [];
}

// 🔒 MASTER PROMPT: Client-Specific Scope Allowlists (Section A RBAC)
// SECURITY: Defines which scopes each service client is permitted to request
// Updated to match MASTER ORCHESTRATION PROMPT scope names (Nov 14, 2025)
const CLIENT_ALLOWED_SCOPES: Record<string, string[]> = {
  'scholarship-sage-m2m': ['read:scholarships', 'read:users', 'read:recommendations', 'export:data'],
  'scholarship-api-service': ['read:scholarships', 'write:scholarships', 'read:applications'],
  'scholarship-agent-service': ['read:scholarships', 'send:notifications'],
  'auto-com-center-service': ['send:notifications'],
  'auto-page-maker-service': ['read:scholarships', 'generate:assets', 'export:data'],
  'provider-register-m2m': ['read:providers', 'write:providers'],
  'reviewer-portal-m2m': ['read:applications', 'review:applications'],
  'admin-dashboard-m2m': ['admin:read', 'admin:write', 'introspect:tokens'],
  // S2S Auth Client for scholarship_agent telemetry (registered per CEO directive)
  'scholarship_agent': ['telemetry:write'],
};

// 🔒 CEO NOV 13: Validate Requested Scopes Against Client Allowlist
// CRITICAL: Rejects token requests with scopes the client is not authorized for
function validateClientScopes(clientId: string, requestedScopes: string[]): { valid: boolean; allowedScopes: string[] } {
  const allowedScopes = CLIENT_ALLOWED_SCOPES[clientId] || [];
  
  // Filter requested scopes to only those allowed for this client
  const validScopes = requestedScopes.filter(scope => allowedScopes.includes(scope));
  
  // If any requested scope is not allowed, the request is invalid
  const allValid = requestedScopes.every(scope => allowedScopes.includes(scope) || scope === 'openid');
  
  return {
    valid: allValid,
    allowedScopes: validScopes
  };
}

// 🔒 MASTER PROMPT: Scope-to-Permission Mapping for Service Tokens
// Maps OAuth2 scopes to granular permissions (least-privilege principle)
// Updated to match standard OAuth2 scope format (action:resource) per CEO E2E validation
function getScopePermissions(scopes: string[]): string[] {
  const scopeToPermissions: Record<string, string[]> = {
    // Scholarship management scopes
    'read:scholarships': ['scholarships.read', 'scholarships.view'],
    'write:scholarships': ['scholarships.create', 'scholarships.update', 'scholarships.manage'],
    
    // Application management scopes
    'read:applications': ['applications.read', 'applications.view'],
    'write:applications': ['applications.create', 'applications.submit'],
    'review:applications': ['applications.review', 'applications.update', 'applications.approve'],
    
    // User/Student data scopes
    'read:users': ['students.read', 'students.view.anonymized'],
    
    // Recommendation scopes
    'read:recommendations': ['recommendations.read', 'recommendations.view'],
    
    // Notification scopes
    'send:notifications': ['notifications.send', 'notifications.trigger', 'email.send', 'sms.send'],
    
    // Provider management scopes
    'read:providers': ['providers.read', 'providers.view'],
    'write:providers': ['providers.create', 'providers.update', 'providers.manage'],
    
    // Asset generation scopes
    'generate:assets': ['assets.generate', 'assets.create', 'pdf.generate', 'html.generate'],
    
    // Data export scopes
    'export:data': ['data.export', 'data.read.bulk'],
    
    // Admin scopes
    'admin:read': ['users.read', 'users.view', 'reports.read', 'analytics.read', 'settings.read'],
    'admin:write': ['users.manage', 'users.create', 'users.update', 'reports.generate', 'settings.update', 'config.manage'],
    
    // Introspection scope
    'introspect:tokens': ['token.introspect', 'token.verify', 'auth.debug'],
    
    // Telemetry scopes (for S2S auth with scholarship_agent)
    'telemetry:write': ['telemetry.emit', 'analytics.write', 'events.publish'],
    'telemetry:read': ['telemetry.read', 'analytics.read', 'stats.read'],
  };
  
  const permissions = new Set<string>();
  scopes.forEach(scope => {
    const scopePerms = scopeToPermissions[scope] || [];
    scopePerms.forEach(perm => permissions.add(perm));
  });
  
  return Array.from(permissions);
}

const ISSUER_URL = getIssuerUrl();

// 🔒 CEO P0 SECURITY: Hash client secrets with bcrypt (cost factor 12)
// CRITICAL: All client_secret values stored in DB must be bcrypt hashes
function hashClientSecret(plaintext: string): string {
  const hash = bcrypt.hashSync(plaintext, 12);
  console.log(`🔒 HASHED SECRET: ${plaintext.substring(0, 4)}... → bcrypt hash generated`);
  return hash;
}

// 🎯 CEO GATE 0: Build service client definitions from environment secrets
// This function extracts all 10 OAuth client definitions and validates secrets
// CEO P0: Now hashes all client secrets before storage
function buildServiceClients(): any[] {
  // Define required service client secrets
  const requiredSecrets = {
    'M2M_SCHOLARSHIP_SAGE_SECRET': 'scholarship-sage-m2m',
    'SCHOLARSHIP_API_SERVICE_SECRET': 'scholarship-api-service',
    'SCHOLARSHIP_AGENT_SERVICE_SECRET': 'scholarship-agent-service',
    'SCHOLARSHIP_AGENT_SECRET': 'scholarship_agent', // S2S telemetry client
    'AUTO_COM_CENTER_SERVICE_SECRET': 'auto-com-center-service',
    'AUTO_PAGE_MAKER_SERVICE_SECRET': 'auto-page-maker-service',
    'PROVIDER_REGISTER_M2M_SECRET': 'provider-register-m2m',
    'REVIEWER_PORTAL_M2M_SECRET': 'reviewer-portal-m2m',
    'ADMIN_DASHBOARD_M2M_SECRET': 'admin-dashboard-m2m',
    'PROVIDER_REGISTER_SECRET': 'provider-register',
    'STUDENT_PILOT_SECRET': 'student-pilot',
  };

  // Validate all required secrets are present
  const missingSecrets: string[] = [];
  for (const [envVar, clientId] of Object.entries(requiredSecrets)) {
    if (!process.env[envVar] || process.env[envVar] === '') {
      missingSecrets.push(`${envVar} (for ${clientId})`);
    }
  }

  if (missingSecrets.length > 0) {
    const errorMsg = `🚨 SECURITY: Missing required OAuth client secrets in Replit Secrets:\n${missingSecrets.map(s => `  - ${s}`).join('\n')}\n\nAdd these secrets to Replit Secrets before starting the application.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  console.log('✅ SECURITY: All OAuth client secrets validated (non-empty)');

  // 🔒 CEO P0 NOTE: Secrets kept plaintext in-memory for oidc-provider string comparison
  // Hashed only when seeding to database for at-rest security
  // This is acceptable because in-memory config never persisted to disk
  return [
    {
      client_id: 'provider-register',
      client_secret: process.env.PROVIDER_REGISTER_SECRET!,
      redirect_uris: [
        'https://provider-register-jamarrlmayes.replit.app/callback',
        'https://provider-register-jamarrlmayes.replit.app/oidc/callback',
        'https://provider-register-jamarrlmayes.replit.app/api/callback',
        'https://provider-register-jamarrlmayes.replit.app/auth/callback',
        'https://provider-register-jamarrlmayes.replit.app/api/auth/callback',
      ],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    },
    {
      client_id: 'student-pilot',
      client_secret: process.env.STUDENT_PILOT_SECRET!,
      redirect_uris: [
        'https://student-pilot-jamarrlmayes.replit.app/callback',
        'https://student-pilot-jamarrlmayes.replit.app/oidc/callback',
        'https://student-pilot-jamarrlmayes.replit.app/api/callback',
        'https://student-pilot-jamarrlmayes.replit.app/auth/callback',
        'https://student-pilot-jamarrlmayes.replit.app/api/auth/callback',
      ],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    },
    {
      client_id: 'scholarship-sage-m2m',
      client_secret: process.env.M2M_SCHOLARSHIP_SAGE_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'read:scholarships read:users read:recommendations export:data',
    },
    {
      client_id: 'scholarship-api-service',
      client_secret: process.env.SCHOLARSHIP_API_SERVICE_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'read:scholarships write:scholarships read:applications',
    },
    {
      client_id: 'scholarship-agent-service',
      client_secret: process.env.SCHOLARSHIP_AGENT_SERVICE_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'read:scholarships send:notifications',
    },
    {
      client_id: 'auto-com-center-service',
      client_secret: process.env.AUTO_COM_CENTER_SERVICE_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'send:notifications',
    },
    {
      client_id: 'auto-page-maker-service',
      client_secret: process.env.AUTO_PAGE_MAKER_SERVICE_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'read:scholarships generate:assets export:data',
    },
    {
      client_id: 'provider-register-m2m',
      client_secret: process.env.PROVIDER_REGISTER_M2M_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'read:providers write:providers',
    },
    {
      client_id: 'reviewer-portal-m2m',
      client_secret: process.env.REVIEWER_PORTAL_M2M_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'read:applications review:applications',
    },
    {
      client_id: 'admin-dashboard-m2m',
      client_secret: process.env.ADMIN_DASHBOARD_M2M_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'admin:read admin:write introspect:tokens',
    },
    // S2S Auth Client: scholarship_agent for telemetry (CEO directive: T+2 hours)
    {
      client_id: 'scholarship_agent',
      client_secret: process.env.SCHOLARSHIP_AGENT_SECRET!,
      redirect_uris: [],
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'telemetry:write',
    }
  ];
}

// 🎯 CEO GATE 0: Seed all service clients into database before Provider instantiation
// This ensures all 8 M2M clients are available via PostgresAdapter.find()
// 🔐 CEO P0: Hash client secrets before DB storage (at-rest security)
async function ensureServiceClientsSeeded(): Promise<void> {
  try {
    const { hashClientSecret } = await import('./utils/secretsManagement');
    const clients = buildServiceClients();
    console.log(`🌱 SEEDING: Starting database seed for ${clients.length} OAuth clients...`);
    
    for (const client of clients) {
      // 🔐 CEO P0: Hash client secret before storing in DB (at-rest security)
      const hashedSecret = client.client_secret 
        ? await hashClientSecret(client.client_secret)
        : null;
      
      // Create payload with hashed secret for DB storage
      const dbPayload = {
        ...client,
        client_secret: hashedSecret,
        _secret_metadata: hashedSecret ? {
          hashed_at: new Date().toISOString(),
          hash_algorithm: 'bcrypt',
          salt_rounds: 12
        } : null
      };
      
      await db.insert(oidcModels).values({
        id: client.client_id,
        type: 'Client',
        payload: dbPayload,
        grantId: null,
        userCode: null,
        uid: null,
        expiresAt: null,
      }).onConflictDoUpdate({
        target: oidcModels.id,
        set: {
          payload: dbPayload,
        }
      });
      
      console.log(`✅ SEEDED with bcrypt hash: ${client.client_id}`);
    }
    
    console.log(`✅ DATABASE SEED COMPLETE: All ${clients.length} OAuth clients ready with hashed secrets`);
  } catch (error) {
    console.error('❌ DATABASE SEED FAILED:', error);
    throw error;
  }
}

// JWT signing configuration
// Note: All keys are validated at startup in environmentValidation.ts
const jwks = {
  keys: [
    {
      kty: 'RSA',
      kid: process.env.OIDC_SIGNING_KID!, // Required - validated at startup
      use: 'sig',
      alg: 'RS256',
      n: process.env.OIDC_RSA_PUBLIC_KEY_N!, // Required - validated at startup
      e: process.env.OIDC_RSA_PUBLIC_KEY_E!, // Required - validated at startup
      d: process.env.OIDC_RSA_PRIVATE_KEY_D!, // Required - validated at startup
      p: process.env.OIDC_RSA_PRIVATE_KEY_P!, // Required - validated at startup
      q: process.env.OIDC_RSA_PRIVATE_KEY_Q!, // Required - validated at startup
      dp: process.env.OIDC_RSA_PRIVATE_KEY_DP!, // Required - validated at startup
      dq: process.env.OIDC_RSA_PRIVATE_KEY_DQ!, // Required - validated at startup
      qi: process.env.OIDC_RSA_PRIVATE_KEY_QI!, // Required - validated at startup
    }
  ]
};

// 🎯 CEO GATE 0: Database adapter mode for all 8 M2M clients
// Nov 14 FIX: Switch to adapter-based client loading to ensure all 8 clients register
// Static mode was failing because env validation cleared secrets before IIFE executed
const OAUTH_STATIC_ONLY = false; // Use database adapter for reliable client loading

// 🎯 CEO GATE 0: Adapter configuration for database-backed client loading
// When OAUTH_STATIC_ONLY=false, PostgresAdapter handles all models including "Client"
// When OAUTH_STATIC_ONLY=true, no adapter is used (static configuration.clients only)
const adapterConfig = OAUTH_STATIC_ONLY ? {} : {
  adapter: (name: string) => {
    console.log(`🔧 ADAPTER FACTORY: ${name} model requested (database mode)`);
    // 🔐 ARCHITECT FIX: Return instance, not class constructor
    // Factory function needs to return instantiated adapter object
    return new PostgresAdapter(name);
  },
};

const configuration: any = {
  ...adapterConfig,
  
  // 🔧 CEO DIRECTIVE (Nov 7, 17:45 UTC): Enable 300s cache for discovery/JWKS stability
  // Required for edge cache compatibility and variance reduction
  clientCacheDuration: 300, // 300s TTL per CEO gate directive
  
  // 🔧 PROXY TRUST: REQUIRED for Replit reverse proxy environment
  // Without proxy: true, oidc-provider treats requests as HTTP, causing:
  // - Secure cookies (SameSite=None) to be rejected  
  // - interactionDetails() to fail with "Session Expired" error
  // The issuer is explicitly set at Provider instantiation, so proxy=true is safe.
  proxy: true,
  
  // 🔍 DEBUG MODE: Enable detailed error logging
  debug: true,
  
  // Production JWKS configuration
  jwks,
  
  // 🎯 CEO GATE 0: Conditional client attachment (only in static mode)
  // When OAUTH_STATIC_ONLY=true, attach static clients array
  // When OAUTH_STATIC_ONLY=false, clients are loaded from database via adapter
  ...(OAUTH_STATIC_ONLY ? { clients: buildServiceClients() } : {}),
  
  // Supported features
  features: {
    devInteractions: { enabled: false }, // Disable dev interactions in production
    deviceFlow: { enabled: false },
    introspection: { enabled: true },
    jwtIntrospection: { enabled: true }, // 🔐 P1 FIX: Enable JWT introspection for JWT access tokens (validates by signature, not DB lookup)
    revocation: { enabled: true },
    rpInitiatedLogout: { enabled: true },
    clientCredentials: { enabled: true }, // 🔒 CEO DIRECTIVE: Enable M2M for scholarship_sage
    
    // CEO NOV 13 Gate 0: Enable JWT access tokens via Resource Indicators
    resourceIndicators: {
      enabled: true,
      // Default resource for requests without explicit resource parameter
      // CEO P0: RFC 8707 requires absolute URI (https:// or urn:)
      defaultResource(ctx: any, client: any, oneOf: any) {
        return 'urn:scholar-platform'; // URN format per RFC 8707
      },
      // Configure all tokens as JWT format with RS256 signing
      getResourceServerInfo(ctx: any, resourceIndicator: any, client: any) {
        // 🎯 CEO E2E VALIDATION: Define all available M2M scopes in standard OAuth2 format
        // Uses action:resource format per RFC 6749 (e.g., read:scholarships not scholarships:read)
        const allM2MScopes = [
          // scholarship_sage scopes
          'read:scholarships', 'read:users', 'read:recommendations', 'export:data',
          // scholarship_api scopes
          'write:scholarships', 'read:applications', 'write:applications',
          // scholarship_agent scopes
          'send:notifications',
          // auto_page_maker scopes
          'generate:assets',
          // provider_register scopes
          'read:providers', 'write:providers',
          // reviewer_portal scopes
          'review:applications',
          // admin_dashboard scopes
          'admin:read', 'admin:write', 'introspect:tokens'
        ].join(' ');
        
        return {
          scope: allM2MScopes, // All available M2M scopes for this resource
          audience: resourceIndicator || 'urn:scholar-platform', // Fallback to default
          accessTokenTTL: 5 * 60, // 🎯 GATE 0: 300s (5 min) for M2M JWT tokens
          accessTokenFormat: 'jwt', // ✅ CRITICAL: JWT instead of opaque
          jwt: {
            sign: { alg: 'RS256' } // RS256 signing per Gate 0 requirement
          }
        };
      }
    },
    // 🔒 EXECUTIVE DIRECTIVE: Security features enabled
  },
  
  // 🎯 ARCHITECT FIX V2: Inject scope AND permissions for M2M tokens
  // CRITICAL: When accessTokenFormat='jwt' under resourceIndicators, extraAccessTokenClaims is bypassed
  // Solution: Use formats.customizers.jwt to inject RBAC claims for client_credentials tokens
  formats: {
    customizers: {
      async jwt(ctx: any, token: any, jwt: any) {
        // DEBUG: Log what we receive
        console.log('🔧 JWT CUSTOMIZER CALLED:', {
          'token.kind': token.kind,
          'token.accountId': token.accountId,
          'token.clientId': token.clientId,
          'token.scope': token.scope,
          'token.scopes': token.scopes ? [...token.scopes] : undefined,
          'jwt.payload keys': Object.keys(jwt.payload)
        });
        
        // CRITICAL: oidc-provider doesn't include scope claim by default in JWT access tokens
        // We must manually add it from token.scope (which is populated from getResourceServerInfo)
        if (token.scope) {
          console.log('✅ Adding scope to JWT payload:', token.scope);
          jwt.payload.scope = token.scope;
        } else if (token.scopes && token.scopes.size > 0) {
          // Alternative: try using token.scopes (Set object)
          const scopeString = [...token.scopes].join(' ');
          console.log('✅ Adding scope from token.scopes:', scopeString);
          jwt.payload.scope = scopeString;
        } else {
          console.log('⚠️  No scope found in token object');
        }
        
        // 🎯 CEO E2E VALIDATION: Add scope + permissions + roles for M2M tokens
        const clientId = ctx?.oidc?.client?.clientId;
        
        if (!token.accountId && clientId) {
          // Get client's allowed scopes from CLIENT_ALLOWED_SCOPES mapping
          const clientAllowedScopes = CLIENT_ALLOWED_SCOPES[clientId] || [];
          
          // Determine which scopes to use: ctx.oidc.params.scope if present, otherwise client defaults
          let requestedScopes: string[] = [];
          const requestedScopeString = ctx?.oidc?.params?.scope || token.scope;
          if (requestedScopeString && requestedScopeString.trim()) {
            requestedScopes = requestedScopeString.split(' ').filter((s: string) => s && s !== 'openid');
          } else {
            requestedScopes = clientAllowedScopes;
          }
          
          // Validate requested scopes against allowlist
          const validation = validateClientScopes(clientId, requestedScopes);
          const approvedScopes = validation.valid ? validation.allowedScopes : clientAllowedScopes;
          
          // ✅ ARCHITECT FIX: Always set scope claim from approved scopes (fixes resourceIndicators path)
          // CRITICAL: When resource parameter is provided, token.scope is undefined but we still need the claim
          jwt.payload.scope = approvedScopes.join(' ');
          console.log(`✅ Set JWT scope claim from approved scopes (${approvedScopes.length} scopes): ${jwt.payload.scope}`);
          
          // Derive permissions from approved scopes using getScopePermissions()
          const permissions = getScopePermissions(approvedScopes);
          
          // Inject RBAC claims into JWT payload (ORCHESTRATION REQUIREMENT)
          jwt.payload.role = 'service';  // MASTER PROMPT: Single role claim for M2M
          jwt.payload.roles = ['service'];
          jwt.payload.permissions = permissions;
          jwt.payload.client_id = clientId;
        }
      }
    }
  },
  
  // Token settings (CEO NOV 13 DIRECTIVE: 5min for client_credentials, 15min for user tokens)
  ttl: {
    AccessToken: (ctx: any, token: any, client: any) => {
      // 🎯 ARCHITECT FIX: Detect client_credentials by absence of accountId
      // Client credentials tokens have NO user account (accountId is undefined)
      // This is more reliable than checking grant_type or other properties
      if (!token.accountId) {
        return 5 * 60; // 300 seconds - Gate 0 requirement for M2M tokens
      }
      // User tokens: 15 minutes (existing requirement)
      return 15 * 60; // 900 seconds
    },
    AuthorizationCode: 10 * 60, // 10 minutes
    IdToken: 60 * 60, // 1 hour
    RefreshToken: 24 * 60 * 60, // 24 hours
  },
  
  // 🔒 CEO TASK 5: Refresh token security (rotation + reuse detection)
  rotateRefreshToken: (ctx: any) => {
    // Always rotate refresh tokens for one-time use security
    return true;
  },
  
  // 🔒 EXECUTIVE DIRECTIVE: Refresh token security logging (via events)
  // Note: Token audit logging implemented via event handlers below
  
  // Supported scopes and claims (CEO NOV 13: RBAC with permissions)
  scopes: [
    'openid', 
    'email', 
    'profile', 
    'roles',
    // M2M scopes for scholarship_sage
    'read:scholarships',           // Read scholarship data
    'read:students_anonymized',    // Read anonymized student data for matching
    'sage.read',                   // Sage service read access
    // M2M scopes for scholarship_api
    'api.read',                    // API read access
    'api.write',                   // API write access
    // M2M scopes for scholarship_agent
    'agent.jobs.read',             // Agent jobs read
    'agent.jobs.write',            // Agent jobs write
    // M2M scopes for auto_com_center
    'notifications.trigger',       // Trigger notifications
    // M2M scopes for auto_page_maker
    'content.generate',            // Generate content
    // M2M scopes for provider_register_m2m (CEO NOV 13: Gate 0 requirement)
    'read:providers',              // Read provider data
    'write:providers',             // Write provider data
    'manage:providers',            // Full provider management
    // M2M scopes for reviewer_portal_m2m
    'read:applications',           // Read application data
    'write:reviews',               // Write reviews
    // M2M scopes for admin_dashboard_m2m
    'admin:*',                     // Full admin access (wildcard)
  ],
  claims: {
    openid: ['sub', 'iss', 'aud', 'exp', 'iat', 'jti'],
    email: ['email', 'email_verified'],
    profile: ['name', 'first_name', 'last_name', 'profile_image_url'],
    roles: ['roles', 'permissions'],  // Include permissions in roles scope
  },
  
  // PKCE enforcement
  // CEO ORDER: Conditional PKCE - required for authorization_code, not required for client_credentials
  pkce: {
    methods: ['S256'],
    required: (ctx: any, client: any) => {
      // M2M clients (client_credentials grant) don't use PKCE
      const grantType = ctx?.oidc?.params?.grant_type;
      if (grantType === 'client_credentials') {
        return false;
      }
      // All other flows require PKCE S256
      return true;
    },
  },
  
  // Response types
  responseTypes: ['code'], // Authorization Code flow only
  
  // Grant types
  // CEO ORDER: Added client_credentials for M2M authentication
  grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
  
  // 🔧 TRACK A FIX: Direct discovery override to advertise client_credentials
  // oidc-provider 9.5.1 doesn't auto-advertise client_credentials even when enabled
  // CEO authorization: Nov 7, 12:00 UTC - Direct configuration override
  discovery: {
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'client_credentials'
    ]
  },
  
  // Subject identifier type
  subjectTypes: ['public'],
  
  // Token endpoint auth methods
  tokenEndpointAuthMethods: ['client_secret_post', 'client_secret_basic'],
  
  // Custom user info and claims resolution (CEO NOV 13: RBAC with permissions)
  async findAccount(ctx: any, sub: string) {
    try {
      // Handle service principals (client_credentials grant)
      // Note: extraTokenClaims handles permissions for service tokens
      if (sub.startsWith('service:')) {
        const serviceName = sub.replace('service:', '');
        return {
          accountId: sub,
          async claims() {
            return {
              sub,
              roles: ['service'],
              // Permissions will be added by extraTokenClaims based on scopes
            };
          },
        };
      }
      
      // Handle user accounts
      const user = await storage.getUser(sub);
      if (!user) return undefined;
      
      const userRole = user.role || 'student';
      
      return {
        accountId: sub,
        async claims() {
          return {
            sub: user.id,
            email: user.email,
            email_verified: user.isEmailVerified,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
            first_name: user.firstName,
            last_name: user.lastName,
            profile_image_url: user.profileImageUrl,
            role: userRole,  // MASTER PROMPT: Single role claim (student|provider|admin)
            roles: [userRole],  // Keep for backward compatibility
            permissions: getRolePermissions(userRole),
          };
        },
      };
    } catch (error) {
      logger.error('Error finding account', error as Error);
      return undefined;
    }
  },
  
  // MASTER PROMPT: Extra ACCESS TOKEN claims for client_credentials (service-to-service)
  // ARCHITECT FIX: Use extraAccessTokenClaims (not extraTokenClaims) for M2M tokens
  // extraTokenClaims only fires for user-account tokens; client_credentials has no accountId
  extraAccessTokenClaims(ctx: any, token: any) {
    // Only apply to client_credentials grants (M2M service tokens)
    if (ctx?.oidc?.params?.grant_type !== 'client_credentials') {
      return {};
    }
    
    const clientId = ctx?.oidc?.client?.clientId;
    if (!clientId) return {};
    
    console.log(`🔍 extraAccessTokenClaims called for ${clientId}, token.scope:`, token.scope);
    
    // Get requested scopes from the token OR use client's default scopes
    let requestedScopes: string[] = [];
    if (token.scope && token.scope.trim()) {
      requestedScopes = token.scope.split(' ').filter((s: string) => s && s !== 'openid');
      console.log(`📋 Scopes from token.scope: ${requestedScopes.join(' ')}`);
    }
    
    // If no valid scopes found, use client's allowed scopes as default (MASTER PROMPT requirement)
    if (requestedScopes.length === 0 && CLIENT_ALLOWED_SCOPES[clientId]) {
      requestedScopes = CLIENT_ALLOWED_SCOPES[clientId];
      console.log(`📋 Using default scopes for ${clientId}:`, requestedScopes.join(' '));
    }
    
    // CRITICAL SECURITY: Validate scopes against client-specific allowlist
    const validation = validateClientScopes(clientId, requestedScopes);
    
    if (!validation.valid) {
      // Log security violation
      const invalidScopes = requestedScopes.filter((s: string) => !CLIENT_ALLOWED_SCOPES[clientId]?.includes(s));
      logger.error('SECURITY: Client requested unauthorized scopes', new Error(`Client ${clientId} requested unauthorized scopes`), {
        clientId,
        requestedScopes,
        allowedScopes: CLIENT_ALLOWED_SCOPES[clientId],
        invalidScopes
      });
      
      // Throw error to reject token issuance
      throw new Error(`invalid_scope: Client ${clientId} is not authorized for requested scopes`);
    }
    
    // Use validated scopes
    const approvedScopes = validation.allowedScopes.length > 0 
      ? validation.allowedScopes 
      : CLIENT_ALLOWED_SCOPES[clientId] || [];
    
    // CRITICAL: Derive permissions from approved scopes only
    const permissions = getScopePermissions(approvedScopes);
    
    // Add RBAC claims for service tokens (MASTER PROMPT compliant)
    return {
      sub: clientId,  // Use clientId as sub (not service:prefix)
      role: 'service',  // MASTER PROMPT: Single role claim for M2M tokens
      roles: ['service'],  // Keep for backward compatibility
      permissions,
      scope: approvedScopes.join(' '),  // REQUIRED: Include scopes in token
      client_id: clientId,
    };
  },
  
  // Interaction handling (login/consent)
  interactions: {
    url(ctx: any, interaction: any) {
      return `/oidc/interaction/${interaction.uid}`;
    },
  },
  
  // Custom route definitions (aligned with discovery endpoints)
  routes: {
    authorization: '/auth',
    token: '/token',
    userinfo: '/userinfo',
    jwks: '/.well-known/jwks.json',
    end_session: '/logout',
  },
  
  // Security settings - CRITICAL for production cookie handling
  cookies: {
    names: {
      session: 'oidc_session',
      interaction: 'oidc_interaction',
      resume: 'oidc_resume',
      state: 'oidc_state',
    },
    long: {
      signed: true,
      secure: true,  // Always true for Replit HTTPS proxy
      httpOnly: true,
      sameSite: 'none' as const,  // Required for cross-site OAuth flow
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
    short: {
      signed: true,
      secure: true,  // Always true for Replit HTTPS proxy
      httpOnly: true,
      sameSite: 'none' as const,  // Required for cross-site OAuth flow
      maxAge: 10 * 60 * 1000, // 10 minutes
    },
    keys: process.env.OIDC_COOKIE_KEYS 
      ? process.env.OIDC_COOKIE_KEYS.split(',')
      : (process.env.NODE_ENV === 'production' 
          ? (() => { throw new Error('OIDC_COOKIE_KEYS must be set in production') })()
          : ['dev-fallback-key-not-for-production']),
  },
  
  // 🔧 CUSTOM ERROR RENDERING - CEO NOV 7 REQUIREMENT
  // Override oidc-provider's default error pages to show correct issuer with /oidc suffix
  // This fixes the residual issuer mismatch on library-generated error pages
  async renderError(ctx: any, out: any, error: any) {
    const issuer = getIssuerUrl(); // Use unified issuer function
    
    // Log detailed error info for diagnosis
    logger.error('OIDC renderError called', {
      error: out.error,
      errorDescription: out.error_description,
      errorInstance: error?.message || 'no error instance',
      errorStack: error?.stack?.substring(0, 500) || 'no stack',
      requestPath: ctx.path,
      requestMethod: ctx.method,
      hasCookies: !!ctx.cookies,
      sessionCookie: ctx.cookies?.get('oidc_session') ? 'present' : 'missing',
      interactionCookie: ctx.cookies?.get('oidc_interaction') ? 'present' : 'missing',
      resumeCookie: ctx.cookies?.get('oidc_resume') ? 'present' : 'missing',
    } as any);
    
    // Extract more error details if available
    const errorMsg = error?.message || out.error_description || 'Oops! Something went wrong';
    const errorType = error?.constructor?.name || 'UnknownError';
    
    ctx.type = 'html';
    ctx.body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Error - ScholarshipAI</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .error-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 600px;
      width: 100%;
      padding: 40px;
      text-align: left;
    }
    h1 {
      color: #dc2626;
      font-size: 24px;
      margin: 0 0 20px 0;
    }
    .error-details {
      background: #f9fafb;
      border-left: 4px solid #dc2626;
      padding: 16px;
      margin: 20px 0;
      font-family: "Monaco", "Courier New", monospace;
      font-size: 14px;
      overflow-x: auto;
    }
    .error-details pre {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .error-details strong {
      color: #374151;
    }
    .info-text {
      color: #6b7280;
      font-size: 14px;
      line-height: 1.6;
      margin: 20px 0;
    }
    .back-link {
      display: inline-block;
      background: #667eea;
      color: white;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      margin-top: 20px;
      transition: background 0.2s;
    }
    .back-link:hover {
      background: #5568d3;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>🔐 Authorization Error</h1>
    <p class="info-text">
      The authorization request could not be completed. Please check the error details below and contact your application administrator if the problem persists.
    </p>
    <div class="error-details">
      <pre><strong>error</strong>: ${out.error || 'unknown_error'}</pre>
      <pre><strong>error_description</strong>: ${errorMsg}</pre>
      <pre><strong>error_type</strong>: ${errorType}</pre>
      ${out.state ? `<pre><strong>state</strong>: ${out.state}</pre>` : ''}
      <pre><strong>iss</strong>: ${issuer}</pre>
    </div>
    <p class="info-text">
      If you believe this is an error, please contact support with the information above.
    </p>
    <a href="/" class="back-link">← Return to Home</a>
  </div>
</body>
</html>`;
  },
};

// Initialize OIDC Provider
export let oidcProvider: Provider;

// 🔧 CEO FIX: Module-level runtime client cache for adapter-based lookup
// When clients[] is passed to Provider constructor, oidc-provider short-circuits adapter calls
// Solution: Store clients here, omit from constructor, force adapter('Client') calls
let runtimeClients: any[] = [];

// 🚀 PERFORMANCE: Koa-level discovery cache (300s TTL per CEO directive)
// Architect guidance: Cache at Koa layer since provider.callback() bypasses Express middleware
interface DiscoveryCache {
  body: any;
  timestamp: number;
  etag: string;
}
let discoveryCache: DiscoveryCache | null = null;
const DISCOVERY_CACHE_TTL = 300 * 1000; // 300 seconds

export async function initializeOIDCProvider() {
  try {
    // 🎯 ARCHITECT FIX: Early return guard to prevent multiple initializations
    // Prevents warm reloads from falling through to database path (TRACK A)
    if (oidcProvider) {
      console.log('✅ OIDC Provider already initialized, returning existing instance');
      return oidcProvider;
    }
    
    // 🎯 CEO GATE 0: Seed all service clients into database (database adapter mode only)
    // This must run BEFORE Provider instantiation to ensure PostgresAdapter can find clients
    if (!OAUTH_STATIC_ONLY) {
      console.log('🌱 DATABASE MODE: Seeding all 10 OAuth clients before Provider instantiation...');
      await ensureServiceClientsSeeded();
      
      // 🔐 CEO P0: Startup integrity check - validate env secrets match DB hashes
      console.log('🔐 Running startup integrity check for client secrets...');
      const { performStartupIntegrityCheck } = await import('./utils/startupIntegrityCheck');
      const serviceClients = buildServiceClients();
      await performStartupIntegrityCheck(serviceClients);
    }
    
    // 🎯 CEO TRACK B: Static-only mode (bypass DB for clean AUTH_GREEN validation)
    if (OAUTH_STATIC_ONLY) {
      console.log('🎯 TRACK B ACTIVE: OAUTH_STATIC_ONLY=true - Using pure static client configuration');
      console.log('🎯 TRACK B: Skipping database client load, using configuration.clients only');
      console.log('🎯 TRACK B: Adapter disabled, no precedence conflicts');
      
      // Skip all DB loading and fallback logic - use configuration.clients as-is
      console.log('🎯 INSTANTIATING PROVIDER with', configuration.clients.length, 'static clients (Track B mode)');
      console.log('🔧 Using issuer URL:', ISSUER_URL);
      console.log('🔬 DEBUG: features.clientCredentials =', JSON.stringify(configuration.features?.clientCredentials));
      console.log('🔬 DEBUG: grantTypes =', JSON.stringify(configuration.grantTypes));
      console.log('🔬 DEBUG: M2M client grant_types =', JSON.stringify(configuration.clients.find((c: any) => c.client_id === 'scholarship-sage-m2m')?.grant_types));
      
      oidcProvider = new Provider(ISSUER_URL, configuration);
      
      // 🔒 CRITICAL: Trust proxy for Replit HTTPS environment
      // Without this, secure cookies are dropped and session lookup fails → server_error
      oidcProvider.proxy = true;
      console.log('✅ PROVIDER INSTANTIATED SUCCESSFULLY (Track B mode) with', configuration.clients.length, 'static clients');
      console.log('🔒 Provider proxy trust enabled: oidcProvider.proxy =', oidcProvider.proxy);
      
      // 🔍 DEBUG: Log first 16 chars of each M2M client secret to verify loading
      console.log('🔍 DEBUG: M2M Client Secret Preview (first 16 chars):');
      const m2mClients = ['scholarship-sage-m2m', 'scholarship-api-service', 'scholarship-agent-service', 'auto-com-center-service', 'auto-page-maker-service', 'provider-register-m2m', 'reviewer-portal-m2m', 'admin-dashboard-m2m'];
      m2mClients.forEach(clientId => {
        const client = configuration.clients.find((c: any) => c.client_id === clientId);
        if (client) {
          console.log(`  ${clientId}: ${(client.client_secret || '').substring(0, 16)}...`);
        }
      });
      
      // 🎯 ARCHITECT FIX V2: Use oidcProvider.use() directly - Provider IS the Koa app (deprecation warning confirmed)
      // Deprecation: ".app getter is deprecated. The Provider instance is now the Koa app itself"
      // Solution: oidcProvider.use() instead of oidcProvider.app.use()
      console.log('🔧 REGISTERING DISCOVERY MIDDLEWARE DIRECTLY ON PROVIDER...');
      const startupMiddlewareCount = (oidcProvider as any).middleware ? (oidcProvider as any).middleware.length : 0;
      console.log('🔍 Middleware count BEFORE registration:', startupMiddlewareCount);
      
      oidcProvider.use(async (ctx: any, next: any) => {
        // 🚀 PERFORMANCE: Check cache for discovery endpoint BEFORE calling next()
        const isDiscoveryPath = ctx.path === '/.well-known/openid-configuration';
        
        if (isDiscoveryPath && ctx.method === 'GET') {
          const now = Date.now();
          
          // Check if we have a valid cache
          if (discoveryCache && (now - discoveryCache.timestamp) < DISCOVERY_CACHE_TTL) {
            // Check ETag for 304 Not Modified
            const clientETag = ctx.headers['if-none-match'];
            if (clientETag === discoveryCache.etag) {
              ctx.status = 304;
              console.log('🚀 DISCOVERY CACHE: 304 Not Modified (ETag match)');
              return; // Early return, skip next()
            }
            
            // Serve cached response
            ctx.status = 200;
            ctx.body = discoveryCache.body;
            ctx.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
            ctx.set('Expires', new Date(discoveryCache.timestamp + DISCOVERY_CACHE_TTL).toUTCString());
            ctx.set('ETag', discoveryCache.etag);
            ctx.set('X-Cache', 'HIT');
            ctx.set('Content-Type', 'application/json; charset=utf-8');
            console.log('🚀 DISCOVERY CACHE: HIT (served from cache, age:', now - discoveryCache.timestamp, 'ms)');
            return; // Early return, skip next()
          } else {
            console.log('🚀 DISCOVERY CACHE: MISS (cache invalid or expired)');
          }
        }
        
        // Log ALL requests to verify middleware is executing
        console.log('🔍 KOA MIDDLEWARE HIT:', {
          path: ctx.path,
          method: ctx.method,
          url: ctx.url,
          hasOidc: !!ctx.oidc,
          oidcRoute: ctx.oidc?.route
        });
        
        await next();
        
        // Check for discovery endpoint after response
        console.log('🔍 AFTER NEXT:', {
          path: ctx.path,
          status: ctx.status,
          hasBody: !!ctx.body,
          oidcRoute: ctx.oidc?.route
        });
        
        // Check multiple conditions to catch discovery endpoint
        const isDiscovery = ctx.path === '/.well-known/openid-configuration' || 
                           ctx.oidc?.route === 'discovery';
        
        if (isDiscovery && ctx.method === 'GET' && ctx.status === 200 && ctx.body) {
          console.log('🔧 DISCOVERY RESPONSE DETECTED:', {
            hasBody: !!ctx.body,
            hasGrantTypes: !!ctx.body.grant_types_supported,
            grantTypes: ctx.body.grant_types_supported
          });
          
          if (!ctx.body.grant_types_supported?.includes('client_credentials')) {
            console.log('🔧 DISCOVERY FIX: Adding client_credentials to grant_types_supported');
            ctx.body.grant_types_supported = ctx.body.grant_types_supported || [];
            ctx.body.grant_types_supported.push('client_credentials');
            console.log('✅ DISCOVERY FIX APPLIED:', ctx.body.grant_types_supported);
          } else {
            console.log('✅ client_credentials already present in discovery');
          }
          
          // 🚀 PERFORMANCE: Cache the discovery response for 300s
          const now = Date.now();
          const etag = `"discovery-${now}"`;
          discoveryCache = {
            body: ctx.body,
            timestamp: now,
            etag
          };
          
          // Set cache headers on the response
          ctx.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
          ctx.set('Expires', new Date(now + DISCOVERY_CACHE_TTL).toUTCString());
          ctx.set('ETag', etag);
          ctx.set('X-Cache', 'MISS');
          
          console.log('🚀 DISCOVERY CACHE: WRITE (cached for 300s)');
        }
      });
      
      const finalMiddlewareCount = (oidcProvider as any).middleware ? (oidcProvider as any).middleware.length : 0;
      console.log('✅ DISCOVERY MIDDLEWARE REGISTERED DIRECTLY ON PROVIDER');
      console.log('🔍 Middleware count AFTER registration:', finalMiddlewareCount);
      console.log('🔍 Middleware added:', finalMiddlewareCount > startupMiddlewareCount ? 'YES ✅' : 'NO ❌');
      
      // Verification
      const testClient = await oidcProvider.Client.find('provider-register');
      console.log('✅ TRACK B VERIFICATION: Client.find("provider-register")', testClient ? 'FOUND' : 'NOT FOUND');
      if (testClient) {
        console.log('✅ Client details:', { 
          client_id: testClient.clientId, 
          redirect_uris_count: (testClient as any).redirectUris?.length 
        });
      }
      
      logger.info('OIDC Provider initialized successfully', { 
        issuer: ISSUER_URL, 
        clientsCount: configuration.clients.length,
        mode: 'static-only'
      });
      logger.info('OIDC provider initialized successfully');
      return oidcProvider; // 🎯 CEO FIX: Return provider instance for Track B
    }
    
    // 🔧 CRITICAL FIX: Load clients FIRST, then create Provider with populated clients
    // CEO NO-GO FIX: Normalize client metadata to support BOTH snake_case AND camelCase
    // oidc-provider expects camelCase internally (clientId, redirectUris) but we use snake_case in DB
    console.log('🔧 TRACK A: Loading clients from database (adapter mode)');
    const clients = await storage.getAllOidcClients();
    const mappedClients = clients.map(client => ({
      // Snake_case (for compatibility with existing code)
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uris: client.redirectUris as string[],
      post_logout_redirect_uris: client.postLogoutRedirectUris as string[],
      response_types: client.responseTypes as string[],
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      // CamelCase (for oidc-provider internal expectations)
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUris: client.redirectUris as string[],
      postLogoutRedirectUris: client.postLogoutRedirectUris as string[],
      responseTypes: client.responseTypes as string[],
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      grantTypes: (client.responseTypes as string[])?.includes('code') ? ['authorization_code', 'refresh_token'] : ['client_credentials'],
      // NOTE: scope is enforced at provider level, not client level in static config
    }));
    
    // 🚨 CEO FALLBACK DIRECTIVE: REPLACE database client with guarded static client for provider-register
    // CONSTRAINTS: Production URIs only, PKCE S256 enforced, 15m tokens, 24h max duration
    // EXPIRY: Feature flag OAUTH_FALLBACK_ENABLED (defaults OFF after 24h window)
    // CEO P0 ESCALATION: Extended expiry to support Gate A chain execution
    const FALLBACK_ENABLED = process.env.OAUTH_FALLBACK_ENABLED !== 'false'; // Default ON, manual disable required
    const FALLBACK_EXPIRY = new Date('2025-11-06T23:59:59Z'); // Extended for Gate A execution
    const now = new Date();
    
    if (FALLBACK_ENABLED && now < FALLBACK_EXPIRY) {
      console.log('🚨 CEO FALLBACK ACTIVATED: Replacing database provider-register with static config (expires:', FALLBACK_EXPIRY.toISOString(), ')');
      
      // Find database client to get client_secret
      const dbClient = clients.find(c => c.clientId === 'provider-register');
      if (!dbClient) {
        throw new Error('FALLBACK FAILED: provider-register not found in database');
      }
      
      // REMOVE database version (prevent duplicates)
      const dbIndex = mappedClients.findIndex((c: any) => c.client_id === 'provider-register');
      if (dbIndex >= 0) {
        console.log('🔧 FALLBACK: Removing database provider-register at index', dbIndex);
        mappedClients.splice(dbIndex, 1);
      }
      
      // Add static client with production URIs + CEO-mandated staging URIs
      // CEO DIRECTIVE: Added /login/callback and localhost:3000/auth/callback for Order B testing
      // CEO NO-GO FIX: Include BOTH snake_case AND camelCase for oidc-provider compatibility
      const redirectUris = [
        'https://provider-register-jamarrlmayes.replit.app/callback',
        'https://provider-register-jamarrlmayes.replit.app/oidc/callback',
        'https://provider-register-jamarrlmayes.replit.app/api/callback',
        'https://provider-register-jamarrlmayes.replit.app/auth/callback',
        'https://provider-register-jamarrlmayes.replit.app/login/callback', // CEO: Added for Order B
        'http://localhost:3000/auth/callback', // CEO: Added for staging/dev testing
        'https://provider.scholarshipai.com/api/callback',
        'https://provider.scholarshipai.dev/api/callback',
      ];
      mappedClients.push({
        // Snake_case
        client_id: 'provider-register',
        client_secret: dbClient.clientSecret,
        redirect_uris: redirectUris,
        post_logout_redirect_uris: dbClient.postLogoutRedirectUris as string[],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        // CamelCase (for oidc-provider)
        clientId: 'provider-register',
        clientSecret: dbClient.clientSecret,
        redirectUris: redirectUris,
        postLogoutRedirectUris: dbClient.postLogoutRedirectUris as string[],
        responseTypes: ['code'],
        tokenEndpointAuthMethod: 'client_secret_post',
        grantTypes: ['authorization_code', 'refresh_token'],
      });
      
      console.log('✅ FALLBACK: Static provider-register client active with', 
        (mappedClients.find((c: any) => c.client_id === 'provider-register')?.redirect_uris || []).length, 
        'production redirect URIs');
    } else if (now >= FALLBACK_EXPIRY) {
      console.log('⏰ FALLBACK EXPIRED: 24h window closed at', FALLBACK_EXPIRY.toISOString());
    } else {
      console.log('🔒 FALLBACK DISABLED: OAUTH_FALLBACK_ENABLED=false');
    }
    
    // 🎯 CEO GATE 0: Add ALL 8 M2M clients for scholar_auth microservice
    // Machine-to-Machine authentication for all service-to-service communication
    const M2M_ENABLED = true; // Always enabled for production M2M auth
    const M2M_EXPIRY = new Date('2026-02-05T00:00:00Z'); // 90-day rotation from Nov 5, 2025
    
    if (M2M_ENABLED && now < M2M_EXPIRY) {
      console.log('🎯🎯🎯 CEO GATE 0 - NEW CODE LOADED SUCCESSFULLY 🎯🎯🎯');
      console.log('🎯 CEO GATE 0: Adding all 8 M2M service clients (expires:', M2M_EXPIRY.toISOString(), ')');
      
      // Get all 8 M2M clients from buildServiceClients()
      const serviceClients = buildServiceClients();
      console.log(`🔧 Adding ${serviceClients.length} M2M clients to provider configuration...`);
      
      // 🎯 CEO GATE 0: Clear mappedClients and rebuild from scratch with all 10 clients
      // This ensures no stale clients interfere with authentication
      mappedClients.length = 0;  // Clear array without creating new reference
      console.log('🔧 Cleared existing mappedClients array - rebuilding from service clients');
      
      // Add each service client to mappedClients array
      // CEO NO-GO FIX: oidc-provider expects clients in config, NOT via adapter
      for (const serviceClient of serviceClients) {
        // Add service client with both snake_case and camelCase for oidc-provider compatibility
        mappedClients.push({
          // Snake_case
          client_id: serviceClient.client_id,
          client_secret: serviceClient.client_secret,
          redirect_uris: serviceClient.redirect_uris,
          post_logout_redirect_uris: [],
          response_types: serviceClient.response_types,
          token_endpoint_auth_method: serviceClient.token_endpoint_auth_method,
          grant_types: serviceClient.grant_types,  // 🎯 CRITICAL: snake_case for internal lookup
          // CamelCase (for oidc-provider)
          clientId: serviceClient.client_id,
          clientSecret: serviceClient.client_secret,
          redirectUris: serviceClient.redirect_uris,
          postLogoutRedirectUris: [],
          responseTypes: serviceClient.response_types,
          tokenEndpointAuthMethod: serviceClient.token_endpoint_auth_method,
          grantTypes: serviceClient.grant_types,  // 🎯 CRITICAL: camelCase for oidc-provider
        } as any);
        
        console.log(`✅ M2M: ${serviceClient.client_id} client added with grant_types: ${serviceClient.grant_types.join(', ')}`);
      }
      
      console.log(`✅ GATE 0: All ${serviceClients.length} M2M clients registered in provider configuration`);
    }
    
    console.log('🔍 DEBUG: Loaded clients for OIDC provider:', 
      mappedClients.map((c: any) => ({
        client_id: c.client_id,
        redirect_uris_count: c.redirect_uris?.length,
        grant_types: c.grant_types
      }))
    );
    
    // DEBUG: Log FULL client config for provider-register
    const providerRegisterClient = mappedClients.find((c: any) => c.client_id === 'provider-register');
    if (providerRegisterClient) {
      console.log('🔬 FULL CONFIG for provider-register:', JSON.stringify(providerRegisterClient, null, 2));
    }
    
    // 🔧 CEO NO-GO FIX: Pass clients directly to Provider constructor
    // oidc-provider expects clients in config, NOT via adapter
    // Adapter pattern is for tokens/codes/sessions, not client registration
    runtimeClients = mappedClients;
    configuration.clients = mappedClients;
    
    console.log('🎯 INSTANTIATING PROVIDER with', mappedClients.length, 'clients (direct config)');
    console.log('🔧 Using issuer URL:', ISSUER_URL);
    // 🔧 ISSUER: Use computed issuer from Replit environment or localhost for dev
    try {
      oidcProvider = new Provider(ISSUER_URL, configuration);
      
      // 🔒 CRITICAL: Trust proxy for Replit HTTPS environment
      // Without this, secure cookies are dropped and session lookup fails → server_error
      oidcProvider.proxy = true;
      console.log('✅ PROVIDER INSTANTIATED SUCCESSFULLY with', mappedClients.length, 'clients');
      console.log('🔒 Provider proxy trust enabled: oidcProvider.proxy =', oidcProvider.proxy);
    } catch (err: any) {
      console.error('❌ PROVIDER INSTANTIATION FAILED:', {
        message: err.message,
        stack: err.stack?.split('\n').slice(0, 10).join('\n')
      });
      throw err;
    }
    
    // 🔬 VERIFICATION: Check if provider actually has the clients
    try {
      const testClient = await oidcProvider.Client.find('provider-register');
      console.log('✅ PROVIDER VERIFICATION: Client.find("provider-register")', testClient ? 'FOUND' : 'NOT FOUND');
      if (testClient) {
        console.log('✅ Client details:', { 
          client_id: testClient.clientId, 
          redirect_uris_count: (testClient as any).redirectUris?.length 
        });
      }
    } catch (err: any) {
      console.error('❌ PROVIDER VERIFICATION FAILED:', {
        message: err.message,
        error: err.error,
        error_description: err.error_description,
        stack: err.stack?.split('\n').slice(0, 10).join('\n')
      });
    }
    
    // 🎯 CEO GATE 0: VERIFY ALL 8 M2M CLIENTS CAN BE FOUND
    console.log('🔍 CEO GATE 0: Verifying all 8 M2M clients can be found by provider...');
    for (const clientId of ['scholarship-sage-m2m', 'scholarship-api-service', 'scholarship-agent-service', 
                              'auto-com-center-service', 'auto-page-maker-service', 'provider-register-m2m', 
                              'reviewer-portal-m2m', 'admin-dashboard-m2m']) {
      try {
        const client = await oidcProvider.Client.find(clientId);
        if (client) {
          console.log(`✅ M2M CLIENT FOUND: ${clientId} - grant_types:`, (client as any).grantTypes || (client as any).grant_types);
        } else {
          console.error(`❌ M2M CLIENT NOT FOUND: ${clientId}`);
        }
      } catch (err: any) {
        console.error(`❌ M2M CLIENT LOOKUP ERROR: ${clientId}`, err.message);
      }
    }
    
    // 🔍 ENHANCED DEBUG: Comprehensive error diagnostics with ctx.oidc.details
    oidcProvider.on('authorization.error', async (ctx: any, err: any) => {
      const redactedDetails = { ...ctx.oidc?.details };
      if (redactedDetails) {
        delete redactedDetails.client_secret;
        delete redactedDetails.code_verifier;
      }
      
      console.error('🔴 OIDC authorization.error [ENHANCED v2]:', {
        error: err.message,
        error_description: err.error_description,
        error_code: err.error,
        errorName: err.name,
        statusCode: err.statusCode || err.status,
        clientFound: !!ctx.oidc?.client,
        clientId: ctx.oidc?.client?.clientId,
        stack: err.stack,
        params: {
          client_id: ctx.oidc?.params?.client_id,
          redirect_uri: ctx.oidc?.params?.redirect_uri,
          response_type: ctx.oidc?.params?.response_type,
          code_challenge_method: ctx.oidc?.params?.code_challenge_method,
          code_challenge: ctx.oidc?.params?.code_challenge ? '[PRESENT]' : '[MISSING]',
          scope: ctx.oidc?.params?.scope,
          state: ctx.oidc?.params?.state,
        },
        details: redactedDetails,
        loaded_clients: configuration.clients.map((c: any) => c.client_id),
        path: ctx.path,
        method: ctx.method
      });
    });
    
    oidcProvider.on('server_error', async (ctx: any, err: any) => {
      console.error('🔴 OIDC server_error [ENHANCED]:', {
        error: err.message,
        error_code: err.error,
        stack: err.stack?.split('\n').slice(0, 5).join('\n'),
        params: {
          client_id: ctx.oidc?.params?.client_id,
          redirect_uri: ctx.oidc?.params?.redirect_uri,
        },
        path: ctx.path,
        method: ctx.method
      });
    });
    
    oidcProvider.on('grant.error', async (ctx: any, err: any) => {
      console.error('🔴 OIDC grant.error [ENHANCED]:', {
        error: err.message,
        error_code: err.error,
        client_id: ctx.oidc?.client?.clientId,
        grant_type: ctx.oidc?.params?.grant_type,
        path: ctx.path
      });
    });
    
    // Event handlers for logging (wrapped in try-catch to prevent unhandled rejections)
    oidcProvider.on('authorization.success', async (ctx: any) => {
      try {
        await logger.audit('OIDC_AUTHORIZATION_SUCCESS', {
          clientId: ctx.oidc.client?.clientId,
          scopes: ctx.oidc.params?.scope,
        }, ctx.req as Request, ctx.oidc.session?.accountId);
      } catch (error) {
        console.error('Error logging authorization success:', error);
      }
    });
    
    oidcProvider.on('grant.success', async (ctx: any) => {
      try {
        await logger.audit('OIDC_GRANT_SUCCESS', {
          grantType: ctx.oidc.params?.grant_type,
          clientId: ctx.oidc.client?.clientId,
        }, ctx.req as Request, ctx.oidc.session?.accountId);
      } catch (error) {
        console.error('Error logging grant success:', error);
      }
    });
    
    (oidcProvider as any).on('token.issued', async (ctx: any) => {
      try {
        await logger.audit('OIDC_TOKEN_ISSUED', {
          tokenType: ctx.oidc.entities?.AccessToken ? 'access_token' : 'unknown',
          clientId: ctx.oidc.client?.clientId,
        }, ctx.req as Request, ctx.oidc.session?.accountId);
      } catch (error) {
        console.error('Error logging token issued:', error);
      }
    });
    
    // 🔒 CEO TASK 5: Refresh token reuse detection logging
    // Log when refresh tokens are revoked (detects replay attacks)
    (oidcProvider as any).on('grant.revoked', async (ctx: any, grantId: string) => {
      try {
        await logger.audit('OIDC_GRANT_REVOKED', {
          grantId,
          reason: 'refresh_token_reuse_detected',
          clientId: ctx.oidc?.client?.clientId,
          alert: 'SECURITY: Potential token theft detected',
        }, ctx.req as Request, ctx.oidc?.session?.accountId);
        console.warn('🚨 SECURITY ALERT: Refresh token reuse detected - grant revoked:', {
          grantId,
          clientId: ctx.oidc?.client?.clientId,
          correlationId: (ctx.req as any).correlationId,
        });
      } catch (error) {
        console.error('Error logging grant revoked:', error);
      }
    });
    
    logger.info('OIDC Provider initialized successfully', {
      issuer: ISSUER_URL,
      clientsCount: configuration.clients.length,
    });
    
    return oidcProvider;
  } catch (error) {
    logger.error('Failed to initialize OIDC Provider', error as Error);
    throw error;
  }
}// Force reload trigger 1763094180
// Force reload 1763095281
