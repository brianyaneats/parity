'use client';

import * as React from 'react';
import {
  Badge,
  Button,
  Card,
  ConditionList,
  CountdownTimer,
  CurrencyInput,
  Input,
  RadioGroup,
  useToast,
  type ConditionListItem,
} from '@/components/ui';
import { formatCents, formatDateTime } from '@/lib/format';
import { Claim, type ClaimKind } from '@/domain/claim/Claim';
import { CLAIM_STATUS_LABELS, OPEN_STATUSES, RESOLVED_WITH_AWARD, isTransitionAllowed, type ClaimStatus } from '@/domain/claim/ClaimStatus';
import {
  EVIDENCE_CHECKLIST,
  MIN_SCREENSHOT_WIDTH_PX,
  isScreenshotWideEnough,
  looksCropped,
} from '@/domain/claim/EvidenceChecklist';
import { generateClaimPacket } from '@/domain/claim/claim-packet';
import { DENIAL_CODES, DENIAL_REASONS, isAppealable, type DenialCode } from '@/domain/claim/DenialReason';
import type { Cents } from '@/domain/shared/cents';
import { cn } from '@/lib/cn';
import { CLAIM_STATUS_BADGE_VARIANT } from './status-presentation';
import { useClaimPersistence } from './useClaimPersistence';

/**
 * The claim kit — `/claims/[id]` (§7.4).
 *
 * Everything the page needs is passed in as plain, JSON-serializable data
 * (`ClaimKitData`) from the server component; this file reconstructs the
 * actual `Claim` aggregate client-side so every status transition — marking
 * submitted, recording an outcome — is validated by the same state machine
 * the API and the cron sweep would use, per `ClaimStatus.ts`'s own doc
 * comment: "the rule is stated once and enforced identically by the API, the
 * UI and the cron sweep." In particular, §7.4's acceptance criterion — "an
 * expired claim can no longer be marked SUBMITTED" — is enforced by
 * `claim.hasPassedDeadline()` and `isTransitionAllowed()`, not by a
 * second copy of that rule written here.
 *
 * There is no persistence wiring for these actions yet (no `/api/claims/:id`
 * route exists in this deliverable's scope) — this mirrors `CompareScreen`'s
 * own "Save comparison" / "Mark as booked" buttons, which are present and
 * fully specified but not yet wired to a backend. The aggregate still gates
 * what is *offered*, which is the actual acceptance criterion in §7.4.
 */

export interface ClaimKitData {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string;
  readonly kind: ClaimKind;
  readonly status: ClaimStatus;
  /** ISO instant. */
  readonly deadlineAt: string;
  readonly claimedGapCents: number | null;
  readonly awardedCents: number | null;
  readonly submittedAt: string | null;
  readonly resolvedAt: string | null;
  readonly denialReason: string | null;
  readonly denialCode: DenialCode | null;
  readonly notes: string | null;
  readonly competingRateId: string | null;

  readonly hotelName: string;
  readonly hotelAddress: string;
  /** ISO `YYYY-MM-DD`. */
  readonly checkIn: string;
  /** ISO `YYYY-MM-DD`. */
  readonly checkOut: string;
  readonly nights: number;
  readonly roomType: string;
  readonly bedType: string;
  readonly guestCount: number;
  readonly currency: string;
  readonly cancellationPolicy: string;
  readonly bookingChannelLabel: string;
  /** ISO instant. */
  readonly bookedAt: string;
  readonly ownTotalCents: number;
  readonly ownBaseCents: number;

  readonly competitor: {
    readonly baseCents: number;
    readonly totalCents: number | null;
    readonly siteDomain: string;
    readonly url: string;
  } | null;
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image.'));
    };
    img.src = url;
  });
}

type OutcomeChoice = 'APPROVED' | 'PARTIAL' | 'DENIED';

