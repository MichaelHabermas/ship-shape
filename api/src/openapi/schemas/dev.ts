/**
 * Dev-only schemas — local setup UX (not mounted in production).
 */

import { z, registry } from '../registry.js';

export const DevDatabaseStatusResponseSchema = z
  .object({
    connected: z.boolean(),
    unreachable: z.boolean().optional(),
    hint: z.string().optional(),
  })
  .openapi('DevDatabaseStatusResponse');

registry.register('DevDatabaseStatusResponse', DevDatabaseStatusResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/dev/database-status',
  tags: ['Dev'],
  summary: 'Probe local database reachability',
  description:
    'Dev-only endpoint for the database status banner. Returns connection state and setup hints without requiring authentication.',
  responses: {
    200: {
      description: 'Database reachability status',
      content: {
        'application/json': {
          schema: DevDatabaseStatusResponseSchema,
        },
      },
    },
  },
});
