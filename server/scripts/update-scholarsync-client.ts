#!/usr/bin/env tsx

import { storage } from '../storage.js';
import { randomBytes } from 'crypto';

async function updateScholarsyncClient() {
  console.log('🔄 ROTATING scholarsync-provider client secret and fixing config mismatches...');
  
  try {
    // Generate new secure client secret (≥256-bit entropy)
    const newClientSecret = randomBytes(32).toString('hex');
    
    // Updated scholarsync-provider Client Configuration with all fixes
    const updatedClient = {
      clientId: 'scholarsync-provider',
      clientSecret: newClientSecret,
      name: 'ScholarSync Provider Portal',
      description: 'P1 Provider Portal Client for ScholarshipAI OIDC Integration',
      redirectUris: [
        'https://provider-register-jamarrlmayes.replit.app/auth/callback',  // ✅ FIX 1: Provider Portal expects /auth/callback
        'https://provider-register-jamarrlmayes.replit.app/oidc/callback'   // Keep dual support
      ],
      postLogoutRedirectUris: [
        'https://provider-register-jamarrlmayes.replit.app/logged-out'      // ✅ FIX 2: Portal expects /logged-out
      ],
      scopes: [
        'openid', 'email', 'profile', 'roles',
        'provider:read',      // Provider-specific scopes
        'provider:write'      // NOTE: offline_access removed - Replit OIDC does not support it
      ],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_basic',  // ✅ FIX 3: Change from client_secret_post
      enabled: true,
    };
    
    // Update the existing client (secret rotation)
    console.log('🔄 Rotating client secret and updating configuration...');
    await storage.updateOidcClient('scholarsync-provider', updatedClient);
    
    // Get current UTC timestamp
    const timestamp = new Date().toISOString();
    
    // Return the EXACT JSON format requested
    const response = {
      "issuer": "https://scholar-auth-jamarrlmayes.replit.app",
      "client_id": "scholarsync-provider",
      "client_secret": newClientSecret,
      "redirect_uris": [
        "https://provider-register-jamarrlmayes.replit.app/auth/callback",
        "https://provider-register-jamarrlmayes.replit.app/oidc/callback"
      ],
      "post_logout_redirect_uris": [
        "https://provider-register-jamarrlmayes.replit.app/logged-out"
      ],
      "scope": "openid email profile roles provider:read provider:write",
      "token_endpoint_auth_method": "client_secret_basic", 
      "pkce": "S256",
      "jwks_uri": "https://scholar-auth-jamarrlmayes.replit.app/.well-known/jwks.json",
      "created_or_rotated_at": timestamp
    };
    
    console.log('\n✅ Client secret rotated and config updated successfully!\n');
    
    // Output the JSON as requested
    console.log('📋 UPDATED CLIENT CONFIGURATION (JSON):');
    console.log('=======================================');
    console.log(JSON.stringify(response, null, 2));
    
    // Verify the update worked
    const verifyClient = await storage.getOidcClient('scholarsync-provider');
    if (verifyClient) {
      console.log('\n✅ VERIFICATION: scholarsync-provider client successfully updated');
      console.log(`   Redirect URIs: ${JSON.stringify(verifyClient.redirectUris)}`);
      console.log(`   Post-logout URIs: ${JSON.stringify(verifyClient.postLogoutRedirectUris)}`);
      console.log(`   Token Auth Method: ${verifyClient.tokenEndpointAuthMethod}`);
      console.log(`   Scopes: ${JSON.stringify(verifyClient.scopes)}`);
      console.log(`   Secret rotated: ✅ (${newClientSecret.substring(0, 8)}...)`);
    } else {
      console.error('❌ VERIFICATION FAILED: Client not found in database');
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ Error updating scholarsync-provider client:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateScholarsyncClient().then(() => {
    console.log('\n🎯 Client secret rotation and config update completed!');
    process.exit(0);
  }).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { updateScholarsyncClient };