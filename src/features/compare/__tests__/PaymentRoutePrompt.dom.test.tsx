import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentRoutePrompt } from '../PaymentRoutePrompt';

/**
 * The prompt that stands between a cardholder and a silently forfeited
 * statement credit (`posting.rules.ts`, D-164).
 *
 * The behaviour worth pinning is not "a radio group renders" — it is that
 * choosing a route which cannot earn the credit *says so*, in money, and still
 * lets the booking be recorded. A prompt that blocked recording would push
 * users to lie about how they paid, which is the one outcome that makes the
 * data useless.
 */

afterEach(cleanup);

const CREDIT_AT_RISK = 20_000; // $200.00 — the Fine Hotels credit face.

function renderPrompt(overrides?: {
  readonly onConfirm?: (route: string) => void;
  readonly onCancel?: () => void;
  readonly pending?: boolean;
}) {
  const onConfirm = overrides?.onConfirm ?? vi.fn();
  const onCancel = overrides?.onCancel ?? vi.fn();
  render(
    <PaymentRoutePrompt
      creditAtRiskCents={CREDIT_AT_RISK}
      pending={overrides?.pending ?? false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe('PaymentRoutePrompt — the credit-forfeiting routes', () => {
  it('names the amount at stake so the question has stakes attached', () => {
    renderPrompt();
    expect(screen.getByText(/\$200\.00 of statement credit/)).toBeInTheDocument();
  });

  it('says nothing alarming when the issuer processed the charge', () => {
    renderPrompt();
    // Issuer-prepaid is the default selection and the one route that earns the
    // credit, so there is no warning to show.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns, and names the remedy, when the property took a deposit instead', async () => {
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('radio', { name: /the property charged my card directly/i }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/will not post/i);
    // The remedy is the actionable half — a warning without it just tells the
    // user they have already lost.
    expect(alert).toHaveTextContent(/travel line/i);
  });

  it('warns when the stay will be settled at the property', async () => {
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('radio', { name: /paying at the property/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/will not post/i);
  });

  it('still records the booking on a forfeiting route, reporting the route it was told', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPrompt();

    await user.click(screen.getByRole('radio', { name: /the property charged my card directly/i }));
    await user.click(screen.getByRole('button', { name: 'Record the booking' }));

    expect(onConfirm).toHaveBeenCalledWith('DEPOSIT_TO_HOTEL');
  });

  it('confirms the issuer-prepaid route without the user touching the radios', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPrompt();

    await user.click(screen.getByRole('button', { name: 'Record the booking' }));

    expect(onConfirm).toHaveBeenCalledWith('PREPAID_VIA_ISSUER');
  });

  it('backs out without recording anything', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderPrompt();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot be cancelled mid-save', () => {
    renderPrompt({ pending: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
