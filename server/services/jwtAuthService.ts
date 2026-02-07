/**
 * JWT Authentication Service - HARDENED
 * 
 * SECURITY HARDENING (Dec 17, 2025):
 * 1. RS256 asymmetric signing (was HS256) - uses OIDC RSA keypair
 * 2. JTI claim for replay defense
 * 3. Separate token storage - access/refresh tokens stored server-side
 * 4. Only minimal claims (sub, email, jti) in JWT cookie
 * 
 * Original CEO DIRECTIVE (Nov 9): Emergency JWT migration from PGStore
 */

import { SignJWT, jwtVerify, importJWK } from 'jose';
import type { JWK } from 'jose';
import { randomUUID } from 'crypto';
import { logger } from '../middleware/auditLogger';
import { db } from '../db';
import { userTokenStore } from '@shared/schema';
import { eq, and, lt, isNull } from 'drizzle-orm';
import type { Request, Response, NextFunction } from 'express';
import { getIssuerUrl } from '../oidc/provider';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = 'scholarai.jwt';
// 🔧 P0 FIX (2026-01-24): Use unified issuer from OIDC provider to prevent oidc_issuer_mismatch
// Previous: Hardcoded 'https://scholar-auth-jamarrlmayes.replit.app' (missing /oidc suffix)
// Now: Uses getIssuerUrl() which returns 'https://scholar-auth-jamarrlmayes.replit.app/oidc'
const ISSUER = getIssuerUrl();
const AUDIENCE = 'scholarai-ecosystem';

