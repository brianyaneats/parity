import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { cards } from '../schema';
import type { CardKind } from '@/domain/rules/price-match.rules';

/**
 * Which cards a user has actually told Parity they hold — the read side of
 * `/settings`' `CardsSection` (`src/features/settings/SettingsScreen.tsx`),
 * which has written to the `cards` table since it shipped but had nothing
 * downstream reading it back. `CreditWallet` and `CompareScreen` both assumed
 * every caller holds both the Amex Platinum and the Chase Sapphire Reserve —
 * the app's founding assumption, and still the right default for a caller who
 * has configured nothing — but a caller who *has* told Parity they only carry
 * one of the two used to be shown perks and statement credits for a card they
 * do not own.
 *
 * `userId` is required, never optional, for the same reason `credits.ts`
 * gives for its own `listCreditBuckets`: a `cards` row belongs to exactly one
 * user (§4.2's `NOT NULL user_id` FK), so an omitted `userId` here has no
 * honest meaning — there is no seeded/global case the way `properties.ts` has
 * one.
 *
 * Only `active` cards count. `setCardActive` already lets a user mark a card
 * inactive without deleting it (closed, downgraded, whatever the reason) —
 * an inactive card should stop unlocking anything the same way a deleted one
 * would, so this filters it out here rather than asking every caller to
 * re-check `active` itself.
 */
export async function listActiveCards(userId: string): Promise<readonly CardKind[]> {
  const rows = await db
    .select({ kind: cards.kind })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.active, true)));

  return rows.map((row) => row.kind);
}
