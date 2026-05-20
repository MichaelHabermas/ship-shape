/**
 * Search schemas - Mentions, documents, and learnings search
 */

import { z, registry } from '../registry.js';
import { UuidSchema } from './common.js';
import { DocumentTypeSchema } from './documents.js';

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
    visibility: z.enum(['private', 'workspace']).optional(),
  })),
}).openapi('MentionSearchResult');

registry.register('MentionSearchResult', MentionSearchResultSchema);

export const LearningSearchResultSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  content_preview: z.string().nullable(),
  program_id: UuidSchema.nullable(),
  program_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('LearningSearchResult');

registry.register('LearningSearchResult', LearningSearchResultSchema);

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
    200: {
      description: 'Search results',
      content: {
        'application/json': {
          schema: MentionSearchResultSchema,
        },
      },
    },
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
      q: z.string().openapi({
        description: 'Search query',
      }),
      program_id: UuidSchema.optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Learning search results',
      content: {
        'application/json': {
          schema: z.array(LearningSearchResultSchema),
        },
      },
    },
  },
});
