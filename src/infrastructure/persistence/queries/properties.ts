import { asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { properties } from '../schema';
import type { BrandOrNone } from '@/domain/rules/channels.rules';
import type { PropertyOption } from '@/features/compare/CompareScreen';

/**
 * Property lookup for the comparator's combobox — §7.3 item 1, §8.5.
 *
 * Returns seeded (global) rows plus the user's own. §7.8: "The user's own edits
 * shadow seeds rather than mutating them", so a user row with the same name
 * wins and the seed stays intact for everyone else.
 */
export async function listProperties(userId?: string): Promise<PropertyOption[]> {
  const rows = await db
    .select()
    .from(properties)
    .where(
      userId
        ? or(isNull(properties.userId), eq(properties.userId, userId))
        : isNull(properties.userId),
    )
    .orderBy(asc(properties.name))
    .limit(500);

  const byName = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    const existing = byName.get(key);
    // A user-scoped row shadows the global seed of the same name.
    if (!existing || (row.userId !== null && existing.userId === null)) {
      byName.set(key, row);
    }
  }

  return [...byName.values()].map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city ?? '',
    brand: (row.brand ?? 'NONE') as BrandOrNone,
    inFhr: row.inFhr,
    inThc: row.inThc,
    inEdit: row.inEdit,
    propertyCreditFaceCents: row.propertyCreditFaceCents,
    propertyCreditKind: row.propertyCreditKind ?? 'ANY',
  }));
}

/** Free-text search for the combobox, matching on name or city. */
export async function searchProperties(
  query: string,
  userId?: string,
  limit = 25,
): Promise<PropertyOption[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return (await listProperties(userId)).slice(0, limit);

  const pattern = `%${trimmed.toLowerCase()}%`;
  const rows = await db
    .select()
    .from(properties)
    .where(
      sql`(${properties.userId} IS NULL ${userId ? sql`OR ${properties.userId} = ${userId}` : sql``})
          AND (lower(${properties.name}) LIKE ${pattern} OR lower(${properties.city}) LIKE ${pattern})`,
    )
    .orderBy(asc(properties.name))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city ?? '',
    brand: (row.brand ?? 'NONE') as BrandOrNone,
    inFhr: row.inFhr,
    inThc: row.inThc,
    inEdit: row.inEdit,
    propertyCreditFaceCents: row.propertyCreditFaceCents,
    propertyCreditKind: row.propertyCreditKind ?? 'ANY',
  }));
}
