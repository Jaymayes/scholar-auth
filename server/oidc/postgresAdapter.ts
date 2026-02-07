import { db } from '../db';
import { oidcModels } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../middleware/auditLogger';

/**
 * Client Adapter for Static Client Array
 * Wraps static clients array to provide adapter interface for oidc-provider
 */
export class ClientAdapter {
  name: string;
  clients: any[];

  constructor(clients: any[]) {
    this.name = 'Client';
    this.clients = clients;
    console.log(`🔧 CEO ORDER: ClientAdapter initialized with ${clients.length} clients`);
  }

  async find(id: string) {
    // 🔧 CEO ORDER: Enhanced runtime diagnostic logging
    console.log(`🔎 CEO DIAGNOSTIC: ClientAdapter.find() ENTRY:`, {
      timestamp: new Date().toISOString(),
      requested_client_id: id,
      total_clients_in_cache: this.clients.length,
      client_ids_in_cache: this.clients.map(c => c.client_id),
    });
    
    const client = this.clients.find(c => c.client_id === id);
    
    if (client) {
      console.log(`✅ CEO DIAGNOSTIC: Client FOUND in cache:`, { 
        id, 
        redirect_uris: client.redirect_uris,
        token_auth_method: client.token_endpoint_auth_method,
        has_secret: !!client.client_secret,
        secret_masked: client.client_secret ? `${client.client_secret.substring(0, 4)}***${client.client_secret.substring(client.client_secret.length - 4)}` : 'NONE'
      });
      return client;
    } else {
      console.error(`❌ CEO DIAGNOSTIC: Client NOT FOUND in cache:`, { 
        requested_id: id,
        available_ids: this.clients.map(c => c.client_id),
        case_sensitive_check: this.clients.find(c => c.client_id.toLowerCase() === id.toLowerCase()) ? 'FOUND_WITH_CASE_MISMATCH' : 'NOT_FOUND',
      });
      return undefined;
    }
  }

  async upsert() {
    // Clients are static, no upsert needed
  }

  async destroy() {
    // Clients are static, no destroy needed
  }

  async consume() {
    // Clients are static, no consume needed
  }

  async revokeByGrantId() {
    // Not applicable to clients
  }
}

/**
 * PostgreSQL Adapter for OIDC Provider
 * Implements persistent storage for OAuth/OIDC tokens, grants, and authorization codes
 * 
 * This replaces the in-memory MemoryAdapter to ensure tokens persist across server restarts
 * and meet production requirements for auditability and reliability.
 */
export class PostgresAdapter {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  async upsert(id: string, payload: any, expiresIn?: number) {
    try {
      const expiresAt = expiresIn 
        ? new Date(Date.now() + expiresIn * 1000) 
        : null;

      await db.insert(oidcModels).values({
        id,
        type: this.name,
        payload,
        grantId: payload.grantId || null,
        userCode: payload.userCode || null,
        uid: payload.uid || null,
        expiresAt,
      }).onConflictDoUpdate({
        target: oidcModels.id,
        set: {
          payload,
          grantId: payload.grantId || null,
          userCode: payload.userCode || null,
          uid: payload.uid || null,
          expiresAt,
        }
      });
    } catch (error) {
      logger.error('OIDC PostgresAdapter upsert failed', error as Error);
      throw error;
    }
  }

  async find(id: string) {
    try {
      console.log(`🔎 PostgresAdapter.find() called:`, { type: this.name, id });
      
      const rows = await db
        .select()
        .from(oidcModels)
        .where(and(
          eq(oidcModels.id, id),
          eq(oidcModels.type, this.name)
        ))
        .limit(1);

      if (rows.length === 0) {
        console.log(`❌ PostgresAdapter.find() NOT FOUND:`, { type: this.name, id });
        return undefined;
      }
      
      console.log(`✅ PostgresAdapter.find() FOUND:`, { type: this.name, id, hasPayload: !!rows[0].payload });

      const item = rows[0];

      // Check expiration
      if (item.expiresAt && item.expiresAt.getTime() <= Date.now()) {
        await this.destroy(id);
        return undefined;
      }

      let payload = item.payload;

      // 🔐 CEO P0: For Client models, swap DB hash with plaintext from env
      // DB stores bcrypt hash (at-rest security), but oidc-provider needs plaintext
      if (this.name === 'Client' && payload && typeof payload === 'object') {
        const clientId = (payload as any).client_id || id;
        const envSecret = this.getClientSecretFromEnv(clientId);
        
        if (envSecret) {
          // Replace bcrypt hash with plaintext from env
          payload = {
            ...payload,
            client_secret: envSecret
          };
          console.log(`🔐 Injected plaintext secret for client: ${clientId}`);
        } else {
          console.warn(`⚠️  No env secret found for client: ${clientId} (may be public client)`);
        }
      }

      return payload;
    } catch (error) {
      logger.error('OIDC PostgresAdapter find failed', error as Error);
      return undefined;
    }
  }

