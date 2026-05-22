import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';

import { apiGetJson, apiPostJson } from '@/lib/api';
import type { Document, DocumentSearchResponse } from '@/api/schemas';
import type { Program } from '@/hooks/useProgramsQuery';

interface SearchableDocument {
  id: string;
  title: string;
  document_type: string;
  ticket_number?: number | null;
}

type ConvertibleDocumentType = 'wiki' | 'issue' | 'project' | 'sprint';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current document context for type conversion commands */
  currentDocument?: {
    id: string;
    type: string;
  };
  /** Handler for document type conversion */
  onConvertDocument?: (newType: ConvertibleDocumentType) => void;
}

export function CommandPalette({ open, onOpenChange, currentDocument, onConvertDocument }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [documents, setDocuments] = useState<SearchableDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap implementation for WCAG 2.4.3 Focus Order
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    // Get focusable elements within dialog
    const getFocusableElements = () => {
      // Query for all focusable elements, including cmdk items
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href], [role="option"]'
      )).filter(el => {
        // Filter out hidden elements
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      return elements;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      // ALWAYS prevent default Tab behavior and manually handle focus
      e.preventDefault();

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const currentIndex = focusableElements.findIndex(el => el === document.activeElement);

      let nextIndex: number;
      if (e.shiftKey) {
        // Shift+Tab - go backwards
        nextIndex = currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1;
      } else {
        // Tab - go forwards
        nextIndex = currentIndex >= focusableElements.length - 1 ? 0 : currentIndex + 1;
      }

      focusableElements[nextIndex].focus();
    };

    // Fallback: if focus escapes to anywhere outside dialog, bring it back immediately
    const handleFocusIn = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) {
        const focusableElements = getFocusableElements();
        if (focusableElements.length > 0) {
          focusableElements[0].focus();
        }
      }
    };

    // Use capture phase to intercept Tab before it can do anything
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [open]);

  const runCommand = useCallback((command: () => void) => {
    onOpenChange(false);
    command();
  }, [onOpenChange]);

  const createIssue = async () => {
    try {
      const programs = await apiGetJson<Program[]>('/api/programs', 'Failed to fetch programs');
      if (programs.length === 0) return;

      const issue = await apiPostJson<Document>('/api/issues', {
        title: 'Untitled',
        belongs_to: [{ id: programs[0].id, type: 'program' }],
      }, 'Failed to create issue');
      navigate(`/documents/${issue.id}`);
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
  };

  const createDocument = async () => {
    try {
      const doc = await apiPostJson<Document>(
        '/api/documents',
        { title: 'Untitled', document_type: 'wiki' },
        'Failed to create document'
      );
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  };

  // Search documents when palette opens or query changes
  useEffect(() => {
    if (!open) {
      setSearch('');
      setDocuments([]);
      return;
    }

    let cancelled = false;

    const fetchDocuments = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: search,
          limit: '20',
        });
        const data = await apiGetJson<DocumentSearchResponse>(
          `/api/search/documents?${params.toString()}`,
          'Failed to search documents'
        );
        if (!cancelled) {
          setDocuments(data.documents);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to search documents:', err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const timeout = window.setTimeout(fetchDocuments, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, search]);

  // Group documents by type for display
  const groupedDocuments = useMemo(() => {
    const groups: Record<string, SearchableDocument[]> = {
      issue: [],
      wiki: [],
      program: [],
      project: [],
      sprint: [],
      person: [],
    };

    for (const doc of documents) {
      if (groups[doc.document_type]) {
        groups[doc.document_type].push(doc);
      }
    }

    return groups;
  }, [documents]);

  // Get route for document type
  const getDocumentRoute = useCallback((doc: SearchableDocument) => {
    switch (doc.document_type) {
      case 'wiki':
        return `/docs/${doc.id}`;
      case 'issue':
        return `/issues/${doc.id}`;
      case 'program':
        return `/programs/${doc.id}`;
      case 'project':
        return `/projects/${doc.id}`;
      case 'sprint':
        return `/sprints/${doc.id}`;
      case 'person':
        return `/team/${doc.id}`;
      default:
        return `/docs/${doc.id}`;
    }
  }, []);

  // Format document title for display (includes ticket number for issues)
  const formatDocumentTitle = useCallback((doc: SearchableDocument) => {
    if (doc.document_type === 'issue' && doc.ticket_number) {
      return `#${doc.ticket_number}: ${doc.title}`;
    }
    return doc.title;
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />

      {/* Command dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="absolute left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2"
      >
        {/* Close button for accessibility */}
        <Tooltip content="Close">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close dialog"
            className="absolute right-2 top-2 z-10 rounded p-1 text-muted hover:bg-border hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </Tooltip>
        <Command
          className="rounded-lg border border-border bg-background shadow-2xl"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onOpenChange(false);
          }}
        >
          <div className="border-b border-border p-3">
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Type a command or search..."
              className="w-full bg-transparent text-base text-foreground placeholder:text-muted focus:outline-none"
              autoFocus
            />
          </div>

          <Command.List className="max-h-[400px] overflow-auto p-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-muted">
              {loading ? 'Loading...' : 'No results found.'}
            </Command.Empty>

            {/* Issues */}
            {groupedDocuments.issue.length > 0 && (
              <Command.Group heading="Issues" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {groupedDocuments.issue.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    onSelect={() => runCommand(() => navigate(getDocumentRoute(doc)))}
                    value={formatDocumentTitle(doc)}
                  >
                    <IssueIcon />
                    <span className="truncate">{formatDocumentTitle(doc)}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* Documents (Wiki) */}
            {groupedDocuments.wiki.length > 0 && (
              <Command.Group heading="Documents" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {groupedDocuments.wiki.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    onSelect={() => runCommand(() => navigate(getDocumentRoute(doc)))}
                    value={doc.title}
                  >
                    <DocIcon />
                    <span className="truncate">{doc.title}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* Programs */}
            {groupedDocuments.program.length > 0 && (
              <Command.Group heading="Programs" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {groupedDocuments.program.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    onSelect={() => runCommand(() => navigate(getDocumentRoute(doc)))}
                    value={doc.title}
                  >
                    <ProgramIcon />
                    <span className="truncate">{doc.title}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* Weeks */}
            {groupedDocuments.sprint.length > 0 && (
              <Command.Group heading="Weeks" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {groupedDocuments.sprint.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    onSelect={() => runCommand(() => navigate(getDocumentRoute(doc)))}
                    value={doc.title}
                  >
                    <SprintIcon />
                    <span className="truncate">{doc.title}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* People */}
            {groupedDocuments.person.length > 0 && (
              <Command.Group heading="People" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {groupedDocuments.person.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    onSelect={() => runCommand(() => navigate(getDocumentRoute(doc)))}
                    value={doc.title}
                  >
                    <PersonIcon />
                    <span className="truncate">{doc.title}</span>
                  </CommandItem>
                ))}
              </Command.Group>
            )}

            {/* Convert Actions (only show when viewing a convertible document) */}
            {currentDocument && onConvertDocument && ['wiki', 'issue', 'project', 'sprint'].includes(currentDocument.type) && (
              <Command.Group heading="Convert" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
                {currentDocument.type !== 'wiki' && (
                  <CommandItem onSelect={() => runCommand(() => onConvertDocument('wiki'))}>
                    <ConvertIcon />
                    <span>Convert to Wiki</span>
                  </CommandItem>
                )}
                {currentDocument.type !== 'issue' && (
                  <CommandItem onSelect={() => runCommand(() => onConvertDocument('issue'))}>
                    <ConvertIcon />
                    <span>Convert to Issue</span>
                  </CommandItem>
                )}
                {currentDocument.type !== 'project' && (
                  <CommandItem onSelect={() => runCommand(() => onConvertDocument('project'))}>
                    <ConvertIcon />
                    <span>Convert to Project</span>
                  </CommandItem>
                )}
                {currentDocument.type !== 'sprint' && (
                  <CommandItem onSelect={() => runCommand(() => onConvertDocument('sprint'))}>
                    <ConvertIcon />
                    <span>Convert to Week</span>
                  </CommandItem>
                )}
              </Command.Group>
            )}

            {/* Create Actions */}
            <Command.Group heading="Create" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
              <CommandItem onSelect={() => runCommand(createIssue)}>
                <PlusIcon />
                <span>Create Issue</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(createDocument)}>
                <DocIcon />
                <span>Create Document</span>
              </CommandItem>
            </Command.Group>

            {/* Navigation */}
            <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
              <CommandItem onSelect={() => runCommand(() => navigate('/docs'))}>
                <DocIcon />
                <span>Go to Documents</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/issues'))}>
                <IssueIcon />
                <span>Go to Issues</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/programs'))}>
                <ProgramIcon />
                <span>Go to Programs</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/team'))}>
                <TeamIcon />
                <span>Go to Team</span>
              </CommandItem>
            </Command.Group>
          </Command.List>

          <div className="border-t border-border px-3 py-2 text-xs text-muted">
            <kbd className="rounded bg-border px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
            <span className="ml-1">to navigate</span>
            <kbd className="ml-3 rounded bg-border px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
            <span className="ml-1">to select</span>
            <kbd className="ml-3 rounded bg-border px-1.5 py-0.5 font-mono text-[10px]">esc</kbd>
            <span className="ml-1">to close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function CommandItem({ children, onSelect, value }: { children: React.ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item
      onSelect={onSelect}
      value={value}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm',
        'data-[selected=true]:bg-accent data-[selected=true]:text-white'
      )}
    >
      {children}
    </Command.Item>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function ProgramIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function SprintIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function ConvertIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  );
}
