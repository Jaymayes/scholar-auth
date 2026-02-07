import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// 🚨 P1 HOTFIX (Nov 9, 23:05 UTC): Strip psql command prefix from DATABASE_URL
// Root cause: DATABASE_URL contains "psql 'postgresql://..." instead of clean connection string
// This causes "getaddrinfo ENOTFOUND base" errors in pg-pool
const rawDatabaseUrl = process.env.DATABASE_URL;
const cleanDatabaseUrl = rawDatabaseUrl.replace(/^psql\s+'(.+)'$/, '$1').trim();
if (rawDatabaseUrl !== cleanDatabaseUrl) {
  console.warn('⚠️  DATABASE_URL had psql prefix - stripped for clean connection');
}

// 🚨 ZT3G AUTH REPAIR SPRINT (2026-01-23): Enhanced pooling for cold-start stability
// RUN_ID: CEOSPRINT-20260123-EXEC-ZT3G-FIX-AUTH-009
// CHANGE: Reduced pool size for Neon serverless, extended timeouts for cold start
export const pool = new Pool({ 
  connectionString: cleanDatabaseUrl,
  // ZT3G AUTH REPAIR CONFIG (2026-01-23)
  max: 5,                          // Reduced max for serverless efficiency
  min: 0,                          // Allow full scale-down for cost efficiency
  idleTimeoutMillis: 30000,        // 30s idle timeout (extended for stability)
  connectionTimeoutMillis: 5000,   // 5s acquire timeout (extended for cold starts)
  statement_timeout: 5000,         // 5s statement timeout
  query_timeout: 5000,             // 5s query timeout
  keepAlive: true,                 // Enable keepalive for stability
  ssl: { rejectUnauthorized: false }, // SSL for Neon serverless
});

// 🔧 P1 FIX (2026-01-24): Pool error handling to prevent blank_page_intermittent
// Neon serverless connections can drop during cold starts - gracefully handle this
pool.on('error', (err: Error) => {
  console.warn('⚠️ Pool connection error (non-fatal, will reconnect):', err.message);
});

pool.on('connect', () => {
  console.log('✅ Pool connection established');
});

// SEV-2: Pool metrics for health endpoint
export function getPoolMetrics(): {
  db_connected: boolean;
  pool_total: number;
  pool_idle: number;
  pool_in_use: number;
  pool_waiting: number;
  pool_utilization_pct: number;
} {
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  const inUse = total - idle;
  
  return {
    db_connected: total > 0,
    pool_total: total,
    pool_idle: idle,
    pool_in_use: inUse,
    pool_waiting: waiting,
    pool_utilization_pct: total > 0 ? Math.round((inUse / 5) * 100) : 0,
  };
}

export const db = drizzle({ client: pool, schema });