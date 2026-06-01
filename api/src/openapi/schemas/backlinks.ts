/**
 * Backlinks and Associations schemas - Document relationships
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, BelongsToTypeSchema, ErrorResponseSchema, ApiErrorResponseSchema } from './common.js';
import { jsonResponse, SuccessOnlyResponseSchema } from './route-helpers.js';
import { DocumentTypeSchema } from './documents.js';

// ============== Backlink ==============

export const BacklinkSchema = z.object({
  id: UuidSchema,
  document_type: DocumentTypeSchema,
  title: z.string(),
  display_id: z.string().optional().openapi({
    description: 'Display ID for issues (e.g., "#42")',
  }),
}).openapi('Backlink');

registry.register('Backlink', BacklinkSchema);

// ============== Association ==============

export const AssociationSchema = z.object({
  id: UuidSchema,
  document_id: UuidSchema,
  related_id: UuidSchema,
  relationship_type: BelongsToTypeSchema,
  created_at: DateTimeSchema,
  // Related document info
  related_title: z.string().optional(),
  related_document_type: DocumentTypeSchema.optional(),
  related_color: z.string().optional(),
}).openapi('Association');

registry.register('Association', AssociationSchema);

export const ReverseAssociationSchema = z.object({
  id: UuidSchema,
  document_id: UuidSchema,
  related_id: UuidSchema,
  relationship_type: BelongsToTypeSchema,
  created_at: DateTimeSchema,
  document_title: z.string().nullable().optional(),
  document_document_type: DocumentTypeSchema.nullable().optional(),
}).openapi('ReverseAssociation');

registry.register('ReverseAssociation', ReverseAssociationSchema);

export const DeleteAssociationResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
  associations: z.array(AssociationSchema),
}).openapi('DeleteAssociationResponse');

registry.register('DeleteAssociationResponse', DeleteAssociationResponseSchema);

const ContextDocumentSchema = z.object({
  id: UuidSchema,
  title: z.string().nullable(),
  document_type: DocumentTypeSchema,
  ticket_number: z.number().nullable().optional(),
});

const ContextAssociationSchema = z.object({
  type: BelongsToTypeSchema,
  id: UuidSchema,
  title: z.string().nullable(),
  document_type: DocumentTypeSchema,
  color: z.string().nullable().optional(),
});

export const DocumentContextResponseSchema = z.object({
  current: ContextDocumentSchema.extend({
    program_id: UuidSchema.nullable().optional(),
    program_name: z.string().nullable().optional(),
    program_color: z.string().nullable().optional(),
  }),
  ancestors: z.array(ContextDocumentSchema.extend({ depth: z.number().int() })),
  children: z.array(ContextDocumentSchema.extend({ child_count: z.number().int().nonnegative() })),
  belongs_to: z.array(ContextAssociationSchema),
  breadcrumbs: z.array(z.object({
    id: UuidSchema,
    title: z.string(),
    type: z.string(),
    ticket_number: z.number().optional(),
  })),
}).openapi('DocumentContextResponse');

registry.register('DocumentContextResponse', DocumentContextResponseSchema);

// ============== Register Backlink Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/documents/{id}/backlinks',
  tags: ['Documents'],
  summary: 'Get document backlinks',
  description: 'Get all documents that link to this document.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'List of backlinks',
      content: {
        'application/json': {
          schema: z.array(BacklinkSchema),
        },
      },
    },
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
    404: jsonResponse(ErrorResponseSchema, 'Document not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/documents/{id}/links',
  tags: ['Documents'],
  summary: 'Update document links',
  description: 'Update the links from this document to other documents.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            target_ids: z.array(UuidSchema),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(SuccessOnlyResponseSchema, 'Links updated'),
    400: jsonResponse(ErrorResponseSchema, 'Invalid input or target documents'),
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
    404: jsonResponse(ErrorResponseSchema, 'Document not found'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/documents/{id}/associations',
  tags: ['Documents'],
  summary: 'Get document associations',
  description: 'Get associations (belongs_to relationships) for this document.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'List of associations',
      content: {
        'application/json': {
          schema: z.array(AssociationSchema),
        },
      },
    },
    404: {
      description: 'Document not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/documents/{id}/associations',
  tags: ['Documents'],
  summary: 'Add document association',
  description: 'Add an association to a program, project, sprint, or parent document.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            related_id: UuidSchema,
            relationship_type: BelongsToTypeSchema,
            metadata: z.record(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Association created',
      content: {
        'application/json': {
          schema: AssociationSchema,
        },
      },
    },
    400: {
      description: 'Invalid association',
    },
    404: {
      description: 'Document not found',
    },
    409: {
      description: 'Association already exists',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/documents/{id}/associations/{relatedId}',
  tags: ['Documents'],
  summary: 'Remove document association',
  request: {
    params: z.object({
      id: UuidSchema,
      relatedId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Association removed',
      content: {
        'application/json': {
          schema: DeleteAssociationResponseSchema,
        },
      },
    },
    404: {
      description: 'Document or association not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/documents/{id}/reverse-associations',
  tags: ['Documents'],
  summary: 'Get reverse associations',
  description: 'Get documents that are associated with this document.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'List of reverse associations',
      content: {
        'application/json': {
          schema: z.array(ReverseAssociationSchema),
        },
      },
    },
    404: {
      description: 'Document not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/documents/{id}/context',
  tags: ['Documents'],
  summary: 'Get document context tree',
  description: 'Get ancestors, children, and siblings for hierarchical navigation.',
  request: {
    params: z.object({ id: UuidSchema }),
  },
  responses: {
    200: {
      description: 'Document context tree',
      content: {
        'application/json': {
          schema: DocumentContextResponseSchema,
        },
      },
    },
    404: { description: 'Document not found' },
  },
});
