import crypto from 'crypto';

/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0
 * Implements RFC 7636 with S256 code challenge method
 */

/**
 * Generates a cryptographically secure random string for use as code_verifier
 * Length: 43-128 characters (RFC 7636 recommendation: 43 chars minimum)
 * @returns {string} Base64URL-encoded random string
 */
export function generateCodeVerifier(): string {
  // Generate 32 random bytes (256 bits)
  const randomBytes = crypto.randomBytes(32);
  // Base64URL encode: replace +/= with -_~ for URL safety
  return base64URLEncode(randomBytes);
}

/**
 * Generates code_challenge from code_verifier using SHA-256
 * Method: S256 (recommended by RFC 7636)
 * @param {string} codeVerifier - The code verifier
 * @returns {string} Base64URL-encoded SHA-256 hash of code_verifier
 */
export function generateCodeChallenge(codeVerifier: string): string {
  // Hash the code_verifier using SHA-256
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  // Base64URL encode the hash
  return base64URLEncode(hash);
}

/**
 * Verifies that a code_verifier matches a code_challenge
 * @param {string} codeVerifier - The code verifier to verify
 * @param {string} codeChallenge - The expected code challenge
 * @returns {boolean} True if verifier matches challenge
 */
export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const computedChallenge = generateCodeChallenge(codeVerifier);
  return computedChallenge === codeChallenge;
}

/**
 * Base64URL encoding (RFC 4648 Section 5)
 * Converts binary data to URL-safe base64 string
 * @param {Buffer} buffer - Binary data to encode
 * @returns {string} Base64URL-encoded string
 */
function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL decoding
 * Converts URL-safe base64 string back to binary data
 * @param {string} str - Base64URL-encoded string
 * @returns {Buffer} Decoded binary data
 */
export function base64URLDecode(str: string): Buffer {
  // Add padding if necessary
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
  return Buffer.from(base64, 'base64');
}
