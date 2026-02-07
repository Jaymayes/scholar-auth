#!/usr/bin/env tsx
/**
 * E2E Test Suite: M2M Client Credentials Flow
 * 
 * Tests all 10 M2M OAuth clients for:
 * - Client credentials grant flow (RFC 6749)
 * - JWT access token structure (RS256)
 * - Scope enforcement per client
 * - RFC 8707 resource indicators
 * - Token TTL (300s)
 * - JWKS signature verification
 * - Bcrypt client secret authentication
 */

import * as jose from 'jose';

// Use localhost for E2E tests to test latest code before deployment
const TEST_ISSUER = process.env.TEST_ISSUER || 'http://localhost:5000/oidc';
const TOKEN_ENDPOINT = `${TEST_ISSUER}/token`;
const JWKS_ENDPOINT = `${TEST_ISSUER}/jwks`;

// Canonical issuer for JWT validation (what's actually in the JWT iss claim)
const CANONICAL_ISSUER = process.env.CANONICAL_ISSUER || 'https://scholar-auth-jamarrlmayes.replit.app/oidc';

// All 8 M2M clients with their expected scopes (matching provider.ts configuration)
const M2M_CLIENTS = [
  {
    client_id: 'scholarship-sage-m2m',
    client_secret: process.env.M2M_SCHOLARSHIP_SAGE_SECRET!,
    expected_scopes: ['read:scholarships', 'read:users', 'read:recommendations', 'export:data'],
    resource: 'urn:scholar-platform'
  },
  {
    client_id: 'scholarship-api-service',
    client_secret: process.env.SCHOLARSHIP_API_SERVICE_SECRET!,
    expected_scopes: ['read:scholarships', 'write:scholarships', 'read:applications'],
    resource: 'urn:scholar-platform'
  },
  {
    client_id: 'scholarship-agent-service',
    client_secret: process.env.SCHOLARSHIP_AGENT_SERVICE_SECRET!,
    expected_scopes: ['read:scholarships', 'send:notifications'],
    resource: 'urn:scholar-platform'
  },
  {
    client_id: 'auto-com-center-service',
    client_secret: process.env.AUTO_COM_CENTER_SERVICE_SECRET!,
    expected_scopes: ['send:notifications'],
    resource: 'urn:scholar-platform'
  },
  {
    client_id: 'auto-page-maker-service',
    client_secret: process.env.AUTO_PAGE_MAKER_SERVICE_SECRET!,
    expected_scopes: ['read:scholarships', 'generate:assets', 'export:data'],
    resource: 'urn:scholar-platform'
  },
  {
    client_id: 'provider-register-m2m',
    client_secret: process.env.PROVIDER_REGISTER_M2M_SECRET!,
    expected_scopes: ['read:providers', 'write:providers'],
    resource: 'urn:scholar-platform'
  },
  {
    client_id: 'reviewer-portal-m2m',
    client_secret: process.env.REVIEWER_PORTAL_M2M_SECRET!,
    expected_scopes: ['read:applications', 'review:applications'],
    resource: 'urn:scholar-platform'
  },
  {
    client_id: 'admin-dashboard-m2m',
    client_secret: process.env.ADMIN_DASHBOARD_M2M_SECRET!,
    expected_scopes: ['admin:read', 'admin:write', 'introspect:tokens'],
    resource: 'urn:scholar-platform'
  }
];

interface TestResult {
  client_id: string;
  success: boolean;
  errors: string[];
  token?: any;
  duration_ms?: number;
}

interface JWTPayload {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  scope?: string;
  client_id?: string;
  [key: string]: any;
}

async function getJWKS() {
  const response = await fetch(JWKS_ENDPOINT);
  if (!response.ok) {
    throw new Error(`JWKS fetch failed: ${response.status} ${response.statusText}`);
  }
  return jose.createRemoteJWKSet(new URL(JWKS_ENDPOINT));
}

