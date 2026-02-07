import express, { Request, Response, NextFunction, Router } from 'express';
import { db } from '../../db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { 
  users, providers, uploads, ledgers, scholarships,
  insertProviderSchema, insertUploadSchema, insertLedgerSchema,
  Provider, Upload, Ledger
} from '../../../shared/schema';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const router: Router = express.Router();

const ISSUER = 'https://scholar-auth-jamarrlmayes.replit.app/oidc';
const AUDIENCE = 'dataservice-v1';

const API_KEY_SCOPES: Record<string, { scopes: string[]; isSchoolOfficial: boolean }> = {
  SCHOLARSHIP_API_SERVICE_SECRET: { scopes: ['read:users', 'read:scholarships', 'write:ledgers'], isSchoolOfficial: false },
  AUTO_COM_CENTER_SERVICE_SECRET: { scopes: ['read:users', 'write:ledgers', 'read:ledgers'], isSchoolOfficial: false },
  PROVIDER_REGISTER_M2M_SECRET: { scopes: ['read:providers', 'write:providers', 'read:scholarships', 'write:scholarships'], isSchoolOfficial: true },
  ADMIN_DASHBOARD_M2M_SECRET: { scopes: ['*'], isSchoolOfficial: true },
};

interface AuthContext {
  userId?: string;
  apiKeyName?: string;
  scopes: string[];
  isSchoolOfficial: boolean;
}

interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
  ferpaContext?: {
    isSchoolOfficial: boolean;
    accountType: string;
  };
}

const authenticateRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] as string;
  const traceId = req.headers['x-trace-id'] as string;
  
  const systemHeaders = {
    'X-System-Identity': 'scholar_auth',
    'X-App-Base-URL': 'https://scholar-auth-jamarrlmayes.replit.app'
  };
  
  res.set(systemHeaders);
  
  if (!traceId) {
    return res.status(400).json({ error: 'X-Trace-Id header required', ...systemHeaders });
  }
  
  if (apiKey) {
    for (const [keyName, config] of Object.entries(API_KEY_SCOPES)) {
      const envKey = process.env[keyName];
      if (envKey && envKey.length === apiKey.length) {
        const isMatch = crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(envKey));
        if (isMatch) {
          req.authContext = {
            apiKeyName: keyName,
            scopes: config.scopes,
            isSchoolOfficial: config.isSchoolOfficial
          };
          return next();
        }
      }
    }
    return res.status(401).json({ error: 'Invalid API key', ...systemHeaders });
  }
  
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    
    const JWT_SECRET = process.env.M2M_SCHOLARSHIP_SAGE_SECRET;
    if (!JWT_SECRET) {
      console.error('[DataService] JWT_SECRET not configured');
      return res.status(500).json({ error: 'Authentication service unavailable', ...systemHeaders });
    }
    
    try {
      const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256', 'HS384', 'HS512'],
        issuer: ISSUER,
        audience: AUDIENCE,
        complete: false
      }) as jwt.JwtPayload;
      
      if (!payload.sub) {
        return res.status(401).json({ error: 'Invalid token: missing subject', ...systemHeaders });
      }
      
      const scopes = typeof payload.scope === 'string' 
        ? payload.scope.split(' ').filter(Boolean)
        : Array.isArray(payload.scope) ? payload.scope : [];
      
      req.authContext = {
        userId: payload.sub,
        scopes,
        isSchoolOfficial: payload.ferpa_account_type === 'school_official' || payload.role === 'admin'
      };
      
      return next();
    } catch (error) {
      const jwtError = error as jwt.JsonWebTokenError;
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', ...systemHeaders });
      }
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid token signature', ...systemHeaders });
      }
      return res.status(401).json({ error: 'Token validation failed', ...systemHeaders });
    }
  }
  
  return res.status(401).json({ error: 'Authentication required', ...systemHeaders });
};

const ferpaGuard = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const isSchoolOfficial = req.authContext?.isSchoolOfficial || false;
  
  req.ferpaContext = {
    isSchoolOfficial,
    accountType: isSchoolOfficial ? 'school_official' : 'consumer'
  };
  
  next();
};

const filterFerpaData = <T extends Record<string, any>>(data: T, isSchoolOfficial: boolean): Partial<T> => {
  if (isSchoolOfficial) {
    return data;
  }
  
  const PII_FIELDS = ['email', 'firstName', 'lastName', 'dateOfBirth', 'passwordHash', 'ssn', 'address', 'phone'];
  const FERPA_METADATA = ['ferpaProtected', 'ferpaAccountType', 'ferpaInstitutionId', 'isFerpaCovered', 'isConfidential'];
  
  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!PII_FIELDS.includes(key) && !FERPA_METADATA.includes(key)) {
      filtered[key] = value;
    } else if (PII_FIELDS.includes(key)) {
      filtered[key] = '[REDACTED]';
    }
  }
  
  return filtered as Partial<T>;
};

router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'dataservice',
    version: 'v1',
    timestamp: new Date().toISOString()
  });
});

