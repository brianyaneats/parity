import { z } from 'zod';

/** Validation for `POST /api/auth/magic-link` — §5.2, §12. */

export const magicLinkSchema = z.object({
  email: z.string().trim().toLowerCase().email('must be a valid email address').max(320),
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
