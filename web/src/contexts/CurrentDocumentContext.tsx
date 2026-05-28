import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { CurrentDocumentType } from '@ship/shared';

interface CurrentDocumentContextValue {
  currentDocumentType: CurrentDocumentType;
  currentDocumentId: string | null;
  currentDocumentProjectId: string | null;
  setCurrentDocument: (id: string | null, type: CurrentDocumentType, projectId?: string | null) => void;
  clearCurrentDocument: () => void;
}

const CurrentDocumentContext = createContext<CurrentDocumentContextValue | undefined>(undefined);

export function CurrentDocumentProvider({ children }: { children: ReactNode }) {
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [currentDocumentType, setCurrentDocumentType] = useState<CurrentDocumentType>(null);
  const [currentDocumentProjectId, setCurrentDocumentProjectId] = useState<string | null>(null);

  const setCurrentDocument = useCallback((id: string | null, type: CurrentDocumentType, projectId?: string | null) => {
    setCurrentDocumentId(id);
    setCurrentDocumentType(type);
    setCurrentDocumentProjectId(projectId ?? null);
  }, []);

  const clearCurrentDocument = useCallback(() => {
    setCurrentDocumentId(null);
    setCurrentDocumentType(null);
    setCurrentDocumentProjectId(null);
  }, []);

  return (
    <CurrentDocumentContext.Provider
      value={{
        currentDocumentType,
        currentDocumentId,
        currentDocumentProjectId,
        setCurrentDocument,
        clearCurrentDocument,
      }}
    >
      {children}
    </CurrentDocumentContext.Provider>
  );
}

export function useCurrentDocument() {
  const context = useContext(CurrentDocumentContext);
  if (!context) {
    throw new Error('useCurrentDocument must be used within a CurrentDocumentProvider');
  }
  return context;
}

/**
 * Hook to get the current document type without throwing.
 * Returns null if not in a CurrentDocumentProvider context.
 * Useful for optional context usage.
 */
export function useCurrentDocumentType(): CurrentDocumentType {
  const context = useContext(CurrentDocumentContext);
  return context?.currentDocumentType ?? null;
}
