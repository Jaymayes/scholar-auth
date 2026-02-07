// 🔒 CONFIG-001: COMPREHENSIVE ENVIRONMENT VALIDATION
// Fail-fast startup validation with required vs optional environment variables

import { z } from 'zod';

/**
 * Executive-approved environment variable schema
 * All critical configuration must be validated at startup
 */
const environmentSchema = z.object({
  // CRITICAL REQUIRED VARIABLES - Application will not start without these
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required for database connectivity'),
  
  // Database connection details (required)
  PGDATABASE: z.string().min(1, 'PGDATABASE required'),
  PGHOST: z.string().min(1, 'PGHOST required'),
  PGUSER: z.string().min(1, 'PGUSER required'),
  PGPASSWORD: z.string().min(1, 'PGPASSWORD required'),
  PGPORT: z.string().regex(/^\d+$/, 'PGPORT must be a valid port number'),

  // CORS security (required in production)
  CORS_ALLOWED_ORIGINS: z.string().min(1, 'CORS_ALLOWED_ORIGINS required for security'),

  // OIDC Provider RSA Keys (REQUIRED - no defaults for security)
  OIDC_SIGNING_KID: z.string().min(1, 'OIDC_SIGNING_KID required for JWT signing'),
  OIDC_RSA_PUBLIC_KEY_N: z.string().min(1, 'OIDC_RSA_PUBLIC_KEY_N required for JWT verification'),
  OIDC_RSA_PUBLIC_KEY_E: z.string().min(1, 'OIDC_RSA_PUBLIC_KEY_E required for JWT verification'),
  OIDC_RSA_PRIVATE_KEY_D: z.string().min(1, 'OIDC_RSA_PRIVATE_KEY_D required for JWT signing'),
  OIDC_RSA_PRIVATE_KEY_P: z.string().min(1, 'OIDC_RSA_PRIVATE_KEY_P required for JWT signing'),
  OIDC_RSA_PRIVATE_KEY_Q: z.string().min(1, 'OIDC_RSA_PRIVATE_KEY_Q required for JWT signing'),
  OIDC_RSA_PRIVATE_KEY_DP: z.string().min(1, 'OIDC_RSA_PRIVATE_KEY_DP required for JWT signing'),
  OIDC_RSA_PRIVATE_KEY_DQ: z.string().min(1, 'OIDC_RSA_PRIVATE_KEY_DQ required for JWT signing'),
  OIDC_RSA_PRIVATE_KEY_QI: z.string().min(1, 'OIDC_RSA_PRIVATE_KEY_QI required for JWT signing'),
  OIDC_COOKIE_KEYS: z.string().min(1, 'OIDC_COOKIE_KEYS required for session security'),

  // CEO NOV 13 Gate 0: Auth service canonical URL (optional in dev, required in production)
  ISSUER_URL: z.string().url('ISSUER_URL must be a valid URL (e.g., https://auth.scholaraiadvisor.com)').optional(),
  // Note: CLIENT_ALLOWED_SCOPES is hardcoded in server/oidc/provider.ts, not an env var

  // OPTIONAL VARIABLES WITH SAFE DEFAULTS
  // Note: EVENTS_API_KEY is optional but runtime-validated in /api/events endpoint
  // to allow dev servers to start without events ingestion capability
  EVENTS_API_KEY: z.string().optional(),
  BUILD_SHA: z.string().optional(),
  DEPLOYMENT_ENV: z.string().optional(),
  ALLOW_LOCALHOST: z.string().optional(),
  INTERNAL_API_KEY: z.string().optional(),

  // CEO NOV 13 Gate 0: Email service (optional in dev, validated in production)
  POSTMARK_API_TOKEN: z.string().optional(),
  FROM_EMAIL: z.string().email('FROM_EMAIL must be valid email format').optional(),

  // Service-to-service authentication secrets (optional - for integration testing)
  M2M_SCHOLARSHIP_SAGE_SECRET: z.string().optional(),
  STUDENT_PILOT_SECRET: z.string().optional(),
  PROVIDER_REGISTER_SECRET: z.string().optional(),

  // Security & Audit (recommended but not required)
  AUTH_CLIENT_ID: z.string().optional(),
  AUTH_CLIENT_SECRET: z.string().optional(),
  AUTH_ISSUER_URL: z.string().optional(),
}); // Allow unknown environment variables - system provides many extras

type Environment = z.infer<typeof environmentSchema>;

/**
 * Validate environment variables at application startup
 * Throws error with detailed feedback if validation fails
 */
