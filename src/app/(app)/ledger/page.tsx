import { LedgerScreen } from '@/features/ledger/LedgerScreen';
import type { LedgerEventView } from '@/features/ledger/ledger-types';

export const metadata = { title: 'Ledger · Parity' };

/**
 * `/ledger` — §7.7.
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
  const events = await loadEvents();
  return <LedgerScreen events={events} />;
}

async function loadEvents(): Promise<readonly LedgerEventView[]> {
  try {
    const { listSavingsEvents } = await import('@/infrastructure/persistence/queries/ledger');
    return await listSavingsEvents();
  } catch {
    return [];
  }
}
