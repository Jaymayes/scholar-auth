// Policy Guard - P0 Hardening Requirement
// Automated check to block wildcards in prod/staging CORS configs

export interface CorsPolicy {
  allowedOrigins: string[];
  environment: string;
}

export class PolicyViolationError extends Error {
  constructor(message: string, public violations: string[]) {
    super(message);
    this.name = 'PolicyViolationError';
  }
}

/**
 * Validates CORS policy against security requirements
 * CRITICAL: No wildcards allowed in production/staging
 */
export function validateCorsPolicy(policy: CorsPolicy): void {
  const violations: string[] = [];
  
  // Rule 1: No wildcards in production or staging
  if (policy.environment === 'production' || policy.environment === 'staging') {
    const hasWildcards = policy.allowedOrigins.some(origin => 
      origin.includes('*') || 
      origin === '*' ||
      /\*/.test(origin)
    );
    
    if (hasWildcards) {
      violations.push(
        `Wildcards detected in ${policy.environment} CORS policy. ` +
        'Production and staging must use exact domain allowlists only.'
      );
    }
  }
  
  // Rule 2: All origins must use HTTPS (except localhost in dev)
  const insecureOrigins = policy.allowedOrigins.filter(origin => {
    if (origin.startsWith('http://localhost') && policy.environment === 'development') {
      return false; // Allow localhost HTTP in dev only
    }
    return origin.startsWith('http://') && !origin.startsWith('https://');
  });
  
  if (insecureOrigins.length > 0) {
    violations.push(
      `Insecure HTTP origins detected: ${insecureOrigins.join(', ')}. ` +
      'All origins must use HTTPS except localhost in development.'
    );
  }
  
  // Rule 3: No empty or invalid origins
  const invalidOrigins = policy.allowedOrigins.filter(origin => 
    !origin || 
    origin.trim() === '' ||
    (!origin.startsWith('http://') && !origin.startsWith('https://'))
  );
  
  if (invalidOrigins.length > 0) {
    violations.push(
      `Invalid origins detected: ${invalidOrigins.join(', ')}. ` +
      'All origins must be valid HTTP/HTTPS URLs.'
    );
  }
  
  // Rule 4: Reasonable origin count limits
  if (policy.allowedOrigins.length > 50) {
    violations.push(
      `Too many allowed origins (${policy.allowedOrigins.length}). ` +
      'Consider if this allowlist is necessary for security.'
    );
  }
  
  if (violations.length > 0) {
    throw new PolicyViolationError(
      `CORS policy validation failed for ${policy.environment} environment`,
      violations
    );
  }
}

/**
 * Middleware to enforce CORS policy validation at startup
 */
export function enforceCorsPolicy(allowedOrigins: string[], environment: string = 'development') {
  try {
    validateCorsPolicy({ allowedOrigins, environment });
    console.log(`✅ CORS policy validated for ${environment} environment`);
  } catch (error) {
    if (error instanceof PolicyViolationError) {
      console.error(`🚨 CORS POLICY VIOLATION in ${environment}:`);
      error.violations.forEach(violation => {
        console.error(`   • ${violation}`);
      });
      
      // In production/staging, policy violations should be fatal
      if (environment === 'production' || environment === 'staging') {
        console.error('🛑 FATAL: Policy violations in production/staging are not allowed');
        process.exit(1);
      } else {
        console.warn('⚠️  Policy violations in development - review and fix');
      }
    } else {
      throw error;
    }
  }
}

// Development helper to test policies
export function testCorsPolicy(origins: string[], env: string) {
  console.log(`🧪 Testing CORS policy for ${env}:`);
  console.log(`   Origins: ${origins.join(', ')}`);
  
  try {
    validateCorsPolicy({ allowedOrigins: origins, environment: env });
    console.log('   ✅ Policy validation passed');
  } catch (error) {
    if (error instanceof PolicyViolationError) {
      console.log('   ❌ Policy validation failed:');
      error.violations.forEach(violation => {
        console.log(`      • ${violation}`);
      });
    }
  }
}