// FleetGraph page context shares bounded visible-page hints with the chat probe.
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { FleetGraphPageContext } from '@ship/shared';

type FleetGraphPageContextValue = {
  pageContext: FleetGraphPageContext | null;
  registerPageContext: (id: symbol, context: FleetGraphPageContext | null) => void;
  unregisterPageContext: (id: symbol) => void;
};

const FleetGraphPageContextState = createContext<FleetGraphPageContextValue | null>(null);

export function FleetGraphPageContextProvider({ children }: { children: React.ReactNode }) {
  const [pageContext, setPageContext] = useState<FleetGraphPageContext | null>(null);
  const registrations = useRef<Array<{ id: symbol; context: FleetGraphPageContext | null }>>([]);

  const updateCurrentContext = useCallback(() => {
    const current = [...registrations.current].reverse().find((entry) => entry.context)?.context ?? null;
    setPageContext(current);
  }, []);

  const registerPageContext = useCallback((id: symbol, context: FleetGraphPageContext | null) => {
    registrations.current = [
      ...registrations.current.filter((entry) => entry.id !== id),
      { id, context },
    ];
    updateCurrentContext();
  }, [updateCurrentContext]);

  const unregisterPageContext = useCallback((id: symbol) => {
    registrations.current = registrations.current.filter((entry) => entry.id !== id);
    updateCurrentContext();
  }, [updateCurrentContext]);

  const value = useMemo(() => ({
    pageContext,
    registerPageContext,
    unregisterPageContext,
  }), [pageContext, registerPageContext, unregisterPageContext]);
  return (
    <FleetGraphPageContextState.Provider value={value}>
      {children}
    </FleetGraphPageContextState.Provider>
  );
}

export function useFleetGraphPageContext() {
  return useContextValue().pageContext;
}

export function useFleetGraphPageContextRegistration(context: FleetGraphPageContext | null) {
  const { registerPageContext, unregisterPageContext } = useContextValue();
  const registrationId = useRef(Symbol('fleetgraph-page-context'));
  useLayoutEffect(() => {
    registerPageContext(registrationId.current, context);
    return () => unregisterPageContext(registrationId.current);
  }, [context, registerPageContext, unregisterPageContext]);
}

function useContextValue(): FleetGraphPageContextValue {
  const value = useContext(FleetGraphPageContextState);
  if (!value) {
    throw new Error('useFleetGraphPageContext must be used inside FleetGraphPageContextProvider');
  }
  return value;
}
