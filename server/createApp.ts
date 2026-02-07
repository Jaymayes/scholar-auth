/**
 * App Factory for Testing
 * 
 * Creates Express application instance with configurable middleware.
 * This allows supertest to import and test the app without starting a full server.
 * 
 * **Why this exists:**
 * - Enables HTTP handler testing via supertest
 * - Allows test-only middleware injection (testAuthBypass)
 * - Preserves production OIDC/session/passport flow
 * 
 * **Production vs Test:**
 * - Production: Uses full OIDC, passport, real sessions
 * - Test: Can optionally use testAuthBypass when TEST_AUTH_BYPASS=1
 */

import express, { Express } from 'express';
import session from 'express-session';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import { validateTestAuthBypassSafety, testAuthBypass } from './middleware/testAuthBypass';
import { registerRoutes } from './routes';
import { emailService } from './services/emailService';

/**
 * Email service contract for dependency injection
 */
export interface EmailServiceContract {
  sendVerificationEmail(email: string, code: string): Promise<void>;
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
}

/**
 * Dependencies that can be injected into the app
 */
export interface AppDependencies {
  emailService?: EmailServiceContract;
}

export interface AppConfig {
  /**
   * Enable test-only auth bypass
   * Only works when NODE_ENV === 'test'
   */
  enableTestAuthBypass?: boolean;

  /**
   * Session secret (defaults to env var or test secret)
   */
  sessionSecret?: string;

  /**
   * Skip route registration (useful for minimal testing)
   */
  skipRoutes?: boolean;

  /**
   * Dependencies for dependency injection (tests can provide stubs)
   */
  dependencies?: AppDependencies;
}

/**
 * Create Express application with configurable middleware
 */
export async function createApp(config: AppConfig = {}): Promise<Express> {
  // Validate security before creating app
  if (config.enableTestAuthBypass) {
    validateTestAuthBypassSafety();
  }

  const app = express();

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Session middleware
  const sessionSecret = config.sessionSecret || process.env.SESSION_SECRET || 'test-secret-key-change-in-production';
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Passport middleware
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport serialization (required for sessions)
  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });

  // Test-only auth bypass (if enabled)
  if (config.enableTestAuthBypass && process.env.NODE_ENV === 'test') {
    app.use(testAuthBypass);
  }

  // Prepare dependencies (default to production services)
  const dependencies: AppDependencies = {
    emailService: config.dependencies?.emailService || emailService,
  };

  // Register routes (unless skipped)
  if (!config.skipRoutes) {
    await registerRoutes(app as any, dependencies);
  }

  return app;
}
