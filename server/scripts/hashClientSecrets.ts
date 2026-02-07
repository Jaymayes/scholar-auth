/**
 * 🔐 CEO P0: One-time migration to hash all client secrets
 * 
 * This script:
 * 1. Reads all clients from oidc_models table where type='Client'
 * 2. Extracts client_secret from payload
 * 3. Hashes using bcrypt (12 rounds)
 * 4. Updates payload with hashed secret
 * 5. Validates all secrets were hashed successfully
 * 
 * **CRITICAL**: Backup database before running!
 * 
 * Usage:
 *   tsx server/scripts/hashClientSecrets.ts
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { oidcModels } from '../../shared/schema';
import { hashClientSecret, maskSecret } from '../oidc/utils/secretsManagement';

async function migrateClientSecrets() {
  console.log('🔍 Using existing database connection from server/db.ts');

  console.log('🔐 ========================================');
  console.log('🔐 CLIENT SECRETS MIGRATION TO BCRYPT');
  console.log('🔐 ========================================\n');

  // 1. Find all Client entries in oidc_models
  const clients = await db
    .select()
    .from(oidcModels)
    .where(eq(oidcModels.type, 'Client'));

  console.log(`📋 Found ${clients.length} clients in database\n`);

  if (clients.length === 0) {
    console.log('✅ No clients found - migration not needed');
    return;
  }

  let hashedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  // 2. Hash each client's secret
  for (const client of clients) {
    const payload = client.payload as any;
    const clientId = payload.client_id || client.id;
    const clientSecret = payload.client_secret;

    console.log(`\n🔍 Processing: ${clientId}`);

    // Skip if no secret (public clients)
    if (!clientSecret) {
      console.log(`   ⏭️  No secret found - skipping (public client)`);
      skippedCount++;
      continue;
    }

    // Check if already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
    if (clientSecret.startsWith('$2a$') || clientSecret.startsWith('$2b$') || clientSecret.startsWith('$2y$')) {
      console.log(`   ✅ Already hashed - skipping`);
      skippedCount++;
      continue;
    }

    try {
      // Hash the plaintext secret
      console.log(`   🔐 Hashing secret: ${maskSecret(clientSecret)}`);
      const hashedSecret = await hashClientSecret(clientSecret);

      // Update payload with hashed secret
      const updatedPayload = {
        ...payload,
        client_secret: hashedSecret,
        // Store original secret length for validation (metadata only)
        _secret_metadata: {
          hashed_at: new Date().toISOString(),
          original_length: clientSecret.length,
          hash_algorithm: 'bcrypt',
          salt_rounds: 12
        }
      };

      // Update database
      await db
        .update(oidcModels)
        .set({ payload: updatedPayload })
        .where(eq(oidcModels.id, client.id));

      console.log(`   ✅ Hashed and updated successfully`);
      hashedCount++;
    } catch (error) {
      const errorMsg = `Failed to hash secret for ${clientId}: ${error}`;
      console.error(`   ❌ ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  // 3. Summary
  console.log('\n🔐 ========================================');
  console.log('🔐 MIGRATION SUMMARY');
  console.log('🔐 ========================================');
  console.log(`Total clients:     ${clients.length}`);
  console.log(`✅ Hashed:          ${hashedCount}`);
  console.log(`⏭️  Skipped:         ${skippedCount}`);
  console.log(`❌ Errors:          ${errors.length}\n`);

  if (errors.length > 0) {
    console.error('❌ ERRORS ENCOUNTERED:');
    errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }

  if (hashedCount === 0 && skippedCount === clients.length) {
    console.log('✅ All secrets already hashed - no action needed');
  } else {
    console.log('✅ Migration completed successfully!');
    console.log('\n📋 NEXT STEPS:');
    console.log('   1. Verify all client secrets are hashed in database');
    console.log('   2. Update provider startup to load plaintext from env');
    console.log('   3. Run integrity check: bcrypt.compare(env, dbHash)');
  }
}

// Execute migration
migrateClientSecrets()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
