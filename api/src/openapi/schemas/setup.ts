/**
 * Setup schemas - first-run workspace initialization
 */

import { z, registry } from '../registry.js';
import { successEnvelope } from './route-helpers.js';

const SetupStatusDataSchema = z.object({
  needsSetup: z.boolean(),
}).openapi('SetupStatusData');

export const SetupStatusResponseSchema = successEnvelope(SetupStatusDataSchema, 'SetupStatusResponse');
registry.register('SetupStatusResponse', SetupStatusResponseSchema);

export const SetupInitializeRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
}).openapi('SetupInitializeRequest');

registry.register('SetupInitializeRequest', SetupInitializeRequestSchema);

const SetupInitializeDataSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    isSuperAdmin: z.boolean(),
  }),
  message: z.string(),
}).openapi('SetupInitializeData');

export const SetupInitializeResponseSchema = successEnvelope(SetupInitializeDataSchema, 'SetupInitializeResponse');
registry.register('SetupInitializeResponse', SetupInitializeResponseSchema);
