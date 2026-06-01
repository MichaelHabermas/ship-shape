// File upload routes: presigned S3/local uploads, confirm, serve, and delete with capability checks.
import { Router, type Router as ExpressRouter, Request, Response } from 'express';
import express from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../middleware/auth.js';
import { getActor, getDocumentAccessContext } from '../services/document-access.js';
import { authorize, type Capability } from '../security/capabilities.js';
import { principalFromRequest } from '../security/principal.js';
import { useS3Uploads } from '../config/runtime.js';
import { sendInternalError, sendLegacyError, sendValidationError } from '../utils/route-http.js';
import { requireFirstRow } from '../utils/query-rows.js';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Local uploads directory (for development)
const UPLOADS_DIR = join(__dirname, '../../uploads');

// S3 configuration
const S3_BUCKET_NAME = process.env.S3_UPLOADS_BUCKET || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Max file size: 1GB (1073741824 bytes)
const MAX_FILE_SIZE = 1073741824;

// Presigned URL expiration: 15 minutes
const PRESIGNED_URL_EXPIRES_IN = 15 * 60;

// Initialize S3 client (only when bucket is configured)
let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: AWS_REGION });
  }
  return s3Client;
}

// UUID validation regex - prevents path traversal by ensuring ID is valid UUID
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string | string[] | undefined): id is string {
  if (!id || Array.isArray(id)) return false;
  return UUID_REGEX.test(id);
}

interface FileRecordRow {
  id: string;
  s3_key: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | string;
  document_id: string | null;
  uploaded_by: string;
  status: string;
}

type FileIdRow = { id: string };

type FileMetadataRow = {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | string;
  cdn_url: string | null;
  status: string;
  created_at: Date | string;
  document_id: string | null;
  uploaded_by: string;
};

export const filesRouter: ExpressRouter = Router();

// Validation schemas
const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE, {
    message: `File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB)`,
  }),
  documentId: z.string().uuid().optional(),
});

/**
 * Blocked file extensions for security (executables and scripts)
 * We allow ANY file type EXCEPT these dangerous extensions.
 * Check by extension, not MIME type (MIME types are unreliable and can be spoofed).
 */
const BLOCKED_EXTENSIONS = new Set([
  // Windows executables
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  // Windows scripts
  '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh',
  // Windows system files
  '.dll', '.sys', '.drv', '.cpl', '.ocx',
  // Windows shortcuts and config
  '.lnk', '.inf', '.reg', '.msc',
  // macOS executables
  '.app', '.dmg', '.pkg',
  // Linux executables and packages
  '.sh', '.bash', '.deb', '.rpm', '.run',
  // Cross-platform
  '.jar', '.ps1', '.psm1', '.psd1',
]);

function isAllowedFile(filename: string, _mimeType: string): boolean {
  const safeName = basename(filename).toLowerCase();
  const extensions = safeName.split('.').slice(1).map((ext) => `.${ext}`);
  return extensions.every((ext) => !BLOCKED_EXTENSIONS.has(ext));
}

