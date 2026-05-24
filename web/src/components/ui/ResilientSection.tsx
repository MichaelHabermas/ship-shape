import type { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { cn } from '@/lib/cn';

interface ResilientSectionProps {
  name: string;
  children: ReactNode;
  fallbackTitle?: string;
  fallbackDescription?: string;
  className?: string;
  resetKeys?: unknown[];
}

export function ResilientSection({
  name,
  children,
  fallbackTitle = 'Section unavailable',
  fallbackDescription = 'This part of the page failed to render. The rest of your workspace is still usable.',
  className,
  resetKeys,
}: ResilientSectionProps) {
  return (
    <ErrorBoundary
      boundaryName={name}
      resetKeys={resetKeys}
      fallback={(resetErrorBoundary) => (
        <div
          role="status"
          className={cn(
            'rounded-md border border-border bg-border/20 p-3 text-xs text-muted',
            className
          )}
        >
          <div className="mb-1 font-medium text-foreground">{fallbackTitle}</div>
          <p>{fallbackDescription}</p>
          <button
            type="button"
            onClick={resetErrorBoundary}
            className="mt-2 rounded border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent"
          >
            Try again
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
