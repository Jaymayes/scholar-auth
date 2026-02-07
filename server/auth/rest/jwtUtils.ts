import * as jose from 'jose';
import { logger } from "../../middleware/auditLogger";

const ISSUER = process.env.ISSUER_URL || 'https://auth.scholaraiadvisor.com';
const AUDIENCE = process.env.JWT_AUDIENCE || 'scholar-platform';

let privateKey: any;
let publicKey: any;

async function getKeys() {
  if (!privateKey || !publicKey) {
    const privKeyPem = process.env.JWT_PRIVATE_KEY;
    const pubKeyPem = process.env.JWT_PUBLIC_KEY;
    
    if (!privKeyPem || !pubKeyPem) {
      throw new Error('JWT keys not configured. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY environment variables.');
    }

    privateKey = await jose.importPKCS8(privKeyPem, 'RS256');
    publicKey = await jose.importSPKI(pubKeyPem, 'RS256');
  }

  return { privateKey, publicKey };
}

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: 'student' | 'admin' | 'reviewer' | null;
}

export async function generateJWT(user: User, ttl: number, isRefreshToken: boolean = false): Promise<string> {
  const { privateKey: key } = await getKeys();
  
  const now = Math.floor(Date.now() / 1000);
  
  const payload: any = {
    sub: user.id,
    email: user.email,
    role: user.role || 'student',
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ttl,
  };

  if (isRefreshToken) {
    payload.isRefreshToken = true;
  } else {
    payload.scope = getScopes(user.role || 'student');
  }

  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(now + ttl)
    .setSubject(user.id)
    .sign(key);

  return jwt;
}

export async function verifyJWT(token: string): Promise<any | null> {
  try {
    const { publicKey: key } = await getKeys();
    
    const { payload } = await jose.jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    return payload;
  } catch (error) {
    logger.warn(`[JWT] Token verification failed: ${error}`);
    return null;
  }
}

export async function getJWKS(): Promise<any> {
  const { publicKey: key } = await getKeys();
  
  const jwk = await jose.exportJWK(key);
  
  return {
    keys: [
      {
        ...jwk,
        use: 'sig',
        alg: 'RS256',
        kid: 'rest-auth-2025',
      },
    ],
  };
}

function getScopes(role: string): string {
  const scopes: string[] = ['openid', 'profile', 'email'];
  
  switch (role) {
    case 'student':
      scopes.push('read:scholarships', 'write:applications', 'read:profile', 'read:student_data');
      break;
    case 'provider':
      scopes.push('read:scholarships', 'write:scholarships', 'read:applications', 'read:provider_data', 'write:provider_data');
      break;
    case 'reviewer':
      scopes.push('read:scholarships', 'read:applications', 'write:reviews', 'read:reviewer_data');
      break;
    case 'admin':
      scopes.push(
        'read:scholarships', 'write:scholarships',
        'read:applications', 'write:applications',
        'read:users', 'write:users',
        'read:reviews', 'write:reviews',
        'admin:system', 'admin:audit'
      );
      break;
  }
  
  return scopes.join(' ');
}
