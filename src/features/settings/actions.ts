'use server';

import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { CARD_KIND_VALUES, type ActionResult } from './types';

/**
 * Server actions backing `/settings`. Every write lives here rather than
 * behind a new `src/app/api/**` route: this file sits inside
 * `src/features/settings/**`, the one path this build owns for writes, and a
 * Next.js Server Action needs no route file of its own — it is just an async
 * function marked `'use server'`, callable directly from the client component.
 *
 * Every action returns `ActionResult` instead of throwing. §7.8/§6.4 require
 * every screen to have a real error state, and a thrown server-action error
 * surfaces as an opaque framework error overlay rather than the inline
 * message the settings screen is built to show — converting failures
 * (validation, no session, unreachable database) into a value keeps the
 * screen in control of how it degrades.
 */

const settingsInputSchema = z.object({
  mrValueMicro: z.number().int('must be a whole number of micro-cents').min(0),
  urValueMicro: z.number().int('must be a whole number of micro-cents').min(0),
  breakfastPerDayCents: z.number().int().min(0),
  foraRateBps: z.number().int().min(0).max(10_000),
  foraMember: z.boolean(),
  cardmemberAnniversary: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date')
    .nullable(),
  homeCurrency: z
    .string()
    .trim()
    .length(3, 'must be a 3-letter currency code')
    .toUpperCase(),
  timezone: z.string().trim().min(1, 'is required'),
});

export type SettingsActionInput = z.infer<typeof settingsInputSchema>;

export async function updateUserSettings(input: SettingsActionInput): Promise<ActionResult> {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Some values need fixing.' };
  }

  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to save your settings.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { userSettings } = await import('@/infrastructure/persistence/schema');

    const values = { userId: session.userId, ...parsed.data, updatedAt: new Date() };

    await db
      .insert(userSettings)
      .values(values)
      .onConflictDoUpdate({ target: userSettings.userId, set: values });

    return { ok: true };
  } catch {
    // A degraded database must not crash the settings screen — it should say
    // plainly that nothing was saved so the user doesn't assume it was.
    return { ok: false, message: 'Could not reach the database. Your settings were not saved — try again shortly.' };
  }
}

const cardInputSchema = z.object({
  kind: z.enum(CARD_KIND_VALUES),
  nickname: z.string().trim().max(60).optional(),
});

export type CardActionInput = z.infer<typeof cardInputSchema>;

export async function addCard(input: CardActionInput): Promise<ActionResult> {
  const parsed = cardInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Some values need fixing.' };
  }

  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to add a card.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { cards } = await import('@/infrastructure/persistence/schema');

    await db.insert(cards).values({
      userId: session.userId,
      kind: parsed.data.kind,
      nickname: parsed.data.nickname ?? null,
    });

    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the database. The card was not added.' };
  }
}

export async function setCardActive(cardId: string, active: boolean): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to change a card.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { cards } = await import('@/infrastructure/persistence/schema');
    const { and, eq } = await import('drizzle-orm');

    await db
      .update(cards)
      .set({ active })
      .where(and(eq(cards.id, cardId), eq(cards.userId, session.userId)));

    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the database. The change was not saved.' };
  }
}

export async function removeCard(cardId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to remove a card.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { cards } = await import('@/infrastructure/persistence/schema');
    const { and, eq } = await import('drizzle-orm');

    await db.delete(cards).where(and(eq(cards.id, cardId), eq(cards.userId, session.userId)));

    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the database. The card was not removed.' };
  }
}
