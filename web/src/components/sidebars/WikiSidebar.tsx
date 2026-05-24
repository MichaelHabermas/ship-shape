import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { VisibilityDropdown } from '@/components/VisibilityDropdown';
import { BacklinksPanel } from '@/components/editor/BacklinksPanel';
import { ResilientSection } from '@/components/ui/ResilientSection';

interface WikiDocument {
  id: string;
  visibility?: 'private' | 'workspace';
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
}

interface WikiSidebarProps {
  document: WikiDocument;
  teamMembers: Person[];
  currentUserId?: string;
  onUpdate: (updates: Partial<WikiDocument>) => Promise<void>;
}

export function WikiSidebar({ document, teamMembers, currentUserId, onUpdate }: WikiSidebarProps) {
  // Get effective maintainer (explicit or fallback to creator)
  const maintainerId = (document.properties as { maintainer_id?: string | null })?.maintainer_id || document.created_by;

  // Handle maintainer change
  const handleMaintainerChange = (userId: string | null) => {
    onUpdate({
      properties: { ...document.properties, maintainer_id: userId },
    });
  };

  // Handle visibility change
  const handleVisibilityChange = (visibility: 'private' | 'workspace') => {
    onUpdate({ visibility });
  };

  // Check if user can change visibility (creator or admin)
  const canChangeVisibility = document.created_by === currentUserId;

  // Format date for display
  const formatDate = (date: Date | string | undefined) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (date: Date | string | undefined) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4 p-4">
      <PropertyRow label="Maintainer">
        <PersonCombobox
          people={teamMembers}
          value={maintainerId || null}
          onChange={handleMaintainerChange}
          placeholder="Select maintainer..."
        />
      </PropertyRow>

      <PropertyRow label="Visibility">
        <VisibilityDropdown
          value={document.visibility || 'workspace'}
          onChange={handleVisibilityChange}
          disabled={!canChangeVisibility}
        />
      </PropertyRow>

      <PropertyRow label="Created">
        <p className="text-sm text-foreground">{formatDate(document.created_at)}</p>
      </PropertyRow>

      <PropertyRow label="Updated">
        <p className="text-sm text-foreground">{formatDateTime(document.updated_at)}</p>
      </PropertyRow>

      <ResilientSection
        name="backlinks-panel"
        fallbackTitle="Backlinks unavailable"
        fallbackDescription="The document remains editable while backlinks recover."
        resetKeys={[document.id]}
      >
        <BacklinksPanel documentId={document.id} />
      </ResilientSection>
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
