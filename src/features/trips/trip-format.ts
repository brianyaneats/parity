import { formatDate } from '@/lib/format';

/**
 * `trips.start_date`/`end_date` are both nullable (§4.2) — a trip can exist
 * before its dates are pinned down. This renders every combination without
 * inventing a date the user never entered.
 */
export function formatDateRange(startDate: string | null, endDate: string | null): string {
  if (startDate && endDate) return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  if (startDate) return `From ${formatDate(startDate)}`;
  if (endDate) return `Through ${formatDate(endDate)}`;
  return 'Dates not set';
}
