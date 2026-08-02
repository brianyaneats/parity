import type { CardKind } from '@/domain/rules/price-match.rules';
import { DEFAULT_MR_VALUE_MICRO, DEFAULT_UR_VALUE_MICRO } from '@/domain/rules/points.rules';
import { DEFAULT_BREAKFAST_PER_DAY_CENTS } from '@/domain/rules/perks.rules';
import { DEFAULT_FORA_RATE_BPS } from '@/domain/rules/fora.rules';

/**
 * Pure types for `/settings` — no database import here, on purpose.
 *
 * This module is imported by both the server-only loader (`data.ts`) and the
 * `'use client'` screen (`SettingsScreen.tsx`). Keeping it free of `db`/`schema`
 * imports means the client bundle never has a reason to pull in `postgres` —
 * a server-only dependency has no business in a browser bundle, and a stray
 * value import (as opposed to `import type`) from a DB-touching module is
 * exactly how that happens by accident.
 */

/** Mirrors `user_settings`, minus the columns the screen doesn't manage directly (`userId`, timestamps, `theme` — the last owned by `ThemeToggle`/`ThemeProvider`). */
export interface UserSettingsView {
  readonly mrValueMicro: number;
  readonly urValueMicro: number;
  readonly breakfastPerDayCents: number;
  readonly foraRateBps: number;
  readonly foraMember: boolean;
  /** ISO date (`YYYY-MM-DD`), or `null` if never set. */
  readonly cardmemberAnniversary: string | null;
  readonly homeCurrency: string;
  readonly timezone: string;
}

/** §2.5 / §2.6 / §2.7 defaults — the same figures `user_settings` itself defaults to in the schema, reused rather than re-guessed. */
export const DEFAULT_USER_SETTINGS: UserSettingsView = Object.freeze({
  mrValueMicro: DEFAULT_MR_VALUE_MICRO,
  urValueMicro: DEFAULT_UR_VALUE_MICRO,
  breakfastPerDayCents: DEFAULT_BREAKFAST_PER_DAY_CENTS,
  foraRateBps: DEFAULT_FORA_RATE_BPS,
  foraMember: false,
  cardmemberAnniversary: null,
  homeCurrency: 'USD',
  timezone: 'America/New_York',
});

export interface CardView {
  readonly id: string;
  readonly kind: CardKind;
  readonly nickname: string | null;
  readonly active: boolean;
}

/**
 * The full set of `card_kind` enum values. Hand-written rather than derived,
 * mirroring schema.ts's own `CARD_KIND_VALUES` — `pgEnum`/`z.enum` both need a
 * literal tuple, not a `type` union, at runtime. `AssertCardKindsCovered`
 * below fails the build instead of silently drifting if the domain type ever
 * gains or loses a member.
 */
export const CARD_KIND_VALUES = [
  'AMEX_PLATINUM',
  'CSR',
  'CSR_BUSINESS',
  'JPM_RESERVE',
  'OTHER',
] as const satisfies readonly CardKind[];

type AssertNever<T extends never> = T;
export type AssertCardKindsCovered = AssertNever<Exclude<CardKind, (typeof CARD_KIND_VALUES)[number]>>;

export const CARD_KIND_LABELS: Readonly<Record<CardKind, string>> = Object.freeze({
  AMEX_PLATINUM: 'American Express Platinum',
  CSR: 'Chase Sapphire Reserve',
  CSR_BUSINESS: 'Chase Sapphire Reserve for Business',
  JPM_RESERVE: 'J.P. Morgan Reserve',
  OTHER: 'Other',
});

/** Discriminated result every settings/cards server action returns, so the client never has to `try/catch` a thrown error to render feedback. */
export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly message: string };
