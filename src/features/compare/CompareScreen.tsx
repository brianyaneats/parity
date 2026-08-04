'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  CurrencyInput,
  Disclosure,
  EmptyState,
  Input,
  NumberInput,
  Select,
  StatTile,
  Toggle,
  Combobox,
} from '@/components/ui';
import { ChannelBarList } from '@/components/compare/ChannelBar';
import { PriceMatchPanel } from '@/components/compare/PriceMatchPanel';
import {
  BrgFork,
  ClawbackGuard,
  Disclaimer,
  FhrAsymmetryNote,
  SensitivityPanel,
  WarningList,
} from '@/components/compare/Insights';
import { useComparison } from './useComparison';
import { useSaveComparison, canPersist } from './useSaveComparison';
import { PasteRateBlock } from './PasteRateBlock';
import { OnboardingBanner } from './OnboardingBanner';
import { PaymentRoutePrompt } from './PaymentRoutePrompt';
import type { PaymentRoute } from '@/domain/rules/posting.rules';
import { nightsBetween, type ParsedRate } from '@/domain/parsing/rate-paste-parser';
import { cn } from '@/lib/cn';
import { formatCents, formatSaving } from '@/lib/format';
import { CHANNEL_DEFINITIONS, CHANNEL_RANK_ORDER } from '@/domain/rules/channels.rules';
import {
  DEFAULT_BREAKFAST_PER_DAY_CENTS,
  DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
  DEFAULT_REALIZATION_PCT,
  PROPERTY_CREDIT_KIND_HINTS,
  type PropertyCreditKind,
} from '@/domain/rules/perks.rules';
import { DEFAULT_MR_VALUE_MICRO, DEFAULT_UR_VALUE_MICRO } from '@/domain/rules/points.rules';
import { DEFAULT_FORA_RATE_BPS } from '@/domain/rules/fora.rules';
import { deriveTaxRateBps } from '@/application/mappers/compare-mapper';
import { savePropertyOverride } from '@/features/properties/actions';
import type { Cents } from '@/domain/shared/cents';
import type { Channel, ChannelQuote, ComparisonResult, StayContext } from '@/domain/engine/types';
import type { BucketAvailabilitySnapshot } from '@/domain/credit/CreditBucketResolution';

/**
 * Property credit realization default when a property's credit `kind` is
 * `SPA` or `RESORT` — product-review Defect C. §2.6 defaults realization to
 * 100% and leaves it per-stay editable; that is the right default for a
 * dining or flexible credit ("usually spent in full if you eat at the hotel
 * once" — `PROPERTY_CREDIT_KIND_HINTS`), but a spa or resort credit is the
 * hint's own words "worth far less than face unless a treatment is already
 * planned" — 100% was silently wrong for those two kinds, since only the
 * *hint text* varied and the number underneath never moved. 60% is a
 * deliberately rough, conservative-leaning midpoint (not a verified rule
 * constant like §2.4/§2.6's figures — there is no source for "a typical
 * spa-credit realization rate," so this is a UI default, not a `RuleConstant`
 * in `src/domain/rules/**`), and it stays exactly as editable as before.
 */
const SPA_RESORT_REALIZATION_PCT_DEFAULT = 60;

/**
 * `/compare` — §7.3. "The whole product lives or dies here."
 *
 * Layout at ≥ 1024px is two columns: inputs left (400px, sticky), results right
 * (fluid). Below 1024px it stacks with results first once computed, because on
 * a phone the answer matters more than the form that produced it.
 *
 * The states §7.3 enumerates are all present and all distinct: empty (no
 * property), partial (fewer than two quotes), computing (previous values held,
 * dimmed, no layout shift), error (inline and retryable, never a full-page
 * crash), and computed.
 */

export interface PropertyOption {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly brand: StayContext['brand'];
  readonly inFhr: boolean;
  readonly inThc: boolean;
  readonly inEdit: boolean;
  readonly propertyCreditFaceCents: number;
  readonly propertyCreditKind: string;
}

/**
 * Honest cards gating (Feature B, item 3) — which of the two statement-credit
 * toggles the caller should see at all. Computed server-side
 * (`src/app/(app)/compare/page.tsx`'s `loadCardVisibility`) from the caller's
 * `/settings` card configuration: both `true` when nothing is configured
 * (today's founding assumption), otherwise only the card(s) actually held.
 *
 * `amex` gates the Amex Platinum $300 hotel-credit toggle, `edit` gates the
 * Chase Sapphire Reserve $250 Edit-credit toggle — matching
 * `CREDIT_BUCKET_DEFINITIONS`' own `card` field (`'AMEX_PLATINUM' | 'CSR'`).
 */
export interface CardVisibility {
  readonly amex: boolean;
  readonly edit: boolean;
}

interface QuoteDraft {
  readonly key: string;
  readonly channel: Channel;
  readonly totalCents: number | null;
  readonly prepaid: boolean;
  readonly refundable: boolean;
}

let nextKey = 0;
const makeQuote = (channel: Channel): QuoteDraft => ({
  key: `q${(nextKey += 1)}`,
  channel,
  totalCents: null,
  prepaid: CHANNEL_DEFINITIONS[channel].typicallyPrepaid,
  refundable: !CHANNEL_DEFINITIONS[channel].typicallyPrepaid,
});

const CHANNEL_OPTIONS = CHANNEL_RANK_ORDER.map((channel) => ({
  value: channel,
  label: CHANNEL_DEFINITIONS[channel].label,
}));

export interface CompareScreenProps {
  readonly properties: readonly PropertyOption[];
  /**
   * §5.3 / Defect A: the caller's live bucket state, read server-side
   * (`src/app/(app)/compare/page.tsx`) before first paint. Seeds the two
   * toggles below and the "remaining $" figures shown next to them, so the
   * very first optimistic pass computes with the same inputs
   * `POST /api/compare` will use instead of a pessimistic guess.
   */
  readonly initialBucketAvailability: BucketAvailabilitySnapshot;
  /**
   * `false` when `initialBucketAvailability` is an "assume available"
   * fallback rather than a real read (session missing, database
   * unreachable) — drives the visible "could not check your credits" note.
   * Never silently presented as fact.
   */
  readonly bucketAvailabilityKnown: boolean;
  /** §Defect E: resolves an unqualified paste date ("Sep 1") to a real year. */
  readonly currentYear: number;
  /** Honest cards gating — see `CardVisibility`'s own doc comment. */
  readonly cardVisibility: CardVisibility;
  /** §7.3 onboarding: renders `OnboardingBanner` above the form when true —
   * a signed-in caller with zero saved comparisons who hasn't dismissed it. */
  readonly showOnboarding: boolean;
}

