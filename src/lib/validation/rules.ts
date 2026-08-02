import { z } from 'zod';

/** Validation for `POST /api/rules/flag` — §5.2, §2.8. */

export const flagRuleSchema = z.object({
  ruleKey: z.string().trim().min(1, 'is required').max(200),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type FlagRuleInput = z.infer<typeof flagRuleSchema>;
