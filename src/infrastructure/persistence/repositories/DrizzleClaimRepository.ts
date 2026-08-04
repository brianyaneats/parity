import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db';
import { bookings, claims, userSettings, users } from '../schema';
import { cents } from '@/domain/shared/cents';
import type {
  ClaimListFilter,
  ClaimPatch,
  ClaimRecord,
  ClaimRepository,
  ClaimSweepRow,
  NewClaimInput,
} from '@/application/ports/ClaimRepository';
import type { DenialCode } from '@/domain/claim/DenialReason';
import type { DrizzleHandle } from './drizzle-handle';

const DEFAULT_TIMEZONE = 'America/New_York';

/** Drizzle implementation of `ClaimRepository` — §4.2, §7.4, §9. */
export class DrizzleClaimRepository implements ClaimRepository {
  constructor(private readonly handle: DrizzleHandle = db) {}

  public async create(input: NewClaimInput): Promise<ClaimRecord> {
    const [row] = await this.handle
      .insert(claims)
      .values({
        id: input.id,
        userId: input.userId,
        bookingId: input.bookingId,
        competingRateId: input.competingRateId,
        kind: input.kind,
        deadlineAt: input.deadlineAt,
        status: input.status,
        claimedGapCents: input.claimedGapCents,
      })
      .returning();
    if (!row) throw new Error('Insert into claims returned no row.');
    return toClaimRecord(row);
  }

  public async findById(id: string, userId: string): Promise<ClaimRecord | null> {
    const [row] = await this.handle
      .select()
      .from(claims)
      .where(and(eq(claims.id, id), eq(claims.userId, userId)))
      .limit(1);
    return row ? toClaimRecord(row) : null;
  }

  public async list(userId: string, filter: ClaimListFilter): Promise<readonly ClaimRecord[]> {
    const conditions = [eq(claims.userId, userId)];
    if (filter.status?.length) conditions.push(inArray(claims.status, [...filter.status]));
    if (filter.dueWithinMs !== undefined) {
      conditions.push(gte(claims.deadlineAt, filter.now));
      conditions.push(lte(claims.deadlineAt, new Date(filter.now.getTime() + filter.dueWithinMs)));
    }

    const rows = await this.handle
      .select()
      .from(claims)
      .where(and(...conditions))
      .orderBy(claims.deadlineAt);
    return rows.map(toClaimRecord);
  }

  public async update(id: string, userId: string, patch: ClaimPatch): Promise<ClaimRecord | null> {
    const [row] = await this.handle
      .update(claims)
      .set({
        ...(patch.competingRateId !== undefined ? { competingRateId: patch.competingRateId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.awardedCents !== undefined ? { awardedCents: patch.awardedCents } : {}),
        ...(patch.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}),
        ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
        ...(patch.denialReason !== undefined ? { denialReason: patch.denialReason } : {}),
        ...(patch.denialCode !== undefined ? { denialCode: patch.denialCode } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(claims.id, id), eq(claims.userId, userId)))
      .returning();
    return row ? toClaimRecord(row) : null;
  }

  public async listOpenForSweep(now: Date): Promise<readonly ClaimSweepRow[]> {
    void now; // Every ELIGIBLE/PREPARING claim is a sweep candidate; checkpoint math happens in the use case.
    const rows = await db
      .select({
        claim: claims,
        bookedAt: bookings.bookedAt,
        userEmail: users.email,
        userTimezone: userSettings.timezone,
      })
      .from(claims)
      .innerJoin(bookings, eq(claims.bookingId, bookings.id))
      .innerJoin(users, eq(claims.userId, users.id))
      .leftJoin(userSettings, eq(userSettings.userId, claims.userId))
      .where(inArray(claims.status, ['ELIGIBLE', 'PREPARING']));

    return rows.map((row) => ({
      claim: toClaimRecord(row.claim),
      bookedAt: row.bookedAt,
      userEmail: row.userEmail,
      userTimezone: row.userTimezone ?? DEFAULT_TIMEZONE,
    }));
  }
}

interface ClaimRowLike {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string;
  readonly competingRateId: string | null;
  readonly kind: ClaimRecord['kind'];
  readonly deadlineAt: Date;
  readonly status: ClaimRecord['status'];
  readonly claimedGapCents: number | null;
  readonly awardedCents: number | null;
  readonly submittedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly denialReason: string | null;
  // The column is plain `text`, unlike `kind`'s `.$type<ClaimKind>()` — cast
  // at the boundary in `toClaimRecord` below rather than widening it there.
  readonly denialCode: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

function toClaimRecord(row: ClaimRowLike): ClaimRecord {
  return {
    id: row.id,
    userId: row.userId,
    bookingId: row.bookingId,
    competingRateId: row.competingRateId,
    kind: row.kind,
    deadlineAt: row.deadlineAt,
    status: row.status,
    claimedGapCents: row.claimedGapCents !== null ? cents(row.claimedGapCents) : null,
    awardedCents: row.awardedCents !== null ? cents(row.awardedCents) : null,
    submittedAt: row.submittedAt,
    resolvedAt: row.resolvedAt,
    denialReason: row.denialReason,
    denialCode: row.denialCode as DenialCode | null,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}
