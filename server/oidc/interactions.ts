import { Router, Request, Response } from 'express';
import { oidcProvider } from './provider';
import { storage } from '../storage';
import { logger } from '../middleware/auditLogger';
import { getAuth, syncClerkUser } from '../clerkAuth';

export const interactionRouter = Router();

// 🔧 STALE SESSION RECOVERY: Helper to detect stale interaction errors
function isStaleInteractionError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const errorCode = String(err?.error || '').toLowerCase();
  return (
    msg.includes('interaction') ||
    msg.includes('session') ||
    msg.includes('not found') ||
    msg.includes('expired') ||
    msg.includes('state mismatch') ||
    errorCode.includes('session') ||
    errorCode.includes('interaction')
  );
}

// 🔧 STALE SESSION RECOVERY: Clear all OIDC/session cookies
// Fix: Dynamically derive domain from request hostname to avoid cookie domain mismatch
function clearOidcCookies(res: Response, req?: Request): void {
  // Use request hostname if provided, otherwise fall back to production domain
  const hostname = req?.hostname || 'scholar-auth-jamarrlmayes.replit.app';
  const cookieOptions = `Path=/; Domain=${hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None`;
  const cookieOptionsNoDomain = 'Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None';
  res.setHeader('Set-Cookie', [
    `oidc_session=; ${cookieOptions}`,
    `oidc_interaction=; ${cookieOptions}`,
    `oidc_resume=; ${cookieOptions}`,
    `oidc_state=; ${cookieOptions}`,
    `sid=; ${cookieOptions}`,
    // Also clear without domain for dev environment
    `oidc_session=; ${cookieOptionsNoDomain}`,
    `oidc_interaction=; ${cookieOptionsNoDomain}`,
    `oidc_resume=; ${cookieOptionsNoDomain}`,
    `oidc_state=; ${cookieOptionsNoDomain}`,
  ]);
}

// 🔧 STALE SESSION RECOVERY: Redirect to fresh login
function redirectToFreshLogin(res: Response, clientId?: string, redirectUri?: string): void {
  const authUrl = new URL('/oidc/auth', 'https://scholar-auth-jamarrlmayes.replit.app');
  authUrl.searchParams.set('prompt', 'login');
  authUrl.searchParams.set('max_age', '0');
  if (clientId) authUrl.searchParams.set('client_id', clientId);
  if (redirectUri) authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  res.redirect(303, authUrl.toString());
}

// HTML escape helper to prevent XSS
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 🔧 GET /oidc/interaction/restart - Safety valve to clear stale session and start fresh
// IMPORTANT: This route MUST be defined BEFORE /:uid routes to avoid matching "restart" as a uid
interactionRouter.get('/restart', async (req: Request, res: Response) => {
  logger.info('OIDC Restart requested - clearing cookies and redirecting to fresh login');
  clearOidcCookies(res, req);
  
  // Get client_id and redirect_uri from query params if available
  const clientId = req.query.client_id as string | undefined;
  const redirectUri = req.query.redirect_uri as string | undefined;
  
  return redirectToFreshLogin(res, clientId, redirectUri);
});

