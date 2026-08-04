'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CurrencyInput, Disclosure, EmptyState, Input, Select, useToast, type BadgeProps } from '@/components/ui';
import {
  classifyPosting,
  daysSinceCharge,
  isOutstanding,
  type CreditPostingDerivedState,
} from '@/domain/credit/CreditPosting';
import { formatCents, formatDate, formatDays } from '@/lib/format';
import { markMissing, markPosted, recordPosting } from './postingActions';
import type { PostingListItem } from './types';

/**
 * "Did my statement credit actually post?" — the section §-level pain this
 * whole feature exists for (see `src/domain/credit/CreditPosting.ts` and
 * `posting.rules.ts`): `credit_buckets` only ever tracked how much of an
 * allowance was *spent*; this is the first place `/credits` says whether the
 * money actually came back.
 *
 * Rendered above the per-card bucket sections in `CreditWallet`. Every write
 * (`markPosted`/`markMissing`/`recordPosting`) is a Server Action in
 * `./postingActions`; this component's own job is classification (via
 * `classifyPosting`, never re-derived here) and the inline "chase it" /
 * "mark posted" expansions — no modal, per the repo-wide ban on any dialog
 * that could have been an inline `Disclosure` instead.
 */

interface OutstandingItem {
  readonly posting: PostingListItem;
  readonly state: CreditPostingDerivedState;
  readonly days: number;
}

const STATE_BADGE: Readonly<Record<CreditPostingDerivedState, { label: string; variant: NonNullable<BadgeProps['variant']> }>> =
  Object.freeze({
    SETTLING: { label: 'Settling', variant: 'neutral' },
    OVERDUE: { label: 'Overdue — chase it', variant: 'warning' },
    STALE: { label: 'Stale — escalate', variant: 'critical' },
    POSTED: { label: 'Posted', variant: 'good' },
    DISPUTED: { label: 'Disputed', variant: 'warning' },
    WRITTEN_OFF: { label: 'Written off', variant: 'critical' },
  });

/** STALE first, then OVERDUE, then SETTLING — the credits closest to being written off surface at the top. */
const URGENCY_RANK: Readonly<Record<CreditPostingDerivedState, number>> = Object.freeze({
  STALE: 0,
  OVERDUE: 1,
  SETTLING: 2,
  POSTED: 3,
  DISPUTED: 3,
  WRITTEN_OFF: 3,
});

/** Exactly the three facts an issuer's chat asks for — no more, no less. */
function chaseText(posting: PostingListItem): string {
  return [
    `Merchant: ${posting.merchantDescriptor ?? 'not shown on the statement yet'}`,
    `Amount: ${formatCents(posting.expectedCents)}`,
    `Charge date: ${formatDate(posting.chargedOn)}`,
  ].join('\n');
}

export interface CreditPostingTrackerProps {
  readonly postings: readonly PostingListItem[];
  /** Real `credit_buckets` ids the "log a credit" form can link to — empty
   * when the wallet is running on the rule-derived fallback (see
   * `CreditWallet`'s `isLive`), since those ids aren't rows the write side
   * could actually find. */
  readonly bucketOptions: readonly { readonly id: string; readonly label: string }[];
}

export function CreditPostingTracker({ postings, bucketOptions }: CreditPostingTrackerProps) {
  const router = useRouter();
  // A page-load snapshot, not a ticking clock — unlike ClaimKit's 24-hour
  // countdown, a day-granularity settling window doesn't need per-second
  // re-evaluation, and `router.refresh()` after every write already gets a
  // fresh `now` on the next render.
  const now = React.useMemo(() => new Date(), []);

  const items: readonly OutstandingItem[] = React.useMemo(() => {
    return postings
      .filter((posting) => isOutstanding(posting.status))
      .map(
        (posting): OutstandingItem => ({
          posting,
          state: classifyPosting({ chargedOn: posting.chargedOn, status: posting.status }, now),
          days: daysSinceCharge(posting.chargedOn, now),
        }),
      )
      .sort((a, b) => URGENCY_RANK[a.state] - URGENCY_RANK[b.state] || b.days - a.days);
  }, [postings, now]);

  const handleChanged = React.useCallback(() => router.refresh(), [router]);

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-h2 text-text-primary">Did it actually post?</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Statement credits post anywhere from same-day to twelve days after the charge — some
          benefits also require enrolment before you buy, or fail on the issuer&rsquo;s side
          entirely. Anything past the normal lag shows up here so you know when it is actually
          time to start chasing.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState message="Every credit you're tracking has posted or been resolved — nothing outstanding right now." />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <PostingRow key={item.posting.id} item={item} onChanged={handleChanged} />
          ))}
        </ul>
      )}

      <LogCreditDisclosure bucketOptions={bucketOptions} onLogged={handleChanged} />
    </Card>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tnum text-sm font-medium text-text-primary">{value}</dd>
    </div>
  );
}

