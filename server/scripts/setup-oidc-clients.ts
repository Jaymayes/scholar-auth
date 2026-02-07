#!/usr/bin/env tsx
/**
 * Script to register OIDC clients for student-pilot and provider-register apps
 * Run with: npx tsx server/scripts/setup-oidc-clients.ts
 */
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { db } from '../db';

async function setupOIDCClients() {
  console.log('Setting up OIDC clients...');
  
  try {
    // Generate secure client secrets
    const studentClientSecret = randomBytes(32).toString('hex');
    const providerClientSecret = randomBytes(32).toString('hex');
    const replIdClientSecret = randomBytes(32).toString('hex');
    
    // Student Portal Client
    // NOTE: offline_access removed - Replit OIDC does not support it for hosted Repls
    const studentClient = {
      clientId: 'student-pilot',
      clientSecret: studentClientSecret,
      name: 'Student Portal',
      description: 'B2C Student Application for scholarship applications',
      redirectUris: [
        'https://student-pilot-jamarrlmayes.replit.app/oidc/callback',
        'https://student-pilot-jamarrlmayes.replit.app/api/callback',
        'https://student.scholarshipai.com/api/callback',
        'https://student.scholarshipai.dev/api/callback',
      ],
      postLogoutRedirectUris: [
        'https://student-pilot-jamarrlmayes.replit.app/',
        'https://student.scholarshipai.com/',
        'https://student.scholarshipai.dev/'
      ],
      scopes: ['openid', 'email', 'profile'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      enabled: true,
    };
    
    // Provider Portal Client  
    // NOTE: offline_access removed - Replit OIDC does not support it for hosted Repls
    const providerClient = {
      clientId: 'provider-register',
      clientSecret: providerClientSecret,
      name: 'Provider Portal', 
      description: 'B2B Provider Application for scholarship management',
      redirectUris: [
        'https://provider-register-jamarrlmayes.replit.app/oidc/callback',
        'https://provider-register-jamarrlmayes.replit.app/api/callback',
        'https://provider-register-jamarrlmayes.replit.app/auth/callback',
        'https://provider.scholarshipai.com/api/callback',
        'https://provider.scholarshipai.dev/api/callback',
      ],
      postLogoutRedirectUris: [
        'https://provider-register-jamarrlmayes.replit.app/',
        'https://provider-register-jamarrlmayes.replit.app/logged-out',
        'https://provider.scholarshipai.com/',
        'https://provider.scholarshipai.dev/'
      ],
      scopes: ['openid', 'email', 'profile'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      enabled: true,
    };
    
    // REPL_ID Client (for Replit environment access)
    // NOTE: offline_access removed - Replit OIDC does not support it for hosted Repls
    const replIdClient = {
      clientId: process.env.REPL_ID!,
      clientSecret: replIdClientSecret,
      name: 'Replit Environment Client',
      description: 'Auto-generated client for Replit environment access',
      redirectUris: [
        'https://replit.com/api/callback',
        `https://${process.env.REPL_ID}.replit.dev/api/callback`,
        'https://scholar-auth-jamarrlmayes.replit.app/api/callback',
        'https://student.scholarshipai.com/api/callback',
        'https://provider.scholarshipai.com/api/callback',
        'https://auth.scholarshipai.com/api/callback'
      ],
      postLogoutRedirectUris: [
        'https://replit.com/',
        'https://scholar-auth-jamarrlmayes.replit.app/',
        'https://student.scholarshipai.com/',
        'https://provider.scholarshipai.com/'
      ],
      scopes: ['openid', 'email', 'profile'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      enabled: true,
    };
    
    // Check if clients already exist
    const existingStudentClient = await storage.getOidcClient('student-pilot');
    const existingProviderClient = await storage.getOidcClient('provider-register');
    const existingReplIdClient = await storage.getOidcClient(process.env.REPL_ID!);
    
    if (existingStudentClient) {
      console.log('⚠️  Student client already exists, updating...');
      await storage.updateOidcClient('student-pilot', studentClient);
    } else {
      console.log('➕ Creating student client...');
      await storage.createOidcClient(studentClient);
    }
    
    if (existingProviderClient) {
      console.log('⚠️  Provider client already exists, updating...');
      await storage.updateOidcClient('provider-register', providerClient);
    } else {
      console.log('➕ Creating provider client...');
      await storage.createOidcClient(providerClient);
    }
    
    if (existingReplIdClient) {
      console.log('⚠️  REPL_ID client already exists, updating...');
      await storage.updateOidcClient(process.env.REPL_ID!, replIdClient);
    } else {
      console.log('➕ Creating REPL_ID client...');
      await storage.createOidcClient(replIdClient);
    }
    
    console.log('\n✅ OIDC Clients configured successfully!\n');
    
    // Generate environment variable configuration
    console.log('📋 Environment Variables for scholar-auth:');
    console.log('=====================================');
    console.log(`OIDC_ISSUER=https://scholar-auth-jamarrlmayes.replit.app`);
    console.log(`STUDENT_CLIENT_ID=student-pilot`);
    console.log(`STUDENT_CLIENT_SECRET=${studentClientSecret}`);
    console.log(`PROVIDER_CLIENT_ID=provider-register`);
    console.log(`PROVIDER_CLIENT_SECRET=${providerClientSecret}`);
    console.log(`EVENTS_API_KEY=${randomBytes(32).toString('hex')}`);
    console.log();
    
    console.log('📋 Environment Variables for student-pilot app:');
    console.log('===============================================');
    console.log(`OIDC_ISSUER=https://scholar-auth-jamarrlmayes.replit.app`);
    console.log(`OIDC_CLIENT_ID=student-pilot`);
    console.log(`OIDC_CLIENT_SECRET=${studentClientSecret}`);
    console.log(`OIDC_REDIRECT_URI=https://student-pilot-jamarrlmayes.replit.app/oidc/callback`);
    console.log(`OIDC_POST_LOGOUT_REDIRECT_URI=https://student-pilot-jamarrlmayes.replit.app/`);
    console.log(`ANALYTICS_INGEST_URL=https://scholar-auth-jamarrlmayes.replit.app/api/events`);
    console.log(`ANALYTICS_API_KEY=${randomBytes(32).toString('hex')}`);
    console.log();
    
    console.log('📋 Environment Variables for provider-register app:');
    console.log('===================================================');
    console.log(`OIDC_ISSUER=https://scholar-auth-jamarrlmayes.replit.app`);
    console.log(`OIDC_CLIENT_ID=provider-register`);
    console.log(`OIDC_CLIENT_SECRET=${providerClientSecret}`);
    console.log(`OIDC_REDIRECT_URI=https://provider-register-jamarrlmayes.replit.app/oidc/callback`);
    console.log(`OIDC_POST_LOGOUT_REDIRECT_URI=https://provider-register-jamarrlmayes.replit.app/`);
    console.log(`ANALYTICS_INGEST_URL=https://scholar-auth-jamarrlmayes.replit.app/api/events`);
    console.log(`ANALYTICS_API_KEY=${randomBytes(32).toString('hex')}`);
    console.log();
    
    // List registered clients for verification
    const allClients = await storage.getAllOidcClients();
    console.log('📊 Registered OIDC Clients:');
    console.log('===========================');
    allClients.forEach(client => {
      console.log(`• ${client.name} (${client.clientId})`);
      console.log(`  Redirect URIs: ${JSON.stringify(client.redirectUris)}`);
      console.log(`  Scopes: ${JSON.stringify(client.scopes)}`);
      console.log(`  Enabled: ${client.enabled ? '✅' : '❌'}`);
      console.log();
    });
    
  } catch (error) {
    console.error('❌ Error setting up OIDC clients:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the setup
setupOIDCClients();