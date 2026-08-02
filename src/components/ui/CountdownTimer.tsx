'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCountdown, urgencyOf, type UrgencyBand } from '@/lib/format';

/**
 * CountdownTimer — §6.4 required states: `> 6h`, `1–6h` (warning), `< 1h`
 * (critical), expired. §7.4 is where it actually matters: the claims queue
 * pins anything inside its last 24 hours to the top with a *live* instance of
 * this, and the claim kit leads with one.
 *
 * Both the countdown text and the urgency band are computed with the reused
 * `formatCountdown`/`urgencyOf` from `src/lib/format.ts` — this component owns
 * no time-math or formatting logic of its own, only the ticking and the
 * markup. `urgencyOf` reserves "safe" for *strictly more* than six hours
 * remaining, so the instant of exactly six hours (and exactly one hour) reads
 * "warning" — the amber band is closed on its upper edge, per §7.4's
 * "green > 6h, amber 1–6h". That boundary lives in `urgencyOf`, not here.
 *
 * §6.7: colour is never the sole carrier of meaning. Every band pairs its
 * status colour with an icon *and* a text word ("On track" / "Due soon" /
 * "Urgent" / "Expired"), not just a coloured numeral.
 */

export interface CountdownTimerProps {
  /** The instant the submission window closes. */
  readonly deadline: Date | string;
  /**
   * Overrides "now" for the initial tick — testability, not a live-clock
   * override. Pass a fixed instant (with `vi.useFakeTimers()` in a test) to
   * get a deterministic starting `msRemaining`; every tick after that
   * advances in exact whole-second decrements driven by the interval itself,
   * never by re-reading the wall clock, so a test can `vi.advanceTimersByTime`
   * through a boundary and see exact values. Omit in production and the
   * component seeds itself from the real clock instead.
   */
  readonly now?: Date | string;
  readonly className?: string;
  /** `lg` (default) for a prominent header placement (§7.4 item 1); `sm` for
   * an inline table cell (the claims queue's pinned row). */
  readonly size?: 'sm' | 'lg';
}

const BAND_CONFIG: Record<
  UrgencyBand,
  { readonly icon: React.ComponentType<{ className?: string }>; readonly word: string; readonly textClass: string }
> = {
  safe: { icon: CheckCircle2, word: 'On track', textClass: 'text-status-good' },
  warning: { icon: Clock, word: 'Due soon', textClass: 'text-status-warning' },
  critical: { icon: AlertTriangle, word: 'Urgent', textClass: 'text-status-critical' },
  expired: { icon: XCircle, word: 'Expired', textClass: 'text-status-critical' },
};

function toMs(value: Date | string): number {
  return typeof value === 'string' ? new Date(value).getTime() : value.getTime();
}

export function CountdownTimer({ deadline, now, className, size = 'lg' }: CountdownTimerProps) {
  const deadlineMs = React.useMemo(() => toMs(deadline), [deadline]);
  // `undefined` when `now` is omitted, so an un-pinned production timer never
  // puts a freshly-read `Date.now()` into this memo's dependency array on
  // every render — only an actual change to the `now` prop (a test rerender)
  // should restart the interval below.
  const seededNowMs = React.useMemo(() => (now !== undefined ? toMs(now) : undefined), [now]);

  const [msRemaining, setMsRemaining] = React.useState(() =>
    Math.max(0, deadlineMs - (seededNowMs ?? Date.now())),
  );

  React.useEffect(() => {
    const startMs = seededNowMs ?? Date.now();
    setMsRemaining(Math.max(0, deadlineMs - startMs));

    // Already past the deadline: nothing to tick down.
    if (deadlineMs - startMs <= 0) return undefined;

    const id = setInterval(() => {
      setMsRemaining((previous) => Math.max(0, previous - 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [deadlineMs, seededNowMs]);

  const band = urgencyOf(msRemaining);
  const { icon: Icon, word, textClass } = BAND_CONFIG[band];

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      role="timer"
      aria-label={`${word}: ${formatCountdown(msRemaining)} remaining to submit`}
    >
      <Icon className={cn('size-4 shrink-0', textClass)} aria-hidden="true" />
      <span className={cn('tnum font-medium', textClass, size === 'lg' ? 'text-h2' : 'text-sm')}>
        {formatCountdown(msRemaining)}
      </span>
      <span className={cn('text-xs', textClass)}>{word}</span>
    </div>
  );
}