  /**
   * 🔐 CEO P0: Map client_id to environment secret
   * Loads plaintext secret from process.env for runtime use
   */
  private getClientSecretFromEnv(clientId: string): string | null {
    const secretMap: Record<string, string> = {
      'scholarship-sage-m2m': process.env.M2M_SCHOLARSHIP_SAGE_SECRET || '',
      'scholarship-api-service': process.env.SCHOLARSHIP_API_SERVICE_SECRET || '',
      'scholarship-agent-service': process.env.SCHOLARSHIP_AGENT_SERVICE_SECRET || '',
      'scholarship_agent': process.env.SCHOLARSHIP_AGENT_SECRET || '', // S2S telemetry client
      'auto-com-center-service': process.env.AUTO_COM_CENTER_SERVICE_SECRET || '',
      'auto-page-maker-service': process.env.AUTO_PAGE_MAKER_SERVICE_SECRET || '',
      'provider-register-m2m': process.env.PROVIDER_REGISTER_M2M_SECRET || '',
      'reviewer-portal-m2m': process.env.REVIEWER_PORTAL_M2M_SECRET || '',
      'admin-dashboard-m2m': process.env.ADMIN_DASHBOARD_M2M_SECRET || '',
      'provider-register': process.env.PROVIDER_REGISTER_SECRET || '',
      'student-pilot': process.env.STUDENT_PILOT_SECRET || ''
    };

    const secret = secretMap[clientId];
    return secret && secret.length > 0 ? secret : null;
  }

  async findByUserCode(userCode: string) {
    try {
      const rows = await db
        .select()
        .from(oidcModels)
        .where(and(
          eq(oidcModels.userCode, userCode),
          eq(oidcModels.type, this.name)
        ))
        .limit(1);

      return rows.length > 0 ? rows[0].payload : undefined;
    } catch (error) {
      logger.error('OIDC PostgresAdapter findByUserCode failed', error as Error);
      return undefined;
    }
  }

  async findByUid(uid: string) {
    try {
      const rows = await db
        .select()
        .from(oidcModels)
        .where(and(
          eq(oidcModels.uid, uid),
          eq(oidcModels.type, this.name)
        ))
        .limit(1);

      return rows.length > 0 ? rows[0].payload : undefined;
    } catch (error) {
      logger.error('OIDC PostgresAdapter findByUid failed', error as Error);
      return undefined;
    }
  }

  async consume(id: string) {
    try {
      const rows = await db
        .select()
        .from(oidcModels)
        .where(and(
          eq(oidcModels.id, id),
          eq(oidcModels.type, this.name)
        ))
        .limit(1);

      if (rows.length > 0) {
        const item = rows[0];
        const consumedPayload = {
          ...(item.payload as object),
          consumed: Math.floor(Date.now() / 1000)
        };

        await db
          .update(oidcModels)
          .set({
            payload: consumedPayload,
            consumedAt: new Date()
          })
          .where(eq(oidcModels.id, id));
      }
    } catch (error) {
      logger.error('OIDC PostgresAdapter consume failed', error as Error);
    }
  }

  async destroy(id: string) {
    try {
      await db
        .delete(oidcModels)
        .where(and(
          eq(oidcModels.id, id),
          eq(oidcModels.type, this.name)
        ));
    } catch (error) {
      logger.error('OIDC PostgresAdapter destroy failed', error as Error);
    }
  }

  async revokeByGrantId(grantId: string) {
    try {
      await db
        .delete(oidcModels)
        .where(eq(oidcModels.grantId, grantId));
    } catch (error) {
      logger.error('OIDC PostgresAdapter revokeByGrantId failed', error as Error);
    }
  }
}
