import { z } from 'zod';
import { uuidSchema } from './shared';

/** Validation for `/api/watchlist` — §5.2, §7.6. */

export const createWatchlistSchema = z.object({
  bookingId: uuidSchema,
  cadenceDays: z.number().int().min(1).max(90).optional(),
});

export type CreateWatchlistInput = z.infer<typeof createWatchlistSchema>;

export const deleteWatchlistQuerySchema = z.object({
  id: uuidSchema,
});

export type DeleteWatchlistQuery = z.infer<typeof deleteWatchlistQuerySchema>;
