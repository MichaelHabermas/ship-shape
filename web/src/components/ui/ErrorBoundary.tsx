import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((resetErrorBoundary: () => void) => ReactNode);
  boundaryName?: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: unknown[];
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', this.props.boundaryName ?? 'unnamed', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (!this.state.hasError) return;
    if (!this.props.resetKeys || !prevProps.resetKeys) return;
    if (this.props.resetKeys.length !== prevProps.resetKeys.length) {
      this.handleReset();
      return;
    }
    const hasChanged = this.props.resetKeys.some((key, index) => !Object.is(key, prevProps.resetKeys?.[index]));
    if (hasChanged) this.handleReset();
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback(this.handleReset)
          : this.props.fallback;
      }

      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-sm font-medium text-foreground">Something went wrong</div>
            <p className="max-w-md text-xs text-muted">
              An unexpected error occurred while rendering this section.
            </p>
            <button
              onClick={this.handleReset}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
