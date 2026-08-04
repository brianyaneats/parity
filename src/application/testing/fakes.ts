/**
 * In-memory port fakes — §10.2 / the task's own instruction: "Unit-test the
 * use cases against in-memory port fakes — do NOT require a live database for
 * these." Shared across use-case test files so the fake behaviour (id
 * generation, filtering, the transaction bundle) is written once rather than
 * once per test file, the same reasoning `application.test.ts`'s own `deps()`
 * helper follows for `UseCaseDependencies`.
 *
 * Not a `*.test.ts` file itself — vitest's `include` glob only picks up
 * `*.test.ts`/`*.spec.ts`, so this module contributes no tests of its own; it
 * is infrastructure *for* tests.
 */
import { randomUUID } from 'node:crypto';
import type {
  ComparisonListFilter,
  ComparisonListPage,
  ComparisonPatch,
  ComparisonRecord,
  ComparisonRepository,
  NewComparisonInput,
} from '@/application/ports/ComparisonRepository';
import type {
  BookingPatch,
  BookingRecord,
  BookingRepository,
  NewBookingInput,
} from '@/application/ports/BookingRepository';
import type {
  ClaimListFilter,
  ClaimPatch,
  ClaimRecord,
  ClaimRepository,
  ClaimSweepRow,
  NewClaimInput,
} from '@/application/ports/ClaimRepository';
import type {
  NewSavingsEventInput,
  SavingsEventListFilter,
  SavingsEventListResult,
  SavingsEventRecord,
  SavingsEventRepository,
} from '@/application/ports/SavingsEventRepository';
import type {
  CreditBucketRecord,
  CreditBucketRepository,
  CreditBucketSweepRow,
  NewCreditBucketInput,
} from '@/application/ports/CreditBucketRepository';
import type {
  NewWatchlistInput,
  WatchlistRecord,
  WatchlistRepository,
  WatchlistSweepRow,
} from '@/application/ports/WatchlistRepository';
import type {
  NotificationRecipient,
  UserSettingsPatch,
  UserSettingsRecord,
  UserSettingsRepository,
} from '@/application/ports/UserSettingsRepository';
import type { NotificationMessage, NotificationResult, Notifier } from '@/application/ports/Notifier';
import type {
  NotificationSentRecord,
  NotificationsSentRepository,
  RecordSentInput,
} from '@/application/ports/NotificationsSentRepository';
import type { TransactionalRepositories, UnitOfWork } from '@/application/ports/UnitOfWork';
import type {
  CompetingRateRecord,
  CompetingRateRepository,
} from '@/application/ports/CompetingRateRepository';
import type { NewCompetingRateInput } from '@/application/ports/ComparisonRepository';
import {
  RECIPIENT_DAILY_EMAIL_LIMIT,
  RECIPIENT_EMAIL_COOLDOWN_MS,
  type EmailBudgetDecision,
  type EmailBudgetRepository,
} from '@/application/ports/EmailBudgetRepository';
import type { AuthRepository, AuthUserRecord } from '@/application/ports/AuthRepository';
import { cents } from '@/domain/shared/cents';
import { toIsoDate } from '@/domain/credit/CreditWindow';

export class InMemoryComparisonRepository implements ComparisonRepository {
  public readonly rows: ComparisonRecord[] = [];

  public async create(input: NewComparisonInput): Promise<ComparisonRecord> {
    const now = new Date();
    const record: ComparisonRecord = {
      id: randomUUID(),
      userId: input.userId,
      tripId: input.tripId ?? null,
      propertyId: input.propertyId ?? null,
      propertyNameSnapshot: input.propertyNameSnapshot,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: input.nights,
      adults: input.adults ?? 2,
      children: input.children ?? 0,
      rooms: input.rooms ?? 1,
      roomType: input.roomType ?? null,
      bedType: input.bedType ?? null,
      currency: input.currency ?? 'USD',
      taxRateBps: input.taxRateBps,
      realizationPct: input.realizationPct ?? 100,
      contextSnapshot: input.contextSnapshot,
      resultSnapshot: input.resultSnapshot,
      engineVersion: input.engineVersion,
      status: input.status ?? 'DRAFT',
      chosenChannel: input.chosenChannel ?? null,
      createdAt: now,
      updatedAt: now,
      quotes: input.quotes.map((quote, index) => ({
        id: randomUUID(),
        comparisonId: '',
        channel: quote.channel,
        label: quote.label ?? null,
        totalCents: quote.totalCents,
        prepaid: quote.prepaid,
        refundable: quote.refundable,
        sourceUrl: quote.sourceUrl ?? null,
        capturedAt: quote.capturedAt ?? null,
        sortIndex: quote.sortIndex ?? index,
      })),
      competingRates: input.competingRate
        ? [
            {
              id: randomUUID(),
              comparisonId: '',
              siteDomain: input.competingRate.siteDomain,
              url: input.competingRate.url,
              baseCents: input.competingRate.baseCents,
              taxCents: input.competingRate.taxCents ?? null,
              refundable: input.competingRate.refundable,
              publiclyAvailable: input.competingRate.publiclyAvailable,
              roomType: input.competingRate.roomType ?? null,
              bedType: input.competingRate.bedType ?? null,
              adults: input.competingRate.adults ?? null,
              children: input.competingRate.children ?? null,
              currency: input.competingRate.currency ?? null,
              screenshotKey: null,
              capturedAt: input.competingRate.capturedAt,
            },
          ]
        : [],
    };
    this.rows.push(record);
    return record;
  }