function PostingRow({
  item,
  onChanged,
}: {
  readonly item: OutstandingItem;
  readonly onChanged: () => void;
}) {
  const { posting, state, days } = item;
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [markingMissing, startMarkingMissing] = React.useTransition();
  const badge = STATE_BADGE[state];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(chaseText(posting));
      setCopied(true);
      toast({ title: 'Copied the three facts', variant: 'success', durationMs: 2500 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Could not copy automatically',
        description: 'Select the text above and copy it manually.',
        variant: 'error',
      });
    }
  }

  function handleMarkMissing() {
    startMarkingMissing(async () => {
      const result = await markMissing(posting.id);
      if (!result.ok) {
        toast({ title: 'Could not flag this credit', description: result.message, variant: 'error' });
        return;
      }
      toast({ title: 'Flagged as missing', variant: 'success' });
      onChanged();
    });
  }

  const title = posting.bucketLabel ?? posting.merchantDescriptor ?? 'Credit';

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface-1 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {title}
            {posting.propertyName ? ` · ${posting.propertyName}` : ''}
          </p>
          <p className="text-xs text-text-muted">Charged {formatDate(posting.chargedOn)}</p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Figure label="Expected" value={formatCents(posting.expectedCents)} />
        <Figure label="Days since charge" value={formatDays(days)} />
      </dl>

      {posting.status === 'MISSING' ? (
        <p className="text-xs text-text-muted">You already flagged this as missing once.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Disclosure summary="Chase it" className="min-w-[220px] flex-1">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-muted">
              The three facts an issuer&rsquo;s chat will ask for.
            </p>
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-2 text-xs text-text-primary">
              {chaseText(posting)}
            </pre>
            <Button variant="secondary" size="sm" onClick={handleCopy} className="self-start">
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </Disclosure>

        <Disclosure summary="Mark posted" className="min-w-[220px] flex-1">
          <MarkPostedForm posting={posting} onDone={onChanged} />
        </Disclosure>
      </div>

      <Button
        variant="ghost"
        size="sm"
        loading={markingMissing}
        disabled={posting.status === 'MISSING'}
        onClick={handleMarkMissing}
        className="self-start"
      >
        {posting.status === 'MISSING' ? 'Already flagged missing' : 'Mark missing'}
      </Button>
    </li>
  );
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function MarkPostedForm({
  posting,
  onDone,
}: {
  readonly posting: PostingListItem;
  readonly onDone: () => void;
}) {
  const { toast } = useToast();
  const [postedCents, setPostedCents] = React.useState<number | null>(posting.expectedCents);
  const [postedOn, setPostedOn] = React.useState(todayIsoDate);
  const [pending, startTransition] = React.useTransition();

  function handleSubmit() {
    if (postedCents === null) {
      toast({ title: 'Enter the amount that posted first.', variant: 'error' });
      return;
    }
    startTransition(async () => {
      const result = await markPosted(posting.id, postedCents, postedOn);
      if (!result.ok) {
        toast({ title: 'Could not mark this posted', description: result.message, variant: 'error' });
        return;
      }
      toast({ title: 'Marked posted', variant: 'success' });
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <CurrencyInput
        label="Amount that posted"
        value={postedCents}
        onChange={setPostedCents}
        hint="What actually landed — this can be less than the expected amount for a partial post."
      />
      <Input
        label="Posted on"
        type="date"
        value={postedOn}
        onChange={(event) => setPostedOn(event.target.value)}
      />
      <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="self-start">
        Confirm posted
      </Button>
    </div>
  );
}

function LogCreditDisclosure({
  bucketOptions,
  onLogged,
}: {
  readonly bucketOptions: readonly { readonly id: string; readonly label: string }[];
  readonly onLogged: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [expectedCents, setExpectedCents] = React.useState<number | null>(null);
  const [chargedOn, setChargedOn] = React.useState(todayIsoDate);
  const [merchantDescriptor, setMerchantDescriptor] = React.useState('');
  const [bucketId, setBucketId] = React.useState<string | undefined>(undefined);
  const [pending, startTransition] = React.useTransition();

  function handleSubmit() {
    if (expectedCents === null) {
      toast({ title: 'Enter the expected amount first.', variant: 'error' });
      return;
    }
    startTransition(async () => {
      const result = await recordPosting({
        bucketId: bucketId ?? null,
        expectedCents,
        chargedOn,
        merchantDescriptor: merchantDescriptor.trim() || null,
      });
      if (!result.ok) {
        toast({ title: 'Could not save this credit', description: result.message, variant: 'error' });
        return;
      }
      toast({ title: 'Now tracking this credit', variant: 'success' });
      setExpectedCents(null);
      setMerchantDescriptor('');
      setBucketId(undefined);
      setOpen(false);
      onLogged();
    });
  }

  return (
    <Disclosure summary="Log a credit to track" open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-3">
        <CurrencyInput label="Expected amount" value={expectedCents} onChange={setExpectedCents} />
        <Input
          label="Charge date"
          type="date"
          value={chargedOn}
          onChange={(event) => setChargedOn(event.target.value)}
        />
        <Input
          label="Merchant descriptor"
          value={merchantDescriptor}
          onChange={(event) => setMerchantDescriptor(event.target.value)}
          placeholder="e.g. AMEX TRAVEL ONLINE"
          hint="Optional — the exact string as it appears on your statement, if you know it yet."
        />
        {bucketOptions.length > 0 ? (
          <Select
            label="Bucket"
            value={bucketId}
            onChange={setBucketId}
            options={bucketOptions.map((bucket) => ({ value: bucket.id, label: bucket.label }))}
            placeholder="Not linked to a bucket"
            hint="Optional."
          />
        ) : null}
        <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="self-start">
          Start tracking
        </Button>
      </div>
    </Disclosure>
  );
}
