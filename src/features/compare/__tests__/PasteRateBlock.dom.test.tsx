import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasteRateBlock } from '../PasteRateBlock';

afterEach(cleanup);

/**
 * §13.3's paste parser, at the UI boundary.
 *
 * Two defects a product review caught here, both of the same shape — the app
 * knowing something and then silently discarding it:
 *
 * 1. Every applied row was hardcoded to `EDIT`, so a pasted Marriott.com or
 *    Expedia rate was granted 8× Ultimate Rewards, price-match eligibility and
 *    a $250 statement credit it could never earn.
 * 2. The parser correctly detected `¥`/`£`/`€` and then threw it away, because
 *    `StayContext` has no currency (§3.2). A ¥40,000 Tokyo rate rendered as a
 *    confident "$400.00".
 *
 * Both now fail closed.
 */

const EDIT_BLOCK = [
  'Check-in: September 1, 2026',
  'Check-out: September 4, 2026',
  'Room rate: $3,149.47',
  'Taxes and fees: $390.53',
  'Total: $3,540.00',
  'Free cancellation until August 28, 2026',
].join('\n');

async function paste(text: string) {
  const user = userEvent.setup();
  // §0.5 bans a modal that could be an inline expansion, so the paste box lives
  // behind a Disclosure and starts collapsed — open it the way a user would.
  await user.click(screen.getByRole('button', { name: /Paste a rate block/ }));
  const textarea = await screen.findByRole('textbox');
  await user.click(textarea);
  await user.paste(text);
  return user;
}

describe('PasteRateBlock — the channel is never assumed', () => {
  it('will not apply until the user names the channel', async () => {
    render(<PasteRateBlock onApply={vi.fn()} />);
    await paste(EDIT_BLOCK);

    // The parse succeeded — the confirmation panel is showing real figures.
    expect(await screen.findByText('$3,540.00')).toBeInTheDocument();

    // But Apply is inert until a channel is chosen. The parser cannot know it,
    // so the app must not pretend to.
    expect(screen.getByRole('button', { name: 'Apply these values' })).toBeDisabled();
  });

  it('asks which channel the rate came from, and says why it matters', async () => {
    render(<PasteRateBlock onApply={vi.fn()} />);
    await paste(EDIT_BLOCK);

    expect(
      await screen.findByText(/Which channel is this rate from\?/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/grants perks and credits the booking never earns/),
    ).toBeInTheDocument();
  });

  /**
   * The "an OTA paste arrives as OTA, not as The Edit" pass-through assertion
   * lives in the Playwright suite (`e2e/compare-and-decide.spec.ts`), not here:
   * Radix Select portals its listbox and relies on pointer-capture APIs jsdom
   * does not implement, so its options can never be opened in this
   * environment. A test that cannot run is worse than one that lives where it
   * can. The safety-critical half — that Apply is inert until a channel is
   * named — is asserted above and does run here.
   */
});

describe('PasteRateBlock — a foreign-currency rate is refused, not converted', () => {
  const YEN_BLOCK = ['Total: ¥120,000', '3 nights', 'Free cancellation'].join('\n');

  it('blocks Apply and explains the exchange-rate consequence', async () => {
    render(<PasteRateBlock onApply={vi.fn()} homeCurrency="USD" />);
    await paste(YEN_BLOCK);

    expect(await screen.findByText(/This rate is in JPY/)).toBeInTheDocument();
    expect(screen.getByText(/wrong by the exchange rate/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply these values' })).toBeDisabled();
  });

  it('does not even offer a channel picker for a rate it will not apply', async () => {
    render(<PasteRateBlock onApply={vi.fn()} homeCurrency="USD" />);
    await paste(YEN_BLOCK);

    await screen.findByText(/This rate is in JPY/);
    expect(screen.queryByRole('combobox', { name: /Which channel/ })).not.toBeInTheDocument();
  });

  it('accepts the same rate when it matches the home currency', async () => {
    render(<PasteRateBlock onApply={vi.fn()} homeCurrency="JPY" />);
    await paste(YEN_BLOCK);

    expect(await screen.findByRole('combobox', { name: /Which channel/ })).toBeInTheDocument();
    expect(screen.queryByText(/This rate is in JPY/)).not.toBeInTheDocument();
  });

});

describe('PasteRateBlock — §13.3’s confirmation rule', () => {
  it('shows nothing to confirm for a block with no money in it', async () => {
    render(<PasteRateBlock onApply={vi.fn()} />);
    await paste('Prices shown in $');

    expect(
      await screen.findByText(/needs at least a total or a room rate/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply these values' })).not.toBeInTheDocument();
  });

  it('names every field it could not read rather than guessing', async () => {
    render(<PasteRateBlock onApply={vi.fn()} />);
    await paste('Total: $500.00');

    expect(await screen.findByText(/Not found, so you will need to enter/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing here is guessed\./)).toBeInTheDocument();
  });

  it('shows the source text each figure came from', async () => {
    render(<PasteRateBlock onApply={vi.fn()} />);
    await paste(EDIT_BLOCK);

    expect(await screen.findByText(/from “Total: \$3,540\.00”/)).toBeInTheDocument();
  });
});
