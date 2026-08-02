/**
 * The ten-element evidence checklist — §7.4.
 *
 * The claim kit is "a checklist-first screen, not a form-first one". Each item
 * carries a one-line "why this matters / what happens if it's missing", because
 * a checklist without consequences is a list the user skims.
 *
 * The two highest-risk items — cancellation-policy match and the public-rate
 * requirement — are flagged for visual emphasis. They are the two that get a
 * claim denied *after* the user has done all the work, and they are the two
 * users most often get wrong: a free, instant loyalty signup still makes a rate
 * non-public (§2.3.1 PM9).
 */

export interface EvidenceItem {
  readonly id: string;
  readonly label: string;
  /** Why it matters, and what happens without it. */
  readonly why: string;
  /** §7.4: the two highest-risk items are visually emphasised. */
  readonly highRisk: boolean;
}

export const EVIDENCE_CHECKLIST: readonly EvidenceItem[] = Object.freeze([
  {
    id: 'full_url',
    label: 'Full URL visible in the address bar',
    why: 'The reviewer has to be able to reach the same page. A cropped screenshot without the URL is routinely rejected as unverifiable.',
    highRisk: false,
  },
  {
    id: 'visible_clock',
    label: 'A visible clock or timestamp in the capture',
    why: 'Rates move. Proof of when you saw it is what ties the rate to your 24-hour window.',
    highRisk: false,
  },
  {
    id: 'hotel_identity',
    label: 'Hotel name and street address',
    why: 'Chains run several properties in one city with near-identical names. The address is what proves it is the same building.',
    highRisk: false,
  },
  {
    id: 'dates',
    label: 'Both check-in and check-out dates',
    why: 'A one-night difference makes it a different stay and voids the parameter match.',
    highRisk: false,
  },
  {
    id: 'occupancy',
    label: 'Guest count and number of rooms',
    why: 'A two-guest rate does not match a one-guest booking, even at the same property on the same night.',
    highRisk: false,
  },
  {
    id: 'room_and_bed',
    label: 'Room type and bed type',
    why: 'A king does not match a twin, and a “deluxe” does not match a “superior”. Both must be legible in the capture.',
    highRisk: false,
  },
  {
    id: 'cancellation_policy',
    label: 'The cancellation policy, in full',
    why: 'This is the single most common denial cause across every programme. A cheaper non-refundable rate never qualifies against a refundable booking — if your booking is refundable, the competing rate must be too.',
    highRisk: true,
  },
  {
    id: 'base_rate',
    label: 'Base rate shown both per night and as a total',
    why: 'Only the base rate is compared. Showing a total that bundles tax invites the reviewer to compare the wrong number.',
    highRisk: false,
  },
  {
    id: 'taxes_itemised',
    label: 'Taxes and fees itemised separately',
    why: 'Taxes are never refunded on either side. Keeping them visibly separate is what proves your base-rate figure is the base rate.',
    highRisk: false,
  },
  {
    id: 'public_rate',
    label: 'Currency, plus proof the rate is publicly available',
    why: 'Member, loyalty, AAA, AARP, corporate, government, military, group, package and opaque-site rates are all excluded — even when the membership is free and signup takes ten seconds. Capture the page as a signed-out visitor.',
    highRisk: true,
  },
]);

export const EVIDENCE_ITEM_COUNT = EVIDENCE_CHECKLIST.length;

/** §7.4 item 3: a usable screenshot is at least this wide. */
export const MIN_SCREENSHOT_WIDTH_PX = 1000;

/**
 * Whether an image looks like a partial window rather than a full page.
 *
 * A very wide, very short capture is usually a cropped strip — the user grabbed
 * the price and not the cancellation policy, which is exactly the omission that
 * gets claims denied. This warns; it never blocks, because an unusual aspect
 * ratio is a hint and the user can see their own screenshot.
 */
export function looksCropped(widthPx: number, heightPx: number): boolean {
  if (heightPx <= 0) return true;
  return widthPx / heightPx > 3.5;
}

export function isScreenshotWideEnough(widthPx: number): boolean {
  return widthPx >= MIN_SCREENSHOT_WIDTH_PX;
}
