// Express app assembly wires middleware, security policy, and API route modules.
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import documentsRoutes from './routes/documents/index.js';
import issuesRoutes from './routes/issues/index.js';
import feedbackRoutes, { publicFeedbackRouter } from './routes/feedback.js';
import programsRoutes from './routes/programs.js';
import projectsRoutes from './routes/projects.js';
import weeksRoutes from './routes/weeks/index.js';
import standupsRoutes from './routes/standups.js';
import iterationsRoutes from './routes/iterations.js';
import teamRoutes from './routes/team/index.js';
import workspacesRoutes from './routes/workspaces/index.js';
import adminRoutes from './routes/admin/index.js';
import invitesRoutes from './routes/invites.js';
import setupRoutes from './routes/setup.js';
import devRoutes from './routes/dev.js';
import backlinksRoutes from './routes/backlinks.js';
import { searchRouter } from './routes/search.js';
import { filesRouter } from './routes/files.js';
import caiaAuthRoutes from './routes/caia-auth.js';
import apiTokensRoutes from './routes/api-tokens.js';
import platformAppsRoutes from './platform/apps/routes.js';
import oauthProviderRoutes from './platform/oauth/http-routes.js';
import {
  OAUTH_AUTHORIZE_PATH,
  OAUTH_CONSENT_PAGE_PATH,
  OAUTH_DEVICE_CODE_PATH,
  OAUTH_DEVICE_VERIFY_PATH,
  OAUTH_TOKEN_PATH,
} from './platform/oauth/routes.js';
import { publicApiV1Router } from './platform/api/v1/router.js';
import { bootstrapWebhooks } from './platform/webhooks/bootstrap.js';
import { consumePublicApiPreAuthRateLimit } from './platform/api/v1/middleware.js';
import { sendPublicApiError } from './platform/api/v1/errors.js';
import { RATE_LIMIT_HEADER_RETRY_AFTER } from './platform/ratelimit/headers.js';
import adminCredentialsRoutes from './routes/admin-credentials.js';
import claudeRoutes from './routes/claude/context-route.js';
import activityRoutes from './routes/activity.js';
import dashboardRoutes from './routes/dashboard/index.js';
import bootstrapRoutes from './routes/bootstrap.js';
import associationsRoutes from './routes/associations.js';
import accountabilityRoutes from './routes/accountability.js';
import aiRoutes from './routes/ai.js';
import fleetgraphRoutes from './routes/fleetgraph/index.js';
import weeklyPlansRoutes, { weeklyRetrosRouter } from './routes/weekly-plans/index.js';
import { documentCommentsRouter, commentsRouter } from './routes/comments.js';
import { authMiddleware } from './middleware/auth.js';
import { setupSwagger } from './swagger.js';
import { initializeCAIA } from './services/caia.js';
import { sessionCookieOptions } from './config/session-cookies.js';
import { isDevEnv, isProduction, isTestEnv } from './config/runtime.js';

// Validate SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required in production');
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-production';

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Conditional CSRF middleware - skip for API token auth (Bearer tokens are not vulnerable to CSRF)
const CSRF_COOKIE_NAME = 'csrf_token';

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function csrfTokensMatch(expected: string, presented: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);
  return expectedBuffer.length === presentedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, presentedBuffer);
}

const conditionalCsrf = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Skip CSRF for API token requests - Bearer tokens are not auto-attached by browsers
    return next();
  }

  const originDecision = validateCookieAuthOrigin(req);
  if (!originDecision.allowed) {
    res.status(403).json({ error: originDecision.reason });
    return;
  }

  if (!isStateChangingMethod(req.method)) {
    return next();
  }

  const signedCookies = req.signedCookies as Record<string, unknown> | undefined;
  const expectedToken = signedCookies?.[CSRF_COOKIE_NAME];
  const presentedToken = getHeaderValue(req.headers['x-csrf-token']);
  if (
    typeof expectedToken !== 'string'
    || typeof presentedToken !== 'string'
    || !csrfTokensMatch(expectedToken, presentedToken)
  ) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }

  return next();
};

function isStateChangingMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestOrigin(req: Request): string {
  const protocol = req.protocol;
  const host = req.get('host') ?? '';
  return `${protocol}://${host}`;
}

function configuredAllowedOrigins(): Set<string> {
  const values = [
    process.env.CORS_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.WEB_URL,
  ]
    .flatMap(value => (value ?? '').split(','))
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => value !== '*')
    .map(value => parseOrigin(value) ?? value);

  return new Set(values);
}

function wildcardOriginAllowed(): boolean {
  if (isProduction()) return false;
  return [process.env.CORS_ORIGIN, process.env.FRONTEND_URL, process.env.WEB_URL]
    .flatMap(value => (value ?? '').split(','))
    .map(value => value.trim())
    .includes('*');
}

