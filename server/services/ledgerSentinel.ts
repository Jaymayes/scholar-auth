import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from '../middleware/auditLogger';

const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastHeartbeatAt: Date | null = null;

export interface LedgerSentinelStatus {
  active: boolean;
  last_heartbeat_at: string | null;
  stale: boolean;
  heartbeat_interval_ms: number;
  stale_threshold_ms: number;
}

async function writeHeartbeatRow(): Promise<boolean> {
  const ledgerFreeze = process.env.LEDGER_FREEZE === 'true';
  
  try {
    const entryId = `sentinel_heartbeat_${Date.now()}`;
    
    await db.execute(sql`
      INSERT INTO overnight_protocols_ledger (
        entry_id, entry_type, direction, amount_cents, currency, 
        description, metadata, status, created_at, updated_at
      ) VALUES (
        ${entryId},
        'SENTINEL_HEARTBEAT',
        'credit',
        0,
        'USD',
        'Ledger liveness sentinel heartbeat - 10 minute interval',
        ${JSON.stringify({
          sentinel: true,
          ledger_freeze: ledgerFreeze,
          timestamp: new Date().toISOString(),
          source: 'a1_scholar_auth'
        })}::jsonb,
        'posted',
        now(),
        now()
      )
    `);
    
    lastHeartbeatAt = new Date();
    
    logger.info('Ledger sentinel heartbeat written', {
      entry_id: entryId,
      table: 'overnight_protocols_ledger',
      ledger_freeze: ledgerFreeze,
      timestamp: lastHeartbeatAt.toISOString()
    });
    
    return true;
  } catch (error) {
    logger.error('LEDGER SENTINEL FAILURE - Heartbeat write failed: ' + 
      (error instanceof Error ? error.message : String(error)));
    
    return false;
  }
}

async function checkStaleness(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT MAX(created_at) as last_written_at 
      FROM overnight_protocols_ledger 
      WHERE entry_type = 'SENTINEL_HEARTBEAT'
    `);
    
    const rows = result.rows as Array<{ last_written_at: Date | null }>;
    const lastWrittenAt = rows[0]?.last_written_at;
    
    if (!lastWrittenAt) {
      return true;
    }
    
    const ageMs = Date.now() - new Date(lastWrittenAt).getTime();
    const isStale = ageMs > STALE_THRESHOLD_MS;
    
    if (isStale) {
      logger.error('LEDGER SENTINEL STALE ALERT - last_written_at: ' + lastWrittenAt + 
        ', age_ms: ' + ageMs + ', threshold_ms: ' + STALE_THRESHOLD_MS);
    }
    
    return isStale;
  } catch (error) {
    logger.error('Ledger sentinel staleness check failed: ' + 
      (error instanceof Error ? error.message : String(error)));
    return true;
  }
}

export function startLedgerSentinel(): void {
  if (heartbeatTimer) {
    logger.info('Ledger sentinel already running');
    return;
  }
  
  logger.info('Starting ledger liveness sentinel', {
    heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    stale_threshold_ms: STALE_THRESHOLD_MS,
    table: 'overnight_protocols_ledger'
  });
  
  writeHeartbeatRow();
  
  heartbeatTimer = setInterval(async () => {
    const success = await writeHeartbeatRow();
    
    if (!success) {
      logger.error('LEDGER SENTINEL: Heartbeat failed - potential rollback trigger');
    }
    
    const isStale = await checkStaleness();
    if (isStale) {
      logger.error('LEDGER SENTINEL: Staleness detected - last_written_at > 15 minutes');
    }
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopLedgerSentinel(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info('Ledger sentinel stopped');
  }
}

export function getLedgerSentinelStatus(): LedgerSentinelStatus {
  return {
    active: heartbeatTimer !== null,
    last_heartbeat_at: lastHeartbeatAt?.toISOString() || null,
    stale: lastHeartbeatAt 
      ? (Date.now() - lastHeartbeatAt.getTime()) > STALE_THRESHOLD_MS 
      : true,
    heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    stale_threshold_ms: STALE_THRESHOLD_MS
  };
}
