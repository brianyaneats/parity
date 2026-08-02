import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { RulesScreen } from '../RulesScreen';
import { ALL_RULES, buildRuleViews, findRule, formatRuleValue, type RuleView } from '@/domain/rules/registry';
import { RULE_STALENESS_DAYS, VERIFIED_ON } from '@/domain/rules/rule-types';

/**
 * §2.8 / §7.8: `/settings/rules` is the one place the user can tell the app a
 * programme changed, so this suite checks the three things the task brief
 * calls out explicitly — the staleness indicator's presence is conditional on
 * age, every rule carries a source link, and `formatRuleValue`'s output (not
 * a raw, undecoded number) is what actually lands on the page.
 *
 * `RulesScreen` renders `<ToastProvider>`-dependent children (`FlagButton`
 * calls `useToast()`), so every render here is wrapped in one, matching how
 * `src/app/(app)/layout.tsx` wraps the real app.
 */

afterEach(cleanup);

function renderRules(views: readonly RuleView[]) {
  return render(
    <ToastProvider>
      <RulesScreen views={views} />
    </ToastProvider>,
  );
}

const DAY_MS = 86_400_000;

function fixtureView(overrides: Partial<RuleView> & { key: string; label: string }): RuleView {
  return {
    description: 'A rule constructed only for this test.',
    category: 'POINTS',
    categoryLabel: 'Points and valuations',
    value: 100,
    unit: 'bps',
    verifiedOn: '2026-01-01',
    sourceUrl: 'https://example.com/test-rule',
    ageDays: 1,
    stale: false,
    ...overrides,
  };
}

describe('<RulesScreen /> — staleness indicator', () => {
  it('renders a staleness indicator for a rule older than 180 days and not for a fresh one', () => {
    const staleView = fixtureView({
      key: 'TEST_STALE_RULE',
      label: 'A long-unchecked rule',
      ageDays: RULE_STALENESS_DAYS + 1,
      stale: true,
    });
    const freshView = fixtureView({
      key: 'TEST_FRESH_RULE',
      label: 'A recently-checked rule',
      ageDays: 4,
      stale: false,
    });

    renderRules([staleView, freshView]);

    const staleRow = screen.getByText(staleView.label).closest('tr');
    const freshRow = screen.getByText(freshView.label).closest('tr');
    expect(staleRow).not.toBeNull();
    expect(freshRow).not.toBeNull();

    expect(within(staleRow as HTMLElement).getByText(/Stale/)).toBeInTheDocument();
    expect(within(freshRow as HTMLElement).queryByText(/Stale/)).not.toBeInTheDocument();
  });
});

describe('<RulesScreen /> — source links', () => {
  it('renders every rule in the registry with a source link', () => {
    // A `now` just past VERIFIED_ON — nothing is stale, which is irrelevant to
    // this assertion but keeps the render's other content unsurprising.
    const now = new Date(new Date(`${VERIFIED_ON}T00:00:00Z`).getTime() + 30 * DAY_MS);
    const views = buildRuleViews(now);

    renderRules(views);

    const links = screen.getAllByRole('link', { name: 'View source' });
    expect(links).toHaveLength(ALL_RULES.length);

    for (const link of links) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\//) as unknown as string);
      expect(link).toHaveAttribute('target', '_blank');
    }
  });
});

describe('<RulesScreen /> — formatRuleValue rendering', () => {
  it('shows a bps rule formatted as a percentage', () => {
    const rule = findRule('FORA_RATE_BPS');
    expect(rule).toBeDefined();
    const now = new Date(`${VERIFIED_ON}T00:00:00Z`);
    renderRules(buildRuleViews(now));

    expect(formatRuleValue(rule!)).toBe('7.00%');
    expect(screen.getByText('7.00%')).toBeInTheDocument();
  });

  it('shows a micro rule formatted as cents-per-point', () => {
    const rule = findRule('MR_DEFAULT_VALUE_MICRO');
    expect(rule).toBeDefined();
    const now = new Date(`${VERIFIED_ON}T00:00:00Z`);
    renderRules(buildRuleViews(now));

    expect(formatRuleValue(rule!)).toBe('1.50¢ per point');
    expect(screen.getByText('1.50¢ per point')).toBeInTheDocument();
  });
});
