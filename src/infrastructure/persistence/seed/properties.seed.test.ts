import { describe, it, expect } from 'vitest';
import { PROPERTY_SEEDS, PROPERTY_SEED_COUNT } from './properties.seed';
import { CHANNEL_RANK_ORDER } from '@/domain/rules/channels.rules';

/**
 * §4.4's seed requirements, asserted.
 *
 * "Seed ~40 properties covering the overlap between FHR/THC and The Edit in
 * cities the user cares about — Tokyo, Chicago, Seattle, New York, London,
 * Paris. Tokyo must include: …"
 *
 * The named Tokyo properties are not decoration: §10.3's first E2E flow drives
 * Four Seasons Otemachi specifically, so its membership flags are effectively
 * part of the test fixture set.
 */

const byName = (name: string) => PROPERTY_SEEDS.find((seed) => seed.name.includes(name));

describe('§4.4 seed coverage', () => {
  it('seeds roughly forty properties', () => {
    expect(PROPERTY_SEED_COUNT).toBeGreaterThanOrEqual(40);
    expect(PROPERTY_SEED_COUNT).toBeLessThan(60);
  });

  it('covers every city the spec names', () => {
    const cities = new Set(PROPERTY_SEEDS.map((seed) => seed.city));
    for (const city of ['Tokyo', 'Chicago', 'Seattle', 'New York', 'London', 'Paris']) {
      expect(cities).toContain(city);
    }
  });

  it('gives every city more than one option, so a comparison is possible', () => {
    const counts = new Map<string, number>();
    for (const seed of PROPERTY_SEEDS) {
      counts.set(seed.city, (counts.get(seed.city) ?? 0) + 1);
    }
    for (const [city, count] of counts) {
      expect(count, `${city} has only ${count} property`).toBeGreaterThan(1);
    }
  });

  it('has no duplicate property names', () => {
    const names = PROPERTY_SEEDS.map((seed) => seed.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('§4.4 — the five named Tokyo properties', () => {
  it('Four Seasons Otemachi is in both FHR and The Edit', () => {
    // The E2E fixture property. This is the comparison where the FHR
    // price-match asymmetry (§2.3.2) actually bites, which is why the spec
    // names it first.
    const property = byName('Otemachi');
    expect(property?.inFhr).toBe(true);
    expect(property?.inEdit).toBe(true);
    expect(property?.city).toBe('Tokyo');
  });

  it('Bulgari Tokyo is in both FHR and The Edit', () => {
    const property = byName('Bulgari Hotel Tokyo');
    expect(property?.inFhr).toBe(true);
    expect(property?.inEdit).toBe(true);
  });

  it('Andaz Toranomon Hills is in The Edit and branded Hyatt', () => {
    // The Hyatt brand is what makes the §3.5 best-rate-guarantee fork reachable
    // from this property — fixture TC-08 uses exactly that pairing.
    const property = byName('Andaz Tokyo Toranomon Hills');
    expect(property?.inEdit).toBe(true);
    expect(property?.brand).toBe('HYATT');
  });

  it('Four Seasons Marunouchi is in The Edit', () => {
    const property = byName('Marunouchi');
    expect(property?.inEdit).toBe(true);
  });

  it('Kimpton Shinjuku is in The Edit and branded IHG', () => {
    const property = byName('Kimpton Shinjuku');
    expect(property?.inEdit).toBe(true);
    expect(property?.brand).toBe('IHG');
  });
});

describe('seed data integrity', () => {
  it('covers the FHR/Edit overlap that makes the asymmetry insight demonstrable', () => {
    // §8.4 requires a persistent note whenever a comparison holds both an FHR
    // and an Edit quote. Without seeded overlap, that insight would never fire
    // from seeded data and would go untested in practice.
    const overlap = PROPERTY_SEEDS.filter((seed) => seed.inFhr && seed.inEdit);
    expect(overlap.length).toBeGreaterThanOrEqual(8);
  });

  it('includes properties in each portal so every channel row is reachable', () => {
    expect(PROPERTY_SEEDS.some((seed) => seed.inFhr)).toBe(true);
    expect(PROPERTY_SEEDS.some((seed) => seed.inThc)).toBe(true);
    expect(PROPERTY_SEEDS.some((seed) => seed.inEdit)).toBe(true);
  });

  it('includes several chain brands so the BRG fork is reachable', () => {
    const brands = new Set(
      PROPERTY_SEEDS.map((seed) => seed.brand).filter((brand) => brand !== 'NONE'),
    );
    expect(brands.size).toBeGreaterThanOrEqual(3);
    expect(brands).toContain('HYATT');
  });

  it('uses only brands the rules module knows about', () => {
    const known = new Set(['NONE', 'HILTON', 'MARRIOTT', 'HYATT', 'IHG', 'WYNDHAM', 'CHOICE', 'BEST_WESTERN']);
    for (const seed of PROPERTY_SEEDS) {
      expect(known, `${seed.name} has brand ${seed.brand}`).toContain(seed.brand);
    }
  });

  it('uses only credit kinds the realization hint knows about', () => {
    const known = new Set(['DINING', 'SPA', 'RESORT', 'ANY']);
    for (const seed of PROPERTY_SEEDS) {
      expect(known).toContain(seed.propertyCreditKind);
    }
  });

  it('gives every seed a positive integer credit face in cents', () => {
    for (const seed of PROPERTY_SEEDS) {
      expect(Number.isInteger(seed.propertyCreditFaceCents)).toBe(true);
      expect(seed.propertyCreditFaceCents).toBeGreaterThan(0);
    }
  });

  it('uses two-letter ISO country codes', () => {
    for (const seed of PROPERTY_SEEDS) {
      expect(seed.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('flags a spa-weighted credit in the notes, since realization should not default to 100%', () => {
    // §2.6: "a spa-only credit for someone who won't spa: maybe 20%."
    const spa = PROPERTY_SEEDS.filter((seed) => seed.propertyCreditKind === 'SPA');
    expect(spa.length).toBeGreaterThan(0);
    expect(spa.some((seed) => seed.notes !== null)).toBe(true);
  });
});

describe('seeds do not encode engine behaviour', () => {
  it('carries no rates, so nothing seeded can affect a computed number', () => {
    // Rates come from the user (§1.4: no live rate feeds). A seeded rate would
    // quietly become an input to the engine.
    for (const seed of PROPERTY_SEEDS) {
      expect(Object.keys(seed)).not.toContain('totalCents');
      expect(Object.keys(seed)).not.toContain('baseCents');
    }
  });

  it('never names a channel directly — membership flags are the interface', () => {
    const serialised = JSON.stringify(PROPERTY_SEEDS);
    for (const channel of CHANNEL_RANK_ORDER) {
      expect(serialised).not.toContain(`"${channel}"`);
    }
  });
});
