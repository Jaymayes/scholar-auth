import { randomUUID } from "crypto";
import type { InsertAuditLog } from "@shared/schema";

// 🚀 PERFORMANCE: Standalone audit queue system for global performance optimization
interface AuditQueueItem {
  id: string;
  action: string;
  details: Record<string, any>;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId?: string;
  timestamp: Date;
  retryCount?: number;
  maxRetries?: number;
}

// PRODUCTION QUEUE CONFIGURATION
const QUEUE_CONFIG = {
  MAX_QUEUE_SIZE: 10000,
  BATCH_SIZE: 50,
  PROCESSING_INTERVAL_MS: 100,
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: 1000,
  OVERFLOW_STRATEGY: 'database_emergency' as const,
};

let storage: any = null;
const auditQueue: AuditQueueItem[] = [];
let isProcessing = false;
let queueOverflowCount = 0;
let lastOverflowAlert = 0;
let queueProcessorInterval: NodeJS.Timeout | null = null;
let databaseReady = false;

// DATABASE READINESS: Check if database is accessible
const isDatabaseReady = (): boolean => {
  if (!storage) return false;
  if (!process.env.DATABASE_URL) return false;
  
  try {
    new URL(process.env.DATABASE_URL);
    return databaseReady;
  } catch {
    return false;
  }
};

// Initialize storage reference (called from main app)
export const initializeAuditQueue = (storageInstance: any) => {
  storage = storageInstance;
  
  // SAFETY: Only start queue processor if database is ready
  // Queue will accumulate items safely until DB is available
  if (isDatabaseReady()) {
    startQueueProcessor();
  } else {
    console.warn('Audit queue initialized but database not ready. Queue will start when setDatabaseReady() is called.');
  }
};

// SAFETY: Mark database as ready and start queue processor
export const setDatabaseReady = () => {
  databaseReady = true;
  if (storage && !queueProcessorInterval) {
    console.log('Database ready signal received. Starting audit queue processor...');
    startQueueProcessor();
  }
};

// ENHANCED: Audit queue processor with batch processing and backpressure
const processAuditQueue = async () => {
  if (isProcessing || auditQueue.length === 0 || !storage || !isDatabaseReady()) return;
  
  isProcessing = true;
  const batchSize = Math.min(QUEUE_CONFIG.BATCH_SIZE, auditQueue.length);
  const batch = auditQueue.splice(0, batchSize);
  
  for (const item of batch) {
    try {
      // Direct database insert for queue processing
      await storage.createAuditLogAsync({
        userId: item.userId,
        action: item.action,
        details: item.details,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
      });
      
    } catch (error) {
      // RETRY LOGIC: Re-queue failed items with backoff
      const retryCount = (item.retryCount || 0) + 1;
      if (retryCount <= QUEUE_CONFIG.MAX_RETRIES) {
        auditQueue.unshift({
          ...item,
          retryCount,
          maxRetries: QUEUE_CONFIG.MAX_RETRIES
        });
        
        // Exponential backoff delay for retries
        await new Promise(resolve => 
          setTimeout(resolve, QUEUE_CONFIG.RETRY_BACKOFF_MS * Math.pow(2, retryCount - 1))
        );
      } else {
        // EMERGENCY: Failed item beyond max retries, emergency database write
        try {
          await emergencyAuditWrite(item);
        } catch (emergencyError) {
          console.error('CRITICAL: Emergency audit write failed:', emergencyError, 'Original item:', item);
        }
      }
    }
  }
  
  isProcessing = false;
  
  // Continue processing if queue has items
  if (auditQueue.length > 0) {
    setTimeout(processAuditQueue, 0);
  }
};

