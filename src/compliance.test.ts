import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Part 12 compliance, enforced as tests.
 *
 * §12's constraints are "non-negotiable" and "violating any of these is a
 * product failure regardless of how well it works." A constraint that is only
 * written down is a constraint that erodes; these are the ones that can be
 * mechanically checked, so they are.
 *
 * DECISIONS.md D-060 specifically calls for a test that greps rendered copy for
 * guarantee language.
 */

const ROOT = join(__dirname);

function walk(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(ROOT, ['.ts', '.tsx']).filter(
  (file) => !file.includes('.test.') && !file.includes('__fixtures__'),
);

/** Strips comments so a spec citation is not mistaken for user-facing copy. */
function codeOnly(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('§12 — never state a refund or a saving as guaranteed', () => {
  /**
   * "Best Rate Guarantee" and "Lowest Hotel Rate Guarantee" are the programmes'
   * own proper nouns and must stay. What is banned is Parity claiming that
   * *its* numbers are guaranteed.
   */
  const BANNED = [
    /guaranteed\s+savings?/i,
    /savings?\s+(?:is|are)\s+guaranteed/i,
    /guaranteed\s+refund/i,
    /refund\s+is\s+guaranteed/i,
    /we\s+guarantee/i,
    /you\s+are\s+guaranteed/i,
    /guaranteed\s+to\s+save/i,
  ];

  it.each(BANNED.map((pattern) => [pattern.source, pattern] as const))(
    'no source file contains %s',
    (_label, pattern) => {
      const offenders = sourceFiles.filter((file) =>
        pattern.test(codeOnly(readFileSync(file, 'utf8'))),
      );
      expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
    },
  );

  it('permits the programmes’ own proper nouns', () => {
    // A false positive here would push us into renaming Hilton's programme.
    const properNoun = 'Hilton Price Match Guarantee and the Lowest Hotel Rate Guarantee';
    for (const pattern of BANNED) {
      expect(pattern.test(properNoun)).toBe(false);
    }
  });
});

describe('§12 — no credentials, ever', () => {
  it('no source file collects a password, a card number, or a CVV', () => {
    // "Parity never asks for, stores, transmits, or proxies a bank,
    // card-issuer, or hotel-portal password. No OAuth-shaped workaround."
    const banned = /type=["']password["']|cardNumber|creditCardNumber|\bcvv\b|securityCode/i;
    const offenders = sourceFiles.filter((file) => {
      const contents = codeOnly(readFileSync(file, 'utf8'));
      // The logger's redaction list names these deliberately, in order to
      // scrub them if they ever appear.
      if (file.includes('observability/Logger.ts')) return false;
      return banned.test(contents);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('the cards table stores a kind, never a number — §12 PII minimisation', () => {
    const schema = readFileSync(join(ROOT, 'infrastructure/persistence/schema.ts'), 'utf8');
    expect(schema).toMatch(/card_kind|cardKind/);
    expect(codeOnly(schema)).not.toMatch(/cardNumber|pan\b|cvv/i);
  });
});

describe('§12 — data export and deletion both exist and are reachable', () => {
  it('exposes an export route and a deletion route', () => {
    // "Data export and deletion must both work from /settings and must actually
    // cascade." Non-negotiable, so its existence is asserted rather than
    // assumed — a route deleted in a refactor fails here.
    expect(existsSync(join(ROOT, 'app/api/account/export/route.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'app/api/account/route.ts'))).toBe(true);
  });

  it('offers both from /settings', () => {
    const settings = readFileSync(join(ROOT, 'features/settings/SettingsScreen.tsx'), 'utf8');
    expect(settings).toContain('AccountDataSection');

    const section = readFileSync(join(ROOT, 'features/settings/AccountDataSection.tsx'), 'utf8');
    expect(section).toContain('/api/account/export');
    expect(section).toContain('/api/account');
  });

  it('requires typed confirmation before deleting', () => {
    // §1.5 promises the ledger survives the user's own audit, which only holds
    // if a year of records cannot be destroyed by a mis-click.
    const route = readFileSync(join(ROOT, 'app/api/account/route.ts'), 'utf8');
    expect(route).toContain('confirmEmail');
  });
});

describe('§5.1 — mutations are rate limited', () => {
  it('enforces a limit in the shared route wrapper, not per route', () => {
    // A limit that has to be remembered in each of twenty-five route files is
    // a limit that will be missing from one of them.
    const handler = readFileSync(join(ROOT, 'lib/api/handler.ts'), 'utf8');
    expect(handler).toContain('enforceRateLimit');
    expect(handler).toContain('countsAgainstBudget');
  });

  it('uses the figure §5.1 specifies', () => {
    const limiter = readFileSync(join(ROOT, 'lib/api/rate-limit.ts'), 'utf8');
    expect(limiter).toContain('MUTATION_LIMIT_PER_MINUTE = 60');
  });
});

describe('§1.4 — no LLM anywhere in a numeric path', () => {
  it('the domain layer contains no AI SDK, model call, or network access at all', () => {
    // "The engine is deterministic arithmetic. If you add an LLM call anywhere
    // that affects a number the user sees, you have broken the product."
    const domainFiles = sourceFiles.filter((file) => file.includes(`${'/'}domain${'/'}`));
    expect(domainFiles.length).toBeGreaterThan(10);

    const banned = /@anthropic-ai|openai|langchain|\bfetch\s*\(|XMLHttpRequest|axios/i;
    const offenders = domainFiles.filter((file) =>
      banned.test(codeOnly(readFileSync(file, 'utf8'))),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('no dependency in package.json is an LLM client', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, '..', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    const llmClients = names.filter((name) =>
      /@anthropic-ai|^openai$|langchain|@google\/generative-ai|cohere|mistralai|ollama/.test(name),
    );
    expect(llmClients).toEqual([]);
  });
});

describe('§1.4 and §12 — no scraping, no live rate feeds, no third-party analytics', () => {
  it('no dependency is a headless browser or an OTA/GDS client', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, '..', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    // §12: "No scraping of issuer or OTA sites from any server. This is both a
    // terms-of-service and an account-security position."
    const runtime = Object.keys(pkg.dependencies ?? {});
    const banned = runtime.filter((name) =>
      /puppeteer|playwright|cheerio|selenium|amadeus|sabre|expedia|^got$|jsdom/.test(name),
    );
    expect(banned).toEqual([]);
  });

  it('no third-party analytics or session-recording script is referenced', () => {
    // "Self-hosted or privacy-preserving only. No session recording. No
    // third-party pixel. The app knows what hotels the user is considering."
    const banned =
      /google-analytics|googletagmanager|segment\.com|mixpanel|fullstory|hotjar|logrocket|sentry\.io/i;
    const offenders = sourceFiles.filter((file) =>
      banned.test(codeOnly(readFileSync(file, 'utf8'))),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});

describe('§6.1 — no raw design values outside the token file', () => {
  const uiFiles = sourceFiles.filter(
    (file) => file.includes(`${'/'}components${'/'}`) || file.includes(`${'/'}features${'/'}`),
  );

  it('has UI files to check', () => {
    expect(uiFiles.length).toBeGreaterThan(10);
  });

  it('no component contains a raw hex or rgba colour', () => {
    // §6.1: "A grep for `#` inside src/components/ returns nothing but comments."
    // This is what makes swapping the design system a one-file edit, which is
    // the entire mitigation for §6.1's unresolved assumption (D-050).
    const offenders = uiFiles.filter((file) =>
      /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(codeOnly(readFileSync(file, 'utf8'))),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('no component hardcodes a px font size or radius', () => {
    const offenders = uiFiles.filter((file) =>
      /text-\[\d+px\]|rounded-\[\d+px\]|fontSize:\s*['"]\d+px/.test(
        codeOnly(readFileSync(file, 'utf8')),
      ),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('no component uses --brand as a text colour', () => {
    // §6.7: --brand is 3.3:1 in dark mode. Legal for fills, borders and large
    // text; never for body text. A component cannot know which theme it is in,
    // so it must never choose (D-052).
    const offenders = uiFiles.filter((file) =>
      /\btext-brand\b/.test(codeOnly(readFileSync(file, 'utf8'))),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('no component uses a data-viz series colour as a text colour', () => {
    // Same failure mode as --brand, one step further out. §6.5 verifies the
    // series palette at ≥3:1, which §6.7 permits for graphical objects and
    // large text but not for body text (4.5:1). Series identity belongs on a
    // swatch or a mark; the words stay on --text-*. This also satisfies §6.5
    // rule 7, which forbids identity being carried by colour alone.
    const offenders = uiFiles.filter((file) =>
      /\btext-series-[0-9]\b/.test(codeOnly(readFileSync(file, 'utf8'))),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});

describe('§7.2 — the fixed sidebar cannot cover the main column', () => {
  const tailwind = readFileSync(join(ROOT, '..', 'tailwind.config.ts'), 'utf8');
  const shell = readFileSync(join(ROOT, 'components/layout/AppShell.tsx'), 'utf8');

  it('offsets the main column by the sidebar width', () => {
    expect(shell).toMatch(/pl-rail/);
    expect(shell).toMatch(/pl-sidebar/);
  });

  it('defines sidebar and rail in the spacing scale, not only in width', () => {
    // The bug this guards against emitted no CSS at all: `pl-*` resolves
    // against `spacing`, so defining these under `width` alone made
    // `lg:pl-sidebar` a no-op class and the fixed sidebar silently covered the
    // left edge of every screen at ≥ 640px — blocking a real mouse, not just a
    // test runner. A missing utility fails silently, which is exactly why it
    // needs an assertion. See DECISIONS.md D-120.
    const spacingBlock = tailwind.slice(
      tailwind.indexOf('spacing: {'),
      tailwind.indexOf('fontFamily'),
    );
    expect(spacingBlock).toContain("sidebar: 'var(--sidebar-width)'");
    expect(spacingBlock).toContain("rail: 'var(--sidebar-rail)'");
  });
});

describe('hexagonal boundaries — DECISIONS.md D-033', () => {
  it('the domain layer imports nothing from infrastructure, app, or the UI', () => {
    const domainFiles = sourceFiles.filter((file) => file.includes(`${'/'}domain${'/'}`));
    const banned = /from ['"]@\/(infrastructure|app|components|features|lib)\//;

    const offenders = domainFiles.filter((file) => banned.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('the domain layer imports no React', () => {
    const domainFiles = sourceFiles.filter((file) => file.includes(`${'/'}domain${'/'}`));
    const offenders = domainFiles.filter((file) =>
      /from ['"]react['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('the pure engine reads no clock and no randomness', () => {
    // §3: "no dates from `Date.now()` inside pure functions (pass `now` in), no
    // randomness, no network."
    const engineFiles = sourceFiles.filter((file) => file.includes(`${'/'}domain/engine${'/'}`));
    expect(engineFiles.length).toBeGreaterThan(5);

    const offenders = engineFiles.filter((file) => {
      const code = codeOnly(readFileSync(file, 'utf8'));
      // The profiler *supplies* a timer rather than reading one, and its
      // default reads no clock at all (D-041) — that indirection is the point.
      if (file.endsWith('profiler.ts')) return false;
      return /Date\.now\(\)|new Date\(|Math\.random\(/.test(code);
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