  public async findById(id: string, userId: string): Promise<ComparisonRecord | null> {
    return this.rows.find((row) => row.id === id && row.userId === userId) ?? null;
  }

  public async list(userId: string, filter: ComparisonListFilter): Promise<ComparisonListPage> {
    let items = this.rows.filter((row) => row.userId === userId);
    if (filter.tripId) items = items.filter((row) => row.tripId === filter.tripId);
    if (filter.status) items = items.filter((row) => row.status === filter.status);
    return { items, nextCursor: null };
  }

  public async update(id: string, userId: string, patch: ComparisonPatch): Promise<ComparisonRecord | null> {
    const index = this.rows.findIndex((row) => row.id === id && row.userId === userId);
    if (index === -1) return null;
    const existing = this.rows[index];
    if (!existing) return null;
    const updated: ComparisonRecord = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.chosenChannel !== undefined ? { chosenChannel: patch.chosenChannel } : {}),
      ...(patch.tripId !== undefined ? { tripId: patch.tripId } : {}),
      updatedAt: new Date(),
    };
    this.rows[index] = updated;
    return updated;
  }
}

export class InMemoryBookingRepository implements BookingRepository {
  public readonly rows: BookingRecord[] = [];

  public async create(input: NewBookingInput): Promise<BookingRecord> {
    // `paymentRoute` is optional on the way in and always present on the way
    // out — same normalisation the Drizzle repository does on insert.
    const record: BookingRecord = {
      ...input,
      paymentRoute: input.paymentRoute ?? null,
      createdAt: new Date(),
    };
    this.rows.push(record);
    return record;
  }

  public async findById(id: string, userId: string): Promise<BookingRecord | null> {
    return this.rows.find((row) => row.id === id && row.userId === userId) ?? null;
  }

