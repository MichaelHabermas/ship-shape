/**
 * File upload service for images and attachments.
 * Handles upload flow: get presigned URL -> upload to storage -> confirm -> return CDN URL
 */

// In development, Vite proxy handles /api routes (see vite.config.ts)
// In production, use VITE_API_URL or relative URLs
const API_BASE = import.meta.env.VITE_API_URL ?? '';

// File size limits
export const MAX_FILE_SIZE = 1073741824; // 1GB in bytes
export const MAX_FILE_SIZE_DISPLAY = '1GB';

interface UploadResult {
  fileId: string;
  cdnUrl: string;
}

interface UploadProgress {
  fileId: string;
  progress: number; // 0-100
  status: 'pending' | 'uploading' | 'confirming' | 'complete' | 'error';
  error?: string;
}

type ProgressCallback = (progress: UploadProgress) => void;

interface CsrfTokenResponse {
  token: string;
}

interface ApiErrorResponse {
  error?: string;
}

interface UploadRequestResponse {
  fileId: string;
  uploadUrl: string;
}

interface FileMetadataResponse {
  cdn_url: string;
}

interface ConfirmUploadResponse {
  cdnUrl: string;
}

async function readJson<T>(res: Response): Promise<T> {
  return await res.json() as T;
}

/**
 * Get CSRF token for API requests
 */
async function getCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/csrf-token`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to get CSRF token');
  const { token } = await readJson<CsrfTokenResponse>(res);
  return token;
}

/**
 * Upload a file to the server
 * @param file - The file to upload
 * @param onProgress - Optional callback for progress updates
 * @param signal - Optional AbortSignal for cancelling the upload
 * @returns The CDN URL of the uploaded file
 */
export async function uploadFile(
  file: File,
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<UploadResult> {
  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException('Upload cancelled', 'AbortError');
  }

  const csrfToken = await getCsrfToken();

  const progress: UploadProgress = {
    fileId: '',
    progress: 0,
    status: 'pending',
  };

  const updateProgress = (updates: Partial<UploadProgress>) => {
    Object.assign(progress, updates);
    onProgress?.({ ...progress });
  };

  try {
    // Step 1: Request upload URL
    updateProgress({ status: 'pending', progress: 10 });

    // Use effective MIME type (fallback to extension-based detection if browser returns empty)
    const effectiveMimeType = file.type || getMimeTypeFromExtension(file.name) || 'application/octet-stream';

    const uploadReqRes = await fetch(`${API_BASE}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({
        filename: file.name,
        mimeType: effectiveMimeType,
        sizeBytes: file.size,
      }),
      signal,
    });

    if (!uploadReqRes.ok) {
      const error = await readJson<ApiErrorResponse>(uploadReqRes);
      throw new Error(error.error || 'Failed to create upload request');
    }

    const { fileId, uploadUrl } = await readJson<UploadRequestResponse>(uploadReqRes);
    updateProgress({ fileId, progress: 20 });

    // Step 2: Upload file data
    updateProgress({ status: 'uploading', progress: 30 });

    // Check if this is a local upload URL or S3 presigned URL
    const isLocalUpload = uploadUrl.startsWith('/api/files/');
    const fullUploadUrl = isLocalUpload ? `${API_BASE}${uploadUrl}` : uploadUrl;

    const fileBuffer = await file.arrayBuffer();

    if (isLocalUpload) {
      // Local development: upload to our API
      const uploadRes = await fetch(fullUploadUrl, {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': effectiveMimeType,
        },
        credentials: 'include',
        body: fileBuffer,
        signal,
      });

      if (!uploadRes.ok) {
        const error = await readJson<ApiErrorResponse>(uploadRes);
        throw new Error(error.error || 'Failed to upload file');
      }

      updateProgress({ progress: 90 });

      // For local uploads, the local-upload endpoint already sets status to 'uploaded'
      // Just get the file metadata to return the CDN URL
      const fileRes = await fetch(`${API_BASE}/api/files/${fileId}`, {
        credentials: 'include',
        signal,
      });

      if (!fileRes.ok) {
        throw new Error('Failed to get file metadata');
      }

      const fileData = await readJson<FileMetadataResponse>(fileRes);
      updateProgress({ status: 'complete', progress: 100 });

      return {
        fileId,
        cdnUrl: fileData.cdn_url,
      };
    } else {
      // Production: upload directly to S3
      const uploadRes = await fetch(fullUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': effectiveMimeType,
        },
        body: fileBuffer,
        signal,
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload to S3');
      }

      updateProgress({ status: 'confirming', progress: 80 });

      // Step 3: Confirm upload
      const confirmRes = await fetch(`${API_BASE}/api/files/${fileId}/confirm`, {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfToken,
        },
        credentials: 'include',
        signal,
      });

      if (!confirmRes.ok) {
        const error = await readJson<ApiErrorResponse>(confirmRes);
        throw new Error(error.error || 'Failed to confirm upload');
      }

      const { cdnUrl } = await readJson<ConfirmUploadResponse>(confirmRes);
      updateProgress({ status: 'complete', progress: 100 });

      return { fileId, cdnUrl };
    }
  } catch (error) {
    updateProgress({
      status: 'error',
      error: error instanceof Error ? error.message : 'Upload failed',
    });
    throw error;
  }
}

/**
 * Upload a file from a data URL (e.g., from clipboard paste)
 */
export async function uploadDataUrl(
  dataUrl: string,
  filename: string,
  onProgress?: ProgressCallback
): Promise<UploadResult> {
  // Convert data URL to File
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type });

  return uploadFile(file, onProgress);
}

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

/**
 * Map file extensions to MIME types for fallback detection
 * Browsers sometimes return empty MIME type for Office files (especially on macOS)
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  // Archives
  '.zip': 'application/zip',
};

/**
 * Get MIME type from filename extension as fallback
 */
export function getMimeTypeFromExtension(filename: string): string | null {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return EXTENSION_TO_MIME[ext] || null;
}

/**
 * Check if a file type is allowed for upload
 * Uses blocklist approach: allow ANY file EXCEPT dangerous executables.
 * Checks by extension (not MIME type) since MIME types can be spoofed.
 */
export function isAllowedFileType(mimeType: string, filename?: string): boolean {
  // If no filename provided, allow (can't check extension)
  if (!filename) {
    return true;
  }

  // Extract extension from filename
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));

  // Block dangerous file types
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return false;
  }

  // Allow everything else
  return true;
}

/**
 * Check if a file is an image
 */
export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
