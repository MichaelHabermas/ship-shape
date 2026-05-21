/**
 * Document schemas - Base document type and document-type-specific properties
 */

import { z, registry } from '../registry.js';
import { documentTypeSchema } from '../../schemas/document-boundary.js';
import { UuidSchema, DateTimeSchema, DocumentVisibilitySchema } from './common.js';

// ============== Document Types ==============

export const DocumentTypeSchema = documentTypeSchema.openapi({
  description: 'Type of document',
});

registry.register('DocumentType', DocumentTypeSchema);

// ============== Base Document ==============

export const BaseDocumentSchema = z.object({
  id: UuidSchema.openapi({ description: 'Document ID' }),
  title: z.string().openapi({ description: 'Document title' }),
  document_type: DocumentTypeSchema,
  content: z.record(z.unknown()).nullable().openapi({
    description: 'TipTap JSON content',
  }),
  properties: z.record(z.unknown()).openapi({
    description: 'Type-specific properties (see individual document type schemas)',
  }),
  parent_id: UuidSchema.nullable().optional().openapi({
    description: 'Parent document ID for hierarchical wiki pages',
  }),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  archived_at: DateTimeSchema.nullable().optional(),
  deleted_at: DateTimeSchema.nullable().optional(),
  created_by: UuidSchema.optional().openapi({ description: 'User ID who created this document' }),
}).openapi('Document');

registry.register('Document', BaseDocumentSchema);

// ============== Document List Item (lighter response) ==============

export const DocumentListItemSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  document_type: DocumentTypeSchema,
  parent_id: UuidSchema.nullable().optional(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('DocumentListItem');

registry.register('DocumentListItem', DocumentListItemSchema);

// ============== Create/Update Document ==============

export const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled').openapi({
    description: 'Document title. Defaults to "Untitled".',
  }),
  document_type: DocumentTypeSchema.optional().default('wiki'),
  content: z.record(z.unknown()).optional().openapi({
    description: 'TipTap JSON content',
  }),
  properties: z.record(z.unknown()).optional().openapi({
    description: 'Type-specific properties',
  }),
  parent_id: UuidSchema.nullable().optional().openapi({
    description: 'Parent document ID (for hierarchical wikis)',
  }),
  visibility: DocumentVisibilitySchema.optional().default('workspace'),
}).openapi('CreateDocument');

registry.register('CreateDocument', CreateDocumentSchema);

export const UpdateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.record(z.unknown()).optional(),
  properties: z.record(z.unknown()).optional(),
  parent_id: UuidSchema.nullable().optional(),
  visibility: DocumentVisibilitySchema.optional(),
  document_type: DocumentTypeSchema.optional(),
}).openapi('UpdateDocument');

registry.register('UpdateDocument', UpdateDocumentSchema);

// ============== Register Document Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/documents',
  tags: ['Documents'],
  summary: 'List documents',
  description: 'List documents with optional filtering by type and parent.',
  request: {
    query: z.object({
      type: DocumentTypeSchema.optional().openapi({
        description: 'Filter by document type',
      }),
      parent_id: UuidSchema.optional().openapi({
        description: 'Filter by parent document ID',
      }),
    }),
  },
  responses: {
    200: {
      description: 'List of documents',
      content: {
        'application/json': {
          schema: z.array(DocumentListItemSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/documents/{id}',
  tags: ['Documents'],
  summary: 'Get document by ID',
  description: 'Retrieve a single document with full content and properties.',
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Document ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Document details',
      content: {
        'application/json': {
          schema: BaseDocumentSchema,
        },
      },
    },
    404: {
      description: 'Document not found',
      content: {
        'application/json': {
          schema: z.object({ error: z.literal('Document not found') }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/documents',
  tags: ['Documents'],
  summary: 'Create document',
  description: 'Create a new document of any type.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateDocumentSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created document',
      content: {
        'application/json': {
          schema: BaseDocumentSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
            details: z.array(z.object({
              path: z.array(z.union([z.string(), z.number()])),
              message: z.string(),
            })).optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/documents/{id}',
  tags: ['Documents'],
  summary: 'Update document',
  description: 'Update document title, content, or properties.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateDocumentSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated document',
      content: {
        'application/json': {
          schema: BaseDocumentSchema,
        },
      },
    },
    404: {
      description: 'Document not found',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/documents/{id}',
  tags: ['Documents'],
  summary: 'Delete document',
  description: 'Soft-delete a document. Can be restored later.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'Document deleted',
    },
    404: {
      description: 'Document not found',
    },
  },
});

const DocumentContentPayloadSchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    content: z.record(z.unknown()).nullable(),
  })
  .openapi('DocumentContentPayload');

registry.registerPath({
  method: 'get',
  path: '/documents/{id}/content',
  tags: ['Documents'],
  summary: 'Get document TipTap content',
  request: { params: z.object({ id: UuidSchema }) },
  responses: {
    200: {
      description: 'Document content',
      content: { 'application/json': { schema: DocumentContentPayloadSchema } },
    },
    404: { description: 'Document not found' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/documents/{id}/content',
  tags: ['Documents'],
  summary: 'Update document TipTap content',
  request: {
    params: z.object({ id: UuidSchema }),
    body: { content: { 'application/json': { schema: z.record(z.unknown()).nullable() } } },
  },
  responses: {
    200: { description: 'Content updated' },
    404: { description: 'Document not found' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/documents/converted/list',
  tags: ['Documents'],
  summary: 'List converted documents',
  request: {
    query: z.object({
      original_type: DocumentTypeSchema.optional(),
      converted_type: DocumentTypeSchema.optional(),
    }),
  },
  responses: {
    200: { description: 'Converted documents', content: { 'application/json': { schema: z.array(z.record(z.unknown())) } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/documents/{id}/convert',
  tags: ['Documents'],
  summary: 'Convert document to another type',
  request: {
    params: z.object({ id: UuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ target_type: DocumentTypeSchema }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Document converted', content: { 'application/json': { schema: BaseDocumentSchema } } },
    404: { description: 'Document not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/documents/{id}/undo-conversion',
  tags: ['Documents'],
  summary: 'Undo document type conversion',
  request: { params: z.object({ id: UuidSchema }) },
  responses: {
    200: { description: 'Conversion undone', content: { 'application/json': { schema: BaseDocumentSchema } } },
    404: { description: 'Document not found' },
  },
});