interface UserClaims {
  sub: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

interface StoredTokens {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

let privateKeyCache: CryptoKey | null = null;
let publicKeyCache: CryptoKey | null = null;

function getSigningKid(): string {
  return process.env.OIDC_SIGNING_KID || 'scholar-auth-prod-20251017';
}

async function getPrivateKey(): Promise<CryptoKey> {
  if (privateKeyCache) return privateKeyCache;
  
  const jwk: JWK = {
    kty: 'RSA',
    kid: getSigningKid(),
    use: 'sig',
    alg: 'RS256',
    n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
    e: process.env.OIDC_RSA_PUBLIC_KEY_E!,
    d: process.env.OIDC_RSA_PRIVATE_KEY_D!,
    p: process.env.OIDC_RSA_PRIVATE_KEY_P!,
    q: process.env.OIDC_RSA_PRIVATE_KEY_Q!,
    dp: process.env.OIDC_RSA_PRIVATE_KEY_DP!,
    dq: process.env.OIDC_RSA_PRIVATE_KEY_DQ!,
    qi: process.env.OIDC_RSA_PRIVATE_KEY_QI!,
  };
  
  privateKeyCache = await importJWK(jwk, 'RS256') as CryptoKey;
  return privateKeyCache;
}

async function getPublicKey(): Promise<CryptoKey> {
  if (publicKeyCache) return publicKeyCache;
  
  const jwk: JWK = {
    kty: 'RSA',
    kid: getSigningKid(),
    use: 'sig',
    alg: 'RS256',
    n: process.env.OIDC_RSA_PUBLIC_KEY_N!,
    e: process.env.OIDC_RSA_PUBLIC_KEY_E!,
  };
  
  publicKeyCache = await importJWK(jwk, 'RS256') as CryptoKey;
  return publicKeyCache;
}

// NOTE: HS256 helper functions removed as part of SEC-01 hardening
// All JWT operations now use RS256 exclusively via OIDC RSA keypair

export async function signJWT(claims: UserClaims): Promise<string> {
  const jti = claims.jti || randomUUID();
  const now = Math.floor(Date.now() / 1000);
  
  // SEC-01 HARDENING: RS256 only - no HS256 fallback (algorithm confusion attack prevention)
  const privateKey = await getPrivateKey();
  const kid = getSigningKid();
  
  const jwt = await new SignJWT({ 
    sub: claims.sub,
    email: claims.email,
    first_name: claims.first_name,
    last_name: claims.last_name,
    profile_image_url: claims.profile_image_url,
    jti,
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + Math.floor(SESSION_TTL_MS / 1000))
    .sign(privateKey);
  
  logger.info('JWT signed with RS256', {
    action: 'jwt_signed_rs256',
    kid,
    jti,
  });
  
  return jwt;
}

export async function verifyJWT(token: string): Promise<UserClaims | null> {
  // SEC-01 HARDENING: RS256 only - HS256 fallback REMOVED (algorithm confusion attack prevention)
  // Attack vector: Attacker uses public key as HMAC secret to forge tokens
  // Mitigation: Strictly reject any non-RS256 tokens
  try {
    const publicKey = await getPublicKey();
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],  // SECURITY: Only RS256 accepted
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    
    if (payload.jti) {
      const isRevoked = await isTokenRevoked(payload.jti as string);
      if (isRevoked) {
        logger.warn('Token revoked', { jti: payload.jti, action: 'jwt_revoked' });
        return null;
      }
    }
    
    return payload as UserClaims;
  } catch (error) {
    // SECURITY: Log and reject - no fallback to weaker algorithms
    logger.warn('JWT RS256 verification failed', {
      action: 'jwt_verify_failed_rs256_only',
      errorCode: (error as any)?.code || 'unknown',
    });
    
    return null;
  }
}

async function isTokenRevoked(jti: string): Promise<boolean> {
  try {
    const result = await db
      .select({ revoked: userTokenStore.revoked })
      .from(userTokenStore)
      .where(eq(userTokenStore.jti, jti))
      .limit(1);
    
    return result.length > 0 && result[0].revoked === true;
  } catch (error) {
    // SECURITY FIX: Fail-closed - if DB unavailable, treat token as revoked
    // Previous: returned false (fail-open) allowing revoked tokens during outages
    logger.error('Token revocation check failed - FAILING CLOSED', 
      error instanceof Error ? error : new Error(String(error)),
      { jti, action: 'token_revocation_check_error_fail_closed' }
    );
    return true;  // SECURITY: Fail-closed - assume revoked if we can't verify
  }
}

export async function storeTokens(
  jti: string, 
  userId: string, 
  tokens: StoredTokens
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const tokenExpiresAt = tokens.expires_at 
      ? new Date(tokens.expires_at * 1000) 
      : undefined;
    
    await db.insert(userTokenStore).values({
      jti,
      userId,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || null,
      tokenExpiresAt,
      expiresAt,
    });
    
    logger.info('Tokens stored securely', {
      action: 'tokens_stored',
      jti,
      userId,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
    });
  } catch (error) {
    logger.error('Failed to store tokens', 
      error instanceof Error ? error : new Error(String(error)),
      { jti, userId, action: 'token_store_error' }
    );
    throw error;
  }
}

export async function getStoredTokens(jti: string): Promise<StoredTokens | null> {
  try {
    const result = await db
      .select()
      .from(userTokenStore)
      .where(
        and(
          eq(userTokenStore.jti, jti),
          eq(userTokenStore.revoked, false)
        )
      )
      .limit(1);
    
    if (result.length === 0) return null;
    
    const record = result[0];
    return {
      access_token: record.accessToken || undefined,
      refresh_token: record.refreshToken || undefined,
      expires_at: record.tokenExpiresAt 
        ? Math.floor(record.tokenExpiresAt.getTime() / 1000) 
        : undefined,
    };
  } catch (error) {
    logger.error('Failed to retrieve tokens', 
      error instanceof Error ? error : new Error(String(error)),
      { jti, action: 'token_retrieve_error' }
    );
    return null;
  }
}

export async function revokeToken(jti: string): Promise<void> {
  try {
    await db
      .update(userTokenStore)
      .set({ revoked: true, revokedAt: new Date() })
      .where(eq(userTokenStore.jti, jti));
    
    logger.info('Token revoked', { jti, action: 'token_revoked' });
  } catch (error) {
    logger.error('Failed to revoke token', 
      error instanceof Error ? error : new Error(String(error)),
      { jti, action: 'token_revoke_error' }
    );
  }
}

export async function revokeAllUserTokens(userId: string): Promise<number> {
  try {
    const result = await db
      .update(userTokenStore)
      .set({ revoked: true, revokedAt: new Date() })
      .where(
        and(
          eq(userTokenStore.userId, userId),
          eq(userTokenStore.revoked, false)
        )
      );
    
    logger.info('All user tokens revoked', { 
      userId, 
      action: 'all_tokens_revoked' 
    });
    
    return 1;
  } catch (error) {
    logger.error('Failed to revoke all user tokens', 
      error instanceof Error ? error : new Error(String(error)),
      { userId, action: 'all_tokens_revoke_error' }
    );
    return 0;
  }
}

export async function cleanupExpiredTokens(): Promise<void> {
  try {
    await db
      .delete(userTokenStore)
      .where(lt(userTokenStore.expiresAt, new Date()));
    
    logger.info('Expired tokens cleaned up', { action: 'tokens_cleanup' });
  } catch (error) {
    logger.error('Failed to cleanup expired tokens', 
      error instanceof Error ? error : new Error(String(error)),
      { action: 'tokens_cleanup_error' }
    );
  }
}

export function setJWTCookie(res: Response, token: string): void {
  const isHttpsEnvironment = process.env.NODE_ENV === 'production' || 
    process.env.REPLIT_DEPLOYMENT === '1' ||
    process.env.REPLIT_DEV_DOMAIN?.includes('.replit.dev');
  
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttpsEnvironment,
    sameSite: isHttpsEnvironment ? 'none' : 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
  
  logger.info('JWT cookie set', {
    action: 'jwt_cookie_set',
    secure: isHttpsEnvironment,
    ttl: SESSION_TTL_MS
  });
}

export function clearJWTCookie(res: Response): void {
  const isHttpsEnvironment = process.env.NODE_ENV === 'production' || 
    process.env.REPLIT_DEPLOYMENT === '1' ||
    process.env.REPLIT_DEV_DOMAIN?.includes('.replit.dev');
  
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isHttpsEnvironment,
    sameSite: isHttpsEnvironment ? 'none' : 'lax',
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  });
  
  logger.info('JWT cookie cleared (explicit expiration)', {
    action: 'jwt_cookie_cleared',
    secure: isHttpsEnvironment,
    httpOnly: true,
    method: 'explicit_expiration'
  });
}