export function validateEnvironment(): Environment {
  console.log('🔒 Validating environment configuration...');
  
  try {
    const env = environmentSchema.parse(process.env);
    
    // Additional production-specific validation
    if (env.NODE_ENV === 'production') {
      validateProductionEnvironment(env);
    }
    
    console.log('✅ Environment validation passed');
    console.log(`📋 Environment: ${env.NODE_ENV}`);
    console.log(`🔌 Database: ${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`);
    console.log(`🌐 CORS Origins: ${env.CORS_ALLOWED_ORIGINS.split(',').length} configured`);
    
    return env;
  } catch (error) {
    console.error('❌ ENVIRONMENT VALIDATION FAILED');
    
    if (error instanceof z.ZodError) {
      console.error('📋 Missing or invalid environment variables:');
      error.errors.forEach((err) => {
        console.error(`  ❌ ${err.path.join('.')}: ${err.message}`);
      });
      
      // Provide helpful guidance
      console.error('\n📖 Required environment variables:');
      console.error('  DATABASE_URL, PGDATABASE, PGHOST, PGUSER, PGPASSWORD, PGPORT');
      console.error('  CORS_ALLOWED_ORIGINS, NODE_ENV');
      console.error('  ISSUER_URL (Gate 0 OAuth2 requirement)');
      console.error('\n📖 Production-only required variables:');
      console.error('  POSTMARK_API_TOKEN, FROM_EMAIL (email service)');
      console.error('\n💡 Create a .env file with the required variables');
      console.error('💡 Refer to .env.example for the complete template');
    } else {
      console.error('Unknown environment validation error:', error);
    }
    
    console.error('\n🛑 APPLICATION STARTUP ABORTED - Fix environment configuration and restart');
    process.exit(1);
  }
}

/**
 * Additional validation rules for production environment
 */
function validateProductionEnvironment(env: Environment): void {
  const productionWarnings: string[] = [];
  const productionErrors: string[] = [];

  // CEO NOV 13 Gate 0: OAuth2 configuration REQUIRED in production
  if (!env.ISSUER_URL) {
    productionErrors.push('ISSUER_URL required in production - OAuth2 provider cannot function without canonical URL');
  }
  
  // CLIENT_ALLOWED_SCOPES is hardcoded in server/oidc/provider.ts, not an env var
  // No validation needed here

  // CEO NOV 13 Gate 0: Email service REQUIRED in production
  if (!env.POSTMARK_API_TOKEN) {
    productionErrors.push('POSTMARK_API_TOKEN required in production - email service cannot function');
  }
  
  if (!env.FROM_EMAIL) {
    productionErrors.push('FROM_EMAIL required in production - email sender identity not configured');
  }

  // Critical production requirements
  if (!env.AUTH_CLIENT_ID || !env.AUTH_CLIENT_SECRET) {
    productionWarnings.push('AUTH_CLIENT_ID and AUTH_CLIENT_SECRET not configured - OIDC auth may not work');
  }

  if (!env.BUILD_SHA) {
    productionWarnings.push('BUILD_SHA not set - version tracking disabled');
  }

  if (env.CORS_ALLOWED_ORIGINS.includes('localhost') || env.CORS_ALLOWED_ORIGINS.includes('*')) {
    productionErrors.push('CORS_ALLOWED_ORIGINS contains localhost or wildcard in production - security risk');
  }

  // Log warnings
  if (productionWarnings.length > 0) {
    console.warn('⚠️  Production environment warnings:');
    productionWarnings.forEach(warning => console.warn(`  ⚠️  ${warning}`));
  }

  // Fail on critical errors
  if (productionErrors.length > 0) {
    console.error('🚨 Production environment errors:');
    productionErrors.forEach(error => console.error(`  🚨 ${error}`));
    throw new Error('Production environment validation failed - critical security issues detected');
  }
}

/**
 * Get validated environment variables (use after validateEnvironment)
 */
export function getEnvironment(): Environment {
  return environmentSchema.parse(process.env);
}

/**
 * Runtime environment checks for specific features
 */
export const environmentChecks = {
  hasAuth: () => !!process.env.AUTH_CLIENT_ID && !!process.env.AUTH_CLIENT_SECRET,
  isProduction: () => process.env.NODE_ENV === 'production',
  isDevelopment: () => process.env.NODE_ENV === 'development',
  hasInternalApiKey: () => !!process.env.INTERNAL_API_KEY,
  getBuildInfo: () => ({
    sha: process.env.BUILD_SHA || 'unknown',
    env: process.env.NODE_ENV || 'development',
    deploymentEnv: process.env.DEPLOYMENT_ENV || 'development'
  })
};