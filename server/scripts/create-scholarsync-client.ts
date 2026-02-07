#!/usr/bin/env tsx

import { storage } from '../storage.js';
import { randomBytes } from 'crypto';

async function createScholarsyncClient() {
  console.log('🔥 Creating scholarsync-provider client for P1 deployment...');
  
  try {
    // Generate secure client secret
    const clientSecret = randomBytes(32).toString('hex');
    
    // scholarsync-provider Client Configuration
    const scholarsyncClient = {
      clientId: 'scholarsync-provider',
      clientSecret: clientSecret,
      name: 'ScholarSync Provider Portal',
      description: 'P1 Provider Portal Client for ScholarshipAI OIDC Integration',
      redirectUris: [
        'https://provider-register-jamarrlmayes.replit.app/oidc/callback',
        'https://scholarsync-provider.com/oidc/callback',
        'https://localhost:3000/oidc/callback'  // Dev environment
      ],
      postLogoutRedirectUris: [
        'https://provider-register-jamarrlmayes.replit.app/',
        'https://scholarsync-provider.com/',
        'https://localhost:3000/'
      ],
      scopes: ['openid', 'email', 'profile', 'roles'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      enabled: true,
    };
    
    // Check if client already exists
    const existingClient = await storage.getOidcClient('scholarsync-provider');
    
    if (existingClient) {
      console.log('⚠️  scholarsync-provider client already exists, updating...');
      await storage.updateOidcClient('scholarsync-provider', scholarsyncClient);
    } else {
      console.log('➕ Creating scholarsync-provider client...');
      await storage.createOidcClient(scholarsyncClient);
    }
    
    console.log('\n✅ scholarsync-provider client configured successfully!\n');
    
    // P1 DELIVERABLE: Client credentials for Provider Portal
    console.log('🎯 P1 DELIVERABLE - Provider Portal Credentials:');
    console.log('==================================================');
    console.log(`OIDC_ISSUER=https://scholar-auth-jamarrlmayes.replit.app`);
    console.log(`OIDC_CLIENT_ID=scholarsync-provider`);
    console.log(`OIDC_CLIENT_SECRET=${clientSecret}`);
    console.log(`OIDC_REDIRECT_URI=https://provider-register-jamarrlmayes.replit.app/oidc/callback`);
    console.log(`OIDC_POST_LOGOUT_REDIRECT_URI=https://provider-register-jamarrlmayes.replit.app/`);
    console.log();
    
    console.log('🔍 Test OIDC Provider Discovery:');
    console.log('curl -sS https://scholar-auth-jamarrlmayes.replit.app/.well-known/openid-configuration | jq .');
    console.log();
    
    console.log('🔍 Test OIDC Authorization URL:');
    console.log(`https://scholar-auth-jamarrlmayes.replit.app/oidc/auth?response_type=code&client_id=scholarsync-provider&scope=openid%20email%20profile&redirect_uri=https://provider-register-jamarrlmayes.replit.app/oidc/callback&state=test123`);
    console.log();
    
    // Verify client registration
    const verifyClient = await storage.getOidcClient('scholarsync-provider');
    if (verifyClient) {
      console.log('✅ VERIFICATION: scholarsync-provider client successfully registered');
      console.log(`   Client ID: ${verifyClient.clientId}`);
      console.log(`   Name: ${verifyClient.name}`);
      console.log(`   Scopes: ${JSON.stringify(verifyClient.scopes)}`);
      console.log(`   Enabled: ${verifyClient.enabled ? '✅' : '❌'}`);
    } else {
      console.error('❌ VERIFICATION FAILED: Client not found in database');
    }
    
  } catch (error) {
    console.error('❌ Error creating scholarsync-provider client:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createScholarsyncClient().then(() => {
    console.log('\n🎯 P1 scholarsync-provider client creation completed!');
    process.exit(0);
  }).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { createScholarsyncClient };