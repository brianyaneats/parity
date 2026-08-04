/**
 * Drizzle schema — Part 4 §4.2 of parity-build-spec.md, translated table for table.
 *
 * House rules from §4.1, applied throughout unless a table's own DDL in §4.2
 * overrides them for a specific column (noted inline where that happens):
 *   - every table's `id` is `uuid primary key default gen_random_uuid()`;
 *   - `createdAt`/`updatedAt` are `timestamptz`, only where §4.2 actually shows them;
 *   - every table except `users` carries a `userId` FK, `ON DELETE CASCADE` unless
 *     §4.2 says otherwise for that column.
 *
 * Column names are explicit snake_case strings (Drizzle does not infer them from the
 * camelCase TS key), so the emitted SQL matches §4.2 byte for byte where §4.2 gives
 * a name.
 *
 * Money is always `integer` cents, never `numeric` or a float — see the project-wide
 * rule at src/domain/shared/cents.ts and §3.1 of the spec.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { StayContext, ChannelResult } from '../../domain/engine/types';
import type { Channel, BrandOrNone } from '../../domain/rules/channels.rules';
import type { CardKind } from '../../domain/rules/price-match.rules';
import type { CreditBucketKey } from '../../domain/rules/credit.rules';
import {
  DEFAULT_BREAKFAST_PER_DAY_CENTS,
  DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
  DEFAULT_REALIZATION_PCT,
  type PropertyCreditKind,
} from '../../domain/rules/perks.rules';
import { DEFAULT_MR_VALUE_MICRO, DEFAULT_UR_VALUE_MICRO } from '../../domain/rules/points.rules';
import { DEFAULT_FORA_RATE_BPS } from '../../domain/rules/fora.rules';
import type { ClaimKind } from '../../domain/claim/Claim';
import { CLAIM_STATUSES, type ClaimStatus } from '../../domain/claim/ClaimStatus';

// ---------------------------------------------------------------------------
// Type-level plumbing
// ---------------------------------------------------------------------------

/**
 * Two-way type equality check. Used below to prove a hand-written literal
 * tuple (which `pgEnum` requires — it cannot accept a `type` union at
 * runtime) still matches a domain-owned union type. If the domain type ever
 * gains or loses a member without this tuple being updated to match, the
 * assignment on the following line fails to compile instead of drifting
 * silently.
 */
type AssertEqual<A, B> = A extends B ? (B extends A ? true : never) : never;

// ---------------------------------------------------------------------------
// Enums — §4.2
// ---------------------------------------------------------------------------

/**
 * §4.2 `card_kind`. Values are owned by `CardKind` in price-match.rules.ts
 * (PM1's eligible-card predicate plus `OTHER`); reused via the `AssertEqual`
 * check below rather than re-derived, per the task's reuse instruction — a
 * literal tuple is unavoidable because `pgEnum` needs one at runtime, but the
 * tuple cannot silently diverge from the domain type.
 */
const CARD_KIND_VALUES = ['AMEX_PLATINUM', 'CSR', 'CSR_BUSINESS', 'JPM_RESERVE', 'OTHER'] as const;
const _cardKindMatchesDomain: AssertEqual<CardKind, (typeof CARD_KIND_VALUES)[number]> = true;
void _cardKindMatchesDomain;

export const cardKindEnum = pgEnum('card_kind', CARD_KIND_VALUES);

/**
 * §4.2 `comparison_status`. Persistence-only lifecycle — the domain engine
 * (§3) is stateless and has no notion of a comparison's workflow state, so
 * there is no existing constant to reuse here.
 */
export const comparisonStatusEnum = pgEnum('comparison_status', [
  'DRAFT',
  'DECIDED',
  'BOOKED',
  'ABANDONED',
]);
export type ComparisonStatus = (typeof comparisonStatusEnum.enumValues)[number];

