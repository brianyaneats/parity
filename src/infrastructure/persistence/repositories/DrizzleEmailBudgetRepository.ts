import { sql } from 'drizzle-orm';
import { db } from '../db';
import { emailSendCounters, emailSendDailyTotals } from '../schema';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import {
  RECIPIENT_DAILY_EMAIL_LIMIT,
  RECIPIENT_EMAIL_COOLDOWN_MS,
  type EmailBudgetBlockReason,
  type EmailBudgetDecision,
  type EmailBudgetRepository,
} from '@/application/ports/EmailBudgetRepository';

/**
 * Thrown inside the transaction below to abort it — never escapes
 * `reserveSend`, which catches it and turns it back into a plain
 * `EmailBudgetDecision`. Postgres rolling the transaction back is what
 * undoes any counter this attempt already incremented before the block was
 * discovered, which is what keeps a rejected attempt from silently spending
 * budget for a send that never happened.
 */
class BudgetBlocked extends Error {
  constructor(public readonly reason: EmailBudgetBlockReason) {
    super(`email budget blocked: ${reason}`);
  }
}

/**
 * Drizzle implementation of `EmailBudgetRepository` — see that port's module
 * doc for the full reasoning. The entire mechanism is two conditional
 * upserts, each `INSERT ... ON CONFLICT (...) DO UPDATE ... WHERE <cond>
 * RETURNING *`:
 *
 * - On the very first send to a recipient today (or the first send globally
 *   today), there's no conflicting row, so the plain `INSERT` always
 *   succeeds — a cold counter can never itself be "over budget."
 * - On every later send that day, the row already exists, so the statement
 *   takes Postgres's row-level lock for that row as part of evaluating the
 *   `DO UPDATE ... WHERE` clause. If the `WHERE` condition is false against
 *   the *current* (locked) row, Postgres performs no update at all — the
 *   conflicting row is left exactly as it was, and `RETURNING` yields zero
 *   rows.
 *
 * That row lock is what makes this safe under real concurrency: two
 * transactions racing to increment the same counter serialize on the lock
 * rather than both reading the same "under budget" snapshot and both
 * proceeding — the exact read-then-write race a plain `SELECT count(...)`
 * followed by an `UPDATE` would have.
 *
 * `reserveSend` runs the per-recipient check first, then the global check,
 * inside one `db.transaction`. If either is blocked it throws `BudgetBlocked`
 * (caught below, turned into `{ allowed: false, reason }`), which rolls the
 * whole transaction back — so a per-recipient increment that already
 * committed within this attempt is undone if the *global* check
 * subsequently fails, rather than being left spent for a send that the
 * global cap prevented from ever happening.
 */
export class DrizzleEmailBudgetRepository implements EmailBudgetRepository {
  public async reserveSend(email: string, now: Date, globalDailyLimit: number): Promise<EmailBudgetDecision> {
    const sendDate = toIsoDate(now);
    const cooldownCutoff = new Date(now.getTime() - RECIPIENT_EMAIL_COOLDOWN_MS);

    // `.values()`/`.set()` go through Drizzle's typed column mapping, which
    // knows how to serialise a `Date` for a `timestamptz` column — but a raw
    // `sql` template (used for the `setWhere` conditions below, since a
    // conflict-update `WHERE` clause has no typed-column equivalent in
    // Drizzle) loses that mapping and hands the interpolated value straight
    // to the driver as a bind parameter. `postgres` (the driver) does not
    // know how to bind a raw `Date`, only primitives — so every `sql`
    // interpolation below is a string or a number, never a `Date` object.
    const cooldownCutoffIso = cooldownCutoff.toISOString();

    try {
      await db.transaction(async (tx) => {
        const [recipientRow] = await tx
          .insert(emailSendCounters)
          .values({ email, sendDate, count: 1, lastSentAt: now })
          .onConflictDoUpdate({
            target: [emailSendCounters.email, emailSendCounters.sendDate],
            set: {
              count: sql`${emailSendCounters.count} + 1`,
              lastSentAt: now,
            },
            setWhere: sql`${emailSendCounters.count} < ${RECIPIENT_DAILY_EMAIL_LIMIT}
              AND (${emailSendCounters.lastSentAt} IS NULL OR ${emailSendCounters.lastSentAt} <= ${cooldownCutoffIso}::timestamptz)`,
          })
          .returning();
        if (!recipientRow) throw new BudgetBlocked('RECIPIENT_LIMIT');

        const [globalRow] = await tx
          .insert(emailSendDailyTotals)
          .values({ sendDate, count: 1 })
          .onConflictDoUpdate({
            target: emailSendDailyTotals.sendDate,
            set: { count: sql`${emailSendDailyTotals.count} + 1` },
            setWhere: sql`${emailSendDailyTotals.count} < ${globalDailyLimit}`,
          })
          .returning();
        if (!globalRow) throw new BudgetBlocked('GLOBAL_LIMIT');
      });

      return { allowed: true };
    } catch (error) {
      if (error instanceof BudgetBlocked) return { allowed: false, reason: error.reason };
      throw error;
    }
  }
}
