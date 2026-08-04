import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui';
import { PropertiesScreen } from '../PropertiesScreen';
import type { PropertyOption } from '@/features/compare/CompareScreen';

/**
 * §7.8: "the user's own edits shadow seeds rather than mutating them." These
 * tests exercise the inline editor's UI contract — it always calls
 * `savePropertyOverride` (mocked here) rather than any seed-mutating path,
 * and degrades to a visible inline error rather than crashing when that
 * action reports failure.
 *
 * `vi.hoisted` is required for the mock function referenced inside
 * `vi.mock`'s factory: Vitest hoists `vi.mock` calls above the rest of the
 * module, so a plain `const saveMock = vi.fn()` declared below it would not
 * yet exist when the factory runs.
 */

const { saveMock, pushMock } = vi.hoisted(() => ({ saveMock: vi.fn(), pushMock: vi.fn() }));

vi.mock('../actions', () => ({ savePropertyOverride: saveMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: pushMock }) }));

afterEach(() => {
  cleanup();
  saveMock.mockReset();
  pushMock.mockReset();
});

const properties: readonly PropertyOption[] = [
  {
    id: '1',
    name: 'Four Seasons Tokyo',
    city: 'Tokyo',
    brand: 'NONE',
    inFhr: true,
    inThc: false,
    inEdit: true,
    propertyCreditFaceCents: 10_000,
    propertyCreditKind: 'DINING',
  },
  {
    id: '2',
    name: 'Park Hyatt Chicago',
    city: 'Chicago',
    brand: 'HYATT',
    inFhr: false,
    inThc: false,
    inEdit: true,
    propertyCreditFaceCents: 10_000,
    propertyCreditKind: 'ANY',
  },
];

function renderScreen() {
  return render(
    <ToastProvider>
      <PropertiesScreen properties={properties} signedIn />
    </ToastProvider>,
  );
}

describe('<PropertiesScreen />', () => {
  it('renders every property by name', () => {
    renderScreen();
    expect(screen.getByText('Four Seasons Tokyo')).toBeInTheDocument();
    expect(screen.getByText('Park Hyatt Chicago')).toBeInTheDocument();
  });

  it('filters to matches on name or city as the user searches', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText('Search properties'), 'chicago');

    expect(screen.queryByText('Four Seasons Tokyo')).not.toBeInTheDocument();
    expect(screen.getByText('Park Hyatt Chicago')).toBeInTheDocument();
  });

  it('shows a no-match empty state for a search with no results', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText('Search properties'), 'nonexistent hotel');

    expect(screen.getByText('No properties match your search.')).toBeInTheDocument();
  });

  it('renders a truly-empty state with an action back to /compare when there are no properties at all', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PropertiesScreen properties={[]} signedIn />
      </ToastProvider>,
    );

    expect(screen.getByText(/no properties saved/i)).toBeInTheDocument();
    // The search box only makes sense once there is something to search.
    expect(screen.queryByLabelText('Search properties')).not.toBeInTheDocument();

    const action = screen.getByRole('button', { name: 'Compare a stay' });
    await user.click(action);
    expect(pushMock).toHaveBeenCalledWith('/compare');
  });

  it('opens the inline editor pre-filled with the property’s current values and saves an override', async () => {
    saveMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderScreen();

    const row = screen.getByText('Four Seasons Tokyo').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    expect(screen.getByText('Editing Four Seasons Tokyo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save as my override' }));

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Four Seasons Tokyo', inFhr: true, inEdit: true, inThc: false }),
    );
  });

  it('shows an inline error and does not crash when the save action reports failure', async () => {
    saveMock.mockResolvedValue({ ok: false, message: 'Could not reach the database.' });
    const user = userEvent.setup();
    renderScreen();

    const row = screen.getByText('Park Hyatt Chicago').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save as my override' }));

    // The same message also appears in a toast; scope to the inline `role="alert"`
    // element the edit Card renders, which is the one under test here.
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the database.');
  });
});
