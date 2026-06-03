import type { ConversionDocumentType } from '@ship/shared';

export interface EditorProps {
  documentId: string;
  userName: string;
  userColor?: string;
  onTitleChange?: (title: string) => void;
  initialTitle?: string;
  /** Whether the title is read-only (e.g., for weekly plans/retros with computed titles) */
  titleReadOnly?: boolean;
  onBack?: () => void;
  /** Label for back button (e.g., parent document title) */
  backLabel?: string;
  /** Room prefix for collaboration (e.g., 'doc' or 'issue') */
  roomPrefix?: string;
  /** Placeholder text for the editor */
  placeholder?: string;
  /** Badge to show in header (e.g., issue number) */
  headerBadge?: React.ReactNode;
  /** Breadcrumbs to show above the title */
  breadcrumbs?: React.ReactNode;
  /** Sidebar content (e.g., issue properties) */
  sidebar?: React.ReactNode;
  /** Callback to create a sub-document (for slash commands) */
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  /** Callback to navigate to a document (for slash commands) */
  onNavigateToDocument?: (id: string) => void;
  /** Callback to delete the document */
  onDelete?: () => void;
  /** Secondary header content (e.g., action buttons) - displayed below breadcrumb header */
  secondaryHeader?: React.ReactNode;
  /** Document type for filtering document-specific slash commands (e.g., 'program', 'project') */
  documentType?: string;
  /** Callback when the document is converted to a different type by another user */
  onDocumentConverted?: (newDocId: string, newDocType: ConversionDocumentType) => void;
  /** Callback when plan block content changes (for sprint documents) */
  onPlanChange?: (plan: string) => void;
  /** Banner content rendered between the title and editor content (e.g., AI quality check) */
  contentBanner?: React.ReactNode;
  /** Callback when editor content changes (debounced). Receives TipTap JSON content. */
  onContentChange?: (content: Record<string, unknown>) => void;
  /** AI scoring analysis data to render as inline decorations */
  aiScoringAnalysis?: { planAnalysis?: unknown; retroAnalysis?: unknown } | null;
  /** Suffix displayed after the title in the header (e.g., author name) */
  titleSuffix?: string;
}

// Generate a consistent color from a string
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
}
