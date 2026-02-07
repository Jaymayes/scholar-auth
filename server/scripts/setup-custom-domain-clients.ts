#!/usr/bin/env tsx
/**
 * Script to update OIDC clients for custom domain cutover
 * Updates redirect URIs to use custom domains: auth.scholarshipai.dev, student.scholarshipai.dev, provider.scholarshipai.dev
 */
import { randomBytes } from 'crypto';
import { storage } from '../storage';

async function setupCustomDomainClients() {
  console.log('🚀 Updating OIDC clients for custom domain cutover...');
  
  try {
    // Custom domain configuration
    const authDomain = 'auth.scholarshipai.dev';
    const studentDomain = 'student.scholarshipai.dev';
    const providerDomain = 'provider.scholarshipai.dev';
    
    // Get existing clients to preserve secrets
    const existingStudentClient = await storage.getOidcClient('student-pilot');
    const existingProviderClient = await storage.getOidcClient('provider-register');
    
    if (!existingStudentClient || !existingProviderClient) {
      console.log('❌ Existing clients not found. Run setup-oidc-clients.ts first.');
      process.exit(1);
    }
    
    // Update Student Portal Client with custom domain
    const studentClientUpdate = {
      redirectUris: [`https://${studentDomain}/oidc/callback`],
      postLogoutRedirectUris: [`https://${studentDomain}/`],
    };
    
    // Update Provider Portal Client with custom domain  
    const providerClientUpdate = {
      redirectUris: [`https://${providerDomain}/oidc/callback`],
      postLogoutRedirectUris: [`https://${providerDomain}/`],
    };
    
    // Apply updates
    console.log('🔄 Updating student client redirect URIs...');
    await storage.updateOidcClient('student-pilot', studentClientUpdate);
    
    console.log('🔄 Updating provider client redirect URIs...');
    await storage.updateOidcClient('provider-register', providerClientUpdate);
    
    console.log('\n✅ OIDC Clients updated for custom domain!\n');
    
    // Generate updated environment variable configuration
    console.log('📋 UPDATED Environment Variables:');
    console.log('==================================');
    console.log('\n🏗️  IdP (scholar-auth) - SET THIS ENVIRONMENT VARIABLE:');
    console.log(`OIDC_ISSUER=https://${authDomain}`);
    console.log('\n📱 Student App (student-pilot) - SET THESE:');
    console.log(`OIDC_ISSUER=https://${authDomain}`);
    console.log(`OIDC_DISCOVERY_URL=https://${authDomain}/.well-known/openid-configuration`);
    console.log(`OIDC_REDIRECT_URI=https://${studentDomain}/oidc/callback`);
    console.log(`OIDC_POST_LOGOUT_REDIRECT_URI=https://${studentDomain}/`);
    console.log(`ANALYTICS_INGEST_URL=https://${authDomain}/api/events`);
    console.log('\n🏢 Provider App (provider-register) - SET THESE:');
    console.log(`OIDC_ISSUER=https://${authDomain}`);
    console.log(`OIDC_DISCOVERY_URL=https://${authDomain}/.well-known/openid-configuration`);
    console.log(`OIDC_REDIRECT_URI=https://${providerDomain}/oidc/callback`);
    console.log(`OIDC_POST_LOGOUT_REDIRECT_URI=https://${providerDomain}/`);
    console.log(`ANALYTICS_INGEST_URL=https://${authDomain}/api/events`);
    
    console.log('\n📊 Updated OIDC Client Registrations:');
    console.log('=====================================');
    console.log(`• Student Portal (student-pilot)`);
    console.log(`  Redirect URI: https://${studentDomain}/oidc/callback`);
    console.log(`  Post-Logout: https://${studentDomain}/`);
    console.log(`• Provider Portal (provider-register)`);
    console.log(`  Redirect URI: https://${providerDomain}/oidc/callback`);
    console.log(`  Post-Logout: https://${providerDomain}/`);
    console.log('\n🎯 Next Steps:');
    console.log('1. Set OIDC_ISSUER environment variable on IdP');
    console.log('2. Deploy IdP with custom domain issuer');
    console.log('3. Configure student and provider apps with custom domain URLs');
    console.log('4. Deploy student and provider apps');
    console.log('5. Test end-to-end SSO flows');
    
  } catch (error) {
    console.error('❌ Error updating OIDC clients for custom domain:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the custom domain setup
setupCustomDomainClients();