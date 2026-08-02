'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FOCUS_RING } from './_shared';

/**
 * Toast + ToastProvider/useToast — §6.4 required states: info, success,
 * warning, error.
 *
 * There is no Radix toast primitive in this project's dependencies, so this
 * is a small hand-rolled context + a single `aria-live="polite"` region that
 * announces every toast as it mounts, per §6.7 ("live regions announce
 * recompute results" generalizes to any async status change).
 */
export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. Pass `0` to require manual dismissal. */
  readonly durationMs?: number;
}

interface ToastRecord {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly variant: ToastVariant;
}

interface ToastContextValue {
  readonly toast: (options: ToastOptions) => string;
  readonly dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider.');
  return ctx;
}

const VARIANT_ICON: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  info: 'text-text-secondary',
  success: 'text-status-good',
  warning: 'text-status-warning',
  error: 'text-status-critical',
};

let toastIdCounter = 0;

export function ToastProvider({ children }: { readonly children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<readonly ToastRecord[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = `toast-${++toastIdCounter}`;
      const durationMs = options.durationMs ?? 5000;
      setToasts((current) => [
        ...current,
        {
          id,
          title: options.title,
          description: options.description,
          variant: options.variant ?? 'info',
        },
      ]);
      if (durationMs > 0) {
        setTimeout(() => dismiss(id), durationMs);
      }
      return id;
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((item) => (
          <Toast key={item.id} {...item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export interface ToastProps {
  readonly title: string;
  readonly description?: string;
  readonly variant?: ToastVariant;
  readonly onDismiss?: () => void;
  readonly className?: string;
}

export function Toast({ title, description, variant = 'info', onDismiss, className }: ToastProps) {
  const Icon = VARIANT_ICON[variant];
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-md border border-border bg-surface-2 p-3 shadow-e2 sm:w-96',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', VARIANT_ICON_COLOR[variant])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className={cn('shrink-0 rounded-sm text-text-muted hover:text-text-primary', FOCUS_RING)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
