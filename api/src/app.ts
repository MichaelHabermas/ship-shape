import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { csrfSync } from 'csrf-sync';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import documentsRoutes from './routes/documents.js';
import issuesRoutes from './routes/issues.js';
import feedbackRoutes, { publicFeedbackRouter } from './routes/feedback.js';
import programsRoutes from './routes/programs.js';
import projectsRoutes from './routes/projects.js';
import weeksRoutes from './routes/weeks.js';
import standupsRoutes from './routes/standups.js';
import iterationsRoutes from './routes/iterations.js';
import teamRoutes from './routes/team.js';
import workspacesRoutes from './routes/workspaces.js';
import adminRoutes from './routes/admin.js';
import invitesRoutes from './routes/invites.js';
import setupRoutes from './routes/setup.js';
import backlinksRoutes from './routes/backlinks.js';
import { searchRouter } from './routes/search.js';
import { filesRouter } from './routes/files.js';
import caiaAuthRoutes from './routes/caia-auth.js';
import apiTokensRoutes from './routes/api-tokens.js';
import adminCredentialsRoutes from './routes/admin-credentials.js';
import claudeRoutes from './routes/claude.js';
import activityRoutes from './routes/activity.js';
import dashboardRoutes from './routes/dashboard.js';
import bootstrapRoutes from './routes/bootstrap.js';
import associationsRoutes from './routes/associations.js';
import accountabilityRoutes from './routes/accountability.js';
import aiRoutes from './routes/ai.js';
import weeklyPlansRoutes, { weeklyRetrosRouter } from './routes/weekly-plans.js';
import { documentCommentsRouter, commentsRouter } from './routes/comments.js';
import { setupSwagger } from './swagger.js';
import { initializeCAIA } from './services/caia.js';

// Validate SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required in production');
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-production';
const sameSiteCookiePolicy = process.env.NODE_ENV === 'production' && process.env.ENVIRONMENT === 'render'
  ? 'none'
  : 'strict';

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// CSRF protection setup
const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => getHeaderValue(req.headers['x-csrf-token']) ?? '',
});

// Conditional CSRF middleware - skip for API token auth (Bearer tokens are not vulnerable to CSRF)
import { Request, Response, NextFunction } from 'express';
const conditionalCsrf = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Skip CSRF for API token requests - Bearer tokens are not auto-attached by browsers
    return next();
  }
  // Apply CSRF protection for session-based auth
  return csrfSynchronisedProtection(req, res, next);
};

function isCsrfError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: string; message?: string; code?: string; status?: number };
  return candidate.status === 403
    && (candidate.name === 'ForbiddenError'
      || candidate.code === 'EBADCSRFTOKEN'
      || candidate.message?.toLowerCase().includes('csrf') === true);
}

// Rate limiting configurations
// In test/dev environment, use much higher limits to avoid issues
// Production limits: login=5/15min (failed only), api=100/min
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.E2E_TEST === '1';
const isDevEnv = process.env.NODE_ENV !== 'production';

// Strict rate limit for login (5 failed attempts / 15 min) - brute force protection
// skipSuccessfulRequests: true means only failed attempts count toward the limit
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestEnv ? 1000 : 5, // High limit for tests
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true, // Only count failed login attempts
});

// General API rate limit (100 req/min in prod, 1000 in dev)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTestEnv ? 10000 : isDevEnv ? 1000 : 100, // High limit for tests/dev
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});