/** §4.2 `booking_status`. Persistence-only, same reasoning as above. */
export const bookingStatusEnum = pgEnum('booking_status', ['ACTIVE', 'CANCELLED', 'COMPLETED']);
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];

/**
 * §4.2 `claim_status`. Unlike `comparison_status`/`booking_status`, this one
 * *does* have a domain owner: `src/domain/claim/ClaimStatus.ts` holds the
 * claim lifecycle state machine (§7.4) and already exports `CLAIM_STATUSES`
 * as a runtime array. Reused directly — cast to a non-empty tuple only
 * because `pgEnum` needs one, not because the values are re-derived.
 */
export const claimStatusEnum = pgEnum('claim_status', CLAIM_STATUSES as unknown as [ClaimStatus, ...ClaimStatus[]]);

// ---------------------------------------------------------------------------
// Persistence-local unions
// ---------------------------------------------------------------------------

/** §4.2 `user_settings.theme` comment: `'system'|'light'|'dark'`. */
export type ThemePreference = 'system' | 'light' | 'dark';

// §4.2 `properties.property_credit_kind` comment: `'DINING','SPA','RESORT','ANY'` — this
// is `PropertyCreditKind` from perks.rules.ts (imported above), not redeclared here.

// §4.2 `claims.kind` comment: `'CHASE_PM' | 'AMEX_LRG' | 'BRG_HILTON' | ...` — this is
// `ClaimKind` from src/domain/claim/Claim.ts (imported above), the `Claim` aggregate's
// own props type, not redeclared here.

/** §4.2 `savings_events.kind` comment — a closed list, unlike `claims.kind`. */
export type SavingsEventKind = 'CHANNEL_CHOICE' | 'PRICE_MATCH' | 'CREDIT_BURNED' | 'BRG' | 'RESHOP' | 'PERK';

// ---------------------------------------------------------------------------
// Auth.js standard tables
// ---------------------------------------------------------------------------
//
// §4.2 names these four tables but gives no DDL for them ("-- auth (Auth.js
// standard tables...) --" is a bare comment) — Auth.js's Drizzle adapter
// dictates their shape instead. That contract fixes `accounts`' primary key
// to the (provider, providerAccountId) pair, `sessions`' to `sessionToken`,
// and `verificationTokens`' to (identifier, token); none of the three has a
// synthetic `id`, so the "every table gets a uuid id" rule in §4.1 does not
// apply to them — following it here would break the adapter contract these
// tables exist to satisfy. `users.id` MUST be `uuid`, though: every other
// table's `user_id` column is declared `uuid ... REFERENCES users(id)`, and
// Postgres cannot FK a uuid column to a non-uuid primary key.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// user_settings — §4.2
// ---------------------------------------------------------------------------
//
// §4.2's DDL makes `user_id` itself the primary key (one settings row per
// user) — there is no separate `id` column in the spec's own DDL, so none is
// added here; §4.1's blanket "every table has a uuid id" is the general case
// §4.2 overrides per-table, and this table is the override.

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mrValueMicro: integer('mr_value_micro').notNull().default(DEFAULT_MR_VALUE_MICRO),
  urValueMicro: integer('ur_value_micro').notNull().default(DEFAULT_UR_VALUE_MICRO),
  breakfastPerDayCents: integer('breakfast_per_day_cents').notNull().default(DEFAULT_BREAKFAST_PER_DAY_CENTS),
  foraRateBps: integer('fora_rate_bps').notNull().default(DEFAULT_FORA_RATE_BPS),
  foraMember: boolean('fora_member').notNull().default(false),
  cardmemberAnniversary: date('cardmember_anniversary', { mode: 'string' }),
  homeCurrency: char('home_currency', { length: 3 }).notNull().default('USD'),
  timezone: text('timezone').notNull().default('America/New_York'),
  theme: text('theme').$type<ThemePreference>().notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// cards — §4.2
// ---------------------------------------------------------------------------