  public async update(id: string, userId: string, patch: BookingPatch): Promise<BookingRecord | null> {
    const index = this.rows.findIndex((row) => row.id === id && row.userId === userId);
    if (index === -1) return null;
    const existing = this.rows[index];
    if (!existing) return null;
    const updated: BookingRecord = {
      ...existing,
      ...(patch.confirmationNumber !== undefined ? { confirmationNumber: patch.confirmationNumber } : {}),
      ...(patch.cashChargedCents !== undefined ? { cashChargedCents: patch.cashChargedCents } : {}),
      ...(patch.pointsUsed !== undefined ? { pointsUsed: patch.pointsUsed } : {}),
      ...(patch.bucketId !== undefined ? { bucketId: patch.bucketId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    this.rows[index] = updated;
    return updated;
  }
}

export class InMemoryClaimRepository implements ClaimRepository {
  public readonly rows: ClaimRecord[] = [];
  /** Populated by tests that exercise `listOpenForSweep` — keyed by claim id. */
  public sweepMeta = new Map<string, { bookedAt: Date; userEmail: string; userTimezone: string }>();

  public async create(input: NewClaimInput): Promise<ClaimRecord> {
    const record: ClaimRecord = {
      ...input,
      awardedCents: null,
      submittedAt: null,
      resolvedAt: null,
      denialReason: null,
      denialCode: null,
      notes: null,
      createdAt: new Date(),
    };
    this.rows.push(record);
    return record;
  }

  public async findById(id: string, userId: string): Promise<ClaimRecord | null> {
    return this.rows.find((row) => row.id === id && row.userId === userId) ?? null;
  }

  public async list(userId: string, filter: ClaimListFilter): Promise<readonly ClaimRecord[]> {
    let items = this.rows.filter((row) => row.userId === userId);
    if (filter.status?.length) items = items.filter((row) => filter.status?.includes(row.status));
    if (filter.dueWithinMs !== undefined) {
      const horizon = filter.now.getTime() + filter.dueWithinMs;
      items = items.filter(
        (row) => row.deadlineAt.getTime() >= filter.now.getTime() && row.deadlineAt.getTime() <= horizon,
      );
    }
    return items;
  }

  public async update(id: string, userId: string, patch: ClaimPatch): Promise<ClaimRecord | null> {
    const index = this.rows.findIndex((row) => row.id === id && row.userId === userId);
    if (index === -1) return null;
    const existing = this.rows[index];
    if (!existing) return null;
    const updated: ClaimRecord = {
      ...existing,
      ...(patch.competingRateId !== undefined ? { competingRateId: patch.competingRateId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.awardedCents !== undefined ? { awardedCents: patch.awardedCents } : {}),
      ...(patch.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}),
      ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
      ...(patch.denialReason !== undefined ? { denialReason: patch.denialReason } : {}),
      ...(patch.denialCode !== undefined ? { denialCode: patch.denialCode } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };
    this.rows[index] = updated;
    return updated;
  }

  public async listOpenForSweep(_now: Date): Promise<readonly ClaimSweepRow[]> {
    return this.rows
      .filter((row) => row.status === 'ELIGIBLE' || row.status === 'PREPARING')
      .map((claim) => {
        const meta = this.sweepMeta.get(claim.id) ?? {
          bookedAt: new Date(claim.deadlineAt.getTime() - 24 * 60 * 60 * 1000),
          userEmail: 'user@example.com',
          userTimezone: 'America/New_York',
        };
        return { claim, ...meta };
      });
  }
}

export class InMemorySavingsEventRepository implements SavingsEventRepository {
  public readonly rows: SavingsEventRecord[] = [];

  public async create(input: NewSavingsEventInput): Promise<SavingsEventRecord> {
    const record: SavingsEventRecord = {
      id: randomUUID(),
      userId: input.userId,
      bookingId: input.bookingId ?? null,
      claimId: input.claimId ?? null,
      kind: input.kind,
      amountCents: input.amountCents,
      realized: input.realized,
      occurredOn: input.occurredOn,
      note: input.note ?? null,
    };
    this.rows.push(record);
    return record;
  }

  public async list(userId: string, filter: SavingsEventListFilter): Promise<SavingsEventListResult> {
    let items = this.rows.filter((row) => row.userId === userId);
    if (filter.from) items = items.filter((row) => row.occurredOn >= (filter.from as string));
    if (filter.to) items = items.filter((row) => row.occurredOn <= (filter.to as string));
    if (filter.realized !== undefined) items = items.filter((row) => row.realized === filter.realized);

    const totalCents = cents(items.reduce((sum, item) => sum + item.amountCents, 0));
    const realizedCents = cents(items.filter((i) => i.realized).reduce((sum, item) => sum + item.amountCents, 0));
    return {
      items,
      aggregates: {
        totalCents,
        realizedCents,
        projectedCents: cents(totalCents - realizedCents),
        count: items.length,
      },
    };
  }
}

/** Runs `fn` against the same fakes with no real transaction — in-memory writes are already atomic. */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    public readonly bookings: InMemoryBookingRepository = new InMemoryBookingRepository(),
    public readonly claims: InMemoryClaimRepository = new InMemoryClaimRepository(),
    public readonly savingsEvents: InMemorySavingsEventRepository = new InMemorySavingsEventRepository(),
    public readonly watchlist: InMemoryWatchlistRepository = new InMemoryWatchlistRepository(),
    public readonly creditBuckets: InMemoryCreditBucketRepository = new InMemoryCreditBucketRepository(),
    public readonly competingRates: InMemoryCompetingRateRepository = new InMemoryCompetingRateRepository(),
  ) {}

  public async run<T>(fn: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    return fn({
      bookings: this.bookings,
      claims: this.claims,
      savingsEvents: this.savingsEvents,
      watchlist: this.watchlist,
      creditBuckets: this.creditBuckets,
      competingRates: this.competingRates,
    });
  }
}

/**
 * In-memory competing rates. A claim opened from a booking looks the rate up by
 * comparison so it can name its source (§2.3.1 PM8) and generate its text
 * (§7.4 item 4); these tests need that lookup to be answerable without a
 * database.
 */
export class InMemoryCompetingRateRepository implements CompetingRateRepository {
  public readonly rows: CompetingRateRecord[] = [];

  public async create(
    comparisonId: string,
    input: NewCompetingRateInput,
  ): Promise<CompetingRateRecord> {
    const row = {
      id: `competing-rate-${this.rows.length + 1}`,
      comparisonId,
      ...input,
      capturedAt: input.capturedAt ?? new Date(0),
      screenshotKey: null,
    } as unknown as CompetingRateRecord;
    this.rows.push(row);
    return row;
  }

  public async findById(id: string): Promise<CompetingRateRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  public async findByComparisonId(comparisonId: string): Promise<CompetingRateRecord | null> {
    return this.rows.filter((row) => row.comparisonId === comparisonId).at(-1) ?? null;
  }

  public async setScreenshotKey(
    id: string,
    screenshotKey: string,
  ): Promise<CompetingRateRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    const updated = { ...row, screenshotKey } as CompetingRateRecord;
    this.rows[this.rows.indexOf(row)] = updated;
    return updated;
  }
}

export class InMemoryCreditBucketRepository implements CreditBucketRepository {
  public readonly rows: CreditBucketRecord[] = [];
  public sweepMeta = new Map<string, { userEmail: string; userTimezone: string }>();

