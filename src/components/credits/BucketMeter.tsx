import type { ComponentType } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, PiggyBank } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatCents, formatDate, formatDays } from '@/lib/format';
import type { CreditBucket } from '@/domain/credit/CreditBucket';

/**
 * `BucketMeter` — one row of the `/credits` wallet (§6.4, §7.5).
 *
 * §6.4: "remaining, consumed, days-left, expired." §7.5: "face, consumed,
 * remaining, window end, and days remaining, with a status color that shifts
 * as expiry approaches (> 60 days neutral, 30–60 warning, < 30 critical)."
 *
 * All of that math — `remainingCents`, `daysRemaining`, and the band itself —
 * comes straight from the `CreditBucket` aggregate (`status()`,
 * `daysRemaining()`, `isExhausted`) rather than being re-derived here. This
 * component is presentation only.
 *
 * A fifth band, `EXHAUSTED`, is added on top of the aggregate's own
 * `NEUTRAL | WARNING | CRITICAL | EXPIRED` — a bucket that has been fully
 * spent is not a problem (§1.5 success criterion #3 is literally "all four
 * semiannual credit buckets are burned before expiry"), so it reads as a
 * calm, positive state rather than inheriting whatever the date-based band
 * says. It takes priority over the date bands: a bucket exhausted with 100
 * days left and a bucket exhausted with 2 days left both read "Fully used."
 */

type MeterBand = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EXPIRED' | 'EXHAUSTED';

interface BandConfig {
  readonly label: string;
  readonly variant: NonNullable<BadgeProps['variant']>;
  readonly icon: ComponentType<{ className?: string }>;
  readonly barClassName: string;
  readonly borderClassName: string;
}

const BAND_CONFIG: Record<MeterBand, BandConfig> = {
  HEALTHY: {
    label: 'On track',
    variant: 'good',
    icon: CheckCircle2,
    barClassName: 'bg-status-good',
    borderClassName: 'border-border',
  },
  WARNING: {
    label: 'Expiring soon',
    variant: 'warning',
    icon: AlertTriangle,
    barClassName: 'bg-status-warning',
    borderClassName: 'border-border',
  },
  CRITICAL: {
    label: 'Act now',
    variant: 'critical',
    icon: XCircle,
    barClassName: 'bg-status-critical',
    borderClassName: 'border-status-critical',
  },
  EXPIRED: {
    label: 'Expired',
    variant: 'critical',
    icon: XCircle,
    barClassName: 'bg-status-critical',
    borderClassName: 'border-status-critical',
  },
  EXHAUSTED: {
    label: 'Fully used',
    variant: 'neutral',
    icon: PiggyBank,
    barClassName: 'bg-border-strong',
    borderClassName: 'border-border',
  },
};

function bandFor(bucket: CreditBucket, todayIsoDate: string): MeterBand {
  // Exhausted overrides the date-based band regardless of days remaining —
  // there is nothing left to lose, so it is never a warning.
  if (bucket.isExhausted) return 'EXHAUSTED';
  const status = bucket.status(todayIsoDate);
  return status === 'NEUTRAL' ? 'HEALTHY' : status;
}

export interface BucketMeterProps {
  readonly bucket: CreditBucket;
  readonly todayIsoDate: string;
  readonly className?: string;
}

export function BucketMeter({ bucket, todayIsoDate, className }: BucketMeterProps) {
  const band = bandFor(bucket, todayIsoDate);
  const config = BAND_CONFIG[band];
  const days = bucket.daysRemaining(todayIsoDate);
  const consumedPct =
    bucket.faceCents > 0
      ? Math.min(100, Math.round((bucket.consumedCents / bucket.faceCents) * 100))
      : 0;

  return (
    <div
      className={cn('rounded-lg border bg-surface-1 p-4', config.borderClassName, className)}
      data-band={band}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-h3 text-text-primary">{bucket.label}</p>
          <p className="text-xs text-text-muted">
            Window {formatDate(bucket.window.start)} – {formatDate(bucket.window.end)}
          </p>
        </div>
        {/* §6.7: colour is never the sole carrier — `Badge` always pairs its
            colour with an icon and a text label. */}
        <Badge variant={config.variant} icon={config.icon}>
          {config.label}
        </Badge>
      </div>

      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-sm bg-glass"
        role="img"
        aria-label={`${formatCents(bucket.consumedCents)} consumed of ${formatCents(bucket.faceCents)}`}
      >
        <div
          className={cn('h-full rounded-sm transition-[width] duration-base ease-standard', config.barClassName)}
          style={{ width: `${consumedPct}%` }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Figure label="Face" value={formatCents(bucket.faceCents)} />
        <Figure label="Consumed" value={formatCents(bucket.consumedCents)} />
        <Figure label="Remaining" value={formatCents(bucket.remainingCents)} emphasis />
        <Figure
          label={days >= 0 ? 'Days remaining' : 'Window'}
          value={days >= 0 ? formatDays(days) : 'Expired'}
        />
      </dl>

      {bucket.windowAssumed ? (
        <p className="mt-2 text-xs text-text-muted">
          Window assumed as the calendar year — set your cardmember anniversary in Settings for
          the exact date.
        </p>
      ) : null}
    </div>
  );
}

function Figure({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={cn('tnum text-sm', emphasis ? 'font-medium text-text-primary' : 'text-text-secondary')}>
        {value}
      </dd>
    </div>
  );
}