router.get('/readyz', async (req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`SELECT 1 as ping`);
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      error: (error as Error).message
    });
  }
});

router.get('/users', authenticateRequest, ferpaGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const results = await db.select().from(users).limit(limit).offset(offset);
    const filtered = results.map(u => filterFerpaData(u, req.ferpaContext?.isSchoolOfficial || false));
    
    res.json({ data: filtered, meta: { limit, offset, count: filtered.length } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/users/:id', authenticateRequest, ferpaGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ data: filterFerpaData(user, req.ferpaContext?.isSchoolOfficial || false) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.get('/providers', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const results = await db.select().from(providers).limit(limit).offset(offset);
    res.json({ data: results, meta: { limit, offset, count: results.length } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

router.get('/providers/:id', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [provider] = await db.select().from(providers).where(eq(providers.id, req.params.id));
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    res.json({ data: provider });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch provider' });
  }
});

router.post('/providers', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header required' });
    }
    
    const validated = insertProviderSchema.parse(req.body);
    const [created] = await db.insert(providers).values(validated).returning();
    
    res.status(201).json({ data: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create provider' });
  }
});

router.put('/providers/:id', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [existing] = await db.select().from(providers).where(eq(providers.id, req.params.id));
    if (!existing) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    
    const [updated] = await db.update(providers)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(providers.id, req.params.id))
      .returning();
    
    res.json({ data: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update provider' });
  }
});

router.delete('/providers/:id', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [deleted] = await db.delete(providers).where(eq(providers.id, req.params.id)).returning();
    if (!deleted) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    res.json({ data: deleted });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete provider' });
  }
});

router.get('/scholarships', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const results = await db.select().from(scholarships).limit(limit).offset(offset);
    res.json({ data: results, meta: { limit, offset, count: results.length } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch scholarships' });
  }
});

router.get('/scholarships/:id', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [scholarship] = await db.select().from(scholarships).where(eq(scholarships.id, req.params.id));
    if (!scholarship) {
      return res.status(404).json({ error: 'Scholarship not found' });
    }
    res.json({ data: scholarship });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch scholarship' });
  }
});

router.get('/uploads', authenticateRequest, ferpaGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const results = await db.select().from(uploads).limit(limit).offset(offset).orderBy(desc(uploads.createdAt));
    
    const filtered = results.map(u => 
      u.isFerpaCovered && !req.ferpaContext?.isSchoolOfficial 
        ? filterFerpaData(u, false) 
        : u
    );
    
    res.json({ data: filtered, pagination: { limit, offset, count: filtered.length } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

router.post('/uploads', authenticateRequest, ferpaGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header required' });
    }
    
    const validated = insertUploadSchema.parse(req.body);
    const [created] = await db.insert(uploads).values(validated).returning();
    
    res.status(201).json({ data: { upload_id: created.id, ...created } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create upload' });
  }
});

router.get('/uploads/:id', authenticateRequest, ferpaGuard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [upload] = await db.select().from(uploads).where(eq(uploads.id, req.params.id));
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    if (upload.isFerpaCovered && !req.ferpaContext?.isSchoolOfficial) {
      return res.status(403).json({ error: 'FERPA protected content' });
    }
    
    res.json({ data: upload });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch upload' });
  }
});

router.get('/ledgers', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const results = await db.select().from(ledgers).limit(limit).offset(offset).orderBy(desc(ledgers.createdAt));
    
    res.json({ data: results, pagination: { limit, offset, count: results.length } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch ledgers' });
  }
});

router.post('/ledgers', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    const traceId = req.headers['x-trace-id'] as string;
    
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header required' });
    }
    
    const validated = insertLedgerSchema.parse({ ...req.body, traceId });
    const [created] = await db.insert(ledgers).values({ ...validated, idempotencyKey }).returning();
    
    res.status(201).json({ data: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if ((error as any).code === '23505') {
      return res.status(409).json({ error: 'Duplicate idempotency key' });
    }
    res.status(500).json({ error: 'Failed to create ledger entry' });
  }
});

router.get('/ledgers/reconcile', authenticateRequest, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const traceId = req.query.trace_id as string;
    if (!traceId) {
      return res.status(400).json({ error: 'trace_id query parameter required' });
    }
    
    const entries = await db.select().from(ledgers).where(eq(ledgers.traceId, traceId));
    
    let debitSum = 0;
    let creditSum = 0;
    
    for (const entry of entries) {
      const amount = parseFloat(entry.amount);
      if (entry.entryType === 'debit') {
        debitSum += amount;
      } else {
        creditSum += amount;
      }
    }
    
    const isBalanced = Math.abs(debitSum - creditSum) < 0.01;
    
    res.json({
      trace_id: traceId,
      entries: entries.length,
      debit_sum: debitSum.toFixed(2),
      credit_sum: creditSum.toFixed(2),
      is_balanced: isBalanced,
      difference: Math.abs(debitSum - creditSum).toFixed(2)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reconcile ledger' });
  }
});

export default router;
