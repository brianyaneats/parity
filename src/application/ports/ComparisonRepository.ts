import type { StayContext, ChannelResult } from '@/domain/engine/types';
import type { Channel } from '@/domain/rules/channels.rules';
import type { Cents } from '@/domain/shared/cents';

/**
 * `ComparisonRepository` — port for the `comparisons`/`quotes`/`competing_rates`
 * tables (§4.2), covering the three "comparisons, quotes, competing rates" items
 * from the task brief as one aggregate-shaped port, because that is how they are
 * always read and written together: a comparison never exists without its quotes.
 *
 * §4.3 / §13.3: "Never recompute a historical comparison with a newer engine and
 * overwrite it." That rule is enforced structurally here, not just by convention:
 * `ComparisonPatch` — the only shape `update()` accepts — has no
 * `contextSnapshot`/`resultSnapshot` fields, so there is no call this interface
 * can make that would touch either column. `POST /api/comparisons/:id/recompute`
 * must go through `create()` and produce a new row.
 */

export type ComparisonStatus = 'DRAFT' | 'DECIDED' | 'BOOKED' | 'ABANDONED';

export interface QuoteRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly channel: Channel;
  readonly label: string | null;
  readonly totalCents: Cents;
  readonly prepaid: boolean;
  readonly refundable: boolean;
  readonly sourceUrl: string | null;
  readonly capturedAt: Date | null;
  readonly sortIndex: number;
}

export interface NewQuoteInput {
  readonly channel: Channel;
  readonly label?: string | null;
  readonly totalCents: Cents;
  readonly prepaid: boolean;
  readonly refundable: boolean;
  readonly sourceUrl?: string | null;
  readonly capturedAt?: Date | null;
  readonly sortIndex?: number;
}

export interface CompetingRateRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly siteDomain: string;
  readonly url: string;
  readonly baseCents: Cents;
  readonly taxCents: Cents | null;
  readonly refundable: boolean;
  readonly publiclyAvailable: boolean;
  readonly roomType: string | null;
  readonly bedType: string | null;
  readonly adults: number | null;
  readonly children: number | null;
  readonly currency: string | null;
  readonly screenshotKey: string | null;
  readonly capturedAt: Date;
}

export interface NewCompetingRateInput {
  readonly siteDomain: string;
  readonly url: string;
  readonly baseCents: Cents;
  readonly taxCents?: Cents | null;
  readonly refundable: boolean;
  readonly publiclyAvailable: boolean;
  readonly roomType?: string | null;
  readonly bedType?: string | null;
  readonly adults?: number | null;
  readonly children?: number | null;
  readonly currency?: string | null;
  readonly capturedAt: Date;
}

export interface ComparisonRecord {
  readonly id: string;
  readonly userId: string;
  readonly tripId: string | null;
  readonly propertyId: string | null;
  readonly propertyNameSnapshot: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  readonly rooms: number;
  readonly roomType: string | null;
  readonly bedType: string | null;
  readonly currency: string;
  readonly taxRateBps: number;
  readonly realizationPct: number;
  readonly contextSnapshot: StayContext;
  readonly resultSnapshot: readonly ChannelResult[];
  readonly engineVersion: string;
  readonly status: ComparisonStatus;
  readonly chosenChannel: Channel | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly quotes: readonly QuoteRecord[];
  readonly competingRates: readonly CompetingRateRecord[];
}

export interface NewComparisonInput {
  readonly userId: string;
  readonly tripId?: string | null;
  readonly propertyId?: string | null;
  readonly propertyNameSnapshot: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly adults?: number;
  readonly children?: number;
  readonly rooms?: number;
  readonly roomType?: string | null;
  readonly bedType?: string | null;
  readonly currency?: string;
  readonly taxRateBps: number;
  readonly realizationPct?: number;
  readonly contextSnapshot: StayContext;
  readonly resultSnapshot: readonly ChannelResult[];
  readonly engineVersion: string;
  readonly status?: ComparisonStatus;
  readonly chosenChannel?: Channel | null;
  readonly quotes: readonly NewQuoteInput[];
  readonly competingRate?: NewCompetingRateInput | null;
}

/**
 * Everything `update()` is allowed to change. Deliberately excludes
 * `contextSnapshot`/`resultSnapshot` — see the module doc.
 */
export interface ComparisonPatch {
  readonly status?: ComparisonStatus;
  readonly chosenChannel?: Channel | null;
  readonly tripId?: string | null;
}

export interface ComparisonListFilter {
  readonly tripId?: string;
  readonly status?: ComparisonStatus;
  /** Opaque, from a previous page's `nextCursor`. */
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface ComparisonListPage {
  readonly items: readonly ComparisonRecord[];
  readonly nextCursor: string | null;
}

export interface ComparisonRepository {
  /** Persists a comparison plus its quotes and optional competing rate, atomically. */
  create(input: NewComparisonInput): Promise<ComparisonRecord>;
  findById(id: string, userId: string): Promise<ComparisonRecord | null>;
  list(userId: string, filter: ComparisonListFilter): Promise<ComparisonListPage>;
  /** Status / chosen-channel / trip only — see `ComparisonPatch`. */
  update(id: string, userId: string, patch: ComparisonPatch): Promise<ComparisonRecord | null>;
}
