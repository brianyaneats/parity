'use client';

import * as React from 'react';
import { Button } from './Button';

/**
 * ErrorBoundary — per-route, with a retry action and a request id (§6.4).
 *
 * Must be a class component: `getDerivedStateFromError`/`componentDidCatch`
 * have no hook equivalent in React today.
 */
export interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly fallbackTitle?: string;
  /** Called when the user clicks "Try again", before the boundary clears its
   * own error state — use it to reset any query/data state that caused the
   * crash so retrying doesn't immediately re-throw. */
  readonly onReset?: () => void;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
  readonly requestId: string;
}

/** A short, user-shareable id for support correlation — not a security token. */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, requestId: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, requestId: generateRequestId() };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.props.onReset?.();
    this.setState({ error: null, requestId: '' });
  };

  override render(): React.ReactNode {
    const { error, requestId } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface-1 p-6"
      >
        <p className="text-h3 text-text-primary">{this.props.fallbackTitle ?? 'Something went wrong'}</p>
        <p className="text-sm text-text-secondary">{error.message || 'An unexpected error occurred.'}</p>
        <p className="text-xs text-text-muted">
          Request ID: <span className="tnum">{requestId}</span>
        </p>
        <Button variant="secondary" size="sm" onClick={this.handleRetry}>
          Try again
        </Button>
      </div>
    );
  }
}
