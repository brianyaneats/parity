import type { BrandOrNone } from '@/domain/rules/channels.rules';
import type { PropertyCreditKind } from '@/domain/rules/perks.rules';

/**
 * Seeded property intelligence — §4.4.
 *
 * "Seed ~40 properties covering the overlap between FHR/THC and The Edit in
 * cities the user cares about — Tokyo, Chicago, Seattle, New York, London,
 * Paris."
 *
 * Programme membership is the point. §8.5: knowing a property is in both FHR
 * and The Edit lets the comparator pre-populate the right channel rows and warn
 * when the user is about to compare FHR at a property that isn't in FHR. Over
 * time this becomes the app's most valuable data, which is why user corrections
 * write user-scoped overrides rather than mutating these rows (§7.8).
 *
 * All rows seed with `user_id = NULL`, marking them global.
 *
 * **On accuracy:** programme rosters change constantly — a property moves in and
 * out of The Edit without notice. These are seeded as *starting points the user
 * corrects*, not as verified facts, and the property screen exposes an inline
 * editor for exactly that reason. Nothing in the engine trusts them: they
 * pre-fill inputs, and the user's entered rates are what get computed.
 */

export interface PropertySeed {
  readonly name: string;
  readonly city: string;
  readonly country: string;
  readonly address: string | null;
  readonly brand: BrandOrNone;
  readonly inFhr: boolean;
  readonly inThc: boolean;
  readonly inEdit: boolean;
  readonly propertyCreditFaceCents: number;
  readonly propertyCreditKind: PropertyCreditKind;
  readonly notes: string | null;
}

const p = (
  name: string,
  city: string,
  country: string,
  brand: BrandOrNone,
  membership: { fhr?: boolean; thc?: boolean; edit?: boolean },
  credit: { cents?: number; kind?: PropertyCreditKind } = {},
  notes: string | null = null,
  address: string | null = null,
): PropertySeed => ({
  name,
  city,
  country,
  address,
  brand,
  inFhr: membership.fhr ?? false,
  inThc: membership.thc ?? false,
  inEdit: membership.edit ?? false,
  propertyCreditFaceCents: credit.cents ?? 10_000,
  propertyCreditKind: credit.kind ?? 'ANY',
  notes,
});

