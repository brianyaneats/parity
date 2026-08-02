import { z } from 'zod';

/** Validation for `PATCH /api/settings/theme` — §5.2, §6.2. */

export const THEME_PREFERENCE_VALUES = ['system', 'light', 'dark'] as const;

export const themePatchSchema = z.object({
  theme: z.enum(THEME_PREFERENCE_VALUES),
});

export type ThemePatchInput = z.infer<typeof themePatchSchema>;