export async function jwtAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME];
  
  if (!token) {
    return next();
  }
  
  try {
    const claims = await verifyJWT(token);
    
    if (!claims) {
      clearJWTCookie(res);
      return next();
    }
    
    let storedTokens: StoredTokens | null = null;
    if (claims.jti) {
      storedTokens = await getStoredTokens(claims.jti);
    }
    
    req.user = {
      claims,
      access_token: storedTokens?.access_token,
      refresh_token: storedTokens?.refresh_token,
      expires_at: storedTokens?.expires_at,
    };
    
    // P0 FIX (Dec 23, 2025): Add isAuthenticated() polyfill for Passport compatibility
    // OIDC interaction handlers check req.isAuthenticated() which Passport provides
    // With JWT auth (no Passport sessions), we need to provide this function ourselves
    (req as any).isAuthenticated = () => !!req.user;
    
    return next();
  } catch (error) {
    logger.error('JWT middleware error', 
      error instanceof Error ? error : new Error(String(error)),
      { action: 'jwt_middleware_error' }
    );
    
    clearJWTCookie(res);
    return next();
  }
}

export async function issueJWTForUser(
  oidcClaims: any,
  tokens: { access_token?: string; refresh_token?: string; }
): Promise<string> {
  const jti = randomUUID();
  
  const userClaims: UserClaims = {
    sub: oidcClaims.sub,
    email: oidcClaims.email,
    first_name: oidcClaims.first_name,
    last_name: oidcClaims.last_name,
    profile_image_url: oidcClaims.profile_image_url,
    jti,
  };
  
  const jwt = await signJWT(userClaims);
  
  await storeTokens(jti, oidcClaims.sub, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: oidcClaims.exp,
  });
  
  logger.info('JWT issued for user (RS256 + separate storage)', {
    action: 'jwt_issued_hardened',
    userId: userClaims.sub,
    jti,
    ttl: SESSION_TTL_MS
  });
  
  return jwt;
}
