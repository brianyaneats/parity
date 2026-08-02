import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { competingRates } from '../schema';
import { cents } from '@/domain/shared/cents';
import type {
  CompetingRateRecord,
  CompetingRateRepository,
} from '@/application/ports/CompetingRateRepository';
import type { NewCompetingRateInput } from '@/application/ports/ComparisonRepository';

/** Drizzle implementation of `CompetingRateRepository` — §4.2, evidence route. */
export class DrizzleCompetingRateRepository implements CompetingRateRepository {
  public async create(comparisonId: string, input: NewCompetingRateInput): Promise<CompetingRateRecord> {
    const [row] = await db
      .insert(competingRates)
      .values({
        comparisonId,
        siteDomain: input.siteDomain,
        url: input.url,
        baseCents: input.baseCents,
        taxCents: input.taxCents ?? null,
        refundable: input.refundable,
        publiclyAvailable: input.publiclyAvailable,
        roomType: input.roomType ?? null,
        bedType: input.bedType ?? null,
        adults: input.adults ?? null,
        children: input.children ?? null,
        currency: input.currency ?? null,
        capturedAt: input.capturedAt,
      })
      .returning();
    if (!row) throw new Error('Insert into competing_rates returned no row.');
    return toRecord(row);
  }

  public async findById(id: string): Promise<CompetingRateRecord | null> {
    const [row] = await db.select().from(competingRates).where(eq(competingRates.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  /**
   * The rate a comparison was decided against — the basis of any claim opened
   * from a booking on that comparison. Takes the most recently captured one if
   * a comparison has several; the newest is what the user was looking at when
   * they decided.
   */
  public async findByComparisonId(comparisonId: string): Promise<CompetingRateRecord | null> {
    const rows = await db
      .select()
      .from(competingRates)
      .where(eq(competingRates.comparisonId, comparisonId))
      .orderBy(desc(competingRates.capturedAt))
      .limit(1);

    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  public async setScreenshotKey(id: string, screenshotKey: string): Promise<CompetingRateRecord | null> {
    const [row] = await db
      .update(competingRates)
      .set({ screenshotKey })
      .where(eq(competingRates.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }
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

function toRecord(row: CompetingRateRowLike): CompetingRateRecord {
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