  public async upsert(input: NewCreditBucketInput): Promise<CreditBucketRecord> {
    const existingIndex = this.rows.findIndex(
      (row) => row.userId === input.userId && row.key === input.key && row.window.start === input.window.start,
    );
    const record: CreditBucketRecord = {
      id: existingIndex >= 0 ? (this.rows[existingIndex]?.id ?? randomUUID()) : randomUUID(),
      userId: input.userId,
      cardId: input.cardId ?? null,
      key: input.key,
      label: input.label,
      faceCents: input.faceCents,
      window: input.window,
      consumedCents: input.consumedCents ?? cents(0),
    };
    if (existingIndex >= 0) this.rows[existingIndex] = record;
    else this.rows.push(record);
    return record;
  }

  public async listByUser(userId: string): Promise<readonly CreditBucketRecord[]> {
    return this.rows.filter((row) => row.userId === userId);
  }

  public async findById(id: string, userId: string): Promise<CreditBucketRecord | null> {
    return this.rows.find((row) => row.id === id && row.userId === userId) ?? null;
  }

  public async setConsumedCents(id: string, userId: string, consumedCents: ReturnType<typeof cents>) {
    const index = this.rows.findIndex((row) => row.id === id && row.userId === userId);
    if (index === -1) return null;
    const existing = this.rows[index];
    if (!existing) return null;
    const updated = { ...existing, consumedCents };
    this.rows[index] = updated;
    return updated;
  }

  public async listForExpirySweep(_now: Date): Promise<readonly CreditBucketSweepRow[]> {
    return this.rows
      .filter((row) => row.consumedCents < row.faceCents)
      .map((bucket) => ({
        bucket,
        ...(this.sweepMeta.get(bucket.id) ?? { userEmail: 'user@example.com', userTimezone: 'America/New_York' }),
      }));
  }
}

export class InMemoryWatchlistRepository implements WatchlistRepository {
  public readonly rows: WatchlistRecord[] = [];
  public sweepDetails = new Map<string, Omit<WatchlistSweepRow, 'entry'>>();

  public async create(input: NewWatchlistInput): Promise<WatchlistRecord> {
    const record: WatchlistRecord = {
      id: randomUUID(),
      userId: input.userId,
      bookingId: input.bookingId,
      cadenceDays: input.cadenceDays ?? 7,
      lastCheckedAt: null,
      nextCheckAt: input.nextCheckAt,
      active: true,
    };
    this.rows.push(record);
    return record;
  }

  public async listByUser(userId: string): Promise<readonly WatchlistRecord[]> {
    return this.rows.filter((row) => row.userId === userId);
  }

  public async delete(id: string, userId: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id && row.userId === userId);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }

