import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { ChannelBarList } from '../ChannelBar';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import type { Cents } from '@/domain/shared/cents';
import type { StayContext } from '@/domain/engine/types';

afterEach(cleanup);

const CENTS = (n: number) => n as Cents;
const engine = new SavingsEngine({ includeSensitivity: false });

const context: StayContext = {
  nights: 3,
  taxRateBps: 1240,
  breakfastPerDayCents: CENTS(7_000),
  propertyCreditFaceCents: CENTS(10_000),
  realizationPct: 100,
  mrValueMicro: 15_000,
  urValueMicro: 17_500,
  foraRateBps: 700,
  amexBucketAvailable: true,
  editBucketAvailable: true,
  competitorBaseCents: CENTS(300_000),
  competitorRefundable: true,
  competitorPublic: true,
  brand: 'NONE',
};

/** TC-01's quote set, so the rendered figures are the spec's own. */
const tc01 = engine.compare({
  context,
  quotes: [
    { channel: 'EDIT', totalCents: CENTS(354_000), prepaid: true, refundable: true },
    { channel: 'FHR', totalCents: CENTS(360_000), prepaid: true, refundable: true },
    { channel: 'OTA', totalCents: CENTS(360_000), prepaid: true, refundable: true },
  ],
});

describe('ChannelBarList — §8.1', () => {
  it('renders one row per quote in ranked order', () => {
    render(<ChannelBarList ranked={tc01.ranked} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Chase The Edit');
  });

  it('prints the exact effective net from the fixture', () => {
    render(<ChannelBarList ranked={tc01.ranked} />);
    expect(screen.getByText('$2,390.86')).toBeInTheDocument(); // EDIT  239086
    expect(screen.getByText('$2,720.00')).toBeInTheDocument(); // FHR   272000
    expect(screen.getByText('$3,564.00')).toBeInTheDocument(); // OTA   356400
  });

  it('marks the winner with a BEST pill and no delta', () => {
    render(<ChannelBarList ranked={tc01.ranked} />);
    expect(screen.getByText('BEST')).toBeInTheDocument();
    expect(screen.getByText('Best option')).toBeInTheDocument();
  });

  it('shows each loser’s delta against the winner', () => {
    render(<ChannelBarList ranked={tc01.ranked} />);
    // FHR 272000 − EDIT 239086 = 32914
    expect(screen.getByText('+$329.14')).toBeInTheDocument();
  });

  it('describes the bar for screen readers, including the refund', () => {
    render(<ChannelBarList ranked={tc01.ranked} />);
    // §6.7: the bar is decorative geometry; the number has to reach a
    // screen reader some other way.
    expect(
      screen.getByLabelText(/Effective net \$2,390\.86, after an estimated \$149\.47/),
    ).toBeInTheDocument();
  });

  it('renders nothing for an empty comparison', () => {
    const { container } = render(<ChannelBarList ranked={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ChannelBar — the traceability requirement, §7.3', () => {
  it('hides the breakdown until asked', () => {
    render(<ChannelBarList ranked={tc01.ranked} />);
    expect(screen.queryByText('Base rate')).not.toBeInTheDocument();
  });

  it('reveals every input to the figure on expand', async () => {
    const user = userEvent.setup();
    render(<ChannelBarList ranked={tc01.ranked} />);

    const buttons = screen.getAllByRole('button', { name: 'Show breakdown' });
    await user.click(buttons[0] as HTMLElement);

    // §7.3: "Every figure in the results column is traceable."
    expect(screen.getByText('$3,540.00')).toBeInTheDocument();     // sticker
    expect(screen.getByText('$3,149.47')).toBeInTheDocument();     // base
    expect(screen.getByText('$390.53')).toBeInTheDocument();       // tax
    expect(screen.getByText('− $310.00')).toBeInTheDocument();     // perks
    expect(screen.getByText('− $250.00')).toBeInTheDocument();     // credit kept
    expect(screen.getByText('− $439.67')).toBeInTheDocument();     // points
    expect(screen.getByText('− $149.47')).toBeInTheDocument();     // refund
  });

  it('labels tax as never refundable', async () => {
    const user = userEvent.setup();
    render(<ChannelBarList ranked={tc01.ranked} />);
    await user.click(screen.getAllByRole('button', { name: 'Show breakdown' })[0] as HTMLElement);
    expect(screen.getByText('Never refunded by any programme')).toBeInTheDocument();
  });

  it('never promises the refund it estimates', async () => {
    const user = userEvent.setup();
    render(<ChannelBarList ranked={tc01.ranked} />);
    await user.click(screen.getAllByRole('button', { name: 'Show breakdown' })[0] as HTMLElement);
    // §12 forbids stating a refund as guaranteed.
    expect(screen.getByText('An estimate — partial approval is common')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/guaranteed/i);
  });

  it('is keyboard operable and reports its expanded state', async () => {
    const user = userEvent.setup();
    render(<ChannelBarList ranked={tc01.ranked} />);

    const toggle = screen.getAllByRole('button', { name: 'Show breakdown' })[0] as HTMLElement;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getAllByRole('button', { name: 'Hide breakdown' })[0]).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

/**
 * §3.6: "the engine returns the true negative number; the UI clamps the *bar
 * length* at zero but prints the true value." TC-05 is the fixture that nets
 * −$240.00.
 */
describe('ChannelBar — a negative effective net, §3.6', () => {
  const tc05 = engine.compare({
    context: { ...context, nights: 2, competitorBaseCents: CENTS(13_350) },
    quotes: [{ channel: 'EDIT', totalCents: CENTS(40_000), prepaid: true, refundable: true }],
  });

  it('prints the true negative value as money back, not as a negative price', () => {
    render(<ChannelBarList ranked={tc05.ranked} />);
    expect(screen.getByText('$240.00 back')).toBeInTheDocument();
  });

  it('clamps the bar geometry at zero without touching the printed figure', () => {
    const { container } = render(<ChannelBarList ranked={tc05.ranked} />);
    const bar = container.querySelector('[style*="width"]') as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe('0%');
    expect(screen.getByText('$240.00 back')).toBeInTheDocument();
  });

  it('surfaces the clawback in the breakdown', async () => {
    const user = userEvent.setup();
    render(<ChannelBarList ranked={tc05.ranked} />);
    await user.click(screen.getByRole('button', { name: 'Show breakdown' }));
    expect(screen.getByText('$72.37 clawed back')).toBeInTheDocument();
  });
});

describe('ChannelBar — duplicate channels, §3.6', () => {
  it('labels repeats by index rather than deduping them', () => {
    const duplicated = engine.compare({
      context,
      quotes: [
        { channel: 'EDIT', totalCents: CENTS(354_000), prepaid: true, refundable: true },
        { channel: 'EDIT', totalCents: CENTS(360_000), prepaid: true, refundable: true },
      ],
    });

    render(<ChannelBarList ranked={duplicated.ranked} />);
    expect(screen.getByText('Chase The Edit (1)')).toBeInTheDocument();
    expect(screen.getByText('Chase The Edit (2)')).toBeInTheDocument();
  });
});
