import type { CompetingRateRecord, NewCompetingRateInput } from './ComparisonRepository';

// Re-exported so callers can `import type { CompetingRateRecord } from
// '@/application/ports/CompetingRateRepository'` without needing to know it
// is actually declared alongside `ComparisonRepository` (a competing rate is
// always a child of some comparison — see the module doc below).
export type { CompetingRateRecord, NewCompetingRateInput };

/**
 * `CompetingRateRepository` — standalone port over `competing_rates` (§4.2).
 *
 * Most competing rates are created alongside a comparison (see
 * `ComparisonRepository.create`), but §5.2's evidence route needs to create one
 * on its own: "a claim with no `competing_rate_id` must create one first," and
 * `screenshot_key` — the column the evidence upload writes to — lives here, not
 * on `claims`.
 *
 * `comparisonId` is required by the schema (`competing_rates.comparison_id` is
 * `NOT NULL`), so creating a rate always happens in the context of some
 * comparison — see `RecordClaimEvidenceUseCase` for how that constraint is
 * satisfied (or explicitly rejected) when a claim's booking has none.
 */
export interface CompetingRateRepository {
  create(comparisonId: string, input: NewCompetingRateInput): Promise<CompetingRateRecord>;
  findById(id: string): Promise<CompetingRateRecord | null>;
  /**
   * The rate a comparison was decided against. Used when a booking opens a
   * claim, so the claim can name its source — §2.3.1's PM8 requires it, and
   * §7.4's generated text cannot exist without it.
   */
  findByComparisonId(comparisonId: string): Promise<CompetingRateRecord | null>;
  setScreenshotKey(id: string, screenshotKey: string): Promise<CompetingRateRecord | null>;
}
