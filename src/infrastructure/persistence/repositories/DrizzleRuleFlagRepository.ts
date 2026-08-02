import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { ruleFlags } from '../schema';
import type {
  NewRuleFlagInput,
  RuleFlagRecord,
  RuleFlagRepository,
} from '@/application/ports/RuleFlagRepository';

/** `RuleFlagRepository` — Drizzle-backed, over `rule_flags` (§4.2, §2.8). */
export class DrizzleRuleFlagRepository implements RuleFlagRepository {
  public async create(input: NewRuleFlagInput): Promise<RuleFlagRecord> {
    const [row] = await db
      .insert(ruleFlags)
      .values({
        userId: input.userId,
        ruleKey: input.ruleKey,
        note: input.note ?? null,
      })
      .returning();

    if (!row) {
      throw new Error('Insert into rule_flags returned no row.');
    }

    return toRecord(row);
  }

  public async listByUser(userId: string): Promise<readonly RuleFlagRecord[]> {
    const rows = await db
      .select()
      .from(ruleFlags)
      .where(eq(ruleFlags.userId, userId))
      .orderBy(desc(ruleFlags.createdAt));

    return rows.map(toRecord);
  }
}

function toRecord(row: typeof ruleFlags.$inferSelect): RuleFlagRecord {
  return {
    id: row.id,
    userId: row.userId,
    ruleKey: row.ruleKey,
    note: row.note,
    createdAt: row.createdAt,
  };
}