function safeAttachmentFilename(filename: string): string {
  return basename(filename).replace(/[\r\n"]/g, '_').trim() || 'download';
}

function authorizeRequest(req: Request, capability: Capability) {
  return authorize(pool, principalFromRequest(req), capability);
}

// POST /api/files/upload - Get presigned URL for upload
// For local dev: returns a mock upload URL
// For production: would return S3 presigned URL
filesRouter.post('/upload', authMiddleware, async (req: Request, res: Response) => {
  try {
    const validation = uploadRequestSchema.safeParse(req.body);
    if (!validation.success) {
      sendValidationError(res, validation.error);
      return;
    }

    const { filename, mimeType, sizeBytes, documentId } = validation.data;
    const workspaceId = req.workspaceId;
    const userId = req.userId;

    // Validate file type
    if (!isAllowedFile(filename, mimeType)) {
      sendLegacyError(res, 400, 'File type not allowed');
      return;
    }

    if (documentId) {
      const decision = await authorizeRequest(req, {
        resource: 'file',
        action: 'create_upload',
        documentId,
      });
      if (!decision.allowed) {
        res.status(403).json({ error: 'Document not accessible' });
        return;
      }
    }

    // Generate unique S3 key / local path
    const fileId = randomUUID();
    const ext = filename.slice(filename.lastIndexOf('.'));
    const s3Key = `${workspaceId}/${fileId}${ext}`;

    // Create file record with 'pending' status
    const result = await pool.query<FileIdRow>(
      `INSERT INTO files (id, workspace_id, uploaded_by, filename, mime_type, size_bytes, s3_key, status, document_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING id`,
      [fileId, workspaceId, userId, filename, mimeType, sizeBytes, s3Key, documentId ?? null]
    );
    const createdFileId = requireFirstRow(result.rows).id;

    // Use S3 when configured; otherwise use local storage for lightweight deployments.
    const uploadUrl = useS3Uploads()
      ? await generateS3PresignedUrl(s3Key, mimeType, sizeBytes)
      : `/api/files/${fileId}/local-upload`;

    res.json({
      fileId: createdFileId,
      uploadUrl,
      s3Key,
    });
  } catch (error) {
    sendInternalError(res, error, 'Error creating upload:', { error: 'Failed to create upload' });
  }
});

// Raw body parser for file uploads (1GB limit for local development)
const rawBodyParser = express.raw({
  type: '*/*',
  limit: '1gb',
});

// POST /api/files/:id/local-upload - Local development upload endpoint
// In production, files upload directly to S3
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.post('/:id/local-upload', rawBodyParser, authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      sendLegacyError(res, 400, 'Invalid file ID format');
      return;
    }

    const workspaceId = req.workspaceId;

    // Verify file record exists and belongs to user's workspace
    const fileResult = await pool.query<FileRecordRow>(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2 AND status = 'pending'`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found or already uploaded' });
      return;
    }

    const file = requireFirstRow(fileResult.rows, 'File not found');

    if (file.uploaded_by !== req.userId) {
      res.status(403).json({ error: 'Only the uploader can complete this upload' });
      return;
    }

    if (file.document_id) {
      const decision = await authorizeRequest(req, {
        resource: 'file',
        action: 'complete_upload',
        documentId: file.document_id,
      });
      if (!decision.allowed) {
        res.status(403).json({ error: 'Document not accessible' });
        return;
      }
    }

    // Get raw body as buffer - handle various input types
    let buffer: Buffer;
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (req.body instanceof Uint8Array) {
      buffer = Buffer.from(req.body);
    } else if (typeof req.body === 'object' && req.body !== null) {
      // Handle ArrayBuffer or typed array wrapped in object
      const bodyRecord = req.body as Record<string, unknown>;
      const nestedData: unknown = bodyRecord.data;
      const data: unknown = nestedData !== undefined ? nestedData : req.body;
      if (Array.isArray(data)) {
        buffer = Buffer.from(data);
      } else {
        buffer = Buffer.from(JSON.stringify(req.body));
      }
    } else if (typeof req.body === 'string') {
      buffer = Buffer.from(req.body, 'base64');
    } else {
      sendLegacyError(res, 400, 'Invalid file data format');
      return;
    }

    if (buffer.length === 0) {
      sendLegacyError(res, 400, 'No file data received');
      return;
    }

    if (buffer.length !== Number(file.size_bytes)) {
      sendLegacyError(res, 400, 'Uploaded file size does not match declared size');
      return;
    }

    // Ensure uploads directory exists
    const filePath = join(UPLOADS_DIR, file.s3_key);
    await mkdir(dirname(filePath), { recursive: true });

    // Write file
    await writeFile(filePath, buffer);

    // Update file status
    const cdnUrl = `/api/files/${fileId}/serve`;
    await pool.query(
      `UPDATE files SET status = 'uploaded', cdn_url = $1, updated_at = NOW() WHERE id = $2`,
      [cdnUrl, fileId]
    );

    res.json({ success: true });
  } catch (error) {
    sendInternalError(res, error, 'Error uploading file locally:', { error: 'Failed to upload file' });
  }
});

// POST /api/files/:id/confirm - Confirm upload complete (for S3 direct uploads)
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.post('/:id/confirm', authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      sendLegacyError(res, 400, 'Invalid file ID format');
      return;
    }

    const workspaceId = req.workspaceId;

    // Verify file record exists and belongs to user's workspace
    const fileResult = await pool.query<FileRecordRow>(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = requireFirstRow(fileResult.rows, 'File not found');

    if (file.uploaded_by !== req.userId) {
      res.status(403).json({ error: 'Only the uploader can confirm this upload' });
      return;
    }

    if (file.document_id) {
      const decision = await authorizeRequest(req, {
        resource: 'file',
        action: 'complete_upload',
        documentId: file.document_id,
      });
      if (!decision.allowed) {
        res.status(403).json({ error: 'Document not accessible' });
        return;
      }
    }

    if (useS3Uploads()) {
      const client = getS3Client();
      let head;
      try {
        head = await client.send(new HeadObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: file.s3_key,
        }));
      } catch {
        res.status(400).json({ error: 'Uploaded object was not found in storage' });
        return;
      }
      if (head.ContentLength !== Number(file.size_bytes)) {
        res.status(400).json({ error: 'Uploaded file size does not match declared size' });
        return;
      }
    }

    // Generate CDN URL
    let cdnUrl: string;
    if (useS3Uploads()) {
      const cdnDomain = process.env.CDN_DOMAIN;
      if (!cdnDomain) {
        throw new Error('CDN_DOMAIN environment variable is required in production');
      }
      cdnUrl = `https://${cdnDomain}/${file.s3_key}`;
    } else {
      cdnUrl = `/api/files/${fileId}/serve`;
    }

    // Update file status
    await pool.query(
      `UPDATE files SET status = 'uploaded', cdn_url = $1, updated_at = NOW() WHERE id = $2`,
      [cdnUrl, fileId]
    );

    res.json({
      fileId,
      cdnUrl,
      status: 'uploaded',
    });
  } catch (error) {
    sendInternalError(res, error, 'Error confirming upload:', { error: 'Failed to confirm upload' });
  }
});

