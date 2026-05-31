/**
 * Search schemas - Mentions, documents, and learnings search
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DocumentVisibilitySchema, ErrorResponseSchema, ApiErrorResponseSchema } from './common.js';
import { jsonResponse } from './route-helpers.js';
import { DocumentTypeSchema } from './documents.js';
import {
  OptionalQueryStringSchema,
  SearchLimitQuerySchema,
  SearchOffsetQuerySchema,
} from './query-helpers.js';

// ============== Search Results ==============

export const MentionSearchResultSchema = z.object({
  people: z.array(z.object({
    id: UuidSchema,
    name: z.string(),
    document_type: z.literal('person'),
  })),
  documents: z.array(z.object({
    id: UuidSchema,
    title: z.string(),
    document_type: DocumentTypeSchema,
    visibility: DocumentVisibilitySchema.optional(),
  })),
}).openapi('MentionSearchResult');

registry.register('MentionSearchResult', MentionSearchResultSchema);

export const LearningSearchResultSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  source_prd: z.string().nullable(),
  source_sprint_id: z.string().nullable(),
  content_preview: z.string().nullable(),
  program_id: UuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('LearningSearchResult');

registry.register('LearningSearchResult', LearningSearchResultSchema);

export const LearningSearchResponseSchema = z.object({
  learnings: z.array(LearningSearchResultSchema),
  total: z.number().int(),
}).openapi('LearningSearchResponse');

registry.register('LearningSearchResponse', LearningSearchResponseSchema);

export const DocumentSearchResultSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  document_type: DocumentTypeSchema,
  visibility: DocumentVisibilitySchema.optional(),
  ticket_number: z.number().int().nullable().optional(),
  updated_at: z.string(),
}).openapi('DocumentSearchResult');

registry.register('DocumentSearchResult', DocumentSearchResultSchema);

export const DocumentSearchResponseSchema = z.object({
  documents: z.array(DocumentSearchResultSchema),
  total: z.number().int(),
}).openapi('DocumentSearchResponse');

registry.register('DocumentSearchResponse', DocumentSearchResponseSchema);

export const ContentSearchResultSchema = DocumentSearchResultSchema.extend({
  rank: z.number().openapi({
    description: 'PostgreSQL full-text rank using weighted title and body vectors.',
  }),
  snippet: z.string().openapi({
    description: 'Highlighted search snippet from matching content or title.',
  }),
}).openapi('ContentSearchResult');

registry.register('ContentSearchResult', ContentSearchResultSchema);

export const ContentSearchResponseSchema = z.object({
  documents: z.array(ContentSearchResultSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
}).openapi('ContentSearchResponse');

registry.register('ContentSearchResponse', ContentSearchResponseSchema);

// ============== Register Search Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/search/mentions',
  tags: ['Search'],
  summary: 'Search for mentions',
  description: 'Search for people and documents to mention. Used by the @ mention autocomplete.',
  request: {
    query: z.object({
      q: z.string().openapi({
        description: 'Search query',
        example: 'john',
      }),
    }),
  },
  responses: {
    200: jsonResponse(MentionSearchResultSchema, 'Search results'),
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/search/documents',
  tags: ['Search'],
  summary: 'Search document titles',
  description: 'Title-only metadata search for command palette document navigation.',
  request: {
    query: z.object({
      q: OptionalQueryStringSchema.openapi({
        description: 'Title search query',
      }),
      type: DocumentTypeSchema.optional().openapi({
        description: 'Optional document type filter',
      }),
      limit: SearchLimitQuerySchema,
    }),
  },
  responses: {
    200: jsonResponse(DocumentSearchResponseSchema, 'Document search results'),
    400: jsonResponse(ErrorResponseSchema, 'Invalid query'),
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/search/content',
  tags: ['Search'],
  summary: 'Search document content',
  description: 'Full-content document search over titles and extracted TipTap text. Applies workspace/private visibility before pagination.',
  request: {
    query: z.object({
      q: z.string().min(1).openapi({
        description: 'Full-text search query',
      }),
      type: DocumentTypeSchema.optional().openapi({
        description: 'Optional document type filter',
      }),
      limit: SearchLimitQuerySchema,
      offset: SearchOffsetQuerySchema,
    }),
  },
  responses: {
    200: jsonResponse(ContentSearchResponseSchema, 'Content search results'),
    400: jsonResponse(ErrorResponseSchema, 'Invalid query'),
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/search/learnings',
  tags: ['Search'],
  summary: 'Search learnings',
  description: 'Search wiki documents for learnings. Filters by program optionally.',
  request: {
    query: z.object({
      q: OptionalQueryStringSchema.openapi({
        description: 'Search query',
      }),
      program_id: UuidSchema.optional(),
      limit: SearchLimitQuerySchema,
    }),
  },
  responses: {
    200: jsonResponse(LearningSearchResponseSchema, 'Learning search results'),
    401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  },
});
