import { clerkClient, clerkMiddleware, getAuth, requireAuth } from '@clerk/express';
import type { Express, Request, Response, NextFunction } from 'express';
import { logger } from './middleware/auditLogger';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Routes that should bypass Clerk authentication entirely
// These are public OIDC endpoints that must remain accessible without browser session
const CLERK_BYPASS_ROUTES = [
  '/oidc/',           // All OIDC provider routes (authorize, token, interaction, etc.)
  '/.well-known/',    // OIDC discovery and JWKS endpoints
  '/health',          // Health check endpoints
  '/api/oauth/',      // Custom OAuth 2.1 endpoints for A5/A6
  '/api/v1/',         // DataService V2 API (handles its own JWT/API key auth)
];

// Routes within OIDC that REQUIRE Clerk authentication (exceptions to bypass)
// These routes need Clerk session to complete the authentication flow
const CLERK_REQUIRED_OIDC_ROUTES = [
  '/oidc/interaction/',  // Resume endpoints need Clerk to get user identity
];

function shouldBypassClerk(path: string): boolean {
  // First check if this is an OIDC route that REQUIRES Clerk
  // (resume endpoints need Clerk to verify user identity after sign-in)
  const isResumePath = path.includes('/resume');
  if (CLERK_REQUIRED_OIDC_ROUTES.some(route => path.startsWith(route)) && isResumePath) {
    return false; // Do NOT bypass Clerk for resume paths
  }
  
  // Check standard bypass routes
  return CLERK_BYPASS_ROUTES.some(route => path.startsWith(route));
}

export function setupClerkAuth(app: Express) {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is required for Clerk authentication');
  }

  // Conditional Clerk middleware - skip for OIDC/OAuth routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldBypassClerk(req.path)) {
      // Skip Clerk for OIDC routes - let oidc-provider handle authentication
      return next();
    }
    // Apply Clerk middleware for all other routes
    return clerkMiddleware()(req, res, next);
  });

  logger.info('Clerk authentication middleware initialized (OIDC routes bypassed)');
}

export async function syncClerkUser(clerkUserId: string): Promise<{ id: string; email: string | null }> {
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    
    const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;
    const firstName = clerkUser.firstName || null;
    const lastName = clerkUser.lastName || null;
    const profileImageUrl = clerkUser.imageUrl || null;
    const isEmailVerified = clerkUser.emailAddresses?.[0]?.verification?.status === 'verified';

    // Handle both clerkUserId and email conflicts safely
    // Priority: Link existing email-based user to new Clerk account
    const result = await db.transaction(async (tx) => {
      // First check if user with this clerkUserId already exists
      const existingByClerkId = await tx
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId))
        .limit(1);

      if (existingByClerkId.length > 0) {
        // Update existing user by clerkUserId
        const [updated] = await tx
          .update(users)
          .set({
            email,
            firstName,
            lastName,
            profileImageUrl,
            isEmailVerified,
            updatedAt: new Date(),
          })
          .where(eq(users.clerkUserId, clerkUserId))
          .returning();
        return updated;
      }

      // Check if user with same email exists (legacy user without clerkUserId)
      if (email) {
        const existingByEmail = await tx
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existingByEmail.length > 0) {
          // Link existing email-based user to Clerk account
          const [updated] = await tx
            .update(users)
            .set({
              clerkUserId,
              firstName,
              lastName,
              profileImageUrl,
              isEmailVerified,
              updatedAt: new Date(),
            })
            .where(eq(users.email, email))
            .returning();
          
          logger.info('Linked existing user to Clerk account', {
            userId: updated.id,
            clerkUserId,
            action: 'clerk_user_linked',
          });
          return updated;
        }
      }

      // No conflicts - insert new user
      const [newUser] = await tx
        .insert(users)
        .values({
          email,
          firstName,
          lastName,
          profileImageUrl,
          clerkUserId,
          isEmailVerified,
        })
        .returning();
      
      return newUser;
    });

    logger.info('Synced user from Clerk', {
      userId: result.id,
      clerkUserId,
      action: 'clerk_user_synced',
    });

    return { id: result.id, email };
  } catch (error) {
    logger.error('Failed to sync Clerk user', error instanceof Error ? error : new Error(String(error)), {
      clerkUserId,
      action: 'clerk_user_sync_failed',
    });
    throw error;
  }
}

export function clerkAuthGuard(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  
  if (!auth?.userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  
  next();
}

export async function clerkUserMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip for OIDC routes - these use oidc-provider's own session management
  if (shouldBypassClerk(req.path)) {
    return next();
  }

  const auth = getAuth(req);
  
  if (auth?.userId) {
    try {
      const user = await syncClerkUser(auth.userId);
      (req as any).user = user;
      (req as any).clerkUserId = auth.userId;
    } catch (error) {
      logger.warn('Failed to sync Clerk user in middleware', {
        clerkUserId: auth.userId,
        error: String(error),
      });
    }
  }
  
  next();
}

export { getAuth, requireAuth };
