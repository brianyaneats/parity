import { describe, it, expect } from 'vitest';
import { programmeMismatch, type PropertyOption } from '../CompareScreen';
import { CHANNEL_RANK_ORDER } from '@/domain/rules/channels.rules';

/**
 * §8.5's second half: "warn when a user is about to compare FHR at a property
 * that isn't in FHR."
 *
 * This is the half that catches a mistake rather than saving a keystroke. A
 * quote entered against a programme the property does not belong to produces a
 * confidently wrong comparison — the engine grants breakfast, a property credit
 * and a $300 statement credit the booking cannot actually earn, and that
 * channel wins on entitlements it never had.
 */

const property = (over: Partial<PropertyOption> = {}): PropertyOption => ({
  id: 'p1',
  name: 'Four Seasons Hotel Tokyo at Otemachi',
  city: 'Tokyo',
  brand: 'NONE',
  inFhr: true,
  inThc: false,
  inEdit: true,
  propertyCreditFaceCents: 10_000,
  propertyCreditKind: 'DINING',
  ...over,
});

describe('programmeMismatch — §8.5', () => {
  it('stays silent when the property is in the programme', () => {
    expect(programmeMismatch('FHR', property())).toBeNull();
    expect(programmeMismatch('EDIT', property())).toBeNull();
  });

  it('warns when comparing FHR at a property that is not in FHR', () => {
    const warning = programmeMismatch('FHR', property({ inFhr: false }));
    expect(warning).toContain('Fine Hotels + Resorts');
    expect(warning).toContain('Four Seasons Hotel Tokyo at Otemachi');
  });

  it('warns for The Edit and The Hotel Collection on the same basis', () => {
    expect(programmeMismatch('EDIT', property({ inEdit: false }))).toContain('The Edit');
    expect(programmeMismatch('THC', property({ inThc: false }))).toContain(
      'The Hotel Collection',
    );
  });

  it('names the consequence, not just the fact — §13.1’s copy rule', () => {
    // "Name the number and the consequence in the same sentence." There is no
    // number here, but the consequence still has to be stated: a warning that
    // only says "not in FHR" leaves the user to work out why that matters.
    const warning = programmeMismatch('FHR', property({ inFhr: false })) ?? '';
    expect(warning).toMatch(/cannot actually earn|statement credit/);
    expect(warning).toMatch(/Properties screen|check the portal/);
  });

  it('stays silent with no property selected', () => {
    // Warning on absence of data would train the user to ignore the warning.
    for (const channel of CHANNEL_RANK_ORDER) {
      expect(programmeMismatch(channel, null)).toBeNull();
    }
  });

  it('never warns about a channel that has no programme membership to check', () => {
    const nonPortal = CHANNEL_RANK_ORDER.filter(
      (channel) => !['FHR', 'THC', 'EDIT'].includes(channel),
    );
    const barren = property({ inFhr: false, inThc: false, inEdit: false });

    for (const channel of nonPortal) {
      expect(programmeMismatch(channel, barren)).toBeNull();
    }
  });

  it('warns independently per programme on a property in only one of them', () => {
    // The Edit-only case: an FHR row is a mistake, an Edit row is fine.
    const editOnly = property({ inFhr: false, inThc: false, inEdit: true });
    expect(programmeMismatch('FHR', editOnly)).not.toBeNull();
    expect(programmeMismatch('THC', editOnly)).not.toBeNull();
    expect(programmeMismatch('EDIT', editOnly)).toBeNull();
  });
});
