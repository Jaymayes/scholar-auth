/**
 * Client Metadata LRU Cache
 * CEO DIRECTIVE (Nov 7, 17:05 UTC): Cache client metadata by client_id with 300s TTL
 * Purpose: Reduce DB lookups during token endpoint hot path
 * Scope: Cache scopes, grant_types, redirect_uris (NOT client_secret)
 */

interface ClientCacheEntry {
  clientId: string;
  grantTypes: string[];
  responseTypes: string[];
  redirectUris: string[];
  scopes?: string[];
  tokenEndpointAuthMethod: string;
  cachedAt: number;
}

class ClientMetadataCache {
  private cache: Map<string, ClientCacheEntry> = new Map();
  private ttl: number = 300_000; // 300s = 5 minutes per CEO directive
  private maxSize: number = 100; // LRU eviction after 100 entries

  get(clientId: string): ClientCacheEntry | null {
    const entry = this.cache.get(clientId);
    if (!entry) return null;

    // Check TTL expiration
    if (Date.now() - entry.cachedAt > this.ttl) {
      this.cache.delete(clientId);
      return null;
    }

    // LRU: Move to end (most recently used)
    this.cache.delete(clientId);
    this.cache.set(clientId, entry);
    
    return entry;
  }

  set(clientId: string, metadata: Omit<ClientCacheEntry, 'cachedAt'>): void {
    // LRU eviction: Remove oldest entry if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(clientId, {
      ...metadata,
      cachedAt: Date.now(),
    });
  }

  invalidate(clientId: string): void {
    this.cache.delete(clientId);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
    };
  }
}

export const clientCache = new ClientMetadataCache();
export type { ClientCacheEntry };
