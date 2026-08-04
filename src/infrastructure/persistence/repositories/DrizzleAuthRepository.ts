import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { users, verificationTokens } from '../schema';
import type { AuthRepository, AuthUserRecord } from '@/application/ports/AuthRepository';

/** Drizzle implementation of `AuthRepository`, against Auth.js's standard `users`/`verification_tokens` tables. */
export class DrizzleAuthRepository implements AuthRepository {
  public async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? { id: row.id, email: row.email } : null;
  }

  public async findOrCreateUserByEmail(email: string): Promise<AuthUserRecord> {
    // `onConflictDoNothing` + re-select rather than a returning upsert: a
    // DO UPDATE would bump nothing meaningful here, and DO NOTHING returns no
    // row on conflict, so the follow-up select covers both the "just created"
    // and the "already existed" (including a concurrent-request winner) cases.
    const [inserted] = await db.insert(users).values({ email }).onConflictDoNothing().returning();
    if (inserted) return { id: inserted.id, email: inserted.email };

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!existing) throw new Error('findOrCreateUserByEmail: insert conflicted but no row exists');
    return { id: existing.id, email: existing.email };
  }

  public async createVerificationToken(identifier: string, token: string, expires: Date): Promise<void> {
    await db.insert(verificationTokens).values({ identifier, token, expires });
  }

  public async consumeVerificationToken(identifier: string, token: string, now: Date): Promise<boolean> {
    const [row] = await db
      .delete(verificationTokens)
      .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token)))
      .returning();
    if (!row) return false;
    return row.expires.getTime() > now.getTime();
  }
}
