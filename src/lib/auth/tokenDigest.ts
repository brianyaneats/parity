import { createHash } from 'node:crypto';

/**
 * Digest for magic-link tokens at rest.
 *
 * The emailed link carries the raw token; the database and logs only ever
 * see this digest. A database read (SQL injection, a leaked backup, a
 * too-curious admin console) therefore cannot yield a usable sign-in link —
 * the raw value exists in exactly two places, the email in the user's inbox
 * and the URL they click.
 *
 * Plain SHA-256, no salt or work factor, deliberately: these are 122-bit
 * random UUIDs with a 15-minute lifetime, not passwords. There is nothing to
 * dictionary-attack; the digest only needs to be one-way.
 */
export function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
