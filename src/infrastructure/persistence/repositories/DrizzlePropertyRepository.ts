import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { properties, type PropertyRow } from '../schema';
import { cents } from '@/domain/shared/cents';
import type {
  NewPropertyInput,
  PropertyRecord,
  PropertyRepository,
  PropertySearchFilter,
} from '@/application/ports/PropertyRepository';

/**
 * Drizzle-backed `PropertyRepository` — §4.2, §4.4, §7.8.
 *
 * `search()` mirrors the dedup logic already used by
 * `queries/properties.ts`'s `listProperties`/`searchProperties`: global
 * (`userId IS NULL`) rows plus the caller's own, collapsed by lower-cased name
 * with the user-scoped row shadowing the global seed of the same name — §7.8's
 * "the user's own edits shadow seeds rather than mutating them."
 */
export class DrizzlePropertyRepository implements PropertyRepository {
  public async create(input: NewPropertyInput): Promise<PropertyRecord> {
    const [row] = await db
      .insert(properties)
      .values({
        userId: input.userId,
        name: input.name,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        // Optional fields with a DB default: passed through as-is. Drizzle
        // maps an `undefined` value to the column's `DEFAULT` clause rather
        // than a literal NULL, so a caller who omits `brand` still gets
        // 'NONE' rather than a NOT NULL violation.
        brand: input.brand,
        inFhr: input.inFhr,
        inThc: input.inThc,
        inEdit: input.inEdit,
        propertyCreditFaceCents: input.propertyCreditFaceCents,
        propertyCreditKind: input.propertyCreditKind ?? null,
        notes: input.notes ?? null,
      })
      .returning();

    if (!row) {
      throw new Error('Insert into properties did not return a row.');
    }
    return toRecord(row);
  }

  public async findById(id: string): Promise<PropertyRecord | null> {
    const rows = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  public async search(
    userId: string,
    filter: PropertySearchFilter,
  ): Promise<readonly PropertyRecord[]> {
    const limit = filter.limit ?? 25;
    const q = filter.q?.trim();
    const city = filter.city?.trim();
    const qPattern = q ? `%${q.toLowerCase()}%` : null;

    // A generous internal cap, well above `limit`: de-duplication happens in
    // memory below, so the SQL-level cap needs enough headroom that a
    // user-scoped row never gets crowded out of the result set by its own
    // global seed before the dedup pass gets a chance to prefer it.
    const rows = await db
      .select()
      .from(properties)
      .where(
        and(
          or(isNull(properties.userId), eq(properties.userId, userId)),
          ...(qPattern
            ? [sql`(lower(${properties.name}) LIKE ${qPattern} OR lower(${properties.city}) LIKE ${qPattern})`]
            : []),
          ...(city ? [sql`lower(${properties.city}) = ${city.toLowerCase()}`] : []),
        ),
      )
      .orderBy(asc(properties.name))
      .limit(500);

    const byName = new Map<string, PropertyRow>();
    for (const row of rows) {
      const key = row.name.toLowerCase();
      const existing = byName.get(key);
      // A user-scoped row shadows the global seed of the same name — §7.8.
      if (!existing || (row.userId !== null && existing.userId === null)) {
        byName.set(key, row);
      }
    }

    return [...byName.values()].slice(0, limit).map(toRecord);
  }
}

function toRecord(row: PropertyRow): PropertyRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    address: row.address,
    city: row.city,
    country: row.country,
    brand: row.brand,
    inFhr: row.inFhr,
    inThc: row.inThc,
    inEdit: row.inEdit,
    propertyCreditFaceCents: cents(row.propertyCreditFaceCents),
    propertyCreditKind: row.propertyCreditKind,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}