export function CompareScreen({
  properties,
  initialBucketAvailability,
  bucketAvailabilityKnown,
  currentYear,
  cardVisibility,
  showOnboarding,
}: CompareScreenProps) {
  const [askPaymentRoute, setAskPaymentRoute] = useState(false);
  const [propertyId, setPropertyId] = useState<string | undefined>(undefined);
  const [nights, setNights] = useState(3);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [taxRateBps, setTaxRateBps] = useState(1240);
  const [quotes, setQuotes] = useState<QuoteDraft[]>([]);

  const [competitorBaseCents, setCompetitorBaseCents] = useState<number | null>(null);
  const [competitorRefundable, setCompetitorRefundable] = useState(true);
  // §7.3 item 5 lists these alongside the toggles. They are not engine inputs
  // — the ranking never reads them — but they are what makes a *claim*
  // filable: §2.3.1's PM8 match and §7.4's evidence checklist both need the
  // source named, and without them the claim kit has nothing to generate
  // text from.
  const [competitorSiteDomain, setCompetitorSiteDomain] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [competitorPublic, setCompetitorPublic] = useState(true);

  const [breakfastPerDayCents, setBreakfast] = useState<number | null>(
    DEFAULT_BREAKFAST_PER_DAY_CENTS,
  );
  const [realizationPct, setRealizationPct] = useState(DEFAULT_REALIZATION_PCT);
  /**
   * Defect C: tracks whether the user has *manually* edited realization %, so
   * the SPA/RESORT auto-default below (`applyProperty`) never stomps on a
   * deliberate override. Deliberately sticky for the rest of the session once
   * set — "do not override a value the user has already touched" has no
   * carve-out for "unless a different property gets picked next": once the
   * user has taken control of this number, no later selection may silently
   * take it back. Unlike `propertyCreditFaceCents` (which does reset on every
   * selection — a face value is a fact about the property, not a preference),
   * realization is inherently a guess about the user's own behaviour, which a
   * property change does not inform.
   */
  const realizationPctTouched = useRef(false);
  /**
   * The on-property credit's face value.
   *
   * Seeded properties carry the real figure; without one the engine fell back
   * to $100 silently, understating perks by $150–200 against the real $250
   * (Edit) or $300 (Amex) on exactly the comparisons where the user is already
   * doing the most manual work. Now it is an editable, visible assumption, and
   * the UI says when it is a guess rather than a known value.
   */
  const [propertyCreditFaceCents, setPropertyCreditFace] = useState<number | null>(
    DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
  );
  // Typed as plain numbers, not the branded `Micro`: these are user-editable
  // (§2.5) and the input layer hands back an unbranded number. The brand is
  // re-applied at the mapper boundary, which is the only place it belongs.
  const [mrValueMicro, setMr] = useState<number>(DEFAULT_MR_VALUE_MICRO);
  const [urValueMicro, setUr] = useState<number>(DEFAULT_UR_VALUE_MICRO);
  const [foraRateBps, setForaRate] = useState(DEFAULT_FORA_RATE_BPS);
  /**
   * §5.3 / Defect A — the P0 fix's other half.
   *
   * These used to default to `useState(false)`: an *unknown* bucket state
   * had to read as unavailable, the conservative direction (§0.3 item 3),
   * until the server said otherwise a debounce cycle later — and it visibly
   * did, ~300ms after every recompute settled, because the client's guess
   * and the server's authoritative answer disagreed on the very numbers the
   * user was staring at. §5.3 promises optimistic and authoritative compute
   * from *the same inputs*, and a guessed default broke that promise even
   * though the math itself was never forked.
   *
   * The real fix is one layer up: `initialBucketAvailability` is the
   * server's own read of live state (`src/app/(app)/compare/page.tsx`,
   * `deriveBucketAvailability`), hydrated *before* this component ever
   * renders. Seeding these two booleans from it means the very first
   * optimistic pass already agrees with what `POST /api/compare` will say,
   * so there is nothing left to visibly correct.
   *
   * The effect below still re-syncs from `bucketAvailability` (the
   * *hook's* own authoritative response) whenever it changes — kept
   * deliberately, as the safety net for the case the two genuinely diverge
   * (a credit gets burned by another tab mid-session, say). The toggle stays
   * user-editable throughout — §5.3 explicitly keeps the client's optimistic
   * override for a "what if" preview — but it only ever affects the local,
   * optimistic pass; `useComparison`'s authoritative response always wins
   * the actual ranking, same as every other figure on this screen.
   */
  const [amexBucketAvailable, setAmexBucket] = useState(initialBucketAvailability.amexBucketAvailable);
  const [editBucketAvailable, setEditBucket] = useState(initialBucketAvailability.editBucketAvailable);

  /**
   * Defect B: seeded from the server-rendered `properties` prop, then grown
   * client-side as the user creates free-text properties (§7.3 item 1,
   * §13.3). A prop can't hold state the user adds after first paint, and a
   * full page reload just to see the property you typed a second ago is
   * exactly the "detour to /properties" friction this defect exists to
   * remove.
   */
  const [localProperties, setLocalProperties] = useState<readonly PropertyOption[]>(properties);
  const [creatingProperty, setCreatingProperty] = useState(false);
  const [createPropertyError, setCreatePropertyError] = useState<string | null>(null);
  /** Drives the §8.5 "membership unknown" notice — cleared by any later selection. */
  const [justCreatedPropertyId, setJustCreatedPropertyId] = useState<string | null>(null);

  const property = localProperties.find((p) => p.id === propertyId) ?? null;

  /**
   * §8.5: selecting a property pre-populates the channel rows it actually
   * belongs to, so the common case needs two numbers rather than six. §13.3
   * calls input friction "the existential risk" and requires this.
   *
   * Shared by both the combobox's normal selection path (`selectProperty`
   * below) and the free-text create path (`createProperty`), so a newly
   * created property gets exactly the same treatment as picking one from the
   * list — it just starts with no known programme membership, so the
   * pre-fill suggests nothing beyond the always-present Direct-flexible row.
   */
  const applyProperty = (chosen: PropertyOption) => {
    setPropertyId(chosen.id);

    // Adopt the property's real credit face — §8.5's whole point is that
    // seeded programme data removes guesswork, and the face value is the part
    // that actually moves the ranking.
    setPropertyCreditFace(chosen.propertyCreditFaceCents);

    // Defect C: a SPA or RESORT credit is realized well below face by
    // default (see `SPA_RESORT_REALIZATION_PCT_DEFAULT`'s own comment) — but
    // never once the user has actually touched the field themselves (see
    // `realizationPctTouched`'s own comment for why this check has no
    // "unless the property changed" exception).
    if (!realizationPctTouched.current) {
      setRealizationPct(
        chosen.propertyCreditKind === 'SPA' || chosen.propertyCreditKind === 'RESORT'
          ? SPA_RESORT_REALIZATION_PCT_DEFAULT
          : DEFAULT_REALIZATION_PCT,
      );
    }

    const suggested: Channel[] = [];
    if (chosen.inEdit) suggested.push('EDIT');
    if (chosen.inFhr) suggested.push('FHR');
    if (chosen.inThc) suggested.push('THC');
    suggested.push('DIRECT_FLEX');

    setQuotes(suggested.map(makeQuote));
  };

  const selectProperty = (id: string) => {
    setJustCreatedPropertyId(null);
    const chosen = localProperties.find((p) => p.id === id);
    if (!chosen) return;
    applyProperty(chosen);
  };

  /**
   * §7.3 item 1 / §13.3: "free text creates one inline." Wired to
   * `Combobox`'s generic `onCreate` — the primitive knows only that a query
   * matched nothing; this is where that becomes "make a minimal user-scoped
   * property and select it."
   *
   * Persists via `savePropertyOverride` (`src/features/properties/actions.ts`)
   * — the same server action `/properties`'s inline editor uses, so a
   * property created here is a real, durable row the next comparison (and
   * `/properties` itself) will see, not a client-only fiction. That action
   * returns only `{ok}` (it shadows-by-name, not by id — see its own doc
   * comment), so the newly created row is built locally with a synthetic id
   * for this session, the same pattern `ComparePage`'s own seed fallback
   * already uses for DB-less rows.
   *
   * Deliberately minimal — name and (optional) city only, brand `NONE` and
   * no programme flags — because a free-text create is definitionally a
   * property the seed data does not know, and guessing its FHR/THC/Edit
   * membership would be exactly the kind of silent guess §0.3 forbids.
   * `justCreatedPropertyId` drives the §8.5 notice that tells the user this
   * plainly instead.
   */
  const createProperty = async (rawName: string) => {
    const name = rawName.trim();
    if (!name || creatingProperty) return;

    setCreatingProperty(true);
    setCreatePropertyError(null);
    try {
      const result = await savePropertyOverride({
        name,
        city: null,
        brand: 'NONE',
        inFhr: false,
        inThc: false,
        inEdit: false,
        propertyCreditFaceCents: DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
        propertyCreditKind: 'ANY',
      });

      if (!result.ok) {
        setCreatePropertyError(result.message);
        return;
      }

      const created: PropertyOption = {
        id: `local-${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        city: '',
        brand: 'NONE',
        inFhr: false,
        inThc: false,
        inEdit: false,
        propertyCreditFaceCents: DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
        propertyCreditKind: 'ANY',
      };

      setLocalProperties((rows) => [created, ...rows]);
      setJustCreatedPropertyId(created.id);
      applyProperty(created);
    } finally {
      setCreatingProperty(false);
    }
  };

  /**
   * Applies a confirmed paste — §13.3.
   *
   * Only fields the parser actually read are written; a field it could not
   * determine is left exactly as it was rather than being cleared or guessed.
   * The tax rate is *derived* from base and tax when both are present, which is
   * the case the §7.3 calculator exists for.
   */
  const applyParsedRate = (parsed: ParsedRate, channel: Channel) => {
    if (parsed.nights) setNights(Math.max(1, parsed.nights.value));

    if (parsed.baseCents && parsed.taxCents) {
      const derived = deriveTaxRateBps({
        baseCents: parsed.baseCents.value,
        taxCents: parsed.taxCents.value,
      });
      if (derived !== null) setTaxRateBps(derived);
    }

    if (parsed.totalCents) {
      setQuotes((rows) => [
        ...rows,
        {
          // The channel comes from the user's explicit choice in the paste
          // confirmation, never a default. Defaulting to EDIT silently granted
          // 8× UR, price-match eligibility and a $250 credit to any pasted
          // rate, including a Marriott.com or Expedia one.
          ...makeQuote(channel),
          totalCents: parsed.totalCents?.value ?? null,
          refundable: parsed.refundable?.value ?? true,
        },
      ]);
    }
  };

  /**
   * Defect D: the tax-rate calculator's "also use this total" affordance.
   * Fills the first quote row still missing a total rather than requiring
   * the user to retype the number they just entered above; if every row
   * already has one, it appends a fresh row instead of silently overwriting
   * a row the user may still be reviewing.
   */
  const applyTotalToFirstEmptyQuote = (totalCents: number) => {
    setQuotes((rows) => {
      const emptyIndex = rows.findIndex((row) => row.totalCents === null);
      if (emptyIndex === -1) return [...rows, { ...makeQuote('EDIT'), totalCents }];
      return rows.map((row, i) => (i === emptyIndex ? { ...row, totalCents } : row));
    });
  };

  /** Nights from the date range, or null when the range is absent or invalid. */
  const derivedNights = useMemo(
    () => (checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null),
    [checkIn, checkOut],
  );
  const effectiveNights = derivedNights ?? nights;

  const context: StayContext = useMemo(
    () => ({
      nights: effectiveNights,
      taxRateBps,
      breakfastPerDayCents: (breakfastPerDayCents ?? 0) as Cents,
      propertyCreditFaceCents: (propertyCreditFaceCents ??
        DEFAULT_PROPERTY_CREDIT_FACE_CENTS) as Cents,
      realizationPct,
      mrValueMicro,
      urValueMicro,
      foraRateBps,
      // Honest cards gating: a hidden toggle's boolean must never reach the
      // engine as `true`, even if the underlying state somehow is — see
      // `CardVisibility`'s own comment. A caller who hasn't configured an
      // Amex Platinum should never be shown perks or a statement credit they
      // have no card to actually claim, whether or not the toggle itself is
      // on screen for them to have set it.
      amexBucketAvailable: cardVisibility.amex && amexBucketAvailable,
      editBucketAvailable: cardVisibility.edit && editBucketAvailable,
      competitorBaseCents: (competitorBaseCents ?? null) as Cents | null,
      competitorRefundable,
      competitorPublic,
      brand: property?.brand ?? 'NONE',
    }),
    [
      effectiveNights,
      taxRateBps,
      breakfastPerDayCents,
      property,
      propertyCreditFaceCents,
      realizationPct,
      mrValueMicro,
      urValueMicro,
      foraRateBps,
      amexBucketAvailable,
      editBucketAvailable,
      cardVisibility.amex,
      cardVisibility.edit,
      competitorBaseCents,
      competitorRefundable,
      competitorPublic,
    ],
  );

  // Only quotes with a total entered reach the engine. A half-typed row should
  // not momentarily rank as a free hotel room.
  const engineQuotes: ChannelQuote[] = useMemo(
    () =>
      quotes
        .filter((q): q is QuoteDraft & { totalCents: number } => q.totalCents !== null)
        .map((q) => ({
          channel: q.channel,
          totalCents: q.totalCents as Cents,
          prepaid: q.prepaid,
          refundable: q.refundable,
        })),
    [quotes],
  );

  const { result, bucketAvailability, status, error, optimistic, retry } = useComparison(
    context,
    engineQuotes,
  );
  const persistence = useSaveComparison();

  /**
   * §5.3 / Defect A: "the remaining-dollar figures next to each [toggle]"
   * hydrate the same way the toggles themselves do. `useComparison`'s own
   * `bucketAvailability` is `null` until the first authoritative response
   * lands (or whenever the quote list is briefly empty — see that hook's own
   * comment), which used to mean a "Checking your live balance…" flash on
   * every fresh page load. `initialBucketAvailability` is never null, so
   * this is the real figure from the very first paint and simply gets
   * replaced by the hook's own value once it reports in (normally a no-op,
   * since both read the same live state — see `ComparePage`).
   */
  const displayedBucketAvailability = bucketAvailability ?? initialBucketAvailability;

  /**
   * Initialises the two toggles from real bucket state the moment the server
   * has actually reported it — task item 4: "must initialise those toggles
   * from real state, not `true`." Re-syncs only when the *server's* booleans
   * genuinely change value (tracked via the ref below), not on every
   * recompute — recompute happens on every keystroke and bucket state does
   * not, so re-applying it unconditionally would silently overwrite a
   * deliberate manual override a few keystrokes later.
   */
  const appliedBucketAvailability = useRef<{ amex: boolean; edit: boolean } | null>(null);
  useEffect(() => {
    if (!bucketAvailability) return;
    const next = {
      amex: bucketAvailability.amexBucketAvailable,
      edit: bucketAvailability.editBucketAvailable,
    };
    const previous = appliedBucketAvailability.current;
    if (previous && previous.amex === next.amex && previous.edit === next.edit) return;
    appliedBucketAvailability.current = next;
    setAmexBucket(next.amex);
    setEditBucket(next.edit);
  }, [bucketAvailability]);

  const saveInput = useMemo(
    () => ({
      // `seed-` ids are synthetic (the DB-unreachable fallback in
      // `ComparePage`); `local-` ids are Defect B's just-created properties,
      // which `savePropertyOverride` persisted under a real, *server-issued*
      // uuid we were never handed back (it shadows by name, not by id — see
      // that action's own doc comment). Neither is a real foreign key today,
      // so both save as an unlinked comparison, named from the snapshot
      // instead — exactly the existing seed-fallback degradation, not a new
      // one.
      propertyId:
        property && !property.id.startsWith('seed-') && !property.id.startsWith('local-')
          ? property.id
          : null,
      propertyName: property?.name ?? 'Untitled stay',
      checkIn,
      checkOut,
      context,
      quotes: engineQuotes,
      // Persisted so the claim kit can generate its text (§7.4 item 4) and so
      // the PM8 parameter match has a source to name. Only sent when the user
      // actually supplied one — a half-entered rate is worse than none.
      competingRate:
        competitorBaseCents !== null && competitorSiteDomain.trim() && competitorUrl.trim()
          ? {
              siteDomain: competitorSiteDomain.trim(),
              url: competitorUrl.trim(),
              baseCents: competitorBaseCents,
              refundable: competitorRefundable,
              publiclyAvailable: competitorPublic,
            }
          : null,
    }),
    [
      property,
      checkIn,
      checkOut,
      context,
      engineQuotes,
      competitorBaseCents,
      competitorSiteDomain,
      competitorUrl,
      competitorRefundable,
      competitorPublic,
    ],
  );

  const winner = result?.winner ?? null;

  /**
   * What the single live region says — §6.7.
   *
   * A save outcome outranks a recompute, because it is the event the user just
   * caused and is waiting on; the ranking is still on screen to be read at
   * leisure. Empty while computing, so the region does not announce a stale
   * winner mid-keystroke.
   */
  const announcement = useMemo(() => {
    if (persistence.state === 'saved') {
      return 'Comparison saved.';
    }
    if (persistence.state === 'error' && persistence.error) {
      return persistence.error;
    }
    return winner
      ? `${winner.label} ranks first at ${formatCents(winner.effectiveNetCents)} effective net.`
      : '';
  }, [persistence.state, persistence.error, winner]);
  const worst = result?.ranked.at(-1)?.result ?? null;
  const ota = result?.results.find((r) => r.channel === 'OTA') ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 lg:p-6">
      {/* §7.3 onboarding — above the whole form, not inside either column, so
          it reads before the user has committed to either side of the
          layout. Renders nothing once dismissed or once a first comparison
          exists — see `showOnboarding`'s own doc comment on the prop. */}
      {showOnboarding ? <OnboardingBanner /> : null}

      <div className="flex w-full flex-col gap-5 lg:flex-row">
        {/* ═══════════════════════════════════════════════ INPUTS (left, sticky) */}
        <section
          aria-label="Stay details"
          className="order-2 flex w-full shrink-0 flex-col gap-4 lg:order-1 lg:w-inputs lg:sticky lg:top-6 lg:self-start"
        >
          <Card className="flex flex-col gap-4">
            <Combobox
              label="Property"
              value={propertyId}
              onChange={selectProperty}
              // Defect B / §7.3 item 1: a property outside the seeded ~47 used
              // to force a detour to /properties before a comparison could even
              // start. `onCreate` is generic on the primitive; this is the one
              // place that generic hook becomes "make a minimal user-scoped
              // property and select it" — see `createProperty`'s own comment.
              onCreate={creatingProperty ? undefined : createProperty}
              createLabel={(text) => `Create “${text}” as a new property`}
              placeholder="Search seeded and saved properties, or type to add one"
              noResultsMessage="No matches. Keep typing the full name to add it."
              options={localProperties.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: `${p.city} · ${membershipSummary(p)}`,
              }))}
            />

            {!bucketAvailabilityKnown ? (
              <p className="flex gap-2 rounded-sm border border-status-warning p-2 text-xs text-text-secondary">
                {/* §6.7: colour is never the sole carrier. */}
                <span aria-hidden="true" className="font-mono text-status-warning">
                  ▲
                </span>
                <span>
                  <span className="sr-only">Check: </span>
                  Could not check your live credit balance — showing both statement credits as
                  available. Verify on the <Link href="/credits" className="underline">Credits</Link>{' '}
                  screen before you book.
                </span>
              </p>
            ) : null}

            {createPropertyError ? (
              <p role="alert" className="text-xs text-status-critical">
                {createPropertyError}
              </p>
            ) : null}

            {property && property.id === justCreatedPropertyId ? (
              // §8.5's hint, surfaced inline rather than forcing the detour
              // this defect exists to remove: a free-text property starts with
              // no known FHR/THC/Edit membership, so nothing was pre-filled
              // above and no programme-mismatch warning will fire for it
              // either, until the real membership is recorded.
              <p className="text-xs text-text-muted">
                Created “{property.name}”. Its Fine Hotels + Resorts, Hotel Collection and Edit
                membership is unknown until you set it on the{' '}
                <Link href="/properties" className="underline">
                  Properties
                </Link>{' '}
                screen — until then no channel rows are pre-filled for it.
              </p>
            ) : null}

            {/* §7.3 item 2: "Dates (range picker) → auto-computes `nights` and
                shows it read-only." Dates stay optional so §13.3's "a useful
                comparison needs only two numbers" still holds — with no dates,
                nights is entered directly; with dates, it is derived and locked. */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Check-in"
                type="date"
                value={checkIn}
                onChange={(event) => setCheckIn(event.target.value)}
              />
              <Input
                label="Check-out"
                type="date"
                value={checkOut}
                onChange={(event) => setCheckOut(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {derivedNights !== null ? (
                <div>
                  <p className="text-xs text-text-secondary">Nights</p>
                  <p className="tnum text-h3 text-text-primary">{derivedNights}</p>
                  <p className="text-xs text-text-muted">From your dates.</p>
                </div>
              ) : (
                <NumberInput
                  label="Nights"
                  value={nights}
                  onChange={(value) => setNights(Math.max(1, value ?? 1))}
                  min={1}
                  step={1}
                  hint="Or enter dates above."
                />
              )}
              <TaxRateField
                valueBps={taxRateBps}
                onChange={setTaxRateBps}
                onUseTotal={applyTotalToFirstEmptyQuote}
              />
            </div>
          </Card>

          {/* ------------------------------------------------- channel quotes */}
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-h3 text-text-primary">Channel quotes</h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setQuotes((rows) => [...rows, makeQuote('EDIT')])}
              >
                Add channel
              </Button>
            </div>

            {quotes.length === 0 ? (
              <p className="text-sm text-text-muted">
                Pick a property to pre-fill the channels it belongs to, or add one manually.
              </p>
            ) : null}

            {quotes.map((quote, index) => (
              <QuoteRow
                key={quote.key}
                quote={quote}
                programmeMismatch={programmeMismatch(quote.channel, property)}
                onChange={(next) =>
                  setQuotes((rows) => rows.map((row, i) => (i === index ? next : row)))
                }
                onRemove={() => setQuotes((rows) => rows.filter((_, i) => i !== index))}
              />
            ))}

            {/* §13.3 names input friction as the existential risk and makes the
                paste parser required. It only ever fills fields the user then
                sees and can correct — nothing here reaches the engine unreviewed.

                Defect E: `assumeYear` was never passed, so a yearless paste
                like "Sep 1" — the overwhelmingly common case, since almost no
                hotel portal prints the year on its own rate summary — failed to
                parse at all. `currentYear` comes from the server page
                (`ComparePage`), not `new Date()` here, so the very first
                server-rendered paint and the client hydration agree on it. */}
            <PasteRateBlock onApply={applyParsedRate} assumeYear={currentYear} />
          </Card>

          {/* ----------------------------------------------- competing rate */}
          <Card className="flex flex-col gap-3">
            <h2 className="text-h3 text-text-primary">Competing rate</h2>
            <CurrencyInput
              label="Base rate, excluding tax"
              value={competitorBaseCents}
              onChange={setCompetitorBaseCents}
              hint="Only the base rate is compared. Taxes are never refunded on either side."
            />

            {/* §7.3: "Two toggles are the difference between a valid and an
                invalid claim, so they carry inline help." */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Site"
                value={competitorSiteDomain}
                onChange={(event) => setCompetitorSiteDomain(event.target.value)}
                placeholder="booking.com"
                hint="Where you found it."
              />
              <Input
                label="URL"
                value={competitorUrl}
                onChange={(event) => setCompetitorUrl(event.target.value)}
                placeholder="https://…"
                hint="Carried onto the claim as evidence."
              />
            </div>

            <Toggle
              label="The competing rate is refundable"
              checked={competitorRefundable}
              onCheckedChange={setCompetitorRefundable}
              description="A cheaper non-refundable rate never qualifies against a refundable booking. This is the most common denial cause."
            />
            <Toggle
              label="The competing rate is publicly available"
              checked={competitorPublic}
              onCheckedChange={setCompetitorPublic}
              description="Member, loyalty, AAA, corporate and promotional rates are all excluded — even when the membership is free and instant."
            />
          </Card>

          {/* -------------------------------------------------- assumptions */}
          <Disclosure summary="Assumptions">
            <div className="flex flex-col gap-3 pt-2">
              <CurrencyInput
                label="Breakfast per day"
                value={breakfastPerDayCents}
                onChange={setBreakfast}
                hint="What you would otherwise have paid, not the menu price."
              />
              <CurrencyInput
                label="On-property credit face value"
                value={propertyCreditFaceCents}
                onChange={setPropertyCreditFace}
                hint={
                  property
                    ? `From ${property.name}.`
                    : 'No property selected, so this is an assumption — the real figure is usually $250 (Edit) or $300 (Amex).'
                }
              />
              <NumberInput
                label="Property credit realization %"
                value={realizationPct}
                onChange={(value) => {
                  // Defect C: a manual edit is the one thing the SPA/RESORT
                  // auto-default in `applyProperty` must never overwrite.
                  realizationPctTouched.current = true;
                  setRealizationPct(clamp(value ?? 100, 0, 100));
                }}
                min={0}
                max={100}
                hint={
                  PROPERTY_CREDIT_KIND_HINTS[
                    (property?.propertyCreditKind as PropertyCreditKind | undefined) ?? 'ANY'
                  ] ?? PROPERTY_CREDIT_KIND_HINTS.ANY
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  label="MR value (micro-cents)"
                  value={mrValueMicro}
                  onChange={(value) => setMr(Math.max(0, value ?? 0))}
                  min={0}
                  step={500}
                  hint="15000 = 1.5¢"
                />
                <NumberInput
                  label="UR value (micro-cents)"
                  value={urValueMicro}
                  onChange={(value) => setUr(Math.max(0, value ?? 0))}
                  min={0}
                  step={500}
                  hint="17500 = 1.75¢"
                />
              </div>
              <NumberInput
                label="Fora commission (bps)"
                value={foraRateBps}
                onChange={(value) => setForaRate(clamp(value ?? 0, 0, 10_000))}
                min={0}
                max={10_000}
                hint="700 = 7%. A post-stay rebate, not a discount."
              />
              {/* Honest cards gating (Feature B, item 3): a caller who has told
                  Parity they hold only one of these two cards never sees the
                  other's toggle at all — see `CardVisibility`'s own comment and
                  the `context` memo above, which keeps the hidden one's boolean
                  out of the engine regardless of this render decision. */}
              {cardVisibility.amex ? (
                <Toggle
                  label="Amex $300 hotel credit still available"
                  checked={amexBucketAvailable}
                  onCheckedChange={setAmexBucket}
                  description={bucketAvailabilityDescription({
                    available: displayedBucketAvailability.amexBucketAvailable,
                    remainingCents: displayedBucketAvailability.amexRemainingCents,
                  })}
                />
              ) : null}
              {cardVisibility.edit ? (
                <Toggle
                  label="Chase $250 Edit credit still available"
                  checked={editBucketAvailable}
                  onCheckedChange={setEditBucket}
                  description={bucketAvailabilityDescription({
                    available: displayedBucketAvailability.editBucketAvailable,
                    remainingCents: displayedBucketAvailability.editRemainingCents,
                  })}
                />
              ) : null}
              {!cardVisibility.amex || !cardVisibility.edit ? (
                <p className="text-xs text-text-muted">
                  Cards you don&rsquo;t hold are hidden — manage in{' '}
                  <Link href="/settings" className="underline">
                    Settings
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </Disclosure>
        </section>

        {/* ═══════════════════════════════════════════════════ RESULTS (right) */}
        <section
          aria-label="Results"
          className="order-1 min-w-0 flex-1 lg:order-2"
          aria-busy={status === 'computing'}
        >
          {/* §6.7: "live regions announce recompute results."
              Exactly ONE live region for this column. Two would compete: a screen
              reader interrupts itself when a second polite region changes, so the
              save confirmation would talk over the recompute announcement — and
              whichever lost is the one the user needed. The most recent
              meaningful event wins instead. */}
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>

          {!property && engineQuotes.length === 0 ? (
            // Empty state — §7.3: "show a one-line prompt and nothing else."
            <EmptyState message="Pick a property to start, or add a channel quote manually." />
          ) : engineQuotes.length < 2 ? (
            <EmptyState
              message="Add a second channel to compare. One quote has nothing to be ranked against."
              action={{
                label: 'Add channel',
                onClick: () => setQuotes((rows) => [...rows, makeQuote('FHR')]),
              }}
            />
          ) : (
            <div
              className={cn(
                'flex flex-col gap-4 transition-opacity duration-fast ease-standard',
                // Dimmed while recomputing, holding previous values. §7.3
                // requires no layout shift, so nothing is removed from the tree.
                status === 'computing' && 'opacity-60',
              )}
            >
              {error ? (
                <Card className="border-status-critical">
                  <p className="text-sm text-text-primary">{error}</p>
                  <Button variant="secondary" size="sm" className="mt-2" onClick={retry}>
                    Try again
                  </Button>
                </Card>
              ) : null}

              {result && winner ? (
                <>
                  {/* ------------------------------------------ stat tiles */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <StatTile
                      hero
                      label="You save"
                      value={formatSaving((worst?.effectiveNetCents ?? 0) - winner.effectiveNetCents)}
                      sublabel={
                        worst ? `${winner.label} versus ${worst.label}` : 'versus the worst option'
                      }
                    />
                    <StatTile
                      label="You capture"
                      value={formatCents(
                        winner.perksCents +
                          winner.creditKeptCents +
                          winner.pointsValueCents +
                          winner.refundCents +
                          winner.rebateCents,
                      )}
                      sublabel="Perks, credits, points and any refund"
                    />
                    <StatTile
                      label="You forfeit if you book wrong"
                      value={
                        ota
                          ? formatSaving(ota.effectiveNetCents - winner.effectiveNetCents)
                          : '—'
                      }
                      sublabel={ota ? 'versus the naive OTA rate' : 'Add an OTA rate to see this'}
                    />
                  </div>

                  {/* ------------------------------------- the ranked bars */}
                  <ChannelBarList ranked={result.ranked} />

                  {/* §8.4 — persistent, never a tooltip. */}
                  <FhrAsymmetryNote results={result.results} />

                  {/* §8.3 — before the user leaves for the portal. */}
                  <ClawbackGuard result={winner} />

                  {/* §8.2 */}
                  <PriceMatchPanel
                    result={winner}
                    hasCompetitor={context.competitorBaseCents !== null}
                  />

                  {/* §3.5 — a fork, never additive. */}
                  {result.brg ? <BrgFork brg={result.brg} winner={winner} /> : null}

                  {/* §8.7 — only on the authoritative result, which includes it. */}
                  <SensitivityPanel outcome={result} />

                  {/* §3.7 */}
                  <WarningList
                    warnings={[
                      ...result.warnings,
                      ...result.results.flatMap((r) => r.warnings),
                    ]}
                  />

                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        loading={persistence.state === 'saving'}
                        disabled={!canPersist(checkIn, checkOut)}
                        onClick={() => void persistence.save(saveInput)}
                      >
                        {persistence.comparisonId ? 'Saved' : 'Save comparison'}
                      </Button>
                      <Button
                        variant="secondary"
                        loading={persistence.state === 'saving'}
                        disabled={!canPersist(checkIn, checkOut)}
                        onClick={() => {
                          // Where a statement credit is at stake, ask who took
                          // the money before recording — see PaymentRoutePrompt.
                          if (winner.creditKeptCents > 0) {
                            setAskPaymentRoute(true);
                            return;
                          }
                          void persistence.markAsBooked(saveInput, winner);
                        }}
                      >
                        Mark as booked
                      </Button>
                      <Button variant="ghost" onClick={() => exportComparison(result)}>
                        Export
                      </Button>
                      {optimistic ? (
                        <span className="text-xs text-text-muted">Confirming with the server…</span>
                      ) : null}
                    </div>

                    {askPaymentRoute ? (
                      <PaymentRoutePrompt
                        creditAtRiskCents={winner.creditKeptCents}
                        pending={persistence.state === 'saving'}
                        onCancel={() => setAskPaymentRoute(false)}
                        onConfirm={(route: PaymentRoute) => {
                          void persistence.markAsBooked(saveInput, winner, route).then((ok) => {
                            if (ok) setAskPaymentRoute(false);
                          });
                        }}
                      />
                    ) : null}

                    {/* A disabled button with no reason is a dead end. §13.1:
                        name the thing and the consequence in the same sentence. */}
                    {!canPersist(checkIn, checkOut) ? (
                      <p className="text-xs text-text-muted">
                        Add check-in and check-out dates to save this comparison or record a
                        booking — both are stored against the stay.
                      </p>
                    ) : null}

                    {persistence.error ? (
                      <p role="alert" className="text-xs text-text-primary">
                        {persistence.error}
                      </p>
                    ) : null}

                    {/* Visible confirmation only — the announcement goes through
                        the single live region above, so nothing competes. */}
                    {persistence.comparisonId && persistence.state === 'saved' ? (
                      <p className="text-xs text-text-muted">
                        Saved. Recording a booking on a prepaid Edit or Chase Travel rate opens a
                        price-match claim with a 24-hour deadline.
                      </p>
                    ) : null}
                  </div>

                  <Disclaimer />
                </>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * §8.5: "warn when a user is about to compare FHR at a property that isn't in
 * FHR."
 *
 * This is the half of property intelligence that catches a mistake rather than
 * saving a keystroke. A quote entered against a programme the property does not
 * belong to produces a confidently wrong comparison — the engine will happily
 * grant it breakfast, a property credit and a $300 statement credit that do not
 * exist, and the channel will win on numbers it was never entitled to.
 *
 * Returns null when we cannot know: with no property selected, or with a
 * property whose membership was never recorded, silence is correct. Warning on
 * absence of data would train the user to ignore the warning.
 */
export function programmeMismatch(
  channel: Channel,
  property: PropertyOption | null,
): string | null {
  if (!property) return null;

  const membership: Partial<Record<Channel, { inProgramme: boolean; label: string }>> = {
    FHR: { inProgramme: property.inFhr, label: 'Fine Hotels + Resorts' },
    THC: { inProgramme: property.inThc, label: 'The Hotel Collection' },
    EDIT: { inProgramme: property.inEdit, label: 'The Edit' },
  };

  const entry = membership[channel];
  if (!entry || entry.inProgramme) return null;

  return `${property.name} is not recorded as being in ${entry.label}. If that is right, this row will credit perks and a statement credit it cannot actually earn — check the portal, or correct the property on the Properties screen.`;
}

function QuoteRow({
  quote,
  programmeMismatch: mismatch,
  onChange,
  onRemove,
}: {
  quote: QuoteDraft;
  programmeMismatch: string | null;
  onChange: (next: QuoteDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-end gap-2">
        <Select
          label="Channel"
          value={quote.channel}
          onChange={(value) => onChange({ ...quote, channel: value as Channel })}
          options={CHANNEL_OPTIONS}
          containerClassName="flex-1"
        />
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${quote.channel}`}>
          Remove
        </Button>
      </div>

      {/* Deliberately not a live region. This is persistent content tied to the
          row, not a status update — and with one per quote row, marking it
          `role="status"` would create several competing announcers. A screen
          reader reads it in document order, right where it belongs. */}
      {mismatch ? (
        <p className="flex gap-2 rounded-sm border border-status-warning p-2 text-xs text-text-secondary">
          {/* §6.7: colour is never the sole carrier — a glyph and the word
              "Check" carry it for anyone who cannot see the border. */}
          <span aria-hidden="true" className="font-mono text-status-warning">
            ▲
          </span>
          <span>
            <span className="sr-only">Check: </span>
            {mismatch}
          </span>
        </p>
      ) : null}

      <CurrencyInput
        label="Total, including tax"
        value={quote.totalCents}
        onChange={(cents) => onChange({ ...quote, totalCents: cents })}
      />

      <div className="flex flex-wrap gap-4">
        <Toggle
          label="Prepaid"
          checked={quote.prepaid}
          onCheckedChange={(checked) => onChange({ ...quote, prepaid: checked })}
        />
        <Toggle
          label="Refundable"
          checked={quote.refundable}
          onCheckedChange={(checked) => onChange({ ...quote, refundable: checked })}
        />
      </div>
    </div>
  );
}

/**
 * §7.3 item 3: "the user often knows base and total but not the rate. Provide a
 * small inline calculator that derives bps from any two of base/tax/total."
 *
 * Defect D: the calculator used to derive the bps and then throw the typed
 * `total` away — so a user who opened it because they had a total in hand
 * (the whole reason to reach for this calculator in the first place) then
 * had to go retype that exact same number into a quote row a moment later.
 * `onUseTotal` offers to carry it straight into the first still-empty quote
 * row instead (or append a fresh row if every row already has a total) — an
 * explicit second action, never automatic, so it never silently overwrites a
 * row the user is still typing into.
 */
function TaxRateField({
  valueBps,
  onChange,
  onUseTotal,
}: {
  valueBps: number;
  onChange: (bps: number) => void;
  onUseTotal: (totalCents: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const derived = deriveTaxRateBps({ baseCents: base, totalCents: total });

  return (
    <div className="flex flex-col gap-1">
      <NumberInput
        label="Tax rate (bps)"
        value={valueBps}
        onChange={(value) => onChange(Math.max(0, value ?? 0))}
        min={0}
        step={10}
        hint={`${(valueBps / 100).toFixed(2)}%`}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start rounded-sm text-xs text-text-secondary underline-offset-2 hover:underline"
      >
        {open ? 'Hide calculator' : 'Compute from a total'}
      </button>

      {open ? (
        <div className="flex flex-col gap-2 rounded-sm border border-border p-2">
          <CurrencyInput label="Base rate" value={base} onChange={setBase} />
          <CurrencyInput label="Total" value={total} onChange={setTotal} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={derived === null}
              onClick={() => {
                if (derived !== null) {
                  onChange(derived);
                  setOpen(false);
                }
              }}
            >
              {derived === null ? 'Enter both figures' : `Use ${(derived / 100).toFixed(2)}%`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={total === null}
              onClick={() => {
                if (total !== null) {
                  onUseTotal(total);
                  setOpen(false);
                }
              }}
            >
              {total === null
                ? 'Enter a total to reuse it'
                : `Also use ${formatCents(total)} as a quote total`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * §7.3's Export action.
 *
 * CSV rather than JSON, because the audience for an export is a spreadsheet:
 * §1.5's fourth success criterion is that the ledger "survives the user's own
 * audit", and auditing means re-adding the columns yourself. Dollars, not
 * cents, for the same reason — nobody audits in cents.
 *
 * Everything is derived from the returned result, so what is exported is
 * exactly what was on screen.
 */
function exportComparison(result: ComparisonResult): void {
  const header = [
    'channel',
    'total',
    'base',
    'tax',
    'perks',
    'credit_kept',
    'clawback',
    'points_value',
    'price_match_refund',
    'rebate',
    'effective_net',
    'effective_nightly',
    'price_match_qualifies',
  ].join(',');

  const dollars = (cents: number) => (cents / 100).toFixed(2);

  const rows = result.ranked.map(({ result: row }) =>
    [
      row.channel,
      dollars(row.totalCents),
      dollars(row.baseCents),
      dollars(row.taxCents),
      dollars(row.perksCents),
      dollars(row.creditKeptCents),
      dollars(row.clawbackCents),
      dollars(row.pointsValueCents),
      dollars(row.refundCents),
      dollars(row.rebateCents),
      dollars(row.effectiveNetCents),
      dollars(row.effectiveNightlyCents),
      row.priceMatch.qualifies ? 'yes' : 'no',
    ].join(','),
  );

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `parity-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * §5.3 / task item 4: "show the actual remaining dollar figure next to each
 * so the assumption is self-explaining rather than buried... When a bucket is
 * spent, the UI must say so plainly — this is the difference between a
 * correct answer and a confidently wrong one."
 *
 * `null` means no read of live state exists at all. Before Defect A's fix
 * that was the normal state for the first render of every page load (the
 * server hadn't answered yet); now the caller always has
 * `displayedBucketAvailability` — either the hook's own authoritative value
 * or `initialBucketAvailability`'s server-hydrated one — so `null` in
 * practice only remains reachable from a caller that has neither, and this
 * still degrades to an honest "checking" message rather than a fabricated
 * number.
 */
function bucketAvailabilityDescription(
  state: { available: boolean; remainingCents: number } | null,
): string {
  if (!state) return 'Checking your live balance…';
  if (!state.available) return 'Spent — $0 remaining in the live window.';
  return `${formatCents(state.remainingCents)} remaining in the live window.`;
}

function membershipSummary(property: PropertyOption): string {
  const badges = [
    property.inFhr ? 'FHR' : null,
    property.inThc ? 'THC' : null,
    property.inEdit ? 'Edit' : null,
    property.brand !== 'NONE' ? property.brand : null,
  ].filter(Boolean);
  return badges.length > 0 ? badges.join(' · ') : 'No programme membership recorded';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
