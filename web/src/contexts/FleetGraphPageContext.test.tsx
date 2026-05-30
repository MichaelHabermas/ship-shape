// Verifies FleetGraph page context registration preserves the active visible surface.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FleetGraphPageContext } from '@ship/shared';
import { fingerprintPageContext } from '@/fleetgraph/page-context';
import {
  FleetGraphPageContextProvider,
  useFleetGraphPageContext,
  useFleetGraphPageContextRegistration,
} from './FleetGraphPageContext';

function context(title: string): FleetGraphPageContext {
  return {
    route: `/${title.toLowerCase()}`,
    surface: 'workspace',
    title,
    visibleItems: [],
  };
}

function RegisteredSurface({ pageContext }: { pageContext: FleetGraphPageContext }) {
  useFleetGraphPageContextRegistration(pageContext);
  return null;
}

function Observer({ onChange }: { onChange: (context: FleetGraphPageContext | null) => void }) {
  onChange(useFleetGraphPageContext());
  return null;
}

describe('FleetGraphPageContextProvider', () => {
  it('keeps the previous registration when a newer page unregisters', () => {
    const observed: Array<string | null> = [];
    const rendered = render(
      <FleetGraphPageContextProvider>
        <RegisteredSurface pageContext={context('Issues')} />
        <RegisteredSurface pageContext={context('My Week')} />
        <Observer onChange={(value) => observed.push(value?.title ?? null)} />
      </FleetGraphPageContextProvider>
    );

    expect(observed.at(-1)).toBe('My Week');

    rendered.rerender(
      <FleetGraphPageContextProvider>
        <RegisteredSurface pageContext={context('Issues')} />
        <Observer onChange={(value) => observed.push(value?.title ?? null)} />
      </FleetGraphPageContextProvider>
    );

    expect(observed.at(-1)).toBe('Issues');
  });

  it('updates, clears, and restores registrations by owner', () => {
    const observed: Array<string | null> = [];
    const rendered = render(
      <FleetGraphPageContextProvider>
        <RegisteredSurface pageContext={context('Issues')} />
        <RegisteredSurface pageContext={context('My Week')} />
        <Observer onChange={(value) => observed.push(value?.title ?? null)} />
      </FleetGraphPageContextProvider>
    );

    rendered.rerender(
      <FleetGraphPageContextProvider>
        <RegisteredSurface pageContext={context('Issues')} />
        <RegisteredSurface pageContext={context('Projects')} />
        <Observer onChange={(value) => observed.push(value?.title ?? null)} />
      </FleetGraphPageContextProvider>
    );
    expect(observed.at(-1)).toBe('Projects');

    rendered.rerender(
      <FleetGraphPageContextProvider>
        <RegisteredSurface pageContext={context('Issues')} />
        <Observer onChange={(value) => observed.push(value?.title ?? null)} />
      </FleetGraphPageContextProvider>
    );
    expect(observed.at(-1)).toBe('Issues');

    rendered.rerender(
      <FleetGraphPageContextProvider>
        <Observer onChange={(value) => observed.push(value?.title ?? null)} />
      </FleetGraphPageContextProvider>
    );
    expect(observed.at(-1)).toBeNull();
  });

});

describe('fingerprintPageContext', () => {
  it('treats equivalent page capsules as the same fingerprint', () => {
    const left = context('Issues');
    const right = { ...context('Issues') };
    expect(fingerprintPageContext(left)).toBe(fingerprintPageContext(right));
  });
});
