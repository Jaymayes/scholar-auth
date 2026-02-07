import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createOIDCRouter } from './routes';
import { logger } from '../middleware/auditLogger';
import { strictHelmetConfig } from '../middleware/headerSecurity';
import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs';

// Create dedicated OIDC sub-app with minimal middleware
export async function createOIDCApp(provider?: any) {
  const oidcApp = express();
  
  console.log('🔧 Creating dedicated OIDC sub-app...');
  
  // Security middleware - use strict production-grade configuration
  oidcApp.use(strictHelmetConfig());
  
  // CRITICAL SECURITY FIX: Use secure CORS allowlist instead of permissive origin: true
  const corsOriginsRaw = process.env.CORS_ALLOWED_ORIGINS || '';
  const allowedOrigins = corsOriginsRaw
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
  
  // OIDC-specific secure CORS configuration
  oidcApp.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Same-origin requests (no Origin header) - always allow
      if (!origin) {
        callback(null, true);
        return;
      }
      
      // Production origins - exact match required
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      
      // Development environment - allow Replit domains
      if (process.env.NODE_ENV === 'development') {
        const replitPatterns = [
          /^https:\/\/[a-f0-9-]+\.replit\.dev$/,
          /^https:\/\/[a-f0-9-]+.*\.spock\.replit\.dev$/
        ];
        
        if (replitPatterns.some(pattern => pattern.test(origin))) {
          callback(null, true);
          return;
        }
      }
      
      console.warn(`[OIDC-CORS] Blocked origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
  }));
  
  // Body parsing middleware
  oidcApp.use(express.json({ limit: '10mb' }));
  oidcApp.use(express.urlencoded({ extended: true }));
  
  // Request tracing for OIDC sub-app
  oidcApp.use((req, res, next) => {
    console.info('[OIDC-APP] Request:', req.method, req.originalUrl, req.path);
    next();
  });
  
  // Create OIDC router with initialized provider (passed from main app)
  const oidcRouter = createOIDCRouter(provider);
  
  // Add internal diagnostic logging to confirm router entry
  oidcRouter.use((req, res, next) => {
    console.info('[OIDC-ROUTER] Inside oidcRouter:', req.method, req.originalUrl, req.path);
    next();
  });
  
  // Test endpoint (same as main routes)
  const testHandler = (req: express.Request, res: express.Response) => {
    console.log('🔍 OIDC test endpoint hit:', { 
      method: req.method, 
      url: req.originalUrl,
      timestamp: new Date().toISOString() 
    });
    
    res.json({ 
      message: 'OIDC router is working correctly', 
      endpoint: req.originalUrl,
      timestamp: new Date().toISOString() 
    });
  };
  
  // Client secret handler (same as main routes) 
  const clientSecretHandler = async (req: express.Request, res: express.Response) => {
    try {
      const clientSecret = randomBytes(32).toString('base64url');
      
      await logger.audit('OIDC_CLIENT_SECRET_GENERATED', { 
        clientId: req.body.clientId || 'unknown'
      });
      
      res.json({
        clientSecret,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        generated: new Date().toISOString()
      });
    } catch (error) {
      console.error('Client secret generation failed:', error);
      res.status(500).json({ 
        error: 'Internal server error', 
        timestamp: new Date().toISOString() 
      });
    }
  };
  
  // Add routes to the OIDC router
  oidcRouter.get('/admin/test', testHandler);
  oidcRouter.post('/admin/client-secret', clientSecretHandler);
  
  // Mount OIDC router at root (sub-app already mounted at /api/auth/oauth - no double prefix)
  oidcApp.use('/', oidcRouter);
  
  // 🎯 ARCHITECT FIX V3: REMOVED Express discovery handlers
  // Root cause: Express handlers intercepted requests BEFORE reaching provider's Koa middleware
  // Solution: Let requests fall through to provider.callback() where Koa middleware will handle discovery
  // Provider's Koa middleware (server/oidc/provider.ts line 416) will add client_credentials to response
  
  // NOTE: JWKS endpoint is handled by the OIDC provider (oidc-provider library)
  // The provider automatically serves production keys at /.well-known/jwks.json
  // Configuration is in server/oidc/provider.ts (jwks object with RSA-2048 keys)
  
  // Production routing: Use originalUrl for proper sub-app route separation
  oidcApp.use('*', async (req, res, next) => {
    // 1. Handle OIDC-specific routes internally
    if (req.originalUrl.startsWith('/oidc/') || req.originalUrl.startsWith('/.well-known/')) {
      return next(); // Let OIDC middleware handle it
    }
    
    // 2. Pass ALL /api/* routes to parent app for JSON responses
    if (req.originalUrl.startsWith('/api/')) {
      return next(); // Pass to parent app
    }
    
    // 3. Serve SPA for all other routes (HTML pages)
    const distPath = path.resolve(import.meta.dirname, "..", "..", "dist", "public");
    
    if (fs.existsSync(distPath)) {
      res.set({
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
      }).sendFile(path.resolve(distPath, "index.html"));
    } else {
      res.status(404).send('Not Found');
    }
  });
  
  return oidcApp;
}