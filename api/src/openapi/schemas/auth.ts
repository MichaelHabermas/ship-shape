/**
 * Authentication schemas - Login, session, and API tokens
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, SuccessResponseSchema, ApiErrorResponseSchema } from './common.js';
import { jsonResponse } from './route-helpers.js';

// ============== Login ==============

export const LoginRequestSchema = z.object({
  email: z.string().email().openapi({
    description: 'User email address',
    example: 'user@example.com',
  }),
  password: z.string().min(1).openapi({
    description: 'User password',
  }),
}).openapi('LoginRequest');

registry.register('LoginRequest', LoginRequestSchema);

export const AuthUserSchema = z.object({
  id: UuidSchema,
  email: z.string().email(),
  name: z.string(),
  isSuperAdmin: z.boolean(),
}).openapi('AuthUser');

registry.register('AuthUser', AuthUserSchema);

export const AuthWorkspaceSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  role: z.string(),
}).openapi('AuthWorkspace');

registry.register('AuthWorkspace', AuthWorkspaceSchema);

export const AuthContextDataSchema = z.object({
  user: AuthUserSchema,
  currentWorkspace: AuthWorkspaceSchema.nullable(),
  workspaces: z.array(AuthWorkspaceSchema),
  pendingAccountabilityItems: z.array(z.unknown()),
}).openapi('AuthContextData');

registry.register('AuthContextData', AuthContextDataSchema);

export const LoginResponseSchema = z.object({
  success: z.literal(true),
  data: AuthContextDataSchema,
}).openapi('LoginResponse');

registry.register('LoginResponse', LoginResponseSchema);

export const CurrentUserResponseSchema = z.object({
  success: z.literal(true),
  data: AuthContextDataSchema,
}).openapi('CurrentUserResponse');

registry.register('CurrentUserResponse', CurrentUserResponseSchema);

export const AuthErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
}).openapi('AuthErrorResponse');

registry.register('AuthErrorResponse', AuthErrorResponseSchema);

export const CsrfTokenResponseSchema = z.object({
  token: z.string(),
}).openapi('CsrfTokenResponse');

registry.register('CsrfTokenResponse', CsrfTokenResponseSchema);

// ============== Session ==============

export const SessionResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    createdAt: DateTimeSchema.openapi({
      description: 'When the session was created',
    }),
    expiresAt: DateTimeSchema.openapi({
      description: 'Effective inactivity expiry derived from lastActivity',
    }),
    absoluteExpiresAt: DateTimeSchema.openapi({
      description: 'Absolute session expiry based on creation time',
    }),
    lastActivity: DateTimeSchema.openapi({
      description: 'Last activity timestamp used for sliding expiration',
    }),
  }),
}).openapi('SessionResponse');

registry.register('SessionResponse', SessionResponseSchema);

export const ExtendSessionResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    expiresAt: DateTimeSchema,
    lastActivity: DateTimeSchema,
  }),
}).openapi('ExtendSessionResponse');

registry.register('ExtendSessionResponse', ExtendSessionResponseSchema);

// ============== API Token ==============

export const APITokenSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  prefix: z.string().openapi({
    description: 'Token prefix for identification (first 8 chars)',
    example: 'ship_abc',
  }),
  last_used_at: DateTimeSchema.nullable(),
  created_at: DateTimeSchema,
  expires_at: DateTimeSchema.nullable(),
}).openapi('APIToken');

registry.register('APIToken', APITokenSchema);

export const CreateAPITokenSchema = z.object({
  name: z.string().min(1).max(100).openapi({
    description: 'Descriptive name for the token',
    example: 'CI/CD Pipeline',
  }),
  expires_in_days: z.number().int().min(1).max(365).optional().openapi({
    description: 'Days until token expires (default: never)',
  }),
}).openapi('CreateAPIToken');

registry.register('CreateAPIToken', CreateAPITokenSchema);

export const CreateAPITokenResponseSchema = z.object({
  token: APITokenSchema,
  secret: z.string().openapi({
    description: 'Full token value. Only shown once at creation time.',
    example: 'ship_abc123xyz789...',
  }),
}).openapi('CreateAPITokenResponse');

registry.register('CreateAPITokenResponse', CreateAPITokenResponseSchema);

// ============== Register Auth Endpoints ==============

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Authentication'],
  summary: 'Login',
  description: 'Authenticate with email and password. Sets a session cookie on success.',
  security: [], // No auth required for login
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: LoginResponseSchema,
        },
      },
    },
    400: jsonResponse(AuthErrorResponseSchema, 'Missing email or password'),
    401: jsonResponse(AuthErrorResponseSchema, 'Invalid credentials'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Authentication'],
  summary: 'Logout',
  description: 'End the current session and clear the session cookie.',
  responses: {
    200: jsonResponse(SuccessResponseSchema, 'Logout successful'),
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['Authentication'],
  summary: 'Get current user',
  description: 'Get the authenticated user, current workspace, and accessible workspaces.',
  responses: {
    200: {
      description: 'Current user information',
      content: {
        'application/json': {
          schema: CurrentUserResponseSchema,
        },
      },
    },
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
    404: jsonResponse(AuthErrorResponseSchema, 'User not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/extend-session',
  tags: ['Authentication'],
  summary: 'Extend current session',
  description: 'Refresh the authenticated session inactivity timeout.',
  responses: {
    200: {
      description: 'Session extended',
      content: {
        'application/json': {
          schema: ExtendSessionResponseSchema,
        },
      },
    },
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/session',
  tags: ['Authentication'],
  summary: 'Get current session',
  description: 'Get information about the current authenticated user and workspace.',
  responses: {
    200: {
      description: 'Session information',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/csrf-token',
  tags: ['Authentication'],
  summary: 'Get CSRF token',
  description: 'Issue a CSRF token for session-protected mutating requests.',
  security: [],
  responses: {
    200: {
      description: 'CSRF token',
      content: {
        'application/json': {
          schema: CsrfTokenResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api-tokens',
  tags: ['API Tokens'],
  summary: 'List API tokens',
  description: 'List all API tokens for the current user.',
  responses: {
    200: {
      description: 'List of API tokens',
      content: {
        'application/json': {
          schema: z.array(APITokenSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api-tokens',
  tags: ['API Tokens'],
  summary: 'Create API token',
  description: 'Create a new API token. The full token is only returned once at creation.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateAPITokenSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created API token',
      content: {
        'application/json': {
          schema: CreateAPITokenResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api-tokens/{id}',
  tags: ['API Tokens'],
  summary: 'Delete API token',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'Token deleted',
    },
    404: {
      description: 'Token not found',
    },
  },
});
