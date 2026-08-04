'use client';

import { useState } from 'react';
import { Button, RadioGroup } from '@/components/ui';
import { PAYMENT_ROUTES, type PaymentRoute } from '@/domain/rules/posting.rules';
import { formatCents } from '@/lib/format';

/**
 * The question that decides whether a statement credit ever arrives.
 *
 * A cardholder who clicked "Pay Now" believes they prepaid. Whether the credit
 * posts depends on *who took the money*: only a charge processed by the
 * issuer's travel arm counts. A deposit collected by the property, or
 * settlement at the desk, leaves the issuer with no qualifying charge — and
 * some properties present a deposit as "Pay Now", so the booking screen the
 * user just came from cannot be trusted to tell them which happened.
 *
 * So this asks, once, at the only moment the user still has the booking
 * confirmation in front of them — and answers immediately, in money, when the
 * answer forfeits a credit. It never blocks recording the booking: the user
 * may have had no choice, and a tracker that refuses to record reality is
 * worse than one that records it with a warning attached.
 *
 * Only shown when there is actually a credit at stake (`creditAtRiskCents > 0`);
 * asking about payment routing on a booking that earns no credit is noise.
 */
export function PaymentRoutePrompt({
  creditAtRiskCents,
  pending,
  onConfirm,
  onCancel,
}: {
  readonly creditAtRiskCents: number;
  readonly pending: boolean;
  readonly onConfirm: (route: PaymentRoute) => void;
  readonly onCancel: () => void;
}) {
  const [route, setRoute] = useState<PaymentRoute>('PREPAID_VIA_ISSUER');
  const definition = PAYMENT_ROUTES[route];
  const forfeits = !definition.earnsPortalCredit;

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
      <div>
        <h3 className="text-h3 text-text-primary">How was this stay paid for?</h3>
        <p className="mt-1 text-sm text-text-secondary">
          {formatCents(creditAtRiskCents)} of statement credit depends on the answer, and the
          booking screen does not reliably show it — some properties label a deposit as “Pay now”.
        </p>
      </div>

      <RadioGroup
        label="Payment route"
        value={route}
        onChange={(value) => setRoute(value as PaymentRoute)}
        options={Object.values(PAYMENT_ROUTES).map((entry) => ({
          value: entry.route,
          label: entry.label,
        }))}
      />

      {forfeits ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-status-critical p-3"
        >
          <p className="text-sm font-medium text-text-primary">
            {definition.warning}
          </p>
          <p className="text-sm text-text-secondary">{definition.remedy}</p>
          <p className="text-xs text-text-muted">
            Recording it is still the right move — Parity will track the {formatCents(creditAtRiskCents)}{' '}
            as forfeited rather than quietly counting money you are never going to see.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={pending} onClick={() => onConfirm(route)}>
          Record the booking
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
