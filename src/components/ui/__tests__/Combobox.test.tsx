import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from '../Combobox';

afterEach(cleanup);

// cmdk's `<Command.List>` measures its own height via `ResizeObserver`, which
// jsdom does not implement. A no-op stub is enough — this suite never asserts
// on layout, only on which rows are present.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;

// cmdk scrolls the highlighted item into view as selection moves, which jsdom
// also does not implement.
Element.prototype.scrollIntoView ??= () => {};

/**
 * Defect B / §7.3 item 1: "free text creates one inline." `onCreate` is a
 * generic addition to this primitive — it knows nothing about properties,
 * only that the current query matched nothing — so it is tested here rather
 * than only through `CompareScreen`.
 */

const OPTIONS: readonly ComboboxOption[] = [
  { value: 'p1', label: 'Four Seasons Tokyo', sublabel: 'Tokyo' },
  { value: 'p2', label: 'Park Hyatt Chicago', sublabel: 'Chicago' },
];

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Property' }));
  return user;
}

describe('Combobox — the create row (Defect B)', () => {
  it('does not appear while there are matching results', async () => {
    render(
      <Combobox label="Property" value={undefined} onChange={vi.fn()} onCreate={vi.fn()} options={OPTIONS} />,
    );
    const user = await open();
    await user.type(screen.getByRole('combobox'), 'Four Seasons');

    expect(screen.getByText('Four Seasons Tokyo')).toBeInTheDocument();
    expect(screen.queryByText(/Create/)).not.toBeInTheDocument();
  });

  it('does not appear without a query, even with zero options', async () => {
    render(<Combobox label="Property" value={undefined} onChange={vi.fn()} onCreate={vi.fn()} options={[]} />);
    await open();

    expect(screen.queryByText(/Create/)).not.toBeInTheDocument();
    expect(screen.getByText('Nothing to search yet.')).toBeInTheDocument();
  });

  it('does not appear when no results and onCreate is not provided', async () => {
    render(<Combobox label="Property" value={undefined} onChange={vi.fn()} options={OPTIONS} />);
    const user = await open();
    await user.type(screen.getByRole('combobox'), 'Nonexistent Hotel');

    expect(screen.queryByText(/Create/)).not.toBeInTheDocument();
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('appears only once there are zero results and onCreate is provided, and hands back the typed text', async () => {
    const onCreate = vi.fn();
    const onChange = vi.fn();
    render(<Combobox label="Property" value={undefined} onChange={onChange} onCreate={onCreate} options={OPTIONS} />);
    const user = await open();
    await user.type(screen.getByRole('combobox'), 'The Ritz-Carlton Nonexistent');

    const createRow = await screen.findByText('Create “The Ritz-Carlton Nonexistent”');
    expect(createRow).toBeInTheDocument();

    await user.click(createRow);
    expect(onCreate).toHaveBeenCalledWith('The Ritz-Carlton Nonexistent');
    expect(onChange).not.toHaveBeenCalled();
  });
});
