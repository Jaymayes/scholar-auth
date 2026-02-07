/**
 * 🔐 CEO P0: Bcrypt-based client secret management
 * 
 * Security Architecture:
 * - DB stores ONLY bcrypt hashes (at-rest security)
 * - Runtime loads plaintext from Replit Secrets (process.env)
 * - Startup integrity check: bcrypt.compare(envPlaintext, dbHashed)
 * - oidc-provider receives plaintext secrets from env (compatibility)
 * 
 * This approach satisfies:
 * - At-rest security requirements (no plaintext in DB)
 * - oidc-provider compatibility (requires plaintext for validation)
 * - Replit deployment best practices (Secrets as runtime env)
 */

import bcrypt from 'bcryptjs';

// Bcrypt salt rounds (12-14 recommended for production)
const SALT_ROUNDS = 12;

/**
 * Hash a plaintext client secret using bcrypt
 * Used during client registration/seeding
 */
export async function hashClientSecret(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.trim().length === 0) {
    throw new Error('Cannot hash empty client secret');
  }
  
  const hash = await bcrypt.hash(plaintext, SALT_ROUNDS);
  console.log('🔐 Client secret hashed', { saltRounds: SALT_ROUNDS });
  return hash;
}

/**
 * Verify a plaintext secret against a bcrypt hash
 * Used during startup integrity checks
 */
export async function verifyClientSecret(
  plaintext: string, 
  hash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch (error) {
    console.error('❌ Secret verification failed', error);
    return false;
  }
}

/**
 * 🚀 CEO P0: Startup integrity check
 * 
 * Validates that runtime env secrets match DB hashed secrets
 * FAIL FAST if mismatch detected
 */
export interface ClientSecretMapping {
  clientId: string;
  envKey: string;      // Environment variable name (e.g., 'M2M_SCHOLARSHIP_SAGE_SECRET')
  envValue: string;    // Plaintext from process.env
  dbHash?: string;     // Bcrypt hash from database (if client exists in DB)
}

export async function validateClientSecretsIntegrity(
  mappings: ClientSecretMapping[]
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  console.log('🔐 Starting client secrets integrity check -', mappings.length, 'clients');
  
  for (const mapping of mappings) {
    // Skip DB validation for clients that don't have a DB entry yet
    if (!mapping.dbHash) {
      console.warn(`⚠️  No DB hash found for ${mapping.clientId} - skipping integrity check`);
      continue;
    }
    
    const isValid = await verifyClientSecret(mapping.envValue, mapping.dbHash);
    
    if (!isValid) {
      const error = `❌ INTEGRITY FAILURE: ${mapping.clientId} - env secret does not match DB hash`;
      errors.push(error);
      console.error(error, { 
        clientId: mapping.clientId,
        envKey: mapping.envKey,
        hashPrefix: mapping.dbHash.substring(0, 10)
      });
    } else {
      console.log(`✅ Integrity validated: ${mapping.clientId}`);
    }
  }
  
  if (errors.length > 0) {
    console.error('🚨 CLIENT SECRETS INTEGRITY CHECK FAILED', { 
      failedCount: errors.length,
      totalCount: mappings.length,
      errors
    });
    return { valid: false, errors };
  }
  
  console.log('✅ All client secrets passed integrity check -', mappings.length, 'validated');
  return { valid: true, errors: [] };
}

/**
 * Mask a secret for safe logging
 * Shows first 4 and last 4 characters
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) {
    return '***';
  }
  return `${secret.substring(0, 4)}***${secret.substring(secret.length - 4)}`;
}
