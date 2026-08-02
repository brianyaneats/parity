import { and, eq, lt, or, desc } from 'drizzle-orm';
import { db } from '../db';
import { comparisons, quotes as quotesTable, competingRates as competingRatesTable } from '../schema';
import { cents } from '@/domain/shared/cents';
import type {
  ComparisonListFilter,
  ComparisonListPage,
  ComparisonPatch,
  ComparisonRecord,
  ComparisonRepository,
  CompetingRateRecord,
  NewComparisonInput,
  QuoteRecord,
} from '@/application/ports/ComparisonRepository';

const DEFAULT_LIMIT = 20;

/**
 * Drizzle implementation of `ComparisonRepository` — §4.2, §4.3.
 *
 * `create()` is the only write path for a comparison's snapshot columns; there
 * is deliberately no method here that accepts `contextSnapshot`/
 * `resultSnapshot` after the row exists (§13.3). Uses the schema's relational
 * query API (`db.query.comparisons.findFirst/findMany` with `with: { quotes,
 * competingRates }`) for reads, since `comparisonsRelations` already declares
 * those joins — and a single `db.transaction` for the multi-table write.
 */
export class DrizzleComparisonRepository implements ComparisonRepository {
  public async create(input: NewComparisonInput): Promise<ComparisonRecord> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(comparisons)
        .values({
          userId: input.userId,
          tripId: input.tripId ?? null,
          propertyId: input.propertyId ?? null,
          propertyNameSnapshot: input.propertyNameSnapshot,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          nights: input.nights,
          ...(input.adults !== undefined ? { adults: input.adults } : {}),
          ...(input.children !== undefined ? { children: input.children } : {}),
          ...(input.rooms !== undefined ? { rooms: input.rooms } : {}),
          roomType: input.roomType ?? null,
          bedType: input.bedType ?? null,
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          taxRateBps: input.taxRateBps,
          ...(input.realizationPct !== undefined ? { realizationPct: input.realizationPct } : {}),
          contextSnapshot: input.contextSnapshot,
          resultSnapshot: [...input.resultSnapshot],
          engineVersion: input.engineVersion,
          ...(input.status !== undefined ? { status: input.status } : {}),
          chosenChannel: input.chosenChannel ?? null,
        })
        .returning();
      if (!row) throw new Error('Insert into comparisons returned no row.');

      const insertedQuotes = input.quotes.length
        ? await tx
            .insert(quotesTable)
            .values(
              input.quotes.map((quote, index) => ({
                comparisonId: row.id,
                channel: quote.channel,
                label: quote.label ?? null,
                totalCents: quote.totalCents,
                prepaid: quote.prepaid,
                refundable: quote.refundable,
                sourceUrl: quote.sourceUrl ?? null,
                capturedAt: quote.capturedAt ?? null,
                sortIndex: quote.sortIndex ?? index,
              })),
            )
            .returning()
        : [];

      const insertedRates = input.competingRate
        ? await tx
            .insert(competingRatesTable)
            .values({
              comparisonId: row.id,
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
              capturedAt: input.competingRate.capturedAt,
            })
            .returning()
        : [];