export const PROPERTY_SEEDS: readonly PropertySeed[] = Object.freeze([
  // ---------------------------------------------------------------- Tokyo
  // §4.4 names these five explicitly. They are the fixture set for the E2E
  // flows in §10.3, so their membership flags must match the spec exactly.
  p(
    'Four Seasons Hotel Tokyo at Otemachi',
    'Tokyo',
    'JP',
    'NONE',
    { fhr: true, edit: true },
    { cents: 10_000, kind: 'DINING' },
    'In both Fine Hotels + Resorts and The Edit — the comparison where the FHR price-match asymmetry matters most.',
    '1-2-1 Otemachi, Chiyoda City',
  ),
  p(
    'Bulgari Hotel Tokyo',
    'Tokyo',
    'JP',
    'NONE',
    { fhr: true, edit: true },
    { cents: 10_000, kind: 'DINING' },
    'In both portals. Compare the two before booking.',
    '2-2-1 Yaesu, Chuo City',
  ),
  p(
    'Andaz Tokyo Toranomon Hills',
    'Tokyo',
    'JP',
    'HYATT',
    { edit: true },
    { cents: 10_000, kind: 'ANY' },
    'Hyatt-branded, so the chain best-rate guarantee is a live alternative path to The Edit.',
    '1-23-4 Toranomon, Minato City',
  ),
  p(
    'Four Seasons Hotel Tokyo at Marunouchi',
    'Tokyo',
    'JP',
    'NONE',
    { edit: true },
    { cents: 10_000, kind: 'DINING' },
    'The Edit only — no FHR row to compare against here.',
    '1-11-1 Marunouchi, Chiyoda City',
  ),
  p(
    'Kimpton Shinjuku Tokyo',
    'Tokyo',
    'JP',
    'IHG',
    { edit: true },
    { cents: 10_000, kind: 'DINING' },
    'IHG-branded: the chain guarantee pays 5× points rather than a discount.',
    '3-4-7 Yoyogi, Shibuya City',
  ),
  p('Aman Tokyo', 'Tokyo', 'JP', 'NONE', { fhr: true }, { cents: 10_000, kind: 'SPA' },
    'Spa-weighted credit — set realization below 100% unless a treatment is already planned.'),
  p('The Peninsula Tokyo', 'Tokyo', 'JP', 'NONE', { fhr: true }, { cents: 10_000, kind: 'DINING' }),
  p('Park Hyatt Tokyo', 'Tokyo', 'JP', 'HYATT', { edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Mandarin Oriental Tokyo', 'Tokyo', 'JP', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Hoshinoya Tokyo', 'Tokyo', 'JP', 'NONE', { thc: true }, { cents: 10_000, kind: 'ANY' }),

  // --------------------------------------------------------------- New York
  p('The Mark', 'New York', 'US', 'NONE', { fhr: true }, { cents: 10_000, kind: 'DINING' }),
  p('The Carlyle, A Rosewood Hotel', 'New York', 'US', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('The Greenwich Hotel', 'New York', 'US', 'NONE', { fhr: true }, { cents: 10_000, kind: 'ANY' }),
  p('Park Hyatt New York', 'New York', 'US', 'HYATT', { edit: true }, { cents: 10_000, kind: 'ANY' }),
  p('The Ritz-Carlton New York, NoMad', 'New York', 'US', 'MARRIOTT', { edit: true }, { cents: 10_000, kind: 'DINING' },
    'Marriott-branded, but §2.3.3 excludes some Ritz-Carlton properties from the chain guarantee — verify before relying on it.'),
  p('Aman New York', 'New York', 'US', 'NONE', { fhr: true }, { cents: 10_000, kind: 'SPA' }),
  p('The Lowell', 'New York', 'US', 'NONE', { thc: true }, { cents: 10_000, kind: 'DINING' }),
  p('Casa Cipriani New York', 'New York', 'US', 'NONE', { thc: true, edit: true }, { cents: 10_000, kind: 'ANY' }),

  // ---------------------------------------------------------------- Chicago
  p('The Peninsula Chicago', 'Chicago', 'US', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Four Seasons Hotel Chicago', 'Chicago', 'US', 'NONE', { fhr: true }, { cents: 10_000, kind: 'DINING' }),
  p('Waldorf Astoria Chicago', 'Chicago', 'US', 'HILTON', { edit: true }, { cents: 10_000, kind: 'ANY' },
    'Hilton-branded: the chain guarantee matches and takes a further 25% off.'),
  p('The Langham, Chicago', 'Chicago', 'US', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Park Hyatt Chicago', 'Chicago', 'US', 'HYATT', { edit: true }, { cents: 10_000, kind: 'ANY' }),
  p('Thompson Chicago', 'Chicago', 'US', 'HYATT', { thc: true, edit: true }, { cents: 10_000, kind: 'ANY' }),
  p('The Talbott Hotel', 'Chicago', 'US', 'NONE', { thc: true }, { cents: 10_000, kind: 'ANY' }),

  // ---------------------------------------------------------------- Seattle
  p('Four Seasons Hotel Seattle', 'Seattle', 'US', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Fairmont Olympic Hotel', 'Seattle', 'US', 'MARRIOTT', { edit: true }, { cents: 10_000, kind: 'ANY' }),
  p('Thompson Seattle', 'Seattle', 'US', 'HYATT', { thc: true, edit: true }, { cents: 10_000, kind: 'ANY' }),
  p('Lotte Hotel Seattle', 'Seattle', 'US', 'NONE', { thc: true }, { cents: 10_000, kind: 'DINING' }),
  p('The Inn at the Market', 'Seattle', 'US', 'NONE', { thc: true }, { cents: 10_000, kind: 'ANY' }),
  p('Hotel Theodore', 'Seattle', 'US', 'IHG', { edit: true }, { cents: 10_000, kind: 'ANY' }),

  // ----------------------------------------------------------------- London
  p('Claridge’s', 'London', 'GB', 'NONE', { fhr: true }, { cents: 10_000, kind: 'DINING' }),
  p('The Connaught', 'London', 'GB', 'NONE', { fhr: true }, { cents: 10_000, kind: 'SPA' }),
  p('The Savoy', 'London', 'GB', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('The Berkeley', 'London', 'GB', 'NONE', { fhr: true }, { cents: 10_000, kind: 'SPA' }),
  p('Rosewood London', 'London', 'GB', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('The Ned', 'London', 'GB', 'NONE', { thc: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Park Hyatt London River Thames', 'London', 'GB', 'HYATT', { edit: true }, { cents: 10_000, kind: 'ANY' }),
  p('The Langham, London', 'London', 'GB', 'NONE', { fhr: true }, { cents: 10_000, kind: 'DINING' }),

  // ------------------------------------------------------------------ Paris
  p('Le Bristol Paris', 'Paris', 'FR', 'NONE', { fhr: true }, { cents: 10_000, kind: 'DINING' }),
  p('Four Seasons Hotel George V', 'Paris', 'FR', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Hôtel Plaza Athénée', 'Paris', 'FR', 'NONE', { fhr: true }, { cents: 10_000, kind: 'SPA' }),
  p('Le Meurice', 'Paris', 'FR', 'NONE', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('Cheval Blanc Paris', 'Paris', 'FR', 'NONE', { fhr: true }, { cents: 10_000, kind: 'SPA' }),
  p('Hôtel de Crillon', 'Paris', 'FR', 'MARRIOTT', { fhr: true, edit: true }, { cents: 10_000, kind: 'DINING' }),
  p('La Réserve Paris', 'Paris', 'FR', 'NONE', { thc: true }, { cents: 10_000, kind: 'SPA' }),
  p('Hôtel Lutetia', 'Paris', 'FR', 'MARRIOTT', { edit: true }, { cents: 10_000, kind: 'SPA' }),
]);

/** §4.4 requires roughly forty. Asserted in the seed test so a trim is deliberate. */
export const PROPERTY_SEED_COUNT = PROPERTY_SEEDS.length;