  public async deactivateForBooking(bookingId: string, userId: string): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) => row.bookingId === bookingId && row.userId === userId && row.active,
    );
    if (index === -1) return false;
    const existing = this.rows[index];
    if (!existing) return false;
    this.rows[index] = { ...existing, active: false };
    return true;
  }

  public async claimDueForSweep(now: Date): Promise<readonly WatchlistSweepRow[]> {
    const due = this.rows.filter((row) => row.active && row.nextCheckAt.getTime() <= now.getTime());
    const result: WatchlistSweepRow[] = [];
    for (const row of due) {
      const index = this.rows.indexOf(row);
      const advanced: WatchlistRecord = {
        ...row,
        lastCheckedAt: now,
        nextCheckAt: new Date(row.nextCheckAt.getTime() + row.cadenceDays * 24 * 60 * 60 * 1000),
      };
      this.rows[index] = advanced;
      const details = this.sweepDetails.get(row.id);
      if (details) result.push({ entry: advanced, ...details });
    }
    return result;
  }

  public async peekDueForSweep(now: Date): Promise<readonly WatchlistSweepRow[]> {
    const due = this.rows.filter((row) => row.active && row.nextCheckAt.getTime() <= now.getTime());
    return due.flatMap((row) => {
      const details = this.sweepDetails.get(row.id);
      return details ? [{ entry: row, ...details }] : [];
    });
  }
}

export class InMemoryUserSettingsRepository implements UserSettingsRepository {
  public readonly rows = new Map<string, UserSettingsRecord>();
  public recipients: NotificationRecipient[] = [];

  private defaultsFor(userId: string): UserSettingsRecord {
    return {
      userId,
      mrValueMicro: 15_000,
      urValueMicro: 17_500,
      breakfastPerDayCents: 7_000,
      foraRateBps: 700,
      foraMember: false,
      cardmemberAnniversary: null,
      homeCurrency: 'USD',
      timezone: 'America/New_York',
      theme: 'system',
    };
  }

  public async getOrCreate(userId: string): Promise<UserSettingsRecord> {
    const existing = this.rows.get(userId);
    if (existing) return existing;
    const created = this.defaultsFor(userId);
    this.rows.set(userId, created);
    return created;
  }

  public async update(userId: string, patch: UserSettingsPatch): Promise<UserSettingsRecord> {
    const existing = await this.getOrCreate(userId);
    const updated = { ...existing, ...patch };
    this.rows.set(userId, updated);
    return updated;
  }

  public async listRecipients(): Promise<readonly NotificationRecipient[]> {
    return this.recipients;
  }
}

/**
 * Records every call instead of sending anything — a dumb recorder, with no
 * dedupe logic of its own. Tests that need idempotency wrap this in the real
 * `IdempotentNotifier` decorator (`src/infrastructure/notifications/`) so
 * what is under test is the actual production dedupe mechanism, not a
 * test-only stand-in for it.
 */
export class FakeNotifier implements Notifier {
  public readonly sent: NotificationMessage[] = [];

  public async send(message: NotificationMessage): Promise<NotificationResult> {
    this.sent.push(message);
    return { sent: true, deduped: false };
  }
}

/**
 * In-memory `NotificationsSentRepository` — the fake behind
 * `DurableIdempotentNotifier`'s tests (`src/infrastructure/notifications/
 * DurableIdempotentNotifier.test.ts`) and the cold-start-simulation tests in
 * `ClaimDeadlineSweepUseCase.test.ts`: constructing two separate
 * `IdempotentNotifier`/`DurableIdempotentNotifier` pairs that both point at
 * *one* shared instance of this class is what stands in for "two serverless
 * invocations, each with an empty in-process map, hitting the same durable
 * Postgres table."
 *
 * `tryClaim`'s check-then-set has no `await` between the two, so within
 * Node's single-threaded event loop it is atomic across any number of
 * "concurrent" callers racing via `Promise.all` — the same guarantee
 * `notifications_sent`'s unique index gives across concurrent real
 * connections. That is what makes this fake suitable for testing the
 * concurrent-insert-race scenario, not just the simpler two-sequential-calls
 * one.
 */
export class InMemoryNotificationsSentRepository implements NotificationsSentRepository {
  private readonly byKey = new Map<string, NotificationSentRecord>();

  public async tryClaim(input: RecordSentInput): Promise<NotificationSentRecord | null> {
    if (this.byKey.has(input.idempotencyKey)) return null;
    const record: NotificationSentRecord = {
      id: `notification-sent-${this.byKey.size + 1}`,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      sentAt: input.sentAt,
      channel: input.channel,
    };
    this.byKey.set(input.idempotencyKey, record);
    return record;
  }

