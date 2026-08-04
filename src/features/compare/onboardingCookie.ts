/**
 * Shared between `src/app/(app)/compare/page.tsx` (reads it to decide whether
 * to render `OnboardingBanner`) and `onboardingActions.ts` (writes it when
 * the banner is dismissed) — a bare string literal duplicated in both places
 * would silently drift the moment either side got edited.
 *
 * `httpOnly: false` is deliberate, not an oversight: nothing server-security-
 * sensitive rides on this cookie (see `dismissOnboarding`'s own comment), and
 * a client component reading it back would otherwise be reason enough not to
 * mark it httpOnly in the first place. It carries no user content, just a
 * flag.
 */
export const ONBOARDING_DISMISSED_COOKIE = 'onboarding-dismissed';
