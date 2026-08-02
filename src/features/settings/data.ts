import type { SavedComparisonSummary } from './sensitivity';
import { DEFAULT_USER_SETTINGS, type CardView, type UserSettingsView } from './types';

/**
 * Server-only data loaders for `/settings` and `/settings/rules`.
 *
 * Every export here is a plain read, imported exactly once from
 * `src/app/(app)/settings/page.tsx` (a server component). Following the
 * `db`-import convention already established at `src/app/(app)/compare/page.tsx`
 * and `src/app/(app)/layout.tsx`'s `loadBadges`: `db.ts` throws at *module
 * evaluation* if `DATABASE_URL` is unset (see its own docstring), so every
 * function here dynamically `import()`s the persistence layer instead of a
 * static top-level import — that is what makes the page's own `try/catch`
 * around each call actually able to catch a missing database rather than
 * crashing before the function body ever runs.
 *
 * This module does not itself write to `src/infrastructure/persistence/**` —
 * it only imports what already exists there (`db`, `schema`, `drizzle-orm`
 * helpers), consistent with this feature owning `src/features/settings/**`
 * and nothing outside it.
 */

export async function loadUserSettings(userId: string | undefined): Promise<UserSettingsView> {
  if (!userId) return DEFAULT_USER_SETTINGS;

  const { db } = await import('@/infrastructure/persistence/db');
  const { userSettings } = await import('@/infrastructure/persistence/schema');
  const { eq } = await import('drizzle-orm');

  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_USER_SETTINGS;

  return {
    mrValueMicro: row.mrValueMicro,
    urValueMicro: row.urValueMicro,
    breakfastPerDayCents: row.breakfastPerDayCents,
    foraRateBps: row.foraRateBps,
    foraMember: row.foraMember,
    cardmemberAnniversary: row.cardmemberAnniversary,
    homeCurrency: row.homeCurrency,
    timezone: row.timezone,
  };
}

export async function loadCards(userId: string | undefined): Promise<readonly CardView[]> {
  if (!userId) return [];

  const { db } = await import('@/infrastructure/persistence/db');
  const { cards } = await import('@/infrastructure/persistence/schema');
  const { eq, asc } = await import('drizzle-orm');

  const rows = await db
    .select()
    .from(cards)
    .where(eq(cards.userId, userId))
    .orderBy(asc(cards.createdAt));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    nickname: row.nickname,
    active: row.active,
  }));
}

/**
 * Loads every saved comparison plus its quotes, reconstructed into engine
 * inputs — the raw material for the §7.8 sensitivity readout.
 *
 * A comparison's own `resultSnapshot` carries the winner it had *at save
 * time*; `winnerOf` (pure, from the ranking module) re-derives that same
 * winner from the snapshot without touching the database again or re-running
 * the full engine. Only the candidate-valuation recompute — done later, in
 * `sensitivity.ts`, against the user's live MR/UR inputs — needs the
 * reconstructed `quotes`.
 *
 * Capped at 200 comparisons and comparisons with fewer than two quotes are
 * dropped: §8.7 sensitivity is meaningless with nothing to rank against, and
 * an unbounded scan would make the settings page's live slider pay for a
 * table scan on every keystroke of an unrelated user's history.
 */
export async function loadSavedComparisonsForSensitivity(
  userId: string | undefined,
): Promise<readonly SavedComparisonSummary[]> {
  if (!userId) return [];

  const { db } = await import('@/infrastructure/persistence/db');
  const { comparisons, quotes } = await import('@/infrastructure/persistence/schema');
  const { eq, inArray, desc } = await import('drizzle-orm');
  const { winnerOf } = await import('@/domain/engine/ranking');
  const { cents } = await import('@/domain/shared/cents');

  const comparisonRows = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.userId, userId))
    .orderBy(desc(comparisons.createdAt))
    .limit(200);

  if (comparisonRows.length === 0) return [];

  const comparisonIds = comparisonRows.map((row) => row.id);
  const quoteRows = await db.select().from(quotes).where(inArray(quotes.comparisonId, comparisonIds));

  const quotesByComparison = new Map<string, typeof quoteRows>();
  for (const quoteRow of quoteRows) {
    const bucket = quotesByComparison.get(quoteRow.comparisonId);
    if (bucket) bucket.push(quoteRow);
    else quotesByComparison.set(quoteRow.comparisonId, [quoteRow]);
  }

  const summaries: SavedComparisonSummary[] = [];

  for (const row of comparisonRows) {
    const relatedQuotes = (quotesByComparison.get(row.id) ?? [])
      .slice()
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map((quoteRow) => ({
        channel: quoteRow.channel,
        totalCents: cents(quoteRow.totalCents),
        prepaid: quoteRow.prepaid,
        refundable: quoteRow.refundable,
        ...(quoteRow.label ? { label: quoteRow.label } : {}),
      }));

    // Fewer than two channels: nothing for a "winner" to be relative to.
    if (relatedQuotes.length < 2) continue;

    summaries.push({
      id: row.id,
      propertyLabel: row.propertyNameSnapshot,
      originalWinner: winnerOf(row.resultSnapshot)?.channel ?? null,
      context: row.contextSnapshot,
      quotes: relatedQuotes,
    });
  }

  return summaries;
}
