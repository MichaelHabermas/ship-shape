import { Router, Request, Response } from 'express';
import express from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../middleware/auth.js';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

function isValidUUID(id: string | string[] | undefined): boolean {
  if (!id || Array.isArray(id)) return false;
  return UUID_REGEX.test(id);
}

type RouterType = ReturnType<typeof Router>;
export const filesRouter: RouterType = Router();

// Validation schemas
const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE, {
    message: `File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB)`,
  }),
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
  // Check extension against blocklist (allow everything except dangerous types)
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return !BLOCKED_EXTENSIONS.has(ext);
}

// POST /api/files/upload - Get presigned URL for upload
// For local dev: returns a mock upload URL
// For production: would return S3 presigned URL
filesRouter.post('/upload', authMiddleware, async (req: Request, res: Response) => {
  try {
    const validation = uploadRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.errors });
      return;
    }

    const { filename, mimeType, sizeBytes } = validation.data;
    const workspaceId = req.workspaceId;
    const userId = req.userId;

    // Validate file type
    if (!isAllowedFile(filename, mimeType)) {
      res.status(400).json({ error: 'File type not allowed' });
      return;
    }

    // Generate unique S3 key / local path
    const fileId = randomUUID();
    const ext = filename.slice(filename.lastIndexOf('.'));
    const s3Key = `${workspaceId}/${fileId}${ext}`;

    // Create file record with 'pending' status
    const result = await pool.query(
      `INSERT INTO files (id, workspace_id, uploaded_by, filename, mime_type, size_bytes, s3_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id`,
      [fileId, workspaceId, userId, filename, mimeType, sizeBytes, s3Key]
    );

    // Use S3 when configured; otherwise use local storage for lightweight deployments.
    const useS3 = process.env.NODE_ENV === 'production' && !!S3_BUCKET_NAME;
    const uploadUrl = useS3
      ? await generateS3PresignedUrl(s3Key, mimeType, sizeBytes)
      : `/api/files/${fileId}/local-upload`;

    res.json({
      fileId: result.rows[0].id,
      uploadUrl,
      s3Key,
    });
  } catch (error) {
    console.error('Error creating upload:', error);
    res.status(500).json({ error: 'Failed to create upload' });
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
      res.status(400).json({ error: 'Invalid file ID format' });
      return;
    }

    const workspaceId = req.workspaceId;

    // Verify file record exists and belongs to user's workspace
    const fileResult = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2 AND status = 'pending'`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found or already uploaded' });
      return;
    }

    const file = fileResult.rows[0];

    // Get raw body as buffer - handle various input types
    let buffer: Buffer;
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (req.body instanceof Uint8Array) {
      buffer = Buffer.from(req.body);
    } else if (typeof req.body === 'object' && req.body !== null) {
      // Handle ArrayBuffer or typed array wrapped in object
      const data = req.body.data || req.body;
      if (Array.isArray(data)) {
        buffer = Buffer.from(data);
      } else {
        buffer = Buffer.from(JSON.stringify(req.body));
      }
    } else if (typeof req.body === 'string') {
      buffer = Buffer.from(req.body, 'base64');
    } else {
      res.status(400).json({ error: 'Invalid file data format' });
      return;
    }

    if (buffer.length === 0) {
      res.status(400).json({ error: 'No file data received' });
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
    console.error('Error uploading file locally:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// POST /api/files/:id/confirm - Confirm upload complete (for S3 direct uploads)
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.post('/:id/confirm', authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      res.status(400).json({ error: 'Invalid file ID format' });
      return;
    }

    const workspaceId = req.workspaceId;

    // Verify file record exists and belongs to user's workspace
    const fileResult = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = fileResult.rows[0];

    // For production: verify file exists in S3
    // For local dev: file was already saved in local-upload

    // Generate CDN URL
    const useS3 = process.env.NODE_ENV === 'production' && !!S3_BUCKET_NAME;
    let cdnUrl: string;
    if (useS3) {
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
    console.error('Error confirming upload:', error);
    res.status(500).json({ error: 'Failed to confirm upload' });
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
      res.status(400).json({ error: 'Invalid file ID format' });
      return;
    }

    const workspaceId = req.workspaceId;

    // Get file record - SECURITY: Verify file belongs to user's workspace
    const fileResult = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2 AND status = 'uploaded'`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = fileResult.rows[0];
    const filePath = join(UPLOADS_DIR, file.s3_key);

    // Set content type and serve file
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// GET /api/files/:id - Get file metadata
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      res.status(400).json({ error: 'Invalid file ID format' });
      return;
    }

    const workspaceId = req.workspaceId;

    const result = await pool.query(
      `SELECT id, filename, mime_type, size_bytes, cdn_url, status, created_at
       FROM files WHERE id = $1 AND workspace_id = $2`,
      [fileId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting file:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// DELETE /api/files/:id - Delete a file
// SECURITY: UUID validation prevents path traversal attacks
filesRouter.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.id;

    // SECURITY: Validate UUID format to prevent path traversal
    if (!fileId || !isValidUUID(fileId)) {
      res.status(400).json({ error: 'Invalid file ID format' });
      return;
    }

    const workspaceId = req.workspaceId;

    // Get file record
    const fileResult = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND workspace_id = $2`,
      [fileId, workspaceId]
    );

    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = fileResult.rows[0];

    // Delete from storage (local or S3)
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && S3_BUCKET_NAME) {
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
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
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
