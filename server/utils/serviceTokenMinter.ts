import * as jose from 'jose';
import { randomUUID } from 'crypto';
import { logger } from '../middleware/auditLogger';

interface ServiceToken {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

interface TokenCache {
  token: ServiceToken | null;
  refreshing: boolean;
}

class ServiceTokenMinter {
  private cache: TokenCache = {
    token: null,
    refreshing: false,
  };

  private getPrivateKeyJWK(): jose.JWK | null {
    try {
      const jwkData: jose.JWK = {
        kty: 'RSA',
        kid: process.env.OIDC_SIGNING_KID!,
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

      if (!jwkData.kid || !jwkData.n || !jwkData.e || !jwkData.d) {
        return null;
      }

      return jwkData;
    } catch (error) {
      logger.warn('Failed to construct private key for service token', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async mintToken(
    clientId: string,
    scope: string,
    audience: string = 'telemetry'
  ): Promise<ServiceToken | null> {
    const privateKeyJWK = this.getPrivateKeyJWK();
    if (!privateKeyJWK) {
      logger.warn('Cannot mint service token: private key not available');
      return null;
    }

    try {
      const issuer = process.env.OIDC_ISSUER || 
                     process.env.ISSUER_URL || 
                     'https://scholar-auth-jamarrlmayes.replit.app/oidc';

      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 300; // 5 minutes (matches M2M token TTL)
      const expiresAt = now + expiresIn;

      const key = await jose.importJWK(privateKeyJWK, 'RS256');

      const jwt = await new jose.SignJWT({
        sub: clientId,
        scope: scope,
        aud: audience,
        client_id: clientId,
        role: 'service',
        roles: ['service'],
        permissions: this.getScopePermissions(scope.split(' ')),
        token_use: 'access',
      })
        .setProtectedHeader({ 
          alg: 'RS256', 
          kid: process.env.OIDC_SIGNING_KID!,
          typ: 'JWT'
        })
        .setIssuedAt(now)
        .setExpirationTime(expiresAt)
        .setJti(randomUUID())
        .setIssuer(issuer)
        .setAudience(audience)
        .sign(key);

      return {
        accessToken: jwt,
        expiresAt: expiresAt * 1000,
        scope,
      };
    } catch (error) {
      logger.error('Failed to mint service token', error as Error);
      return null;
    }
  }

  private getScopePermissions(scopes: string[]): string[] {
    const scopeToPermissions: Record<string, string[]> = {
      'telemetry:write': ['telemetry.emit', 'analytics.write', 'events.publish'],
      'telemetry:read': ['telemetry.read', 'analytics.read', 'stats.read'],
    };

    const permissions = new Set<string>();
    scopes.forEach(scope => {
      const scopePerms = scopeToPermissions[scope] || [];
      scopePerms.forEach(perm => permissions.add(perm));
    });

    return Array.from(permissions);
  }

  async getTelemetryToken(): Promise<string | null> {
    if (this.cache.token && this.cache.token.expiresAt > Date.now() + 60000) {
      return this.cache.token.accessToken;
    }

    if (this.cache.refreshing) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.cache.token?.accessToken || null;
    }

    this.cache.refreshing = true;

    try {
      const clientId = process.env.TELEMETRY_CLIENT_ID || 'scholarship-sage-m2m';
      const audience = process.env.TELEMETRY_AUDIENCE || 'urn:scholar-platform';
      
      const token = await this.mintToken(
        clientId,
        'telemetry:write admin:read',
        audience
      );

      if (token) {
        this.cache.token = token;
        logger.info('Telemetry service token minted', {
          clientId,
          audience,
          expiresAt: new Date(token.expiresAt).toISOString(),
          scope: token.scope,
        });
      }

      return token?.accessToken || null;
    } finally {
      this.cache.refreshing = false;
    }
  }

  invalidateCache(): void {
    this.cache.token = null;
    logger.info('Telemetry token cache invalidated');
  }
}

export const serviceTokenMinter = new ServiceTokenMinter();
