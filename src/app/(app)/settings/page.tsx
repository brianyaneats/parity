import { getSession } from '@/lib/auth/session';
import { loadCards, loadSavedComparisonsForSensitivity, loadUserSettings } from '@/features/settings/data';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { DEFAULT_USER_SETTINGS, type CardView, type UserSettingsView } from '@/features/settings/types';
import type { SavedComparisonSummary } from '@/features/settings/sensitivity';

export const metadata = { title: 'Settings · Parity' };

/**
 * `/settings` — §7.8.
 *
 * Three independent, resilient reads rather than one that fails as a unit:
 * a database blip should degrade one card on this page to its default, not
 * blank the whole screen — the same reasoning `AppLayout.loadBadges` already
 * applies to the sidebar badge counts and `/compare` applies to the property
 * list.
 */
export default async function SettingsPage() {
  const session = await getSession();
  const userId = session?.userId;

  const [settings, cards, comparisons] = await Promise.all([
    loadSettingsSafely(userId),
    loadCardsSafely(userId),
    loadComparisonsSafely(userId),
  ]);

  return (
    <SettingsScreen
      initialSettings={settings}
      initialCards={cards}
      comparisons={comparisons}
      signedIn={userId !== undefined}
      // §12's deletion flow confirms against the account's own address, so it
      // comes from the session rather than from `user_settings` — the address
      // that authenticates is the one that must be typed back.
      accountEmail={session?.email ?? ''}
    />
  );
}

async function loadSettingsSafely(userId: string | undefined): Promise<UserSettingsView> {
  try {
    return await loadUserSettings(userId);
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

async function loadCardsSafely(userId: string | undefined): Promise<readonly CardView[]> {
  try {
    return await loadCards(userId);
  } catch {
    return [];
  }
}

async function loadComparisonsSafely(userId: string | undefined): Promise<readonly SavedComparisonSummary[]> {
  try {
    return await loadSavedComparisonsForSensitivity(userId);
  } catch {
    // §7.8: "falling back to 0 with an explanatory line when there are none."
    // An unreachable database and a genuinely empty history render identically
    // — both are zero comparisons to be sensitive about — which is the correct
    // degrade rather than a special-cased error banner on this one card.
    return [];
  }
}
