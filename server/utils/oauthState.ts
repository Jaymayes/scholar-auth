import crypto from 'crypto';
import { base64URLDecode } from './pkce.js';

/**
 * OAuth State utilities for stateless, HMAC-signed state tokens
 * Prevents CSRF attacks without relying on cookies
 */

/**
 * UTM tracking parameters for marketing attribution
 */
export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface OAuthStatePayload {
  nonce: string;
  ts: number;
  redirect_uri: string;
  origin: string; // Request origin for validation
  // P0 FIX: Include PKCE data in state for cross-domain compatibility
  code_verifier?: string;
  return_to?: string;
  original_origin?: string; // Full origin URL for post-auth redirect
  // UTM attribution: preserve marketing tracking across auth handoff
  utm?: UTMParams;
}

/**
 * Maximum age of state token in milliseconds (5 minutes)
 */
const STATE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Gets the HMAC secret from environment or generates a secure default
 * @returns {string} HMAC secret (32+ bytes recommended)
 */
function getHMACSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.SESSION_SECRET;
  
  if (!secret) {
    throw new Error('OAUTH_STATE_SECRET or SESSION_SECRET environment variable is required for secure state signing');
  }
  
  if (secret.length < 32) {
    console.warn('⚠️  OAUTH_STATE_SECRET is less than 32 characters. For production, use a stronger secret.');
  }
  
  return secret;
}

/**
 * Generates a cryptographically secure random nonce
 * @returns {string} Base64URL-encoded random string (16 bytes)
 */
function generateNonce(): string {
  const randomBytes = crypto.randomBytes(16);
  return randomBytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Options for creating a signed state with PKCE data
 */
export interface CreateStateOptions {
  redirectUri: string;
  origin: string;
  codeVerifier?: string;
  returnTo?: string;
  originalOrigin?: string;
  utm?: UTMParams; // UTM attribution for cross-domain tracking
}

/**
 * Creates a signed OAuth state token with embedded PKCE data
 * Format: base64url(JSON + "." + HMAC-SHA256)
 * 
 * P0 FIX: State now carries all PKCE data, eliminating cross-domain cookie dependency
 * 
 * @param {string} redirectUri - The redirect URI to include in state
 * @param {string} origin - Request origin/hostname for validation
 * @param {CreateStateOptions} options - Optional PKCE and redirect data
 * @returns {string} Signed state token
 */
export function createSignedState(
  redirectUri: string, 
  origin: string,
  options?: Omit<CreateStateOptions, 'redirectUri' | 'origin'>
): string {
  const payload: OAuthStatePayload = {
    nonce: generateNonce(),
    ts: Date.now(),
    redirect_uri: redirectUri,
    origin,
    // P0 FIX: Include PKCE data for cross-domain OAuth
    code_verifier: options?.codeVerifier,
    return_to: options?.returnTo,
    original_origin: options?.originalOrigin,
    // UTM attribution: preserve across auth handoff
    utm: options?.utm,
  };
  
  const payloadJson = JSON.stringify(payload);
  const secret = getHMACSecret();
  
  // Sign the payload using HMAC-SHA256
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadJson)
    .digest('base64url'); // Fixed: Use base64url directly
  
  // Combine payload + signature (no double encoding)
  const stateToken = `${payloadJson}.${signature}`;
  const encoded = Buffer.from(stateToken, 'utf-8').toString('base64url');
  
  return encoded;
}

/**
 * Verifies and decodes a signed OAuth state token
 * 
 * @param {string} stateToken - The state token to verify
 * @param {string} requestOrigin - Request origin/hostname to validate against
 * @returns {OAuthStatePayload | null} Decoded payload if valid, null otherwise
 */
export function verifySignedState(stateToken: string, requestOrigin?: string): OAuthStatePayload | null {
  try {
    // Decode the base64url state token (single encoding)
    const decoded = Buffer.from(stateToken, 'base64url').toString('utf-8');
    
    // Split into payload and signature
    const lastDotIndex = decoded.lastIndexOf('.');
    if (lastDotIndex === -1) {
      console.warn('⚠️  Invalid state token format: no signature separator');
      return null;
    }
    
    const payloadJson = decoded.substring(0, lastDotIndex);
    const receivedSignature = decoded.substring(lastDotIndex + 1);
    
    // Recompute the signature
    const secret = getHMACSecret();
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadJson)
      .digest('base64url');
    
    // Safe constant-time comparison (check lengths first)
    if (receivedSignature.length !== expectedSignature.length) {
      console.warn('⚠️  State token signature length mismatch');
      return null;
    }
    
    if (!crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) {
      console.warn('⚠️  State token signature verification failed');
      return null;
    }
    
    // Parse the payload
    const payload: OAuthStatePayload = JSON.parse(payloadJson);
    
    // Validate origin if provided
    if (requestOrigin && payload.origin !== requestOrigin) {
      console.warn(`⚠️  State token origin mismatch: expected ${requestOrigin}, got ${payload.origin}`);
      return null;
    }
    
    // Check timestamp expiry (5 minutes)
    const age = Date.now() - payload.ts;
    if (age > STATE_MAX_AGE_MS) {
      console.warn(`⚠️  State token expired: ${age}ms old (max: ${STATE_MAX_AGE_MS}ms)`);
      return null;
    }
    
    if (age < 0) {
      console.warn('⚠️  State token has future timestamp');
      return null;
    }
    
    return payload;
  } catch (error) {
    console.warn('⚠️  State token verification error:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Validates that a redirect URI is safe
 * Basic validation - extend as needed for your security requirements
 * 
 * @param {string} redirectUri - The redirect URI to validate
 * @returns {boolean} True if valid
 */
export function validateRedirectUri(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    
    // Only allow https in production (allow http for localhost in dev)
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      return false;
    }
    
    if (process.env.NODE_ENV !== 'production' && url.hostname === 'localhost') {
      return true;
    }
    
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}