      return toComparisonRecord(row, insertedQuotes, insertedRates);
    });
  }

  public async findById(id: string, userId: string): Promise<ComparisonRecord | null> {
    const row = await db.query.comparisons.findFirst({
      where: and(eq(comparisons.id, id), eq(comparisons.userId, userId)),
      with: { quotes: true, competingRates: true },
    });
    return row ? toComparisonRecord(row, row.quotes, row.competingRates) : null;
  }

  public async list(userId: string, filter: ComparisonListFilter): Promise<ComparisonListPage> {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    const cursor = filter.cursor ? decodeCursor(filter.cursor) : null;

    const conditions = [eq(comparisons.userId, userId)];
    if (filter.tripId) conditions.push(eq(comparisons.tripId, filter.tripId));
    if (filter.status) conditions.push(eq(comparisons.status, filter.status));
    if (cursor) {
      const cursorCondition = or(
        lt(comparisons.createdAt, cursor.createdAt),
        and(eq(comparisons.createdAt, cursor.createdAt), lt(comparisons.id, cursor.id)),
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }

    const rows = await db.query.comparisons.findMany({
      where: and(...conditions),
      with: { quotes: true, competingRates: true },
      orderBy: [desc(comparisons.createdAt), desc(comparisons.id)],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((row) => toComparisonRecord(row, row.quotes, row.competingRates)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  public async update(id: string, userId: string, patch: ComparisonPatch): Promise<ComparisonRecord | null> {
    const [row] = await db
      .update(comparisons)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.chosenChannel !== undefined ? { chosenChannel: patch.chosenChannel } : {}),
        ...(patch.tripId !== undefined ? { tripId: patch.tripId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(comparisons.id, id), eq(comparisons.userId, userId)))
      .returning();
    if (!row) return null;

    const [rowQuotes, rowRates] = await Promise.all([
      db.select().from(quotesTable).where(eq(quotesTable.comparisonId, id)),
      db.select().from(competingRatesTable).where(eq(competingRatesTable.comparisonId, id)),
    ]);
    return toComparisonRecord(row, rowQuotes, rowRates);
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [isoAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  return { createdAt: new Date(isoAt ?? 0), id: id ?? '' };
}

// The rows Drizzle's insert/select/relational-query builders return share the
// same column shape either way, so one mapper covers every call site above.
interface ComparisonRowLike {
  readonly id: string;
  readonly userId: string;
  readonly tripId: string | null;
  readonly propertyId: string | null;
  readonly propertyNameSnapshot: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  readonly rooms: number;
  readonly roomType: string | null;
  readonly bedType: string | null;
  readonly currency: string;
  readonly taxRateBps: number;
  readonly realizationPct: number;
  readonly contextSnapshot: ComparisonRecord['contextSnapshot'];
  readonly resultSnapshot: ComparisonRecord['resultSnapshot'];
  readonly engineVersion: string;
  readonly status: ComparisonRecord['status'];
  readonly chosenChannel: ComparisonRecord['chosenChannel'];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface QuoteRowLike {
  readonly id: string;
  readonly comparisonId: string;
  readonly channel: QuoteRecord['channel'];
  readonly label: string | null;
  readonly totalCents: number;
  readonly prepaid: boolean;
  readonly refundable: boolean;
  readonly sourceUrl: string | null;
  readonly capturedAt: Date | null;
  readonly sortIndex: number;
}

interface CompetingRateRowLike {
  readonly id: string;
  readonly comparisonId: string;
  readonly siteDomain: string;
  readonly url: string;
  readonly baseCents: number;
  readonly taxCents: number | null;
  readonly refundable: boolean;
  readonly publiclyAvailable: boolean;
  readonly roomType: string | null;
  readonly bedType: string | null;
  readonly adults: number | null;
  readonly children: number | null;
  readonly currency: string | null;
  readonly screenshotKey: string | null;
  readonly capturedAt: Date;
}

function toComparisonRecord(
  row: ComparisonRowLike,
  quoteRows: readonly QuoteRowLike[],
  rateRows: readonly CompetingRateRowLike[],
): ComparisonRecord {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    propertyId: row.propertyId,
    propertyNameSnapshot: row.propertyNameSnapshot,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    nights: row.nights,
    adults: row.adults,
    children: row.children,
    rooms: row.rooms,
    roomType: row.roomType,
    bedType: row.bedType,
    currency: row.currency,
    taxRateBps: row.taxRateBps,
    realizationPct: row.realizationPct,
    contextSnapshot: row.contextSnapshot,
    resultSnapshot: row.resultSnapshot,
    engineVersion: row.engineVersion,
    status: row.status,
    chosenChannel: row.chosenChannel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    quotes: quoteRows
      .slice()
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map(toQuoteRecord),
    competingRates: rateRows.map(toCompetingRateRecord),
  };
}

function toQuoteRecord(row: QuoteRowLike): QuoteRecord {
  return {
    id: row.id,
    comparisonId: row.comparisonId,
    channel: row.channel,
    label: row.label,
    totalCents: cents(row.totalCents),
    prepaid: row.prepaid,
    refundable: row.refundable,
    sourceUrl: row.sourceUrl,
    capturedAt: row.capturedAt,
    sortIndex: row.sortIndex,
  };
}

function toCompetingRateRecord(row: CompetingRateRowLike): CompetingRateRecord {
  return {
    id: row.id,
    comparisonId: row.comparisonId,
    siteDomain: row.siteDomain,
    url: row.url,
    baseCents: cents(row.baseCents),
    taxCents: row.taxCents !== null ? cents(row.taxCents) : null,
    refundable: row.refundable,
    publiclyAvailable: row.publiclyAvailable,
    roomType: row.roomType,
    bedType: row.bedType,
    adults: row.adults,
    children: row.children,
    currency: row.currency,
    screenshotKey: row.screenshotKey,
    capturedAt: row.capturedAt,
  };
}
