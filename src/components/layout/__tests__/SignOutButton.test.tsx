import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui';
import { SignOutButton } from '../SignOutButton';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/**
 * `window.location.assign` isn't reassignable on jsdom's real `Location`
 * object, so the whole `location` property is replaced with a stub for the
 * duration of each test — the same shape `AccountDataSection.tsx` drives
 * with `window.location.assign('/login')` after account deletion.
 */
function stubLocationAssign() {
  const assign = vi.fn();
  const original = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, assign },
  });
  return {
    assign,
    restore: () => {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    },
  };
}

function renderButton() {
  return render(
    <ToastProvider>
      <SignOutButton />
    </ToastProvider>,
  );
}

describe('<SignOutButton />', () => {
  it('POSTs to /api/auth/logout and hard-navigates to /login on success', async () => {
    const user = userEvent.setup();
    const location = stubLocationAssign();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);

    renderButton();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('/login'));

    location.restore();
  });

  it('disables the button while the request is in flight', async () => {
    const user = userEvent.setup();
    const location = stubLocationAssign();
    let resolveFetch!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderButton();
    const button = screen.getByRole('button', { name: 'Sign out' });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as Response);
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('/login'));

    location.restore();
  });

  it('re-enables the button and does not navigate when the request fails', async () => {
    const user = userEvent.setup();
    const location = stubLocationAssign();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    renderButton();
    const button = screen.getByRole('button', { name: 'Sign out' });
    await user.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    expect(location.assign).not.toHaveBeenCalled();
    expect(await screen.findByText('Could not sign out')).toBeInTheDocument();

    location.restore();
  });
});