export const cards = pgTable('cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: cardKindEnum('kind').notNull(),
  nickname: text('nickname'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// credit_buckets — §4.2, §2.4
// ---------------------------------------------------------------------------
//
// No createdAt/updatedAt: §4.2's DDL doesn't show them for this table.

export const creditBuckets = pgTable(
  'credit_buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id').references(() => cards.id, { onDelete: 'cascade' }),
    // Widened to `| string`, matching `CreditBucketProps.key` in the domain's
    // `CreditBucket` aggregate (src/domain/credit/CreditBucket.ts) exactly:
    // the column is `text NOT NULL` with no DB-level enum constraint, and the
    // aggregate deliberately tolerates a bucket key outside the current six
    // rather than rejecting a program Parity hasn't modelled yet.
    key: text('key').$type<CreditBucketKey | string>().notNull(),
    label: text('label').notNull(),
    faceCents: integer('face_cents').notNull(),
    windowStart: date('window_start', { mode: 'string' }).notNull(),
    windowEnd: date('window_end', { mode: 'string' }).notNull(),
    consumedCents: integer('consumed_cents').notNull().default(0),
  },
  (t) => [unique('credit_buckets_user_key_window_start_unique').on(t.userId, t.key, t.windowStart)],
);

// ---------------------------------------------------------------------------
// trips — §4.2
// ---------------------------------------------------------------------------

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  destination: text('destination'),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// properties — §4.2, §4.4
// ---------------------------------------------------------------------------
//
// `userId` is nullable here (unlike every other table): §4.2 comments
// "NULL = seeded/global" — the ~40 seeded properties in §4.4 belong to no
// user. `ON DELETE CASCADE` still applies verbatim from the spec; it is
// simply inert for NULL-owned rows.

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    city: text('city'),
    country: char('country', { length: 2 }),
    brand: text('brand').$type<BrandOrNone>().notNull().default('NONE'),
    inFhr: boolean('in_fhr').notNull().default(false),
    inThc: boolean('in_thc').notNull().default(false),
    inEdit: boolean('in_edit').notNull().default(false),
    propertyCreditFaceCents: integer('property_credit_face_cents')
      .notNull()
      .default(DEFAULT_PROPERTY_CREDIT_FACE_CENTS),
    propertyCreditKind: text('property_credit_kind').$type<PropertyCreditKind>(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.2: `CREATE INDEX ON properties (lower(name));` — a functional index,
    // expressed with a raw `sql` fragment because Drizzle has no first-class
    // "expression column" helper.
    index('properties_lower_name_idx').on(sql`lower(${t.name})`),
    index('properties_city_idx').on(t.city),
  ],
);

// ---------------------------------------------------------------------------
// comparisons — §4.2, §4.3
// ---------------------------------------------------------------------------

export const comparisons = pgTable(
  'comparisons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    propertyNameSnapshot: text('property_name_snapshot').notNull(),
    checkIn: date('check_in', { mode: 'string' }).notNull(),
    checkOut: date('check_out', { mode: 'string' }).notNull(),
    nights: integer('nights').notNull(),
    adults: integer('adults').notNull().default(2),
    children: integer('children').notNull().default(0),
    rooms: integer('rooms').notNull().default(1),
    roomType: text('room_type'),
    bedType: text('bed_type'),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    taxRateBps: integer('tax_rate_bps').notNull(),
    realizationPct: integer('realization_pct').notNull().default(DEFAULT_REALIZATION_PCT),
    // §4.3: snapshots are immutable — the full engine input/output at compute
    // time, so a saved comparison always renders from what the engine actually
    // said rather than being silently recomputed under a newer engine version.
    contextSnapshot: jsonb('context_snapshot').$type<StayContext>().notNull(),
    resultSnapshot: jsonb('result_snapshot').$type<ChannelResult[]>().notNull(),
    engineVersion: text('engine_version').notNull(),
    status: comparisonStatusEnum('status').notNull().default('DRAFT'),
    chosenChannel: text('chosen_channel').$type<Channel>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comparisons_user_created_idx').on(t.userId, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// quotes — §4.2
// ---------------------------------------------------------------------------
//
// No `userId`: §4.2 scopes this table only through `comparison_id`, and
// `comparisons.user_id` already carries ownership — a redundant denormalized
// `userId` here isn't in the spec's DDL and would need its own reconciliation
// with the parent comparison's owner on every write, so it is deliberately
// omitted, following the spec's own column list exactly rather than the
// general "every table has userId" rule.

export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  comparisonId: uuid('comparison_id')
    .notNull()
    .references(() => comparisons.id, { onDelete: 'cascade' }),
  channel: text('channel').$type<Channel>().notNull(),
  label: text('label'),
  totalCents: integer('total_cents').notNull(),
  prepaid: boolean('prepaid').notNull(),
  refundable: boolean('refundable').notNull(),
  sourceUrl: text('source_url'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  sortIndex: integer('sort_index').notNull().default(0),
});

