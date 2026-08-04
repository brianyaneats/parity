import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { LedgerScreen } from '@/features/ledger/LedgerScreen';
import type { LedgerEventView } from '@/features/ledger/ledger-types';

export const metadata = { title: 'Ledger · Parity' };

/**
 * `/ledger` — §7.7.
 *
 * Session first, outside the try/catch (`redirect()` throws); the data load
 * is scoped to the session's user by `listSavingsEvents`'s required
 * parameter — the ledger is the app's most sensitive screen, a money trail
 * of where the user has been sleeping.
 *
 * Loaded server-side, same resilience pattern as `/compare`
 * (`src/app/(app)/compare/page.tsx`): a dynamic import inside `try/catch` so
 * an unreachable or unconfigured database degrades to an empty ledger
 * instead of a broken page. The task brief is explicit that this fallback is
 * not a rare edge case here — "the DB is empty in dev, so the empty state is
 * what will actually render" — so `LedgerScreen` is built to render a
 * genuinely useful screen (all six sources, both stat tiles, both chart
 * views) at zero events rather than a single blank message.
 */
export default async function LedgerPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const events = await loadEvents(session.userId);
  return <LedgerScreen events={events} />;
}

async function loadEvents(userId: string): Promise<readonly LedgerEventView[]> {
  try {
    const { listSavingsEvents } = await import('@/infrastructure/persistence/queries/ledger');
    return await listSavingsEvents(userId);
  } catch {
    return [];
  }
}