export function ClaimKit({ data }: { data: ClaimKitData }) {
  const { toast } = useToast();

  // (a)–(e) all read and mutate this one aggregate. It is constructed once —
  // `useState`'s lazy initializer runs on mount only — and mutated in place
  // by `transitionTo`; `forceRender` is what turns "the object was mutated"
  // into "React re-renders and the getters are read fresh."
  const [claim] = React.useState(() =>
    Claim.rehydrate({
      id: data.id,
      userId: data.userId,
      bookingId: data.bookingId,
      competingRateId: data.competingRateId,
      kind: data.kind,
      deadlineAt: new Date(data.deadlineAt),
      status: data.status,
      claimedGapCents: data.claimedGapCents as Cents | null,
      awardedCents: data.awardedCents as Cents | null,
      submittedAt: data.submittedAt ? new Date(data.submittedAt) : null,
      resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : null,
      denialReason: data.denialReason,
      denialCode: data.denialCode,
      notes: data.notes,
    }),
  );
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  const persistence = useClaimPersistence();

  // Coarse (30s) re-check of "has the deadline passed" — precise enough to
  // gate a button, without re-implementing CountdownTimer's own per-second
  // ticking here too.
  const [nowTick, setNowTick] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const timeZone = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'America/New_York';
    }
  }, []);

  /* --------------------------------------------------------- (b) evidence */
  const [checkedIds, setCheckedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const evidenceItems: readonly ConditionListItem[] = EVIDENCE_CHECKLIST.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.why,
    state: checkedIds.has(item.id) ? 'pass' : 'warn',
    emphasized: item.highRisk,
  }));

  /* -------------------------------------------------------- (c) screenshot */
  const [screenshot, setScreenshot] = React.useState<{
    readonly fileName: string;
    readonly widthPx: number;
    readonly heightPx: number;
  } | null>(null);
  const [screenshotError, setScreenshotError] = React.useState<string | undefined>(undefined);

  async function handleScreenshotChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const { width, height } = await readImageDimensions(file);
      setScreenshot({ fileName: file.name, widthPx: width, heightPx: height });
      setScreenshotError(undefined);

      // §7.4 item 3 checks the image client-side; §12 requires it stored in
      // private object storage. Both, in that order — the dimension warning is
      // worth showing even if the upload then fails.
      const uploaded = await persistence.uploadEvidence(data.id, file);
      if (!uploaded) {
        setScreenshotError(persistence.error ?? 'The screenshot could not be uploaded.');
      }
    } catch (err) {
      setScreenshot(null);
      setScreenshotError(errorMessage(err) ?? 'Could not read this image.');
    }
  }

  const screenshotItems: readonly ConditionListItem[] = screenshot
    ? [
        {
          id: 'width',
          label: `${screenshot.fileName} — ${screenshot.widthPx}×${screenshot.heightPx}px`,
          state: isScreenshotWideEnough(screenshot.widthPx) ? 'pass' : 'fail',
          description: isScreenshotWideEnough(screenshot.widthPx)
            ? `Meets the ${MIN_SCREENSHOT_WIDTH_PX}px minimum width.`
            : `Needs to be at least ${MIN_SCREENSHOT_WIDTH_PX}px wide — capture the full browser window, not a crop.`,
        },
        ...(looksCropped(screenshot.widthPx, screenshot.heightPx)
          ? ([
              {
                id: 'crop',
                label: 'This looks like a cropped strip, not a full page',
                state: 'warn',
                description:
                  'A very wide, short capture usually means the cancellation policy or price fell out of frame. Not blocking — check it yourself.',
              },
            ] as const)
          : []),
      ]
    : [];

  /* ------------------------------------------------------- (d) claim text */
  const claimText = data.competitor
    ? generateClaimPacket({
        hotelName: data.hotelName,
        hotelAddress: data.hotelAddress,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        roomType: data.roomType,
        bedType: data.bedType,
        guestCount: data.guestCount,
        currency: data.currency,
        cancellationPolicy: data.cancellationPolicy,
        nights: data.nights,
        bookingChannelLabel: data.bookingChannelLabel,
        ownTotalCents: data.ownTotalCents as Cents,
        ownBaseCents: data.ownBaseCents as Cents,
        competitorSiteDomain: data.competitor.siteDomain,
        competitorUrl: data.competitor.url,
        competitorBaseCents: data.competitor.baseCents as Cents,
        competitorTotalCents: data.competitor.totalCents as Cents | null,
        formatMoney: formatCents,
      })
    : null;

  const [copied, setCopied] = React.useState(false);
  async function handleCopy() {
    if (!claimText) return;
    try {
      await navigator.clipboard.writeText(claimText);
      setCopied(true);
      toast({ title: 'Claim text copied', variant: 'success', durationMs: 2500 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Could not copy automatically',
        description: 'Select the text above and copy it manually.',
        variant: 'error',
      });
    }
  }

  /* ------------------------------------------------- (e) submission recorder */
  const pastDeadline = claim.hasPassedDeadline(nowTick);
  const canMarkSubmitted = isTransitionAllowed(claim.status, 'SUBMITTED') && !pastDeadline;

  async function handleMarkSubmitted() {
    // Persists first; the local aggregate only advances once the row actually
    // moved. Before this was wired, the toast fired on a purely in-memory
    // change and the claim silently auto-expired at T+24h — the exact failure
    // §1.5's second criterion exists to prevent.
    const saved = await persistence.transition(claim, 'SUBMITTED');
    if (!saved) {
      toast({
        title: 'Could not mark this claim submitted',
        description: persistence.error ?? undefined,
        variant: 'error',
      });
      return;
    }
    forceRender();
    toast({
      title: 'Marked submitted',
      description: 'Saved. Record the outcome once the issuer responds.',
      variant: 'success',
    });
  }

  const [outcome, setOutcome] = React.useState<OutcomeChoice>('PARTIAL');
  const [awardedDraft, setAwardedDraft] = React.useState<number | null>(null);
  const [denialReasonDraft, setDenialReasonDraft] = React.useState('');
  // `''` rather than `undefined` — Radix's RadioGroup warns loudly if a
  // controlled `value` starts `undefined` and later becomes a string.
  const [denialCodeDraft, setDenialCodeDraft] = React.useState<DenialCode | ''>('');

  async function handleRecordOutcome() {
    if (outcome !== 'DENIED' && awardedDraft === null) {
      toast({ title: 'Enter the amount the issuer awarded first.', variant: 'error' });
      return;
    }
    // A code is what turns "denied" into "worth contesting or not" — the
    // entire point of this feature — so it is required, the same way an
    // award figure is required for APPROVED/PARTIAL above.
    if (outcome === 'DENIED' && denialCodeDraft === '') {
      toast({ title: 'Select what the issuer actually said first.', variant: 'error' });
      return;
    }

    // §5.2: APPROVED/PARTIAL require `awarded_cents` and write a realized
    // savings_events row server-side. That only happens if the PATCH is
    // actually made — which is why the ledger stayed empty before this.
    const saved = await persistence.transition(
      claim,
      outcome,
      outcome === 'DENIED'
        ? { denialReason: denialReasonDraft.trim() || 'Not specified.', denialCode: denialCodeDraft || undefined }
        : { awardedCents: awardedDraft as Cents },
    );

    if (!saved) {
      toast({
        title: 'Could not record this outcome',
        description: persistence.error ?? undefined,
        variant: 'error',
      });
      return;
    }
    forceRender();
    toast({ title: `Recorded as ${CLAIM_STATUS_LABELS[outcome]}`, variant: 'success' });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <p className="text-label uppercase text-text-muted">Claim kit</p>
        <h1 className="text-h1 text-text-primary">{data.hotelName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          {data.bookingChannelLabel} · Booked {formatDateTime(data.bookedAt, timeZone)}
          <Badge variant={CLAIM_STATUS_BADGE_VARIANT[claim.status]}>{CLAIM_STATUS_LABELS[claim.status]}</Badge>
        </p>
      </div>

      {/* (a) countdown, prominent, exact deadline in the user's timezone */}
      <Card className="flex flex-col gap-2">
        <CountdownTimer deadline={data.deadlineAt} size="lg" />
        <p className="text-sm text-text-secondary">
          Submit before{' '}
          <strong className="tnum text-text-primary">{formatDateTime(data.deadlineAt, timeZone)}</strong> ({timeZone}).
        </p>
      </Card>

      {/* (b) the ten-element evidence checklist */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-h2 text-text-primary">Evidence checklist</h2>
          <span className="tnum text-xs text-text-muted">
            {checkedIds.size} of {EVIDENCE_CHECKLIST.length}
          </span>
        </div>
        <p className="text-sm text-text-secondary">
          Tick each item as you capture it. The two emphasised rows are the most common denial causes.
        </p>
        <ConditionList items={evidenceItems} onToggle={toggleChecked} aria-label="Evidence checklist" />
      </Card>

      {/* (c) screenshot upload with a client-side width and crop check */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-h2 text-text-primary">Screenshot</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="claim-screenshot" className="text-xs font-medium text-text-secondary">
            Upload a screenshot of the competing rate
          </label>
          <input
            id="claim-screenshot"
            type="file"
            accept="image/*"
            onChange={handleScreenshotChange}
            className="text-sm text-text-secondary file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface-2 file:px-2 file:py-1 file:text-text-primary"
          />
          {screenshotError ? <p className="text-xs text-status-critical">{screenshotError}</p> : null}
        </div>
        {screenshotItems.length > 0 ? <ConditionList items={screenshotItems} aria-label="Screenshot checks" /> : null}
      </Card>

      {/* (d) the generated claim text */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-h2 text-text-primary">Claim text</h2>
          <Button variant="secondary" size="sm" onClick={handleCopy} disabled={!claimText}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {claimText ? (
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-sm text-text-primary">
            {claimText}
          </pre>
        ) : (
          <p className="text-sm text-text-secondary">
            This claim has no competing rate attached yet, so there is nothing to generate text from.
          </p>
        )}
      </Card>

      {/* (e) submission recorder */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-h2 text-text-primary">Submission</h2>

        {OPEN_STATUSES.has(claim.status) ? (
          pastDeadline ? (
            <p className="text-sm text-status-critical">
              The 24-hour submission window has closed. This can no longer be marked submitted.
            </p>
          ) : (
            <Button variant="primary" onClick={handleMarkSubmitted} disabled={!canMarkSubmitted} className="self-start">
              Mark submitted
            </Button>
          )
        ) : null}

        {claim.status === 'SUBMITTED' ? (
          <div className="flex flex-col gap-3">
            <RadioGroup
              label="Outcome"
              value={outcome}
              onChange={(value) => setOutcome(value as OutcomeChoice)}
              orientation="horizontal"
              options={[
                { value: 'APPROVED', label: 'Approved in full' },
                { value: 'PARTIAL', label: 'Partially approved' },
                { value: 'DENIED', label: 'Denied' },
              ]}
            />
            {outcome === 'DENIED' ? (
              <div className="flex flex-col gap-3">
                <RadioGroup
                  label="Denial reason"
                  value={denialCodeDraft}
                  onChange={(value) => setDenialCodeDraft(value as DenialCode)}
                  options={DENIAL_CODES.map((code) => ({
                    value: code,
                    label: DENIAL_REASONS[code].label,
                    description: DENIAL_REASONS[code].asStated || undefined,
                  }))}
                />
                {denialCodeDraft ? <DenialGuidance code={denialCodeDraft} /> : null}
                <Input
                  label="Their exact words (optional)"
                  value={denialReasonDraft}
                  onChange={(event) => setDenialReasonDraft(event.target.value)}
                  placeholder="Paste the issuer's own wording here"
                />
              </div>
            ) : (
              <CurrencyInput
                label="Amount awarded"
                value={awardedDraft}
                onChange={setAwardedDraft}
                hint="What the issuer actually paid. Treat the queue's estimate as an upper bound, not this figure."
              />
            )}
            <Button variant="primary" onClick={handleRecordOutcome} className="self-start">
              Record outcome
            </Button>
          </div>
        ) : null}

        {RESOLVED_WITH_AWARD.has(claim.status) ? (
          <p className="text-sm text-text-primary">
            Resolved {CLAIM_STATUS_LABELS[claim.status].toLowerCase()} —{' '}
            <strong className="tnum">{formatCents(claim.awardedCents ?? 0)}</strong> credited.
          </p>
        ) : null}
        {claim.status === 'DENIED' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-primary">
              Denied{claim.denialReason ? ` — ${claim.denialReason}` : '.'}
            </p>
            {/* Survives a reload: the code came back from the server on
                `data.denialCode`, not from the (now-empty) draft state above. */}
            {claim.denialCode ? <DenialGuidance code={claim.denialCode} /> : null}
          </div>
        ) : null}
        {claim.status === 'NOT_PURSUED' || claim.status === 'EXPIRED' ? (
          <p className="text-sm text-text-secondary">
            {claim.status === 'EXPIRED'
              ? 'The submission window closed before this was marked submitted.'
              : 'Marked not pursued.'}
          </p>
        ) : null}
      </Card>

      {/* (f) the quiet, honest note */}
      <p className="text-xs text-text-muted">
        Partial approval is common, and the gap shown for this claim is an estimate, not a promise. The amount
        actually credited is at the issuer&rsquo;s discretion.
      </p>
    </div>
  );
}

/**
 * The payoff of `DenialReason.ts` — telling the user, in plain terms, whether
 * a denial is worth fighting. Appealable codes get the rebuttal to send back;
 * everything else gets what would have prevented it, because there is
 * nothing left to contest. Rendered both while composing an outcome (from
 * `denialCodeDraft`) and after reload (from the persisted `claim.denialCode`)
 * — a standalone component keeps its own copy-state independent in each spot.
 */
function DenialGuidance({ code }: { code: DenialCode }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const reason = DENIAL_REASONS[code];
  const appealable = isAppealable(code);

  async function handleCopyRebuttal() {
    if (!reason.rebuttal) return;
    try {
      await navigator.clipboard.writeText(reason.rebuttal);
      setCopied(true);
      toast({ title: 'Rebuttal copied', variant: 'success', durationMs: 2500 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Could not copy automatically',
        description: 'Select the text above and copy it manually.',
        variant: 'error',
      });
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn('text-sm font-semibold', appealable ? 'text-status-good' : 'text-status-warning')}>
          {appealable ? 'Worth contesting' : 'Not worth contesting — for next time'}
        </p>
        {appealable ? (
          <Button variant="secondary" size="sm" onClick={handleCopyRebuttal}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-text-secondary">{appealable ? reason.rebuttal : reason.preventable}</p>
    </div>
  );
}
