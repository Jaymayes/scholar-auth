import type { Express } from 'express';
import { Router } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { storage } from '../storage';
import { logger, securityEventLogger } from '../middleware/auditLogger';
import { isAuthenticated } from '../replitAuth';
import type { Request, Response } from 'express';
import { oidcProvider, getIssuerUrl } from './provider';
import { interactionRouter } from './interactions';

// 🔧 CEO-APPROVED WORKAROUND: Express-level error handler for OAuth errors
// oidc-provider bypasses custom renderError configuration, so we intercept errors at Express level
function renderOAuthError(ctx: any, error: any) {
  const issuer = getIssuerUrl();
  const errorData = {
    error: error.error || error.name || 'server_error',
    error_description: error.error_description || error.message || 'An error occurred during authentication',
    state: error.state,
    iss: issuer
  };

  // Branded error page matching ScholarshipAI design
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Error - ScholarshipAI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .logo {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: white;
    }
    h1 {
      font-size: 24px;
      color: #1a202c;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .error-details {
      background: #f7fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      text-align: left;
    }
    .error-field {
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.5;
    }
    .error-field strong {
      color: #4a5568;
      font-weight: 600;
      display: inline-block;
      min-width: 140px;
    }
    .error-field span {
      color: #718096;
      word-break: break-word;
    }
    .error-message {
      color: #718096;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .back-link {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .back-link:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .footer {
      margin-top: 24px;
      color: #a0aec0;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="logo">🎓</div>
    <h1>Authorization Error</h1>
    <p class="error-message">
      We encountered an issue during the authentication process. 
      Please check the details below or contact support if this persists.
    </p>
    <div class="error-details">
      ${Object.entries(errorData).map(([key, value]) => 
        value ? `<div class="error-field"><strong>${key}:</strong> <span>${value}</span></div>` : ''
      ).join('')}
    </div>
    <a href="/" class="back-link">Return to Home</a>
    <div class="footer">ScholarshipAI Identity Provider</div>
  </div>
</body>
</html>`;

  ctx.type = 'html';
  ctx.body = html;
}

// Create dedicated OIDC router for mounting with initialized provider
export function createOIDCRouter(provider?: any) {
  const router = Router();
  console.log('🔧 Creating OIDC router with provider...');

  // 🔧 CRITICAL: Mount interaction handlers BEFORE provider callback
  // This allows us to handle /interaction/:uid routes before they reach oidc-provider
  router.use('/interaction', interactionRouter);
  console.log('✅ OIDC interaction router mounted at /interaction');

  // 🔒 CRITICAL: Mount the actual OIDC provider to handle auth endpoints
  if (provider) {
    router.use('/', provider.callback());
    console.log('✅ OIDC provider mounted on router successfully');
    
    // 🔧 CEO-APPROVED: Express-level error handler override
    // Catch OAuth errors and render with correct issuer (oidc-provider bypasses custom renderError)
    router.use((err: any, req: Request, res: any, next: any) => {
      if (err && (err.error || err.statusCode === 400 || err.name === 'InvalidClient')) {
        logger.warn('🔧 EXPRESS ERROR HANDLER: OAuth error intercepted', {
          error: err.error || err.name,
          message: err.error_description || err.message,
          path: req.path
        });
        
        // Create Koa-like context for renderOAuthError
        const ctx = {
          type: '',
          body: '',
          status: err.statusCode || 400
        };
        
        renderOAuthError(ctx, err);
        return res.status(ctx.status).type(ctx.type).send(ctx.body);
      }
      next(err);
    });
  } else {
    console.error('❌ OIDC provider not provided - authentication will fail');
  }

  return router;
}

// Register OIDC-related API endpoints (events, metrics)
// Note: The OIDC provider itself is mounted via createOIDCApp() in index.ts
export async function registerOIDCRoutes(app: Express) {
  console.log('🔧 Registering OIDC API endpoints (events, metrics)...');
  
  // 🔧 CRITICAL FIX: Removed custom OIDC endpoints (/oidc/auth, /oidc/token, etc.)
  // These were bypassing the real oidc-provider and causing "invalid_client" errors
  // The oidc-provider mounted at /oidc in index.ts now handles all standard OIDC endpoints
  
  // Events ingestion API for centralized tracking
  app.post('/api/events', async (req: Request, res: Response) => {
    const apiKey = req.headers['x-events-key'];
    const expectedKey = process.env.EVENTS_API_KEY;
    
    // SECURITY: Require EVENTS_API_KEY to be set - no hardcoded fallback
    if (!expectedKey) {
      logger.error('EVENTS_API_KEY environment variable not configured');
      return res.status(500).json({ error: 'server_misconfigured' });
    }
    
    if (!apiKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }
    
    try {
      const { app_id, user_id, event, correlation_id, metadata, ts } = req.body;
      
      // PERFORMANCE: Use async method without RETURNING for fire-and-forget event tracking
      await storage.createEventAsync({
        appId: app_id,
        userId: user_id,
        event,
        correlationId: correlation_id,
        metadata,
        timestamp: ts ? new Date(ts) : new Date(),
      });
      
      logger.info('Event ingested', {
        appId: app_id,
        event,
        correlationId: correlation_id,
      });
      
      res.json({ success: true });
      
    } catch (error) {
      logger.error('Event ingestion error', error as Error);
      res.status(500).json({ error: 'server_error' });
    }
  });
  
  // Metrics API for dashboard
  app.get('/api/metrics/apps', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const [studentMetrics, providerMetrics] = await Promise.all([
        storage.getAppMetrics('student'),
        storage.getAppMetrics('provider'),
      ]);
      
      res.json({
        student: studentMetrics,
        provider: providerMetrics,
      });
      
    } catch (error) {
      logger.error('Metrics API error', error as Error);
      res.status(500).json({ error: 'server_error' });
    }
  });
  
  // Recent events API for dashboard
  app.get('/api/events/recent', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { app_id } = req.query;
      const limit = Math.min(parseInt(req.query.limit as string || '50'), 100);
      
      let events;
      if (app_id && typeof app_id === 'string') {
        events = await storage.getEventsByApp(app_id, limit);
      } else {
        events = await storage.getRecentEvents(limit);
      }
      
      res.json({ events });
      
    } catch (error) {
      logger.error('Recent events API error', error as Error);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // 🔬 CEO OPTION B: Diagnostic endpoint to test client validation
  app.get('/api/debug/client-test', async (req: Request, res: Response) => {
    try {
      const { client_id, redirect_uri } = req.query;
      
      if (!client_id || typeof client_id !== 'string') {
        return res.status(400).json({
          error: 'missing_client_id',
          message: 'Query parameter client_id is required',
          usage: '/debug/client-test?client_id=provider-register&redirect_uri=https://...'
        });
      }

      logger.info('🔬 DIAGNOSTIC: Client validation test', { client_id, redirect_uri });

      // Find the client using oidc-provider's Client.find()
      let client;
      try {
        client = await oidcProvider.Client.find(client_id);
      } catch (error) {
        logger.error('🔬 DIAGNOSTIC: Client.find() error', error as Error);
        return res.status(500).json({
          client_id,
          error: 'client_lookup_failed',
          message: (error as Error).message,
          stack: (error as Error).stack
        });
      }

      if (!client) {
        return res.json({
          client_id,
          found: false,
          reason: 'Client not found in oidc-provider',
          registered_clients: await getRegisteredClientIds()
        });
      }

      // Extract client details
      const clientData: any = {
        client_id: client.clientId,
        found: true,
        redirect_uris: client.redirectUris || [],
        post_logout_redirect_uris: client.postLogoutRedirectUris || [],
        response_types: client.responseTypes || [],
        grant_types: client.grantTypes || [],
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        metadata: {
          camelCase_clientId: client.clientId,
          snake_case_client_id: (client as any).client_id,
          camelCase_redirectUris: client.redirectUris,
          snake_case_redirect_uris: (client as any).redirect_uris
        }
      };

      // If redirect_uri provided, test validation
      if (redirect_uri && typeof redirect_uri === 'string') {
        const isValid = client.redirectUris?.includes(redirect_uri) || false;
        
        clientData.redirect_uri_test = {
          provided: redirect_uri,
          valid: isValid,
          reason: isValid 
            ? 'Exact match found in registered redirect_uris' 
            : 'No exact match - check for trailing slash, protocol mismatch, or typo',
          registered_uris: client.redirectUris || [],
          comparison: (client.redirectUris || []).map((uri: string) => ({
            registered: uri,
            provided: redirect_uri,
            exact_match: uri === redirect_uri,
            case_mismatch: uri.toLowerCase() === redirect_uri.toLowerCase(),
            trailing_slash_diff: 
              uri === redirect_uri + '/' || uri === redirect_uri.replace(/\/$/, '')
          }))
        };
      }

      res.json(clientData);

    } catch (error) {
      logger.error('🔬 DIAGNOSTIC: Endpoint error', error as Error);
      res.status(500).json({
        error: 'diagnostic_failed',
        message: (error as Error).message,
        stack: (error as Error).stack
      });
    }
  });
}

// Helper to get all registered client IDs
async function getRegisteredClientIds(): Promise<string[]> {
  try {
    // Access the static clients configuration
    const config = (oidcProvider as any).Client?.Schema?.configuration?.clients || [];
    return config.map((c: any) => c.client_id || c.clientId).filter(Boolean);
  } catch (error) {
    logger.error('Failed to get registered client IDs', error as Error);
    return [];
  }
}

// Helper function to generate ID tokens (simplified)
async function generateIdToken(clientId: string, sub: string, req: Request): Promise<string> {
  const user = await storage.getUser(sub);
  if (!user) throw new Error('User not found');
  
  const payload = {
    iss: getIssuerUrl(),
    aud: clientId,
    sub: user.id,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    iat: Math.floor(Date.now() / 1000),
    auth_time: Math.floor(Date.now() / 1000),
    email: user.email,
    email_verified: user.isEmailVerified,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
    first_name: user.firstName,
    last_name: user.lastName,
    profile_image_url: user.profileImageUrl,
    roles: [user.role],
  };
  
  // For demo purposes, return a base64-encoded payload
  // In production, use proper JWT signing with RS256
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}