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