// GET /oidc/interaction/:uid - Display login/consent form
interactionRouter.get('/:uid', async (req: Request, res: Response) => {
  try {
    // 🔍 P0 DIAGNOSTIC: Log incoming cookies and request details
    const incomingCookies = req.headers.cookie || 'NONE';
    const requestUid = req.params.uid;
    logger.info('OIDC Interaction starting', {
      requestUid,
      hasCookies: !!req.headers.cookie,
      cookieCount: incomingCookies !== 'NONE' ? incomingCookies.split(';').length : 0,
      hasInteractionCookie: incomingCookies.includes('oidc_interaction'),
      protocol: req.protocol,
      secure: req.secure,
      xForwardedProto: req.headers['x-forwarded-proto'],
    });
    
    const details = await oidcProvider.interactionDetails(req, res);
    const { uid, prompt, params } = details;
    
    logger.info('OIDC Interaction requested', {
      uid,
      promptName: prompt.name,
      clientId: params.client_id,
    });
    
    // Handle login prompt
    if (prompt.name === 'login') {
      // 🔐 CLERK BRIDGE: Check if user is already authenticated with Clerk
      // Note: Clerk middleware is bypassed for /oidc/ routes, so getAuth may not work
      // We must handle this gracefully - if no Clerk context, user needs to sign in
      let auth: ReturnType<typeof getAuth> | null = null;
      try {
        auth = getAuth(req);
      } catch (clerkError) {
        // Expected: Clerk middleware was bypassed, auth context unavailable
        logger.info('OIDC Login - Clerk auth context not available (expected for OIDC bypass)', {
          uid,
          reason: 'clerk_middleware_bypassed',
        });
      }
      
      if (auth?.userId) {
        logger.info('OIDC Login - user already authenticated with Clerk', { 
          uid, 
          clerkUserId: auth.userId,
        });
        // User is authenticated, redirect to resume to complete login
        return res.redirect(`/oidc/interaction/${uid}/resume`);
      }
      
      const client = escapeHtml(params.client_id as string);
      const scopes = Array.isArray(prompt.details?.missingOIDCScope) 
        ? prompt.details.missingOIDCScope as string[]
        : (params.scope as string || '').split(' ').filter(Boolean);
      const escapedScopes = scopes.map(s => escapeHtml(s));
      const escapedUid = escapeHtml(uid);
      
      // 🔐 CLERK BRIDGE: Redirect to Clerk sign-in with return URL to resume
      // Build the Clerk sign-in redirect URL
      const clerkReturnUrl = encodeURIComponent(`/oidc/interaction/${uid}/resume`);
      
      // Return simple HTML login form with "Sign In" button that redirects to Clerk
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sign In - ScholarAuth</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 400px;
              width: 100%;
              padding: 40px;
            }
            h1 {
              color: #333;
              margin-bottom: 8px;
              font-size: 24px;
            }
            .subtitle {
              color: #666;
              margin-bottom: 24px;
              font-size: 14px;
            }
            .app-info {
              background: #f7fafc;
              padding: 12px;
              border-radius: 6px;
              margin-bottom: 24px;
              font-size: 14px;
              color: #4a5568;
            }
            .app-info strong {
              color: #2d3748;
            }
            button, .btn-link {
              width: 100%;
              padding: 12px;
              background: #667eea;
              color: white;
              border: none;
              border-radius: 6px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: background 0.2s;
              text-decoration: none;
              display: block;
              text-align: center;
            }
            button:hover, .btn-link:hover {
              background: #5568d3;
            }
            button:active, .btn-link:active {
              transform: scale(0.98);
            }
            .signup-option {
              margin-top: 20px;
              text-align: center;
              font-size: 14px;
              color: #666;
            }
            .signup-link {
              color: #667eea;
              font-weight: 600;
              text-decoration: none;
              margin-left: 4px;
            }
            .signup-link:hover {
              text-decoration: underline;
            }
            .footer {
              margin-top: 24px;
              text-align: center;
              font-size: 12px;
              color: #a0aec0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Sign In to ScholarAuth</h1>
            <p class="subtitle">Secure authentication for ScholarshipAI</p>
            
            <div class="app-info">
              <strong>Application:</strong> ${client}<br>
              <strong>Requested Scopes:</strong> ${escapedScopes.join(', ') || 'openid'}
            </div>
            
            <a href="/sign-in?redirect_url=${clerkReturnUrl}" class="btn-link" id="login-btn" data-testid="button-signin">
              Sign In to Continue
            </a>
            
            <div class="signup-option">
              <span>Don't have an account?</span>
              <a href="/sign-up?redirect_url=${clerkReturnUrl}" class="signup-link" data-testid="button-signup">
                Create Account
              </a>
            </div>
            
            <div class="footer">
              Powered by ScholarAuth &middot; ScholarshipAI
            </div>
          </div>
          
        </body>
        </html>
      `);
    }
    
    // Handle consent prompt
    if (prompt.name === 'consent') {
      const client = escapeHtml(params.client_id as string);
      const scopes = Array.isArray(prompt.details?.missingOIDCScope) 
        ? prompt.details.missingOIDCScope 
        : [];
      const escapedScopes = (scopes as string[]).map(s => escapeHtml(s));
      const escapedUid = escapeHtml(uid);
      
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Authorize Application - ScholarAuth</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 450px;
              width: 100%;
              padding: 40px;
            }
            h1 { color: #333; margin-bottom: 8px; font-size: 24px; }
            .subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
            .app-info {
              background: #f7fafc;
              padding: 16px;
              border-radius: 6px;
              margin-bottom: 24px;
            }
            .scope-list {
              list-style: none;
              margin: 16px 0;
            }
            .scope-list li {
              padding: 8px 0;
              border-bottom: 1px solid #e2e8f0;
              color: #4a5568;
            }
            .scope-list li:last-child { border-bottom: none; }
            .scope-list li:before {
              content: "✓";
              color: #48bb78;
              font-weight: bold;
              margin-right: 8px;
            }
            .actions {
              display: flex;
              gap: 12px;
              margin-top: 24px;
            }
            button {
              flex: 1;
              padding: 12px;
              border: none;
              border-radius: 6px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
            }
            .btn-approve {
              background: #667eea;
              color: white;
            }
            .btn-approve:hover { background: #5568d3; }
            .btn-deny {
              background: #e2e8f0;
              color: #4a5568;
            }
            .btn-deny:hover { background: #cbd5e0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorize Application</h1>
            <p class="subtitle">Review the permissions requested</p>
            
            <div class="app-info">
              <strong>${client}</strong> is requesting access to:
              <ul class="scope-list">
                ${escapedScopes.map((scope: string) => `<li>${scope}</li>`).join('')}
              </ul>
            </div>
            
            <form method="POST" action="/oidc/interaction/${escapedUid}/confirm" id="consent-form">
              <input type="hidden" name="interaction_uid" value="${escapedUid}" />
              <input type="hidden" name="client_id" value="${escapeHtml(params.client_id as string)}" />
              <input type="hidden" name="consent_action" value="approve" />
              <div class="actions">
                <button type="submit" class="btn-approve" data-testid="button-approve">Authorize</button>
                <button type="button" class="btn-deny" onclick="window.location.href='/oidc/interaction/${escapedUid}/abort-redirect'" data-testid="button-deny">Deny</button>
              </div>
            </form>
            <script>
              // Debug: Log form submission with detailed info
              document.getElementById('consent-form').addEventListener('submit', function(e) {
                console.log('Consent form submitting:', {
                  action: this.action,
                  method: this.method,
                  uid: document.querySelector('input[name="interaction_uid"]').value
                });
              });
            </script>
          </div>
        </body>
        </html>
      `);
    }
    
    // Unknown prompt type
    return res.status(400).json({ 
      error: 'unsupported_interaction_type',
      error_description: `Unsupported interaction type: ${prompt.name}`,
    });
    
  } catch (err) {
    const error = err as Error;
    const errorMessage = error?.message || 'Unknown error';
    const errorName = error?.name || error?.constructor?.name || 'Unknown';
    const requestId = (req as any).correlationId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    // 🔍 P0 DIAGNOSTIC: Log full error details for debugging
    const incomingCookies = req.headers.cookie || 'NONE';
    logger.error('OIDC Interaction error - DETAILED', {
      requestId,
      uid: req.params.uid,
      errorName,
      errorMessage,
      errorStack: error?.stack?.substring(0, 500),
      hasCookies: !!req.headers.cookie,
      cookieNames: incomingCookies !== 'NONE' ? incomingCookies.split(';').map(c => c.trim().split('=')[0]) : [],
      protocol: req.protocol,
      secure: req.secure,
      xForwardedProto: req.headers['x-forwarded-proto'],
      trustProxy: req.app.get('trust proxy'),
    } as any);
    
    // 🔧 UNIVERSAL RECOVERY: Always provide user-friendly recovery for interaction failures
    // Clear potentially stale cookies and show a friendly error page with retry option
    clearOidcCookies(res, req);
    
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session Expired - ScholarAuth</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 450px;
            width: 100%;
            padding: 40px;
            text-align: center;
          }
          .icon { font-size: 48px; margin-bottom: 16px; }
          h1 { color: #333; margin-bottom: 12px; font-size: 24px; }
          p { color: #666; margin-bottom: 24px; line-height: 1.6; }
          .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
          a {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s;
          }
          .primary { background: #667eea; color: white; }
          .primary:hover { background: #5568d3; }
          .secondary { background: #e2e8f0; color: #4a5568; }
          .secondary:hover { background: #cbd5e0; }
          .footer { margin-top: 24px; font-size: 11px; color: #a0aec0; }
          .request-id { font-size: 10px; color: #cbd5e0; margin-top: 8px; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⏰</div>
          <h1>Session Expired</h1>
          <p>Your authorization session has expired or is no longer valid. This can happen if you waited too long or your browser blocked cookies.</p>
          <div class="actions">
            <a href="/oidc/interaction/restart" class="primary" data-testid="button-retry">Try Again</a>
            <a href="https://student-pilot-jamarrlmayes.replit.app" class="secondary">Go to ScholarLink</a>
          </div>
          <div class="footer">
            Powered by ScholarAuth &middot; ScholarshipAI
            <div class="request-id">Request ID: ${escapeHtml(requestId)}</div>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

// GET /oidc/interaction/:uid/resume - Resume interaction after Clerk Auth
interactionRouter.get('/:uid/resume', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    
    // 🔐 CLERK BRIDGE: Check if user is authenticated via Clerk
    // Note: Clerk middleware is bypassed for /oidc/ routes, so getAuth may fail
    let auth: ReturnType<typeof getAuth> | null = null;
    try {
      auth = getAuth(req);
    } catch (clerkError) {
      // Clerk middleware was bypassed, auth context unavailable
      logger.info('OIDC Resume - Clerk auth context not available', {
        uid,
        reason: 'clerk_middleware_bypassed',
      });
    }
    
    if (!auth?.userId) {
      logger.warn('OIDC Resume - user not authenticated with Clerk', { uid });
      const escapedUid = escapeHtml(uid);
      const clerkReturnUrl = encodeURIComponent(`/oidc/interaction/${uid}/resume`);
      return res.status(401).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Authentication Required - ScholarAuth</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 400px;
              width: 100%;
              padding: 40px;
              text-align: center;
            }
            h1 { color: #c53030; margin-bottom: 16px; }
            p { color: #666; margin-bottom: 24px; }
            a {
              display: inline-block;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Required</h1>
            <p>You must sign in to continue.</p>
            <a href="/sign-in?redirect_url=${clerkReturnUrl}">Sign In</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // 🔐 CLERK BRIDGE: Sync Clerk user to database and get user info
    let user;
    try {
      user = await syncClerkUser(auth.userId);
    } catch (syncError) {
      logger.error('OIDC Resume - failed to sync Clerk user', syncError as Error, {
        uid,
        clerkUserId: auth.userId,
      });
      return res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to sync user data',
      });
    }
    
    logger.info('OIDC Resume - user authenticated via Clerk', { 
      uid, 
      userId: user.id,
      clerkUserId: auth.userId,
      email: user.email,
    });
    
    // Complete the interaction with login result
    // Use the database user ID as the accountId for OIDC tokens
    const accountId = user.id;
    const result = {
      login: {
        accountId: String(accountId),
      },
    };
    
    await logger.audit('OIDC_LOGIN_SUCCESS', { 
      userId: accountId,
      clerkUserId: auth.userId,
      email: user.email,
      uid,
    }, undefined, undefined);
    
    logger.info('OIDC Login successful via Clerk', { userId: accountId, clerkUserId: auth.userId, uid });
    
    // Finish interaction - this will redirect to consent or back to client
    // mergeWithLastSubmission: true ensures login is merged with the original auth params
    await oidcProvider.interactionFinished(req, res, result, { 
      mergeWithLastSubmission: true,
    });
    
  } catch (err) {
    logger.error('OIDC Resume error', err as Error);
    
    // 🔧 STALE SESSION RECOVERY: Detect stale interaction and recover
    if (isStaleInteractionError(err)) {
      logger.info('OIDC Stale resume interaction detected, clearing cookies and redirecting to fresh login');
      clearOidcCookies(res, req);
      return redirectToFreshLogin(res);
    }
    
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to resume interaction',
    });
  }
});

// POST /oidc/interaction/:uid/confirm - Confirm consent
interactionRouter.post('/:uid/confirm', async (req: Request, res: Response) => {
  const { uid } = req.params;
  
  // 🔍 P0 DIAGNOSTIC: Capture ALL cookie info for session debugging
  const rawCookies = req.headers.cookie || '';
  const cookieNames = rawCookies.split(';').map(c => c.trim().split('=')[0]).filter(Boolean);
  const hasOidcSession = cookieNames.some(n => n.includes('oidc_session') || n.includes('_session'));
  const hasOidcInteraction = cookieNames.some(n => n.includes('oidc_interaction') || n.includes('_interaction'));
  const hasOidcResume = cookieNames.some(n => n.includes('oidc_resume') || n.includes('_resume'));
  
  // 🔍 DIAGNOSTIC: Entry-point logging for consent form submission
  logger.info('OIDC Consent POST received', {
    uid,
    method: req.method,
    contentType: req.headers['content-type'],
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    formUid: req.body?.interaction_uid,
    formClientId: req.body?.client_id,
    formAction: req.body?.consent_action,
    origin: req.headers.origin,
    referer: req.headers.referer,
    // P0 Cookie diagnostics
    cookieCount: cookieNames.length,
    cookieNames: cookieNames.slice(0, 10), // First 10 cookie names only
    hasOidcSession,
    hasOidcInteraction,
    hasOidcResume,
    protocol: req.protocol,
    secure: req.secure,
    xForwardedProto: req.headers['x-forwarded-proto'],
  });
  
  try {
    let interactionDetails;
    try {
      interactionDetails = await oidcProvider.interactionDetails(req, res);
    } catch (interactionErr) {
      const errMessage = (interactionErr as Error).message;
      const errStack = (interactionErr as Error).stack?.substring(0, 300);
      const requestId = (req as any).correlationId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      
      // 🔍 P0 DIAGNOSTIC: Log full error context for session failures
      logger.error('OIDC Consent - interactionDetails FAILED', interactionErr as Error, {
        requestId,
        uid,
        formUid: req.body?.interaction_uid,
        cookieNames: cookieNames.slice(0, 10),
        hasOidcSession,
        hasOidcInteraction,
        protocol: req.protocol,
        xForwardedProto: req.headers['x-forwarded-proto'],
      });
      
      // OIDC session cookie missing - provide helpful error
      logger.warn('OIDC Consent - interaction session missing', {
        requestId,
        uid,
        formUid: req.body?.interaction_uid,
        error: errMessage,
      });
      
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Session Expired - ScholarAuth</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
            .container { background: white; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 400px; width: 100%; padding: 40px; text-align: center; }
            h1 { color: #e53e3e; margin-bottom: 16px; }
            p { color: #666; margin-bottom: 24px; }
            a { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }
            .footer { margin-top: 24px; font-size: 10px; color: #a0aec0; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Session Expired</h1>
            <p>Your authorization session has expired. This can happen if cookies are blocked or the session timed out. Please start the authorization flow again.</p>
            <a href="https://student-pilot-jamarrlmayes.replit.app">Return to ScholarLink</a>
            <div class="footer">Request ID: ${escapeHtml(requestId)}</div>
          </div>
        </body>
        </html>
      `);
    }
    
    const { prompt: { name, details }, params, session } = interactionDetails;
    
    if (!session?.accountId) {
      logger.warn('OIDC Consent - session missing accountId', {
        uid,
        hasSession: !!session,
        formUid: req.body?.interaction_uid,
      });
      
      return res.status(401).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Login Required - ScholarAuth</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
            .container { background: white; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 400px; width: 100%; padding: 40px; text-align: center; }
            h1 { color: #e53e3e; margin-bottom: 16px; }
            p { color: #666; margin-bottom: 24px; }
            a { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Login Required</h1>
            <p>You must be logged in to authorize this application. Please sign in and try again.</p>
            <a href="/sign-in">Sign In</a>
          </div>
        </body>
        </html>
      `);
    }
    
    logger.info('OIDC Consent requested', {
      uid,
      userId: session.accountId,
      clientId: params.client_id,
    });
    
    let { grantId } = interactionDetails;
    let grant;

    if (grantId) {
      // Existing grant - fetch it
      grant = await oidcProvider.Grant.find(grantId);
    } else {
      // New grant - create it
      grant = new oidcProvider.Grant({
        accountId: session.accountId,
        clientId: params.client_id as string,
      });
    }
    
    // Add missing OIDC scopes
    if (details?.missingOIDCScope) {
      grant!.addOIDCScope((details.missingOIDCScope as string[]).join(' '));
    }
    
    // Add missing resource scopes
    if (details?.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(details.missingResourceScopes)) {
        grant!.addResourceScope(indicator, (scopes as string[]).join(' '));
      }
    }
    
    // Save grant
    grantId = await grant!.save();
    
    // Prepare consent result - ALWAYS include grantId to complete consent flow
    // Bug fix: Previously only set grantId for new grants, causing consent loop
    const consent: any = {
      grantId, // Always required to complete consent
    };
    
    await logger.audit('OIDC_CONSENT_GRANTED', {
      userId: session.accountId,
      clientId: params.client_id,
      grantId,
      uid,
    }, undefined, undefined);
    
    logger.info('OIDC Consent granted', {
      userId: session.accountId,
      grantId,
      uid,
    });
    
    const result = { consent };
    
    logger.info('OIDC Consent - about to finish interaction', {
      uid,
      grantId,
      hasConsent: !!consent.grantId,
    });
    
    // Finish interaction - this will redirect back to client with authorization code
    // mergeWithLastSubmission: true ensures consent is merged with the login session
    try {
      await oidcProvider.interactionFinished(req, res, result, { 
        mergeWithLastSubmission: true,
      });
    } catch (finishErr) {
      const errMsg = (finishErr as Error).message || 'Unknown error';
      logger.error('OIDC interactionFinished failed', finishErr as Error);
      logger.info('OIDC interactionFinished failure details', {
        uid,
        grantId,
        errorMessage: errMsg,
      });
      
      // Return a user-friendly error page
      return res.status(500).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Authorization Failed - ScholarAuth</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
            .container { background: white; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 500px; width: 100%; padding: 40px; text-align: center; }
            h1 { color: #e53e3e; margin-bottom: 16px; }
            p { color: #666; margin-bottom: 24px; }
            .error-detail { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #4a5568; margin-bottom: 24px; text-align: left; }
            a { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Failed</h1>
            <p>We couldn't complete the authorization. This may be due to a session timeout or cookie issue.</p>
            <div class="error-detail">
              Error: ${(finishErr as Error).message?.substring(0, 200) || 'Unknown error'}
            </div>
            <a href="/">Return Home</a>
          </div>
        </body>
        </html>
      `);
    }
    
  } catch (err) {
    logger.error('OIDC Consent error', err as Error);
    
    // 🔧 STALE SESSION RECOVERY: Detect stale interaction and recover
    if (isStaleInteractionError(err)) {
      logger.info('OIDC Stale consent interaction detected, clearing cookies and redirecting to fresh login');
      clearOidcCookies(res, req);
      return redirectToFreshLogin(res);
    }
    
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to process consent',
    });
  }
});

// GET /oidc/interaction/:uid/abort-redirect - Abort via redirect (for Deny button)
interactionRouter.get('/:uid/abort-redirect', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    
    logger.info('OIDC Interaction abort via redirect', { uid });
    
    const result = {
      error: 'access_denied',
      error_description: 'User denied the request',
    };
    
    await oidcProvider.interactionFinished(req, res, result, { 
      mergeWithLastSubmission: false,
    });
    
  } catch (err) {
    logger.error('OIDC Abort redirect error', err as Error);
    // Fallback: redirect to home page
    return res.redirect('/');
  }
});

// POST /oidc/interaction/:uid/abort - Abort/deny interaction
interactionRouter.post('/:uid/abort', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    
    logger.info('OIDC Interaction aborted', { uid });
    
    const result = {
      error: 'access_denied',
      error_description: 'User denied the request',
    };
    
    await oidcProvider.interactionFinished(req, res, result, { 
      mergeWithLastSubmission: false,
    });
    
  } catch (err) {
    logger.error('OIDC Abort error', err as Error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to abort interaction',
    });
  }
});

