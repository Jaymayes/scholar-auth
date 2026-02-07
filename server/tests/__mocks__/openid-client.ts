/**
 * Mock for openid-client to avoid ESM import issues in Jest
 * 
 * This allows HTTP tests to import routes without Jest parsing errors
 */

export const Strategy = class MockStrategy {
  constructor(...args: any[]) {
    // Mock strategy constructor
  }
};

export const generators = {
  codeVerifier: () => 'mock-code-verifier',
  codeChallenge: () => 'mock-code-challenge',
  state: () => 'mock-state'
};

export const discovery = async (issuer: string) => {
  return {
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`
  };
};

export default {
  Strategy,
  generators,
  discovery
};