// ---------------------------------------------------------------------------
// competing_rates — §4.2
// ---------------------------------------------------------------------------
//
// Same reasoning as `quotes`: scoped via `comparison_id`, no `userId` in §4.2.

export const competingRates = pgTable('competing_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  comparisonId: uuid('comparison_id')
    .notNull()
    .references(() => comparisons.id, { onDelete: 'cascade' }),
  siteDomain: text('site_domain').notNull(),
  url: text('url').notNull(),
  baseCents: integer('base_cents').notNull(),
  taxCents: integer('tax_cents'),
  refundable: boolean('refundable').notNull(),
  publiclyAvailable: boolean('publicly_available').notNull(),
  roomType: text('room_type'),
  bedType: text('bed_type'),
  adults: integer('adults'),
  children: integer('children'),
  currency: char('currency', { length: 3 }),
  screenshotKey: text('screenshot_key'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// bookings — §4.2
// ---------------------------------------------------------------------------

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    comparisonId: uuid('comparison_id').references(() => comparisons.id, { onDelete: 'set null' }),
    channel: text('channel').$type<Channel>().notNull(),
    confirmationNumber: text('confirmation_number'),
    bookedAt: timestamp('booked_at', { withTimezone: true }).notNull(),
    checkIn: date('check_in', { mode: 'string' }).notNull(),
    checkOut: date('check_out', { mode: 'string' }).notNull(),
    totalCents: integer('total_cents').notNull(),
    baseCents: integer('base_cents').notNull(),
    cashChargedCents: integer('cash_charged_cents'),
    pointsUsed: integer('points_used'),
    refundable: boolean('refundable').notNull(),
    cancelDeadline: date('cancel_deadline', { mode: 'string' }),
    bucketId: uuid('bucket_id').references(() => creditBuckets.id, { onDelete: 'set null' }),
    status: bookingStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bookings_user_booked_idx').on(t.userId, t.bookedAt.desc())],
);

// ---------------------------------------------------------------------------
// claims — §4.2, §2.3.1 (the 24-hour window)
// ---------------------------------------------------------------------------

export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    competingRateId: uuid('competing_rate_id').references(() => competingRates.id, { onDelete: 'set null' }),
    kind: text('kind').$type<ClaimKind>().notNull(),
    // PM5, §2.3.1: `booked_at + 24h` for Chase claims — the hard cutoff the
    // claim queue exists to defend.
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    status: claimStatusEnum('status').notNull().default('ELIGIBLE'),
    claimedGapCents: integer('claimed_gap_cents'),
    awardedCents: integer('awarded_cents'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    denialReason: text('denial_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.2: `CREATE INDEX ON claims (user_id, deadline_at) WHERE status IN
    // ('ELIGIBLE','PREPARING');` — a partial index over the only rows the
    // 24-hour deadline sweep (§1.5 success criterion #2) actually needs to
    // scan.
    index('claims_user_deadline_pending_idx')
      .on(t.userId, t.deadlineAt)
      .where(sql`${t.status} IN ('ELIGIBLE', 'PREPARING')`),
  ],
);

// ---------------------------------------------------------------------------
// watchlist — §4.2
// ---------------------------------------------------------------------------
//
// No createdAt: §4.2's DDL doesn't show one for this table.

export const watchlist = pgTable('watchlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  cadenceDays: integer('cadence_days').notNull().default(7),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull(),
  active: boolean('active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// savings_events — §4.2, §1.5 (the auditable ledger)
// ---------------------------------------------------------------------------
//
// No createdAt: §4.2's DDL doesn't show one — `occurred_on` is the ledger's
// own date field and is what the §4.2 index and the `?from=&to=` query in
// §5.2 both order by.

export const savingsEvents = pgTable(
  'savings_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    claimId: uuid('claim_id').references(() => claims.id, { onDelete: 'set null' }),
    kind: text('kind').$type<SavingsEventKind>().notNull(),
    amountCents: integer('amount_cents').notNull(),
    realized: boolean('realized').notNull().default(false),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    note: text('note'),
  },
  (t) => [index('savings_events_user_occurred_idx').on(t.userId, t.occurredOn)],
);

// ---------------------------------------------------------------------------
// rule_flags — §4.2, §2.8 ("flag as changed" button)
// ---------------------------------------------------------------------------

export const ruleFlags = pgTable('rule_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  ruleKey: text('rule_key').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations — the meaningful joins
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  accounts: many(accounts),
  sessions: many(sessions),
  cards: many(cards),
  creditBuckets: many(creditBuckets),
  trips: many(trips),
  properties: many(properties),
  comparisons: many(comparisons),
  bookings: many(bookings),
  claims: many(claims),
  watchlist: many(watchlist),
  savingsEvents: many(savingsEvents),
  ruleFlags: many(ruleFlags),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  user: one(users, { fields: [cards.userId], references: [users.id] }),
  creditBuckets: many(creditBuckets),
}));

