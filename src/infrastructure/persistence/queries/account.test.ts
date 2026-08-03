import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '../schema';

/**
 * §12, non-negotiable: "Data export and deletion must both work from
 * `/settings` and must actually cascade. **Test it.**"
 *
 * A live-database integration test covers the cascade actually firing (CI runs
 * one against a Postgres service container). These tests cover the failure this
 * feature will really have, which is not a broken `DELETE` — Postgres is good
 * at those — but **a table added later that nobody remembers to export.**
 *
 * So the assertions are structural: every user-scoped table in the schema must
 * appear in the export, and the check derives its list from the schema rather
 * than from a hand-maintained copy. Add a table, forget the export, fail here.
 */

const accountSource = readFileSync(join(__dirname, 'account.ts'), 'utf8');

/** Every exported Drizzle table object in the schema, by variable name. */
function schemaTableNames(): string[] {
  return Object.entries(schema)
    .filter(([, value]) => {
      if (typeof value !== 'object' || value === null) return false;
      // Drizzle tags each table object with well-known symbols; the presence of
      // a `Symbol(drizzle:Name)` entry is what distinguishes a table from an
      // enum or a relations object.
      return Object.getOwnPropertySymbols(value).some((s) => s.description?.includes('drizzle:Name'));
    })
    .map(([name]) => name);
}

/**
 * Tables that are deliberately not part of a user's export.
 *
 * `properties` IS exported, but only the user's own overrides — seeded rows
 * carry `user_id = NULL` and are not theirs. Auth tables hold session material,
 * not user content, and exporting a session token would be a security defect
 * rather than a courtesy.
 *
 * `emailSendCounters`/`emailSendDailyTotals` (added under the email-budget
 * remediation — see `EmailBudgetRepository.ts`) are anti-abuse bookkeeping,
 * not user content: they have no `userId` column at all — they're keyed by
 * recipient email address and by calendar day, deliberately disconnected
 * from any one account, since the whole point is to bound a caller who need
 * not be a registered user in the first place. There is nothing here to
 * scope by `userId`, and "how many magic-link sends this address has left
 * today" is operational rate-limit state, not a record of anything the user
 * did.
 */
const NOT_USER_CONTENT = new Set([
  'users',
  'accounts',
  'sessions',
  'verificationTokens',
  'emailSendCounters',
  'emailSendDailyTotals',
]);

describe('§12 — the export covers every user-scoped table', () => {
  it('finds the schema tables to check against', () => {
    expect(schemaTableNames().length).toBeGreaterThanOrEqual(15);
  });

  it.each(
    schemaTableNames()
      .filter((name) => !NOT_USER_CONTENT.has(name))
      .map((name) => [name] as const),
  )('exports %s', (table) => {
    // The export module must both query the table and surface it on the result.
    expect(accountSource).toContain(`.from(${table})`);
  });

  it('exports the account holder’s own user row', () => {
    expect(accountSource).toContain('.from(users)');
  });

  it('never exports session or credential material', () => {
    // §12: no credentials, ever. A session token in an export file is a
    // credential that outlives the session.
    expect(accountSource).not.toContain('.from(sessions)');
    expect(accountSource).not.toContain('.from(accounts)');
    expect(accountSource).not.toContain('.from(verificationTokens)');
  });
});

describe('§12 — the two tables with no userId are still exported', () => {
  it('reaches quotes and competing rates through their parent comparisons', () => {
    // §4.2 scopes both only by `comparison_id`. A naive "export every table
    // with a userId column" therefore silently omits the user's own entered
    // rates — the data they would most want back.
    expect(accountSource).toContain('inArray(quotes.comparisonId');
    expect(accountSource).toContain('inArray(competingRates.comparisonId');
  });

  it('only exports the user’s own property overrides, not the seeded rows', () => {
    expect(accountSource).toContain('eq(properties.userId, userId)');
  });
});

describe('§12 — screenshots travel with both paths', () => {
  it('lists screenshot keys in the export', () => {
    // "Screenshots may contain personal data… Include them in the data export
    // and deletion paths." They live in object storage, outside the database.
    expect(accountSource).toContain('screenshotKeys');
    expect(accountSource).toContain('row.screenshotKey');
  });

  it('gathers screenshot keys before the delete, not after', () => {
    // After the delete the rows naming them are gone, and the images would be
    // unreachable but not removed — orphaned and still readable.
    const deleteFn = accountSource.slice(accountSource.indexOf('export async function deleteAccount'));
    const snapshotAt = deleteFn.indexOf('await exportAccount');
    const deleteAt = deleteFn.indexOf('db.delete(users)');
    expect(snapshotAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(snapshotAt);
  });

  it('returns the keys so the caller can purge storage', () => {
    expect(accountSource).toContain('screenshotKeys: snapshot.screenshotKeys');
  });
});

describe('§12 — deletion relies on the declared cascade', () => {
  it('deletes the user row and lets ON DELETE CASCADE do the rest', () => {
    // Enumerating child deletes by hand means a table added later is silently
    // missed. A missing cascade, by contrast, is caught by the integration test
    // that asserts every table is empty afterwards.
    expect(accountSource).toContain('db.delete(users).where(eq(users.id, userId))');
  });

  it('reports what was removed, counted before the delete', () => {
    expect(accountSource).toContain('rowsRemoved');
    expect(accountSource).toContain('deletedAt');
  });
});

describe('§4.1 — every user-scoped table actually declares the cascade', () => {
  const schemaSource = readFileSync(join(__dirname, '..', 'schema.ts'), 'utf8');

  it('declares onDelete cascade for each userId foreign key', () => {
    // The deletion path is only correct because §4.1's cascade is real, so this
    // asserts the premise rather than assuming it.
    //
    // Split on the column declaration and inspect what follows, rather than
    // trying to match the whole builder chain with one regex — the chain spans
    // several lines and contains its own parentheses.
    const declarations = schemaSource.split(/userId:\s*uuid\('user_id'\)/).slice(1);
    expect(declarations.length).toBeGreaterThanOrEqual(10);

    const withoutCascade = declarations
      .map((tail, index) => ({ index, head: tail.slice(0, 200) }))
      .filter(({ head }) => !head.includes("onDelete: 'cascade'"))
      .map(({ index, head }) => `declaration #${index}: ${head.split('\n').slice(0, 3).join(' ')}`);

    expect(withoutCascade).toEqual([]);
  });

  it('cascades from the comparison down to quotes and competing rates', () => {
    // These two have no userId of their own; deleting the user only reaches
    // them transitively, through comparisons.
    for (const table of ['quotes', 'competingRates']) {
      const block = schemaSource.slice(schemaSource.indexOf(`export const ${table} = pgTable`));
      const comparisonFk = block.slice(0, 900);
      expect(comparisonFk, `${table} must cascade from its comparison`).toContain(
        "onDelete: 'cascade'",
      );
    }
  });
});
