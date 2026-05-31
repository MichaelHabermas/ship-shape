/** Lists documents converted between issue and project types. */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/cn';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/date-utils';

interface ConvertedDocument {
  original_id: string;
  original_title: string;
  original_type: string;
  original_ticket_number: number | null;
  converted_id: string;
  converted_title: string;
  converted_type: string;
  converted_ticket_number: number | null;
  converted_at: string | null;
  converted_by: string | null;
  converted_by_name: string | null;
}

type FilterType = 'all' | 'issue-to-project' | 'project-to-issue';

export function ConvertedDocumentsPage() {
  const { currentWorkspace } = useWorkspace();
  const [conversions, setConversions] = useState<ConvertedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    if (!currentWorkspace) return;
    loadConversions();
  }, [currentWorkspace, filter]);

  async function loadConversions() {
    setLoading(true);
    try {
      let url = '/api/documents/converted/list';
      const params = new URLSearchParams();

      if (filter === 'issue-to-project') {
        params.set('original_type', 'issue');
        params.set('converted_type', 'project');
      } else if (filter === 'project-to-issue') {
        params.set('original_type', 'project');
        params.set('converted_type', 'issue');
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const res = await apiGet(url);
      if (res.ok) {
        const data = (await res.json()) as ConvertedDocument[];
        setConversions(data);
      }
    } catch (err) {
      console.error('Failed to load conversions:', err);
    }
    setLoading(false);
  }

  function getTypeIcon(type: string) {
    if (type === 'issue') {
      return <DocumentIcon className="h-4 w-4" />;
    }
    return <FolderIcon className="h-4 w-4" />;
  }

  function getTypeRoute(type: string, id: string) {
    if (type === 'issue') {
      return `/issues/${id}`;
    }
    return `/projects/${id}`;
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-gray-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Converted Documents</h1>
          <p className="mt-1 text-sm text-gray-400">
            Documents that have been converted between issue and project types
          </p>
        </div>

        {/* Filter tabs */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              filter === 'all'
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
            )}
          >
            All
          </button>
          <button
            onClick={() => setFilter('issue-to-project')}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              filter === 'issue-to-project'
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
            )}
          >
            Issues → Projects
          </button>
          <button
            onClick={() => setFilter('project-to-issue')}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              filter === 'project-to-issue'
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
            )}
          >
            Projects → Issues
          </button>
        </div>

        {/* Conversions list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-white" />
          </div>
        ) : conversions.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-[#1a1a1a] p-8 text-center">
            <p className="text-gray-400">No converted documents found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversions.map((conversion) => (
              <div
                key={conversion.original_id}
                className="rounded-lg border border-gray-800 bg-[#1a1a1a] p-4"
              >
                <div className="flex items-center gap-3">
                  {/* Original document */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-gray-400">
                      {getTypeIcon(conversion.original_type)}
                      <span className="text-xs uppercase">{conversion.original_type}</span>
                      {conversion.original_ticket_number && (
                        <span className="text-xs text-gray-500">
                          #{conversion.original_ticket_number}
                        </span>
                      )}
                    </div>
                    <Link
                      to={getTypeRoute(conversion.original_type, conversion.original_id)}
                      className="mt-1 block text-sm text-gray-300 hover:text-white hover:underline"
                    >
                      {conversion.original_title}
                    </Link>
                    <span className="text-xs text-gray-500">(archived)</span>
                  </div>

                  {/* Arrow */}
                  <div className="flex-shrink-0">
                    <ArrowRightIcon className="h-5 w-5 text-gray-600" />
                  </div>

                  {/* Converted document */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-gray-400">
                      {getTypeIcon(conversion.converted_type)}
                      <span className="text-xs uppercase">{conversion.converted_type}</span>
                      {conversion.converted_ticket_number && (
                        <span className="text-xs text-gray-500">
                          #{conversion.converted_ticket_number}
                        </span>
                      )}
                    </div>
                    <Link
                      to={getTypeRoute(conversion.converted_type, conversion.converted_id)}
                      className="mt-1 block text-sm font-medium text-white hover:underline"
                    >
                      {conversion.converted_title}
                    </Link>
                    <span className="text-xs text-green-500">(active)</span>
                  </div>
                </div>

                {/* Metadata */}
                <div className="mt-3 flex items-center gap-4 border-t border-gray-800 pt-3 text-xs text-gray-500">
                  {conversion.converted_at && (
                    <div className="flex items-center gap-1">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      <span>{formatDate(conversion.converted_at)}</span>
                    </div>
                  )}
                  {conversion.converted_by_name && (
                    <div className="flex items-center gap-1">
                      <UserIcon className="h-3.5 w-3.5" />
                      <span>{conversion.converted_by_name}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Icon components
function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M14 5l7 7m0 0l-7 7m7-7H3"
      />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  );
}