export const creditBucketsRelations = relations(creditBuckets, ({ one, many }) => ({
  user: one(users, { fields: [creditBuckets.userId], references: [users.id] }),
  card: one(cards, { fields: [creditBuckets.cardId], references: [cards.id] }),
  bookings: many(bookings),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  user: one(users, { fields: [trips.userId], references: [users.id] }),
  comparisons: many(comparisons),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  user: one(users, { fields: [properties.userId], references: [users.id] }),
  comparisons: many(comparisons),
}));

export const comparisonsRelations = relations(comparisons, ({ one, many }) => ({
  user: one(users, { fields: [comparisons.userId], references: [users.id] }),
  trip: one(trips, { fields: [comparisons.tripId], references: [trips.id] }),
  property: one(properties, { fields: [comparisons.propertyId], references: [properties.id] }),
  quotes: many(quotes),
  competingRates: many(competingRates),
  bookings: many(bookings),
}));

export const quotesRelations = relations(quotes, ({ one }) => ({
  comparison: one(comparisons, { fields: [quotes.comparisonId], references: [comparisons.id] }),
}));

export const competingRatesRelations = relations(competingRates, ({ one, many }) => ({
  comparison: one(comparisons, { fields: [competingRates.comparisonId], references: [comparisons.id] }),
  claims: many(claims),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
  comparison: one(comparisons, { fields: [bookings.comparisonId], references: [comparisons.id] }),
  bucket: one(creditBuckets, { fields: [bookings.bucketId], references: [creditBuckets.id] }),
  claims: many(claims),
  watchlist: many(watchlist),
  savingsEvents: many(savingsEvents),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  user: one(users, { fields: [claims.userId], references: [users.id] }),
  booking: one(bookings, { fields: [claims.bookingId], references: [bookings.id] }),
  competingRate: one(competingRates, { fields: [claims.competingRateId], references: [competingRates.id] }),
  savingsEvents: many(savingsEvents),
}));