export function createApp(corsOrigin: string = 'http://localhost:5173'): express.Express {
  const app = express();

  // Trust proxy headers (CloudFront) for secure cookies and correct protocol detection
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);

    // CloudFront with viewer_protocol_policy="redirect-to-https" always serves viewers over HTTPS.
    // However, CloudFront -> EB uses HTTP (origin_protocol_policy="http-only"), so CloudFront
    // sets X-Forwarded-Proto to "http". Override it to "https" when request comes via CloudFront.
    app.use((req, _res, next) => {
      // CloudFront adds Via header like "2.0 <id>.cloudfront.net (CloudFront)"
      const viaHeader = getHeaderValue(req.headers.via);
      if (viaHeader?.toLowerCase().includes('cloudfront')) {
        req.headers['x-forwarded-proto'] = 'https';
      }
      next();
    });
  }

  // Middleware - Security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },  // Allow images to be loaded cross-origin
    // Content Security Policy - prevents XSS attacks
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Admin credentials page uses inline scripts
        styleSrc: ["'self'", "'unsafe-inline'"], // TipTap editor needs inline styles
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"], // WebSocket connections
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      }
    },
    // HTTP Strict Transport Security
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
  }));

  // Apply rate limiting to all API routes
  app.use('/api/', apiLimiter);
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));  // Large wiki documents can be several MB
  app.use(express.urlencoded({ extended: true, limit: '10mb' })); // For HTML form submissions
  app.use(cookieParser(sessionSecret));

  // Session middleware for CSRF token storage
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: sameSiteCookiePolicy,
      maxAge: 15 * 60 * 1000, // 15 minutes
    },
  }));

  // CSRF token endpoint (must be before CSRF protection middleware)
  app.get('/api/csrf-token', (req, res) => {
    res.json({ token: generateToken(req) });
  });

  // Health check (no CSRF needed)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // API documentation (no auth needed)
  setupSwagger(app);

  // Setup routes (CSRF protected - first-time setup only)
  app.use('/api/setup', conditionalCsrf, setupRoutes);

  // Public feedback routes - no auth or CSRF required (must be before protected routes)
  app.use('/api/feedback', publicFeedbackRouter);

  // Apply stricter rate limiting to login endpoint (brute force protection)
  app.use('/api/auth/login', loginLimiter);

  // Apply CSRF protection to all state-changing API routes
  app.use('/api/auth', conditionalCsrf, authRoutes);
  app.use('/api/documents', conditionalCsrf, documentsRoutes);
  app.use('/api/documents', conditionalCsrf, backlinksRoutes);
  app.use('/api/documents', conditionalCsrf, associationsRoutes);
  app.use('/api/issues', conditionalCsrf, issuesRoutes);
  app.use('/api/feedback', conditionalCsrf, feedbackRoutes);
  app.use('/api/programs', conditionalCsrf, programsRoutes);
  app.use('/api/projects', conditionalCsrf, projectsRoutes);
  app.use('/api/weeks', conditionalCsrf, weeksRoutes);
  app.use('/api/weeks', conditionalCsrf, iterationsRoutes);
  app.use('/api/standups', conditionalCsrf, standupsRoutes);
  app.use('/api/team', conditionalCsrf, teamRoutes);
  app.use('/api/workspaces', conditionalCsrf, workspacesRoutes);
  app.use('/api/admin', conditionalCsrf, adminRoutes);
  app.use('/api/invites', conditionalCsrf, invitesRoutes);
  app.use('/api/api-tokens', conditionalCsrf, apiTokensRoutes);

  // Claude context routes - read-only GET endpoints for Claude skills
  app.use('/api/claude', claudeRoutes);

  // Search routes are read-only GET endpoints - no CSRF needed
  app.use('/api/search', searchRouter);

  // Activity routes are read-only GET endpoints - no CSRF needed
  app.use('/api/activity', activityRoutes);

  // Dashboard routes are read-only GET endpoints - no CSRF needed
  app.use('/api/dashboard', dashboardRoutes);

  // Bootstrap route is read-only app-shell hydration - no CSRF needed
  app.use('/api/bootstrap', bootstrapRoutes);

  // Accountability routes - inference-based action items (read-only GET)
  app.use('/api/accountability', accountabilityRoutes);

  // AI analysis routes - plan and retro quality feedback (CSRF protected)
  app.use('/api/ai', conditionalCsrf, aiRoutes);

  // Weekly plans routes - per-person accountability documents (CSRF protected)
  app.use('/api/weekly-plans', conditionalCsrf, weeklyPlansRoutes);

  // Weekly retros routes - per-person accountability documents (CSRF protected)
  app.use('/api/weekly-retros', conditionalCsrf, weeklyRetrosRouter);

  // CAIA auth routes - no CSRF protection (OAuth flow with external callback)
  // This is the single identity provider for PIV authentication
  // Mount at both /caia and /piv paths - /piv/callback is registered with CAIA
  app.use('/api/auth/caia', caiaAuthRoutes);
  app.use('/api/auth/piv', caiaAuthRoutes);

  // Admin credentials management (CSRF protected, super-admin only)
  app.use('/api/admin/credentials', conditionalCsrf, adminCredentialsRoutes);

  // File upload routes (CSRF protected for POST endpoints)
  app.use('/api/files', conditionalCsrf, filesRouter);

  // Comments routes
  app.use('/api/documents', conditionalCsrf, documentCommentsRouter);
  app.use('/api/comments', conditionalCsrf, commentsRouter);

  // Initialize CAIA OAuth client at startup
  initializeCAIA().catch((err) => {
    console.warn('CAIA initialization failed:', err);
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!isCsrfError(err)) {
      next(err);
      return;
    }

    res.status(403).json({ error: 'Invalid or missing CSRF token' });
  });

  return app;
}