// EMERGENCY: Direct database write for failed queue items
const emergencyAuditWrite = async (item: AuditQueueItem) => {
  // SAFETY: Guard against database not ready
  if (!isDatabaseReady()) {
    console.warn('Emergency audit write deferred (database not ready):', {
      action: item.action,
      timestamp: item.timestamp,
      queueLength: auditQueue.length
    });
    // Re-queue the item for later processing
    auditQueue.push(item);
    return;
  }
  
  try {
    // Direct database insertion with minimal redaction for emergency writes
    await storage.createAuditLogAsync({
      userId: item.userId,
      action: `EMERGENCY_${item.action}`,
      details: { ...item.details, emergency: true, originalAction: item.action },
      ipAddress: item.ipAddress,
      userAgent: item.userAgent,
    });
    
    console.warn('Emergency audit write completed for:', item.action);
  } catch (error) {
    // Final fallback: Log to console for SRE monitoring
    console.error('CRITICAL AUDIT LOSS:', {
      action: item.action,
      userId: item.userId,
      timestamp: item.timestamp,
      error: error instanceof Error ? error.message : String(error),
      databaseReady: isDatabaseReady(),
      databaseUrl: process.env.DATABASE_URL ? 'SET' : 'MISSING'
    });
  }
};

// QUEUE MANAGEMENT: Add audit item with backpressure protection
export const enqueueAudit = (action: string, details: Record<string, any>, req?: any, userId?: string | null) => {
  // BACKPRESSURE: Check queue size limit
  if (auditQueue.length >= QUEUE_CONFIG.MAX_QUEUE_SIZE) {
    queueOverflowCount++;
    const now = Date.now();
    
    // Alert rate limiting (max 1 alert per minute)
    if (now - lastOverflowAlert > 60000) {
      console.error('QUEUE OVERFLOW: Audit queue exceeded max size', {
        queueSize: auditQueue.length,
        maxSize: QUEUE_CONFIG.MAX_QUEUE_SIZE,
        overflowCount: queueOverflowCount,
        action,
        timestamp: new Date().toISOString()
      });
      lastOverflowAlert = now;
    }
    
    // EMERGENCY STRATEGY: Direct database write for critical security events
    const criticalActions = ['LOGIN_FAILURE', 'UNAUTHORIZED_ACCESS_ATTEMPT', 'RATE_LIMIT_TRIGGERED'];
    if (criticalActions.includes(action) && storage) {
      emergencyAuditWrite({
        id: randomUUID(),
        action,
        details,
        userId: userId || null,
        ipAddress: req?.ip || req?.socket?.remoteAddress || null,
        userAgent: req?.get?.('User-Agent') || null,
        correlationId: req?.correlationId,
        timestamp: new Date(),
        retryCount: 0
      }).catch(console.error);
      return;
    }
    
    // Non-critical actions: Drop oldest items to make room
    auditQueue.shift();
  }
  
  // Add item to queue
  auditQueue.push({
    id: randomUUID(),
    action,
    details,
    userId: userId || null,
    ipAddress: req?.ip || req?.socket?.remoteAddress || null,
    userAgent: req?.get?.('User-Agent') || null,
    correlationId: req?.correlationId,
    timestamp: new Date(),
    retryCount: 0
  });
};

// Start queue processor
const startQueueProcessor = () => {
  // Clear existing interval if any
  if (queueProcessorInterval) {
    clearInterval(queueProcessorInterval);
  }
  
  queueProcessorInterval = setInterval(() => {
    if (auditQueue.length > 0) {
      processAuditQueue().catch(console.error);
    }
  }, QUEUE_CONFIG.PROCESSING_INTERVAL_MS);
};

// Graceful shutdown: stop queue processor and flush remaining items
export const shutdownAuditQueue = async () => {
  if (queueProcessorInterval) {
    clearInterval(queueProcessorInterval);
    queueProcessorInterval = null;
  }
  
  // Process remaining items in queue
  if (auditQueue.length > 0 && storage) {
    console.log(`Flushing ${auditQueue.length} remaining audit items...`);
    await processAuditQueue();
  }
};

// Queue status for monitoring
export const getQueueStatus = () => ({
  queueLength: auditQueue.length,
  maxQueueSize: QUEUE_CONFIG.MAX_QUEUE_SIZE,
  overflowCount: queueOverflowCount,
  isProcessing
});