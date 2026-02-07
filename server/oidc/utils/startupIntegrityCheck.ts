/**
 * 🔐 CEO P0: Startup integrity check for client secrets
 * 
 * Architecture:
 * - DB stores bcrypt hashes (at-rest security)
 * - Runtime loads plaintext from Replit Secrets (process.env)
 * - This module validates env plaintext matches DB hashes
 * - oidc-provider receives plaintext secrets from env (unchanged)
 * 
 * Fail-fast on mismatch to prevent auth bypass
 */

import { db } from '../../db';
import { oidcModels } from '../../../shared/schema';
import { eq } from 'drizzle-orm';
import { validateClientSecretsIntegrity, ClientSecretMapping } from './secretsManagement';

/**
 * Perform startup integrity check for all service clients
 * 
 * Validates that env secrets match DB hashed secrets
 * Throws on mismatch to fail-fast
 */
export async function performStartupIntegrityCheck(
  serviceClients: Array<{ client_id: string; client_secret: string }>
): Promise<void> {
  console.log('\n🔐 ===========================================');
  console.log('🔐 STARTUP CLIENT SECRETS INTEGRITY CHECK');
  console.log('🔐 ===========================================\n');

  const mappings: ClientSecretMapping[] = [];

  // Build mappings for each service client
  for (const client of serviceClients) {
    // Load DB client to get hashed secret
    const dbRecord = await db
      .select()
      .from(oidcModels)
      .where(eq(oidcModels.id, client.client_id))
      .limit(1);

    if (dbRecord.length === 0) {
      console.warn(`⚠️  Client ${client.client_id} not found in database - skipping check`);
      continue;
    }

    const payload = dbRecord[0].payload as any;
    const dbHash = payload.client_secret;

    // Determine env key from client_id
    // Convention: M2M_SCHOLARSHIP_SAGE_SECRET -> scholarship-sage-m2m
    const envKey = getEnvKeyForClient(client.client_id);

    mappings.push({
      clientId: client.client_id,
      envKey,
      envValue: client.client_secret, // Plaintext from env
      dbHash: dbHash // Bcrypt hash from DB
    });
  }

  // Validate all mappings
  const result = await validateClientSecretsIntegrity(mappings);

  if (!result.valid) {
    console.error('\n🚨 ============================================');
    console.error('🚨 SECURITY FAILURE: CLIENT SECRET MISMATCH');
    console.error('🚨 ============================================\n');
    console.error('Env secrets do not match database hashes!');
    console.error('This could indicate:');
    console.error('  - Secrets were rotated in env but not in DB');
    console.error('  - Database was tampered with');
    console.error('  - Migration script did not complete\n');
    console.error('ERRORS:');
    result.errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nACTION REQUIRED:');
    console.error('  1. Verify Replit Secrets match intended values');
    console.error('  2. Re-run migration: tsx server/scripts/hashClientSecrets.ts');
    console.error('  3. Or rotate secrets using admin endpoint\n');
    
    throw new Error('STARTUP INTEGRITY CHECK FAILED - Refusing to start with mismatched secrets');
  }

  console.log('✅ All client secrets validated successfully');
  console.log('✅ Runtime env matches database hashes\n');
}

/**
 * Map client_id to environment variable name
 */
function getEnvKeyForClient(clientId: string): string {
  const mapping: Record<string, string> = {
    'scholarship-sage-m2m': 'M2M_SCHOLARSHIP_SAGE_SECRET',
    'scholarship-api-service': 'SCHOLARSHIP_API_SERVICE_SECRET',
    'scholarship-agent-service': 'SCHOLARSHIP_AGENT_SERVICE_SECRET',
    'scholarship_agent': 'SCHOLARSHIP_AGENT_SECRET', // S2S telemetry client
    'auto-com-center-service': 'AUTO_COM_CENTER_SERVICE_SECRET',
    'auto-page-maker-service': 'AUTO_PAGE_MAKER_SERVICE_SECRET',
    'provider-register-m2m': 'PROVIDER_REGISTER_M2M_SECRET',
    'reviewer-portal-m2m': 'REVIEWER_PORTAL_M2M_SECRET',
    'admin-dashboard-m2m': 'ADMIN_DASHBOARD_M2M_SECRET',
    'provider-register': 'PROVIDER_REGISTER_SECRET',
    'student-pilot': 'STUDENT_PILOT_SECRET'
  };

  return mapping[clientId] || clientId.toUpperCase().replace(/-/g, '_') + '_SECRET';
}