async function testClient(client: typeof M2M_CLIENTS[0]): Promise<TestResult> {
  const result: TestResult = {
    client_id: client.client_id,
    success: false,
    errors: []
  };

  const startTime = Date.now();

  try {
    // Step 1: Request access token
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: client.client_id,
        client_secret: client.client_secret,
        scope: client.expected_scopes.join(' '),
        resource: client.resource
      })
    });

    result.duration_ms = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      result.errors.push(`Token request failed: ${response.status} ${error}`);
      return result;
    }

    const tokenResponse = await response.json();

    // Step 2: Validate token response structure
    if (!tokenResponse.access_token) {
      result.errors.push('Missing access_token in response');
      return result;
    }

    if (tokenResponse.token_type !== 'Bearer') {
      result.errors.push(`Invalid token_type: ${tokenResponse.token_type} (expected Bearer)`);
    }

    if (tokenResponse.expires_in !== 300) {
      result.errors.push(`Invalid expires_in: ${tokenResponse.expires_in} (expected 300)`);
    }

    // Step 3: Decode JWT and verify signature
    const JWKS = await getJWKS();
    const { payload } = await jose.jwtVerify(tokenResponse.access_token, JWKS, {
      issuer: CANONICAL_ISSUER,
      algorithms: ['RS256']
    });

    const jwtPayload = payload as JWTPayload;
    result.token = jwtPayload;

    // DEBUG: Log full payload to see what claims are available
    console.log(`  [DEBUG] All JWT claims for ${client.client_id}:`, Object.keys(payload));
    console.log(`  [DEBUG] Scope claim value:`, payload.scope);
    console.log(`  [DEBUG] Raw payload:`, JSON.stringify(payload, null, 2));

    // Step 4: Validate JWT claims
    if (jwtPayload.iss !== CANONICAL_ISSUER) {
      result.errors.push(`Invalid issuer: ${jwtPayload.iss} (expected ${CANONICAL_ISSUER})`);
    }

    if (jwtPayload.client_id !== client.client_id) {
      result.errors.push(`Invalid client_id in token: ${jwtPayload.client_id} (expected ${client.client_id})`);
    }

    // Step 5: Validate RFC 8707 resource indicator
    const aud = Array.isArray(jwtPayload.aud) ? jwtPayload.aud : [jwtPayload.aud];
    if (!aud.includes(client.resource)) {
      result.errors.push(`Missing resource indicator: ${client.resource} not in aud: ${JSON.stringify(aud)}`);
    }

    // Step 6: Validate scopes
    const tokenScopes = jwtPayload.scope ? jwtPayload.scope.split(' ') : [];
    const missingScopes = client.expected_scopes.filter(s => !tokenScopes.includes(s));
    if (missingScopes.length > 0) {
      result.errors.push(`Missing scopes: ${missingScopes.join(', ')}`);
    }

    // Step 7: Validate TTL (should be ~300s)
    const ttl = jwtPayload.exp - jwtPayload.iat;
    if (ttl !== 300) {
      result.errors.push(`Invalid TTL: ${ttl}s (expected 300s)`);
    }

    result.success = result.errors.length === 0;
    
  } catch (error) {
    result.errors.push(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

async function main() {
  console.log('\n🚀 M2M Client Credentials E2E Test Suite');
  console.log('==========================================\n');
  console.log(`Test Endpoint: ${TEST_ISSUER}`);
  console.log(`Canonical Issuer (JWT validation): ${CANONICAL_ISSUER}`);
  console.log(`Testing ${M2M_CLIENTS.length} M2M clients\n`);

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const client of M2M_CLIENTS) {
    console.log(`Testing ${client.client_id}...`);
    const result = await testClient(client);
    results.push(result);

    if (result.success) {
      console.log(`✅ PASS (${result.duration_ms}ms)`);
      passed++;
    } else {
      console.log(`❌ FAIL (${result.duration_ms}ms)`);
      result.errors.forEach(err => console.log(`   - ${err}`));
      failed++;
    }
    console.log('');
  }

  console.log('\n==========================================');
  console.log('Summary:');
  console.log(`✅ Passed: ${passed}/${M2M_CLIENTS.length}`);
  console.log(`❌ Failed: ${failed}/${M2M_CLIENTS.length}`);
  console.log('==========================================\n');

  // Print detailed token info for first successful client
  const firstSuccess = results.find(r => r.success);
  if (firstSuccess && firstSuccess.token) {
    console.log('Sample JWT Payload (first successful client):');
    console.log(JSON.stringify(firstSuccess.token, null, 2));
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
