import { eq } from 'drizzle-orm';
import { db } from '../db';
import { userSettings, users } from '../schema';
import type {
  NotificationRecipient,
  UserSettingsPatch,
  UserSettingsRecord,
  UserSettingsRepository,
} from '@/application/ports/UserSettingsRepository';

/**
 * `UserSettingsRepository` — Drizzle-backed, over `user_settings` (§4.2).
 *
 * `user_settings` has no `INSERT` path of its own anywhere else in this
 * slice — the row is materialized lazily, the first time anyone reads or
 * writes it, with every column but `userId` falling back to the schema's
 * `DEFAULT`. `getOrCreate` and `update` both go through the same
 * `INSERT ... ON CONFLICT (user_id) DO ...` upsert for that reason: whichever
 * one runs first is the one that creates the row.
 */
export class DrizzleUserSettingsRepository implements UserSettingsRepository {
  public async getOrCreate(userId: string): Promise<UserSettingsRecord> {
    const inserted = await db
      .insert(userSettings)
      .values({ userId })
      .onConflictDoNothing({ target: userSettings.userId })
      .returning();

    const row = inserted[0] ?? (await this.selectOne(userId));
    if (!row) {
      throw new Error(`user_settings row for user ${userId} could not be created or found.`);
    }

    return toRecord(row);
  }

  public async update(userId: string, patch: UserSettingsPatch): Promise<UserSettingsRecord> {
    const updatedAt = new Date();
    const values = { userId, ...patch, updatedAt };

    const [row] = await db
      .insert(userSettings)
      .values(values)
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...patch, updatedAt } })
      .returning();

    if (!row) {
      throw new Error(`user_settings upsert for user ${userId} returned no row.`);
    }

    return toRecord(row);
  }

  public async listRecipients(): Promise<readonly NotificationRecipient[]> {
    return db
      .select({
        userId: userSettings.userId,
        email: users.email,
        timezone: userSettings.timezone,
      })
      .from(userSettings)
      .innerJoin(users, eq(userSettings.userId, users.id));
  }

  private async selectOne(userId: string): Promise<typeof userSettings.$inferSelect | undefined> {
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    return rows[0];
  }
}

function toRecord(row: typeof userSettings.$inferSelect): UserSettingsRecord {
  return {
    userId: row.userId,
    mrValueMicro: row.mrValueMicro,
    urValueMicro: row.urValueMicro,
    breakfastPerDayCents: row.breakfastPerDayCents,
    foraRateBps: row.foraRateBps,
    foraMember: row.foraMember,
    cardmemberAnniversary: row.cardmemberAnniversary,
    homeCurrency: row.homeCurrency,
    timezone: row.timezone,
    theme: row.theme,
  };
}
