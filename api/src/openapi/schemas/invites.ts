/**
 * Workspace invite schemas - public token validation and acceptance
 */

import { z, registry } from '../registry.js';
import { DateTimeSchema } from './common.js';
import { jsonResponse, successEnvelope, TokenParamSchema } from './route-helpers.js';

const InviteDetailsSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['admin', 'member']),
  workspaceName: z.string(),
  expiresAt: DateTimeSchema,
  userExists: z.boolean(),
  alreadyMember: z.boolean(),
}).openapi('InviteDetails');

const InviteDetailsResponseSchema = successEnvelope(InviteDetailsSchema, 'InviteDetailsResponse');
registry.register('InviteDetailsResponse', InviteDetailsResponseSchema);

const InviteAcceptRequestSchema = z.object({
  password: z.string().min(8).optional(),
  name: z.string().min(1).optional(),
}).openapi('InviteAcceptRequest');

registry.register('InviteAcceptRequest', InviteAcceptRequestSchema);

const InviteAcceptDataSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  }),
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    role: z.enum(['admin', 'member']),
  }),
}).openapi('InviteAcceptData');

const InviteAcceptResponseSchema = successEnvelope(InviteAcceptDataSchema, 'InviteAcceptResponse');
registry.register('InviteAcceptResponse', InviteAcceptResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/invites/{token}',
  tags: ['Invites'],
  summary: 'Validate invite token',
  security: [],
  request: { params: TokenParamSchema },
  responses: {
    200: jsonResponse(InviteDetailsResponseSchema, 'Invite details'),
    400: { description: 'Invite used or expired' },
    404: { description: 'Invalid invite' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/invites/{token}/accept',
  tags: ['Invites'],
  summary: 'Accept workspace invite',
  security: [],
  request: {
    params: TokenParamSchema,
    body: {
      content: {
        'application/json': { schema: InviteAcceptRequestSchema },
      },
    },
  },
  responses: {
    201: jsonResponse(InviteAcceptResponseSchema, 'Invite accepted'),
    400: { description: 'Validation error' },
    404: { description: 'Invalid invite' },
    500: { description: 'Internal server error' },
  },
});
