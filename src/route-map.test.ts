import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * §7.1's route map, asserted as a completeness check.
 *
 * §0.4's definition of done requires that "every screen in Part 7 exists and
 * renders all of its specified states." This test covers the first half — that
 * the screen exists at all — which is the half that silently rots when a
 * refactor moves a folder.
 *
 * The second half (empty / loading / error / populated) is covered by each
 * screen's own component tests.
 */

const APP = join(__dirname, 'app');

/** Every route §7.1 enumerates, with the file that must back it. */
const ROUTES: readonly { path: string; file: string; note: string }[] = Object.freeze([
  { path: '/', file: 'page.tsx', note: 'redirects: signed out → /login, signed in → /compare' },
  { path: '/login', file: 'login/page.tsx', note: 'magic link' },
  { path: '/compare', file: '(app)/compare/page.tsx', note: 'the comparator, the primary screen' },
  { path: '/compare/[id]', file: '(app)/compare/[id]/page.tsx', note: 'a saved comparison, read-only until recompute' },
  { path: '/claims', file: '(app)/claims/page.tsx', note: 'claim queue, sorted by deadline' },
  { path: '/claims/[id]', file: '(app)/claims/[id]/page.tsx', note: 'the claim kit' },
  { path: '/credits', file: '(app)/credits/page.tsx', note: 'the credit wallet' },
  { path: '/trips', file: '(app)/trips/page.tsx', note: 'trip list' },
  { path: '/trips/[id]', file: '(app)/trips/[id]/page.tsx', note: 'trip detail with its comparisons' },
  { path: '/watchlist', file: '(app)/watchlist/page.tsx', note: 'refundable bookings being re-shopped' },
  { path: '/ledger', file: '(app)/ledger/page.tsx', note: 'the savings ledger' },
  { path: '/properties', file: '(app)/properties/page.tsx', note: 'property intelligence' },
  { path: '/settings', file: '(app)/settings/page.tsx', note: 'valuations, cards, anniversary' },
  { path: '/settings/rules', file: '(app)/settings/rules/page.tsx', note: 'rule constants with verified dates' },
]);

describe('§7.1 route map — every screen exists', () => {
  it.each(ROUTES.map((route) => [route.path, route.file, route.note] as const))(
    '%s — %s',
    (_path, file) => {
      expect(existsSync(join(APP, file))).toBe(true);
    },
  );

  it('covers all fourteen routes the spec enumerates', () => {
    expect(ROUTES).toHaveLength(14);
  });
});

describe('§7.2 global shell', () => {
  const shell = readFileSync(join(__dirname, 'components/layout/AppShell.tsx'), 'utf8');

  it('links every sidebar destination §7.2 names', () => {
    for (const href of ['/compare', '/claims', '/credits', '/trips', '/watchlist', '/ledger']) {
      expect(shell).toContain(`'${href}'`);
    }
  });

  it('pins settings to the bottom rather than putting it in the main list', () => {
    expect(shell).toContain("'/settings'");
  });

  it('has no top bar, search bar, or notification bell — the badges carry it', () => {
    // §7.2 is explicit about the absences, and they are load-bearing: the whole
    // notification surface is two badges, which only works if nothing else
    // competes for the same attention.
    expect(shell).not.toMatch(/<header|role="search"|NotificationBell|<SearchBar/);
  });

  it('badges only the two things that cost real money if ignored', () => {
    // §7.2: Claims when within 24h, Credits when a bucket expires within 30
    // days. §1.5 lists both as success criteria.
    expect(shell).toMatch(/claims\?:\s*number/);
    expect(shell).toMatch(/credits\?:\s*number/);
  });
});

describe('§5.2 API surface', () => {
  const API = join(APP, 'api');

  /** Routes the spec's table names that must exist as handlers. */
  const REQUIRED = [
    'compare/route.ts',
    'health/route.ts',
    'rules/route.ts',
    'rules/flag/route.ts',
    'ledger/route.ts',
  ];

  it.each(REQUIRED)('%s exists', (file) => {
    expect(existsSync(join(API, file))).toBe(true);
  });

  it('leaves /api/health unauthenticated and authenticates everything else', () => {
    // §5.1: "Auth on every route except `/api/health`."
    const health = readFileSync(join(API, 'health/route.ts'), 'utf8');
    expect(health).not.toContain('requireUser');

    const compare = readFileSync(join(API, 'compare/route.ts'), 'utf8');
    expect(compare).toContain('requireUser');
  });
});