function validateCookieAuthOrigin(req: Request): { allowed: true } | { allowed: false; reason: string } {
  if (!isStateChangingMethod(req.method)) return { allowed: true };

  const origin = parseOrigin(getHeaderValue(req.headers.origin));
  const referer = parseOrigin(getHeaderValue(req.headers.referer));
  const presentedOrigin = origin ?? referer;

  if (!presentedOrigin) {
    return isProduction()
      ? { allowed: false, reason: 'Missing Origin or Referer header' }
      : { allowed: true };
  }

  const sameOrigin = requestOrigin(req);
  const allowedOrigins = configuredAllowedOrigins();
  if (presentedOrigin === sameOrigin || allowedOrigins.has(presentedOrigin) || wildcardOriginAllowed()) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Cross-site request rejected' };
}

function isBodyParserSyntaxError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { type?: string; status?: number; body?: unknown };
  return candidate.status === 400 && candidate.type === 'entity.parse.failed';
}

function shouldBypassRateLimit(req: Request): boolean {
  if (isProduction()) return false;
  if (process.env.API_BENCHMARK_RATE_LIMIT_BYPASS !== '1') return false;

  const token = process.env.API_BENCHMARK_RATE_LIMIT_BYPASS_TOKEN;
  if (!token) return false;

  return getHeaderValue(req.headers['x-benchmark-rate-limit-bypass']) === token;
}

function shouldSkipGeneralApiRateLimit(req: Request): boolean {
  return shouldBypassRateLimit(req) || isPublicApiV1Request(req.originalUrl);
}

function isPublicApiV1Request(originalUrl: string): boolean {
  return (
    originalUrl === '/api/v1' ||
    originalUrl.startsWith('/api/v1/') ||
    originalUrl.startsWith('/api/v1?')
  );
}

function oauthFrameProtectionHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  next();
}

export function openApiShouldRequireAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  return env.OPENAPI_PUBLIC !== '1';
}

// Rate limiting configurations
// In test/dev environment, use much higher limits to avoid issues
// Production limits: login=5/15min (failed only), api=100/min

// Strict rate limit for login (5 failed attempts / 15 min) - brute force protection
// skipSuccessfulRequests: true means only failed attempts count toward the limit
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestEnv() ? 1000 : 5, // High limit for tests
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true, // Only count failed login attempts
  skip: shouldBypassRateLimit,
});

// General API rate limit (100 req/min in prod, 1000 in dev)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTestEnv() ? 10000 : isDevEnv() ? 1000 : 100, // High limit for tests/dev
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  skip: shouldSkipGeneralApiRateLimit,
});


export function createApp(corsOrigin: string = 'http://localhost:5173'): express.Express {
  bootstrapWebhooks();

  const app = express();

  // Trust proxy headers (CloudFront) for secure cookies and correct protocol detection
  if (isProduction()) {
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
        scriptSrc: ["'self'"],
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

  // CSRF token endpoint (must be before CSRF protection middleware)
  app.get('/api/csrf-token', (_req, res) => {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, sessionCookieOptions({ signed: true }, 'lax'));
    res.json({ token });
  });

  // Health check (no CSRF needed)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', plugforge: true });
  });

  if (isDevEnv()) {
    app.use('/api/dev', devRoutes);
  }

  setupSwagger(app, openApiShouldRequireAuth() ? authMiddleware : undefined);

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
  app.use('/api/platform/apps', conditionalCsrf, platformAppsRoutes);
  app.use('/api/v1', publicApiV1Router);
  app.use(OAUTH_AUTHORIZE_PATH, oauthFrameProtectionHeaders);
  app.use(OAUTH_DEVICE_CODE_PATH, apiLimiter);
  app.use(OAUTH_DEVICE_VERIFY_PATH, oauthFrameProtectionHeaders, conditionalCsrf);
  app.use(OAUTH_TOKEN_PATH, apiLimiter);
  app.use(OAUTH_CONSENT_PAGE_PATH, oauthFrameProtectionHeaders, conditionalCsrf);
  app.use('/oauth', oauthProviderRoutes);

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

  // FleetGraph routes - visible findings and bounded on-demand graph actions
  app.use('/api/fleetgraph', conditionalCsrf, fleetgraphRoutes);

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
    if (isBodyParserSyntaxError(err)) {
      if (isPublicApiV1Request(_req.originalUrl)) {
        const { requestId, result } = consumePublicApiPreAuthRateLimit(_req, res);
        if (!result.allowed) {
          res.setHeader(RATE_LIMIT_HEADER_RETRY_AFTER, String(result.retryAfterSeconds));
          sendPublicApiError(res, 429, {
            code: 'rate_limited',
            message: 'Too many requests. Please slow down.',
            details: { retry_after_seconds: result.retryAfterSeconds },
            request_id: requestId,
          });
          return;
        }

        sendPublicApiError(res, 400, {
          code: 'validation_failed',
          message: 'Malformed JSON request body',
          request_id: requestId,
        });
        return;
      }

      res.status(400).json({ error: 'Malformed JSON request body' });
      return;
    }

    next(err);
  });

  return app;
}