export const watchlistRelations = relations(watchlist, ({ one }) => ({
  user: one(users, { fields: [watchlist.userId], references: [users.id] }),
  booking: one(bookings, { fields: [watchlist.bookingId], references: [bookings.id] }),
}));

export const savingsEventsRelations = relations(savingsEvents, ({ one }) => ({
  user: one(users, { fields: [savingsEvents.userId], references: [users.id] }),
  booking: one(bookings, { fields: [savingsEvents.bookingId], references: [bookings.id] }),
  claim: one(claims, { fields: [savingsEvents.claimId], references: [claims.id] }),
}));

export const ruleFlagsRelations = relations(ruleFlags, ({ one }) => ({
  user: one(users, { fields: [ruleFlags.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

export type VerificationTokenRow = typeof verificationTokens.$inferSelect;
export type NewVerificationTokenRow = typeof verificationTokens.$inferInsert;

export type UserSettingsRow = typeof userSettings.$inferSelect;
export type NewUserSettingsRow = typeof userSettings.$inferInsert;

export type CardRow = typeof cards.$inferSelect;
export type NewCardRow = typeof cards.$inferInsert;

export type CreditBucketRow = typeof creditBuckets.$inferSelect;
export type NewCreditBucketRow = typeof creditBuckets.$inferInsert;

export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;

export type PropertyRow = typeof properties.$inferSelect;
export type NewPropertyRow = typeof properties.$inferInsert;

export type ComparisonRow = typeof comparisons.$inferSelect;
export type NewComparisonRow = typeof comparisons.$inferInsert;

export type QuoteRow = typeof quotes.$inferSelect;
export type NewQuoteRow = typeof quotes.$inferInsert;

export type CompetingRateRow = typeof competingRates.$inferSelect;
export type NewCompetingRateRow = typeof competingRates.$inferInsert;

export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;

export type ClaimRow = typeof claims.$inferSelect;
export type NewClaimRow = typeof claims.$inferInsert;

export type WatchlistRow = typeof watchlist.$inferSelect;
export type NewWatchlistRow = typeof watchlist.$inferInsert;

export type SavingsEventRow = typeof savingsEvents.$inferSelect;
export type NewSavingsEventRow = typeof savingsEvents.$inferInsert;

export type RuleFlagRow = typeof ruleFlags.$inferSelect;
export type NewRuleFlagRow = typeof ruleFlags.$inferInsert;

// ---------------------------------------------------------------------------
// notifications_sent — durable dedup ledger for Part 9's cron notifications
// ---------------------------------------------------------------------------
//
// Not part of the spec's own §4.2 DDL. Added under a later, narrowly-scoped
// task (fixing a verified notification-durability defect) after
// `claim-deadline-sweep` was found to re-send the same reminder checkpoint on
// every 15-minute tick whenever a serverless cold start emptied
// `IdempotentNotifier`'s in-process `Map` — see
// `src/infrastructure/notifications/DurableIdempotentNotifier.ts`'s module
// doc for the full defect and fix. The unique index on `idempotency_key`
// below is the entire mechanism; every other column exists for attribution
// and cascade-delete hygiene, not correctness.
//
// House rules from §4.1 still apply here: uuid `id`, `userId` FK
// `ON DELETE CASCADE`. No `updatedAt` — a row is written once by
// `NotificationsSentRepository.tryClaim` and never mutated afterward, the
// same reasoning `savings_events` and `rule_flags` above give for omitting
// one on a write-once table.
//
// `NotificationChannel`/`NotificationKind` are declared locally here rather
// than imported from `application/ports/NotificationsSentRepository.ts` —
// same choice this file already makes for `ThemePreference` and
// `SavingsEventKind` above: a closed, persistence-local list that isn't
// owned by `domain/`, kept append-only-safe by not touching this file's
// existing import block.

/** `channel` on `notifications_sent` — only email exists today (§9). */
export type NotificationChannel = 'EMAIL';

/**
 * The four §9 jobs' idempotency-key prefixes today — see
 * `DurableIdempotentNotifier.deriveNotificationKind`. Widened to `| string`
 * on the column itself below, the same reasoning as `creditBuckets.key`
 * above: a future job's kind is stored rather than rejected.
 */
export type NotificationKind = 'claim-deadline' | 'bucket-expiry' | 'watchlist-reshop' | 'rule-staleness';

export const notificationsSent = pgTable(
  'notifications_sent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    kind: text('kind').$type<NotificationKind | string>().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    channel: text('channel').$type<NotificationChannel>().notNull().default('EMAIL'),
  },
  (t) => [unique('notifications_sent_idempotency_key_unique').on(t.idempotencyKey)],
);

// Only this table's own `one` side is defined here — `usersRelations` further
// up is existing content this task's append-only mandate leaves untouched.
// The plain `db.insert`/`db.select` calls `DrizzleNotificationsSentRepository`
// uses don't need the reverse `many()` side; only the relational
// query-builder API (`db.query.users.findMany({ with: { notificationsSent:
// true } })`, unused for this table) would.
export const notificationsSentRelations = relations(notificationsSent, ({ one }) => ({
  user: one(users, { fields: [notificationsSent.userId], references: [users.id] }),
}));

export type NotificationsSentRow = typeof notificationsSent.$inferSelect;
export type NewNotificationsSentRow = typeof notificationsSent.$inferInsert;

// ---------------------------------------------------------------------------
// email_send_counters / email_send_daily_totals — durable send budget
// ---------------------------------------------------------------------------
//
// Not part of the spec's own §4.2 DDL, same as `notifications_sent` above.
// Added under a security-audit remediation: `POST /api/auth/magic-link` had
// only a per-IP rate limit guarding it, which does not bound the *shared*
// resource that actually matters — Resend's free-tier cap of 100 emails/day
// for the whole deployment. A single caller staying within the per-IP limit
// could still exhaust that entire daily quota targeting one known address,
// locking every user out of sign-in for the rest of the day. These two
// tables are the durable, cross-instance budget that closes that gap —
// see `src/application/ports/EmailBudgetRepository.ts` for the full
// reasoning and `src/infrastructure/persistence/repositories/
// DrizzleEmailBudgetRepository.ts` for the atomic conditional-upsert that
// enforces it without a read-then-write race.
//
// `email_send_counters` is one row per (email, UTC day): `count` is how many
// sends that address has had today, `last_sent_at` is when the most recent
// one happened (the cooldown check). `email_send_daily_totals` is one row
// per UTC day, globally: `count` is every send across every recipient that
// day. Both are plain running counters, not append-only logs — an
// append-only table would make "how many today" an aggregate query on every
// request instead of a single indexed row read, and would need its own
// pruning job to stay bounded.
//
// House rules from §4.1 apply loosely here (this is post-spec, like
// `notifications_sent`): no `userId` — a budget is keyed by recipient email
// and by calendar day, not by account, since the whole point is to bound an
// unauthenticated caller who need not be, and often is not, a user of the
// product. `email_send_daily_totals.sendDate` is its own primary key
// (one global row per day; no separate uuid `id` earns its keep on a table
// with exactly one natural key), the same reasoning `user_settings.userId`
// gets in D-072.

export const emailSendCounters = pgTable(
  'email_send_counters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Callers are expected to pass an already-normalised (trimmed,
    // lowercased) address — `magicLinkSchema` in
    // `src/lib/validation/auth.ts` does exactly that with Zod's
    // `.trim().toLowerCase()` before this ever gets called — so two
    // requests for "A@b.com" and "a@b.com" share one row rather than
    // silently doubling the effective per-recipient budget.
    email: text('email').notNull(),
    // UTC calendar day this counter belongs to — `toIsoDate(now)` from
    // `src/domain/credit/CreditWindow.ts` defaults to UTC, matching every
    // other "which day is this" computation in the app.
    sendDate: date('send_date', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  },
  (t) => [unique('email_send_counters_email_send_date_unique').on(t.email, t.sendDate)],
);

export const emailSendDailyTotals = pgTable('email_send_daily_totals', {
  sendDate: date('send_date', { mode: 'string' }).primaryKey(),
  count: integer('count').notNull().default(0),
});

export type EmailSendCounterRow = typeof emailSendCounters.$inferSelect;
export type NewEmailSendCounterRow = typeof emailSendCounters.$inferInsert;

export type EmailSendDailyTotalRow = typeof emailSendDailyTotals.$inferSelect;
export type NewEmailSendDailyTotalRow = typeof emailSendDailyTotals.$inferInsert;

// ---------------------------------------------------------------------------
// evidence_blobs — Postgres-backed object storage for claim evidence
// ---------------------------------------------------------------------------
//
// Not part of the spec's own §4.2 DDL, same footing as `notifications_sent`
// and the `email_send_*` tables above: added to close a real defect rather
// than translate a section of parity-build-spec.md. §12 asks for "private
// object storage with signed, short-lived URLs" for claim screenshots.
// `PostgresSignedUrlStorage` (`src/infrastructure/storage/`, née
// `LocalSignedUrlStorage`) already minted that signed URL, but nothing ever
// received the bytes it pointed at — `POST /api/storage/upload` did not
// exist — so every evidence upload silently vanished after the client PUT it
// to a 404. This table is the missing bucket, backed by Postgres rather than
// a real object-storage provider for the same no-external-credentials
// reason `email_send_*` above uses Postgres instead of a message queue or a
// real Resend-side counter.
//
// Drizzle's pg-core ships column builders for text/integer/jsonb/etc. but no
// binary one, hence the `customType` below rather than an import from
// `drizzle-orm/pg-core`'s usual named exports. No `toDriver`/`fromDriver`
// hook is needed beyond naming the SQL type: `postgres` (the driver
// `db.ts` uses) already infers `bytea` (oid 17) for any `Uint8Array`/`Buffer`
// parameter and parses a `bytea` result back into a `Buffer` on its own —
// see `inferType`/`types.bytea` in the `postgres` package's own source.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// House rules from §4.1 apply: uuid `id`, `userId` FK `ON DELETE CASCADE`.
// `id` is not left to insert-time `defaultRandom()`, though — the eventual
// row's id is minted up front, at *signing* time, in
// `PostgresSignedUrlStorage.createSignedUploadUrl`, and travels inside the
// signed URL's own `key` (`<prefix>/<uuid>`) as its final path segment. The
// `PUT` and `GET` handlers in `/api/storage/upload/route.ts` both recover
// that same uuid back out of `key` (see that file), so signing, storing and
// serving all agree on one identifier without a separate lookup column.
//
// No `updatedAt`: a blob is written once by the `PUT` handler and never
// mutated afterward — the same reasoning `notifications_sent` and
// `rule_flags` give above for omitting one on a write-once table.
export const evidenceBlobs = pgTable('evidence_blobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Only this table's own `one` side is defined here, same choice
// `notificationsSentRelations` makes above and for the same reason: the
// plain `db.insert`/`db.select` calls `PostgresSignedUrlStorage` uses don't
// need the reverse `many()` side, so `usersRelations` further up (existing
// content this append-only addition leaves untouched) is not edited to add
// one.
export const evidenceBlobsRelations = relations(evidenceBlobs, ({ one }) => ({
  user: one(users, { fields: [evidenceBlobs.userId], references: [users.id] }),
}));

export type EvidenceBlobRow = typeof evidenceBlobs.$inferSelect;
export type NewEvidenceBlobRow = typeof evidenceBlobs.$inferInsert;
