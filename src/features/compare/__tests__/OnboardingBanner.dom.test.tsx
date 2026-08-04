import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingBanner } from '../OnboardingBanner';

/**
 * `/compare`'s first-run banner. `createSampleComparison`/`dismissOnboarding`
 * are Server Actions (`'use server'`); mocked here the same way
 * `PropertiesScreen.dom.test.tsx` mocks `savePropertyOverride` — `vi.hoisted`
 * because `vi.mock`'s factory runs before any `const` below it would exist.
 */

const { createSampleMock, dismissMock, pushMock, refreshMock } = vi.hoisted(() => ({
  createSampleMock: vi.fn(),
  dismissMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('../onboardingActions', () => ({
  createSampleComparison: createSampleMock,
  dismissOnboarding: dismissMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  createSampleMock.mockReset();
  dismissMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

describe('OnboardingBanner', () => {
  it('names the 60-second loop and offers the sample action', () => {
    render(<OnboardingBanner />);
    expect(screen.getByText(/60 seconds/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load a sample comparison' })).toBeInTheDocument();
  });

  it('navigates to the new comparison once the sample is created', async () => {
    const user = userEvent.setup();
    createSampleMock.mockResolvedValue({ ok: true, comparisonId: 'cmp-1' });
    render(<OnboardingBanner />);

    await user.click(screen.getByRole('button', { name: 'Load a sample comparison' }));

    expect(createSampleMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/compare/cmp-1');
  });

  it('shows the action failure inline instead of navigating', async () => {
    const user = userEvent.setup();
    createSampleMock.mockResolvedValue({
      ok: false,
      message: 'Could not reach the database. The sample comparison was not created — try again shortly.',
    });
    render(<OnboardingBanner />);

    await user.click(screen.getByRole('button', { name: 'Load a sample comparison' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the database');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('hides itself immediately once dismissed, without waiting on the server action', async () => {
    const user = userEvent.setup();
    dismissMock.mockResolvedValue({ ok: true });
    render(<OnboardingBanner />);

    await user.click(screen.getByRole('button', { name: 'Dismiss the welcome banner' }));

    expect(screen.queryByText(/60 seconds/)).not.toBeInTheDocument();
    expect(dismissMock).toHaveBeenCalledTimes(1);
  });
});