  public get rows(): readonly NotificationSentRecord[] {
    return [...this.byKey.values()];
  }
}

/**
 * In-memory `EmailBudgetRepository` — the fake behind
 * `RequestMagicLinkUseCase.test.ts`'s budget-enforcement coverage.
 *
 * `reserveSend` computes *both* decisions (per-recipient, then global)
 * against the current state before mutating either counter, and only
 * commits the increments once both have passed. That reproduces the
 * observable contract `DrizzleEmailBudgetRepository`'s transaction-plus-
 * rollback gives in real Postgres — a blocked attempt never leaves any
 * counter incremented — without needing an actual transaction: this class
 * has no `await` between reading and writing its `Map`s, so within Node's
 * single-threaded event loop it is already atomic across any number of
 * "concurrent" callers racing via `Promise.all`, the same reasoning
 * `InMemoryNotificationsSentRepository` above documents for its own
 * check-then-set.
 */
export class InMemoryEmailBudgetRepository implements EmailBudgetRepository {
  private readonly recipients = new Map<string, { count: number; lastSentAt: Date | null }>();
  private readonly dailyTotals = new Map<string, number>();

  public async reserveSend(email: string, now: Date, globalDailyLimit: number): Promise<EmailBudgetDecision> {
    const day = toIsoDate(now);
    const recipientKey = `${email}:${day}`;
    const recipient = this.recipients.get(recipientKey) ?? { count: 0, lastSentAt: null };

    const cooldownOk =
      recipient.lastSentAt === null || now.getTime() - recipient.lastSentAt.getTime() >= RECIPIENT_EMAIL_COOLDOWN_MS;
    if (recipient.count >= RECIPIENT_DAILY_EMAIL_LIMIT || !cooldownOk) {
      return { allowed: false, reason: 'RECIPIENT_LIMIT' };
    }

    const globalCount = this.dailyTotals.get(day) ?? 0;
    if (globalCount >= globalDailyLimit) {
      return { allowed: false, reason: 'GLOBAL_LIMIT' };
    }

    this.recipients.set(recipientKey, { count: recipient.count + 1, lastSentAt: now });
    this.dailyTotals.set(day, globalCount + 1);
    return { allowed: true };
  }

  /** Test inspection: how many sends `email` has been charged for on `day` (`YYYY-MM-DD`, UTC). */
  public recipientCount(email: string, day: string): number {
    return this.recipients.get(`${email}:${day}`)?.count ?? 0;
  }

  /** Test inspection: how many sends have been charged globally on `day` (`YYYY-MM-DD`, UTC). */
  public globalCount(day: string): number {
    return this.dailyTotals.get(day) ?? 0;
  }
}

/**
 * In-memory `AuthRepository` — the fake behind
 * `RequestMagicLinkUseCase.test.ts`. Seeded with whichever users a test
 * wants to exist; `createVerificationToken`/`consumeVerificationToken` are
 * a plain in-memory map keyed on `${identifier}:${token}`, matching the real
 * `DrizzleAuthRepository`'s `(identifier, token)` composite key.
 */
export class InMemoryAuthRepository implements AuthRepository {
  private readonly usersByEmail = new Map<string, AuthUserRecord>();
  private readonly tokens = new Map<string, { expires: Date }>();
  public readonly createdTokens: { identifier: string; token: string; expires: Date }[] = [];

  constructor(seedUsers: readonly AuthUserRecord[] = []) {
    for (const user of seedUsers) this.usersByEmail.set(user.email, user);
  }

  public async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  public async findOrCreateUserByEmail(email: string): Promise<AuthUserRecord> {
    const existing = this.usersByEmail.get(email);
    if (existing) return existing;
    const created: AuthUserRecord = { id: randomUUID(), email };
    this.usersByEmail.set(email, created);
    return created;
  }

  public async createVerificationToken(identifier: string, token: string, expires: Date): Promise<void> {
    this.tokens.set(`${identifier}:${token}`, { expires });
    this.createdTokens.push({ identifier, token, expires });
  }

  public async consumeVerificationToken(identifier: string, token: string, now: Date): Promise<boolean> {
    const key = `${identifier}:${token}`;
    const record = this.tokens.get(key);
    if (!record) return false;
    this.tokens.delete(key);
    return record.expires.getTime() > now.getTime();
  }
}
