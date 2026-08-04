import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { CommandPalette } from '../CommandPalette';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

// cmdk's `<Command.List>` measures its own height via `ResizeObserver`, and
// scrolls the highlighted item into view as selection moves — neither is
// implemented in jsdom. Same stubs `Combobox.test.tsx` uses for the same
// reason.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};

const fetchMock = vi.fn();

beforeEach(() => {
  pushMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderPalette() {
  return render(
    <ToastProvider>
      {/* Not `initialPreference="system"`: ThemeProvider's effect calls
          `window.matchMedia` whenever the preference is `system`, which
          jsdom doesn't implement. An explicit preference skips that branch
          entirely (see the early return in ThemeProvider.tsx). */}
      <ThemeProvider initialPreference="dark" initialResolved="dark">
        <CommandPalette />
      </ThemeProvider>
    </ToastProvider>,
  );
}

async function openWithCmdK() {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  return screen.findByRole('dialog', { name: 'Command palette' });
}

describe('<CommandPalette />', () => {
  it('is closed until ⌘K/Ctrl+K is pressed', () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on ⌘K and again on Ctrl+K after closing', async () => {
    renderPalette();
    await openWithCmdK();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('lists all eight sections as "Go to" commands', async () => {
    renderPalette();
    await openWithCmdK();

    for (const label of [
      'Compare',
      'Claims',
      'Credits',
      'Trips',
      'Watchlist',
      'Ledger',
      'Properties',
      'Settings',
    ]) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('lists theme switching and sign out commands', async () => {
    renderPalette();
    await openWithCmdK();

    expect(screen.getByRole('option', { name: /^System/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^Light/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^Dark/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('navigates and closes the palette when a nav command is selected', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithCmdK();

    await user.click(screen.getByRole('option', { name: 'Claims' }));

    expect(pushMock).toHaveBeenCalledWith('/claims');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    renderPalette();
    await openWithCmdK();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
