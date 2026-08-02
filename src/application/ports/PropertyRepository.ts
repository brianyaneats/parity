import type { BrandOrNone } from '@/domain/rules/channels.rules';
import type { PropertyCreditKind } from '@/domain/rules/perks.rules';
import type { Cents } from '@/domain/shared/cents';

export interface PropertyRecord {
  readonly id: string;
  readonly userId: string | null;
  readonly name: string;
  readonly address: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly brand: BrandOrNone;
  readonly inFhr: boolean;
  readonly inThc: boolean;
  readonly inEdit: boolean;
  readonly propertyCreditFaceCents: Cents;
  readonly propertyCreditKind: PropertyCreditKind | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

export interface NewPropertyInput {
  readonly userId: string;
  readonly name: string;
  readonly address?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly brand?: BrandOrNone;
  readonly inFhr?: boolean;
  readonly inThc?: boolean;
  readonly inEdit?: boolean;
  readonly propertyCreditFaceCents?: Cents;
  readonly propertyCreditKind?: PropertyCreditKind | null;
  readonly notes?: string | null;
}

export interface PropertySearchFilter {
  readonly q?: string;
  readonly city?: string;
  readonly limit?: number;
}

/**
 * `PropertyRepository` — port over `properties` (§4.2, §4.4, §7.8).
 *
 * §7.8: "the user's own edits shadow seeds rather than mutating them." A
 * user-scoped row with the same (lower-cased) name as a `userId = NULL` seed
 * wins over it in `search`/`listGlobalAndOwn`; the seed itself is never written
 * through this port for a real user (only `run-seed.ts`, using its own
 * connection, seeds `userId = NULL` rows).
 */
export interface PropertyRepository {
  create(input: NewPropertyInput): Promise<PropertyRecord>;
  findById(id: string): Promise<PropertyRecord | null>;
  /** Global (`userId IS NULL`) rows plus the caller's own, de-duplicated by name — user wins. */
  search(userId: string, filter: PropertySearchFilter): Promise<readonly PropertyRecord[]>;
}
