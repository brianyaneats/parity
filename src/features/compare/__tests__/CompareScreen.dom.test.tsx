import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompareScreen, type PropertyOption } from '../CompareScreen';
import type { BucketAvailabilitySnapshot } from '@/domain/credit/CreditBucketResolution';
import { cents } from '@/domain/shared/cents';

/**
 * Product-review defects C, D and E, all in `CompareScreen` itself (Defect
 * A's own fix is exercised through the SPA/RESORT default and the bucket
 * toggles' initial values below; Defect B's create-row lives in
 * `src/components/ui/__tests__/Combobox.test.tsx`, since it is a generic
 * primitive behaviour, not something specific to this screen).
 */

// cmdk (the Property combobox's listbox) touches `ResizeObserver` and
// scrolls the highlighted row into view — neither exists in jsdom. Same
// no-op stubs as `Combobox.test.tsx`.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};

// `savePropertyOverride` is a Server Action (`'use server'`); none of these
// tests exercise the free-text create path, but mocking it keeps the module
// graph honest and matches `PropertiesScreen.dom.test.tsx`'s own convention
// for this exact action.
vi.mock('@/features/properties/actions', () => ({ savePropertyOverride: vi.fn() }));

afterEach(cleanup);

const BUCKETS: BucketAvailabilitySnapshot = {
  amexBucketAvailable: true,
  amexRemainingCents: cents(30_000),
  editBucketAvailable: true,
  editRemainingCents: cents(25_000),
};

const property = (over: Partial<PropertyOption> & Pick<PropertyOption, 'id' | 'name'>): PropertyOption => ({
  city: '',
  brand: 'NONE',
  inFhr: false,
  inThc: false,
  inEdit: false,
  propertyCreditFaceCents: 10_000,
  propertyCreditKind: 'ANY',
  ...over,
});

const PROPERTIES: readonly PropertyOption[] = [
  property({ id: 'spa-1', name: 'Spa Resort One', inFhr: true, propertyCreditKind: 'SPA' }),
  property({ id: 'spa-2', name: 'Spa Resort Two', inFhr: true, propertyCreditKind: 'SPA' }),
  property({ id: 'dining-1', name: 'Dining Hotel', inEdit: true, propertyCreditKind: 'DINING' }),
];

function renderScreen() {
  return render(
    <CompareScreen
      properties={PROPERTIES}
      initialBucketAvailability={BUCKETS}
      bucketAvailabilityKnown
      currentYear={2031}
    />,
  );
}

async function selectProperty(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Property' }));
  // Not `getByRole('combobox')`: once a property with any programme
  // membership is selected, each pre-filled quote row's own Channel `Select`
  // trigger *also* carries `role="combobox"` (Radix's own default), so that
  // query stops being unique from the second selection on. The cmdk search
  // input's placeholder is not overridden by `CompareScreen` and stays
  // unique to the property popover.
  await user.type(screen.getByPlaceholderText('Search…'), name);
  await user.click(await screen.findByText(name));
}

/** The realization %, breakfast, MR/UR and bucket fields live behind §7.3
 * item 6's "collapsed by default" Assumptions disclosure. */
async function openAssumptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Assumptions' }));
}

describe('CompareScreen — Defect C: SPA/RESORT realization default', () => {
  it('starts at the ordinary 100% default with no property selected', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openAssumptions(user);
    expect(screen.getByLabelText('Property credit realization %')).toHaveValue('100');
  });

  it('auto-defaults to 60% the moment a SPA property is selected, untouched', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openAssumptions(user);
    await selectProperty(user, 'Spa Resort One');

    expect(screen.getByLabelText('Property credit realization %')).toHaveValue('60');
  });

  it('leaves the ordinary 100% default alone for a DINING property', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openAssumptions(user);
    await selectProperty(user, 'Dining Hotel');

    expect(screen.getByLabelText('Property credit realization %')).toHaveValue('100');
  });

  it('never overrides a value the user has already touched, even across later property changes', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openAssumptions(user);

    await selectProperty(user, 'Spa Resort One');
    const input = screen.getByLabelText('Property credit realization %');
    expect(input).toHaveValue('60');

    // The user takes manual control of the figure.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '85' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('85');

    // A second SPA property would auto-default to 60% too, on an untouched
    // field — the defect this guards is exactly that a later selection must
    // not silently claw the user's own 85% back down to it.
    await selectProperty(user, 'Spa Resort Two');
    expect(screen.getByLabelText('Property credit realization %')).toHaveValue('85');
  });
});

describe('CompareScreen — Defect D: the tax-rate calculator carries its total to a quote row', () => {
  it('fills the first empty quote row when "use as a quote total" is pressed', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'Add channel' }));

    await user.click(screen.getByRole('button', { name: 'Compute from a total' }));
    const base = screen.getByLabelText('Base rate') as HTMLInputElement;
    const total = screen.getByLabelText('Total') as HTMLInputElement;
    fireEvent.focus(base);
    fireEvent.change(base, { target: { value: '1000' } });
    fireEvent.blur(base);
    fireEvent.focus(total);
    fireEvent.change(total, { target: { value: '1200' } });
    fireEvent.blur(total);

    // The bps button surfaces the derived rate — the calculator's existing
    // behaviour, unaffected by this defect's fix.
    expect(screen.getByRole('button', { name: /^Use \d+\.\d\d%$/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /Also use \$1,200\.00 as a quote total/ }));

    expect(screen.getByLabelText('Total, including tax')).toHaveValue('$1,200.00');
  });

  it('is disabled until a total has been entered, and names what to do', () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Compute from a total' }));

    expect(screen.getByRole('button', { name: 'Enter a total to reuse it' })).toBeDisabled();
  });
});

describe('CompareScreen — Defect E: assumeYear reaches the paste parser', () => {
  it('resolves a yearless date ("Sep 1") using the current year passed from the server page', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /Paste a rate block/ }));
    const textarea = screen.getByPlaceholderText(/Check-in: September 1, 2026/);
    await user.click(textarea);
    await user.paste('Check-in: Sep 1\nTotal: $500.00');

    // `renderScreen` passes `currentYear={2031}` — a value chosen specifically
    // because it can never coincide with the real system clock, so this can
    // only pass if `CompareScreen` actually threaded its `currentYear` prop
    // into `PasteRateBlock`'s `assumeYear`, not some ambient `new Date()`.
    expect(await screen.findByText('2031-09-01')).toBeInTheDocument();
  });
});
