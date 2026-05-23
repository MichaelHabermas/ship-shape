import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { ResilientSection } from './ResilientSection';

function ThrowingChild({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('render failed');
  return <div>Recovered child</div>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders the default fallback and logs the named boundary', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary boundaryName="test-boundary">
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      '[ErrorBoundary] Uncaught error:',
      'test-boundary',
      expect.objectContaining({ message: 'render failed' })
    );
  });

  it('renders a custom fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
  });

  it('passes reset handling to custom fallback renderers', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;

    function RecoverableChild() {
      return <ThrowingChild shouldThrow={shouldThrow} />;
    }

    render(
      <ErrorBoundary fallback={(reset) => <button onClick={reset}>Retry custom</button>}>
        <RecoverableChild />
      </ErrorBoundary>
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry custom' }));

    expect(screen.getByText('Recovered child')).toBeInTheDocument();
  });

  it('resets and retries rendering when Try Again is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;

    function RecoverableChild() {
      return <ThrowingChild shouldThrow={shouldThrow} />;
    }

    render(
      <ErrorBoundary>
        <RecoverableChild />
      </ErrorBoundary>
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByText('Recovered child')).toBeInTheDocument();
  });

  it('resets when resetKeys change', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary resetKeys={['a']}>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKeys={['b']}>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Recovered child')).toBeInTheDocument();
  });
});

describe('ResilientSection', () => {
  it('contains a section crash without unmounting siblings', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <div>
        <div>Editor shell still mounted</div>
        <ResilientSection
          name="sidebar"
          fallbackTitle="Sidebar unavailable"
          fallbackDescription="Keep working."
        >
          <ThrowingChild />
        </ResilientSection>
      </div>
    );

    expect(screen.getByText('Editor shell still mounted')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sidebar unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('Keep working.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
