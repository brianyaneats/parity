import type { ThemePreference } from '@/lib/theme';

export interface UserSettingsRecord {
  readonly userId: string;
  readonly mrValueMicro: number;
  readonly urValueMicro: number;
  readonly breakfastPerDayCents: number;
  readonly foraRateBps: number;
  readonly foraMember: boolean;
  readonly cardmemberAnniversary: string | null;
  readonly homeCurrency: string;
  readonly timezone: string;
  readonly theme: ThemePreference;
}

export interface UserSettingsPatch {
  readonly mrValueMicro?: number;
  readonly urValueMicro?: number;
  readonly breakfastPerDayCents?: number;
  readonly foraRateBps?: number;
  readonly foraMember?: boolean;
  readonly cardmemberAnniversary?: string | null;
  readonly homeCurrency?: string;
  readonly timezone?: string;
  readonly theme?: ThemePreference;
}

/** The one row per user the cron jobs need to address and time-zone a notification. */
export interface NotificationRecipient {
  readonly userId: string;
  readonly email: string;
  readonly timezone: string;
}

export interface UserSettingsRepository {
  /** Row is created with defaults on first read if it does not exist yet — §4.2's `DEFAULT`s. */
  getOrCreate(userId: string): Promise<UserSettingsRecord>;
  update(userId: string, patch: UserSettingsPatch): Promise<UserSettingsRecord>;
  /** Every user with a settings row — the address book the cron sweeps notify. */
  listRecipients(): Promise<readonly NotificationRecipient[]>;
}
