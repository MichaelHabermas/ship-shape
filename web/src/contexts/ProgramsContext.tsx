/**
 * @deprecated Use useUnifiedDocuments from '@/hooks/useUnifiedDocuments' instead.
 *
 * This context is maintained for backward compatibility but should not be used
 * for new code. The unified document model treats all document types consistently
 * through a single hook.
 *
 * Migration:
 *   Before: const { programs } = usePrograms()
 *   After:  const { byType: { program: programs } } = useUnifiedDocuments({ type: 'program' })
 */
import { createContext, useContext, ReactNode } from 'react';
import { usePrograms as useProgramsQuery, Program } from '@/hooks/useProgramsQuery';

export type { Program };

interface ProgramsContextValue {
  programs: Program[];
  loading: boolean;
  createProgram: () => Promise<Program | null>;
  updateProgram: (id: string, updates: Partial<Program> & { owner_id?: string | null }) => Promise<Program | null>;
  deleteProgram: (id: string) => Promise<boolean>;
  refreshPrograms: () => Promise<void>;
}

const ProgramsContext = createContext<ProgramsContextValue | null>(null);

export function ProgramsProvider({ children }: { children: ReactNode }) {
  const programsData = useProgramsQuery();

  return (
    <ProgramsContext.Provider value={programsData}>
      {children}
    </ProgramsContext.Provider>
  );
}

export function usePrograms() {
  const context = useContext(ProgramsContext);
  if (!context) {
    throw new Error('usePrograms must be used within ProgramsProvider');
  }
  return context;
}
