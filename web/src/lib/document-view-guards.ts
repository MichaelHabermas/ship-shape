import type { BelongsTo, BelongsToType, EditorDocumentType } from '@ship/shared';

export type CurrentDocumentType =
  | 'wiki'
  | 'issue'
  | 'project'
  | 'sprint'
  | 'program'
  | 'person'
  | 'weekly_plan'
  | 'weekly_retro'
  | 'standup'
  | null;

const belongsToTypes = new Set<BelongsToType>(['program', 'project', 'sprint', 'parent']);
const editorDocumentTypes = new Set<EditorDocumentType>([
  'wiki',
  'issue',
  'project',
  'sprint',
  'program',
  'person',
  'weekly_plan',
  'weekly_retro',
  'standup',
  'weekly_review',
]);
const currentDocumentTypes = new Set<NonNullable<CurrentDocumentType>>([
  'wiki',
  'issue',
  'project',
  'sprint',
  'program',
  'person',
  'weekly_plan',
  'weekly_retro',
  'standup',
]);

export function isEditorDocumentType(value: unknown): value is EditorDocumentType {
  return typeof value === 'string' && editorDocumentTypes.has(value as EditorDocumentType);
}

export function isCurrentDocumentType(value: unknown): value is NonNullable<CurrentDocumentType> {
  return typeof value === 'string' && currentDocumentTypes.has(value as NonNullable<CurrentDocumentType>);
}

export function isBelongsToType(value: unknown): value is BelongsToType {
  return typeof value === 'string' && belongsToTypes.has(value as BelongsToType);
}

export function isBelongsTo(value: unknown): value is BelongsTo {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string' && isBelongsToType(candidate.type);
}

export function getBelongsTo(value: unknown): BelongsTo[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isBelongsTo);
}

export function getBelongsToId(value: unknown, type: BelongsToType): string | null {
  return getBelongsTo(value).find(association => association.type === type)?.id ?? null;
}

export function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function getNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
