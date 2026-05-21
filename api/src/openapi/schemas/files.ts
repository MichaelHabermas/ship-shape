/**
 * File upload schemas - Presigned URL-based file uploads to S3
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, SuccessResponseSchema } from './common.js';

// ============== File Upload ==============

export const UploadRequestSchema = z.object({
  filename: z.string().min(1).max(255).openapi({
    description: 'Original filename',
    example: 'screenshot.png',
  }),
  mimeType: z.string().min(1).max(100).openapi({
    description: 'MIME type of the file',
    example: 'image/png',
  }),
  sizeBytes: z.number().int().positive().max(1073741824).openapi({
    description: 'File size in bytes (max 1GB)',
    example: 1024000,
  }),
}).openapi('UploadRequest');

registry.register('UploadRequest', UploadRequestSchema);

export const UploadResponseSchema = z.object({
  uploadUrl: z.string().openapi({
    description: 'Presigned URL or local upload endpoint for uploading the file',
  }),
  fileId: UuidSchema.openapi({
    description: 'File ID to use when referencing this file',
  }),
  s3Key: z.string().openapi({
    description: 'Storage key for the uploaded file',
  }),
}).openapi('UploadResponse');

registry.register('UploadResponse', UploadResponseSchema);

export const FileMetadataSchema = z.object({
  id: UuidSchema,
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
  cdn_url: z.string().nullable(),
  status: z.string(),
  created_at: DateTimeSchema,
}).openapi('FileMetadata');

registry.register('FileMetadata', FileMetadataSchema);

export const ConfirmUploadResponseSchema = z.object({
  fileId: UuidSchema,
  cdnUrl: z.string().openapi({
    description: 'URL where the uploaded file can be served',
  }),
  status: z.literal('uploaded'),
}).openapi('ConfirmUploadResponse');

registry.register('ConfirmUploadResponse', ConfirmUploadResponseSchema);

// ============== Register File Endpoints ==============

registry.registerPath({
  method: 'post',
  path: '/files/upload',
  tags: ['Files'],
  summary: 'Get presigned upload URL',
  description: 'Request a presigned URL to upload a file. Upload the file via PUT to the returned URL.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UploadRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Upload URL and file metadata',
      content: {
        'application/json': {
          schema: UploadResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request or blocked file type',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
            blockedExtensions: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/files/{fileId}',
  tags: ['Files'],
  summary: 'Get file metadata',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'File metadata',
      content: {
        'application/json': {
          schema: FileMetadataSchema,
        },
      },
    },
    404: {
      description: 'File not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/files/{fileId}/serve',
  tags: ['Files'],
  summary: 'Serve uploaded file',
  description: 'Serve an uploaded file from local storage. Used by local development uploads.',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'File bytes',
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    400: {
      description: 'Invalid file ID format',
    },
    404: {
      description: 'File not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/files/{fileId}/local-upload',
  tags: ['Files'],
  summary: 'Upload file bytes locally',
  description: 'Upload raw file bytes to local storage for development environments.',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
    body: {
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'File uploaded',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid file ID format or file data',
    },
    404: {
      description: 'File not found or already uploaded',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/files/{fileId}/confirm',
  tags: ['Files'],
  summary: 'Confirm upload complete',
  description: 'Mark an uploaded file as complete after direct S3 upload.',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Upload confirmed',
      content: {
        'application/json': {
          schema: ConfirmUploadResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid file ID format',
    },
    404: {
      description: 'File not found',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/files/{fileId}',
  tags: ['Files'],
  summary: 'Delete file',
  description: 'Delete a file. Only the uploader or an admin can delete.',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'File deleted',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - not the uploader or admin',
    },
    404: {
      description: 'File not found',
    },
  },
});