// GET /api/files/:id/serve - Serve file (local development only)
// SECURITY: requireAuth added to prevent unauthenticated file access
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.get('/:id/serve', authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      sendLegacyError(res, 400, 'Invalid file ID format');
      return;
    }

    const workspaceId = req.workspaceId;

    // Get file record - SECURITY: Verify file belongs to user's workspace
    const fileResult = await pool.query<FileRecordRow>(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2 AND status = 'uploaded'`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = requireFirstRow(fileResult.rows, 'File not found');
    if (file.document_id) {
      const decision = await authorizeRequest(req, {
        resource: 'file',
        action: 'serve',
        documentId: file.document_id,
      });
      if (!decision.allowed) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    } else {
      const actor = getActor(req);
      const { isAdmin } = await getDocumentAccessContext(actor);
      if (file.uploaded_by !== req.userId && !isAdmin && !req.isSuperAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    const filePath = join(UPLOADS_DIR, file.s3_key);

    // Serve user uploads as downloads to avoid browser execution of uploaded content.
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${safeAttachmentFilename(file.filename)}"`);
    res.sendFile(filePath);
  } catch (error) {
    sendInternalError(res, error, 'Error serving file:', { error: 'Failed to serve file' });
  }
});

// GET /api/files/:id - Get file metadata
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      sendLegacyError(res, 400, 'Invalid file ID format');
      return;
    }

    const workspaceId = req.workspaceId;

    const result = await pool.query<FileMetadataRow>(
      `SELECT id, filename, mime_type, size_bytes, cdn_url, status, created_at, document_id, uploaded_by
       FROM files WHERE id = $1 AND workspace_id = $2`,
      [fileId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = requireFirstRow(result.rows, 'File not found');
    if (file.document_id) {
      const decision = await authorizeRequest(req, {
        resource: 'file',
        action: 'read',
        documentId: file.document_id,
      });
      if (!decision.allowed) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    } else {
      const actor = getActor(req);
      const { isAdmin } = await getDocumentAccessContext(actor);
      if (file.uploaded_by !== req.userId && !isAdmin && !req.isSuperAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    const { uploaded_by: _uploadedBy, ...metadata } = file;
    res.json(metadata);
  } catch (error) {
    sendInternalError(res, error, 'Error getting file:', { error: 'Failed to get file' });
  }
});

// DELETE /api/files/:id - Delete a file
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      sendLegacyError(res, 400, 'Invalid file ID format');
      return;
    }

    const workspaceId = req.workspaceId;

    // Get file record
    const fileResult = await pool.query<FileRecordRow>(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = requireFirstRow(fileResult.rows, 'File not found');

    if (file.document_id) {
      const decision = await authorizeRequest(req, {
        resource: 'file',
        action: 'delete',
        documentId: file.document_id,
      });
      if (!decision.allowed) {
        res.status(403).json({ error: 'Only an authorized document user can delete this file' });
        return;
      }
    } else {
      const actor = getActor(req);
      const { isAdmin } = await getDocumentAccessContext(actor);
      if (file.uploaded_by !== req.userId && !isAdmin && !req.isSuperAdmin) {
        res.status(403).json({ error: 'Only the uploader or an admin can delete this file' });
        return;
      }
    }

    // Delete from storage (local or S3)
    if (useS3Uploads()) {
      const client = getS3Client();
      const command = new DeleteObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: file.s3_key,
      });
      await client.send(command);
    } else {
      try {
        const filePath = join(UPLOADS_DIR, file.s3_key);
        await unlink(filePath);
      } catch {
        // File might not exist, ignore error
      }
    }

    // Delete database record
    await pool.query('DELETE FROM files WHERE id = $1', [fileId]);

    res.json({ success: true });
  } catch (error) {
    sendInternalError(res, error, 'Error deleting file:', { error: 'Failed to delete file' });
  }
});

/**
 * Generate a presigned URL for S3 PUT upload
 * @param s3Key - The S3 object key (path within bucket)
 * @param contentType - The MIME type of the file being uploaded
 * @param sizeBytes - The expected file size in bytes
 * @returns Presigned URL valid for 15 minutes
 */
async function generateS3PresignedUrl(s3Key: string, contentType: string, sizeBytes: number): Promise<string> {
  if (!S3_BUCKET_NAME) {
    throw new Error('S3_UPLOADS_BUCKET environment variable is not configured');
  }

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: s3Key,
    ContentType: contentType,
    ContentLength: sizeBytes,
  });

  const presignedUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
  });

  return presignedUrl;
}
