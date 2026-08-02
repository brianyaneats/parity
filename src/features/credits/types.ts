import type { Channel } from '@/domain/rules/channels.rules';

/**
 * Plain, RSC-serialisable shape of one `credit_buckets` row — §4.2.
 *
 * `CreditWallet` reconstructs the real `CreditBucket` aggregate (§2.4's
 * clawback and status logic) from rows shaped like this, on the client side.
 * The aggregate itself cannot be the prop type here: React Flight only
 * serialises plain data across the server/client boundary, so a class
 * instance handed to a `'use client'` component arrives with its prototype
 * stripped — `bucket.status(...)` would be `undefined` at the call site. The
 * boundary is a flat object; the domain object is rebuilt exactly once, at
 * the top of the client tree, in `CreditWallet`.
 */
export interface BucketRow {
  readonly id: string;
  readonly userId: string;
  readonly cardId: string | null;
  readonly key: string;
  readonly label: string;
  readonly faceCents: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly consumedCents: number;
  /** True when the window was assumed (no cardmember anniversary on file) rather than known. */
  readonly windowAssumed: boolean;
}

/**
 * A saved comparison, reduced to what §7.5's "route a booking to this
 * bucket" filter needs: the channel and night count that decide whether it
 * could unlock a given bucket (§2.4's unlock conditions).
 */
export interface RoutableComparison {
  readonly id: string;
  readonly propertyName: string;
  readonly channel: Channel;
  readonly nights: number;
  readonly prepaid: boolean;
  readonly checkIn: string;
  readonly effectiveNetCents: number;
}
