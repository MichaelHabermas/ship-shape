/**
 * Collaboration WebSocket protocol constants and room naming.
 * Shared between API collaboration server and web Editor.
 */

export const COLLAB_MESSAGE_SYNC = 0;
export const COLLAB_MESSAGE_AWARENESS = 1;
export const COLLAB_MESSAGE_CLEAR_CACHE = 3;

export const COLLAB_CLOSE_CODE_CONVERSION = 4100;
export const COLLAB_CLOSE_CODE_CONTENT_UPDATE = 4101;
export const COLLAB_CLOSE_CODE_ACCESS_REVOKED = 4403;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCollaborationRoomName(
  roomName: string
): { prefix: string; documentId: string } | null {
  const parts = roomName.split(':');
  if (parts.length < 2) return null;
  const documentId = parts.at(-1);
  if (!documentId) return null;
  if (!UUID_RE.test(documentId)) return null;
  const prefix = parts.slice(0, -1).join(':');
  return { prefix, documentId };
}

export function buildCollaborationRoomName(documentType: string, documentId: string): string {
  return `${documentType}:${documentId}`;
}

export function parseDocumentIdFromRoomName(roomName: string): string {
  const parsed = parseCollaborationRoomName(roomName);
  if (parsed) return parsed.documentId;
  const parts = roomName.split(':');
  return parts.at(-1) ?? roomName;
}

/** Legacy Editor default prefix "doc" maps to wiki documents only. */
export function isLegacyDocPrefix(prefix: string, documentType: string): boolean {
  return prefix === 'doc' && documentType === 'wiki';
}

export function roomPrefixMatchesDocumentType(prefix: string, documentType: string): boolean {
  return prefix === documentType || isLegacyDocPrefix(prefix, documentType);
}
