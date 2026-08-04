/**
 * `AuthRepository` — port for magic-link sign-in (§5.2, §12).
 *
 * Not one of the eleven areas the task brief lists under "Cover:" — it exists
 * because `POST /api/auth/magic-link` needs somewhere to look up the user and
 * somewhere to stash a single-use token, and `users`/`verification_tokens`
 * (the Auth.js standard tables §4.2 already declares in `schema.ts`) are
 * exactly shaped for it. No password, no OAuth token, nothing §12 forbids —
 * just an email address and a random single-use string.
 */
export interface AuthUserRecord {
  readonly id: string;
  readonly email: string;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  /**
   * Returns the existing user for this email, creating one first if none
   * exists. This is the entirety of sign-up: magic-link auth means an email
   * address *is* an account, and requiring some separate registration step
   * would only add a screen — there is no password or profile to collect
   * (§12). Idempotent under concurrent calls for the same address (the
   * `users.email` unique constraint is the arbiter).
   */
  findOrCreateUserByEmail(email: string): Promise<AuthUserRecord>;
  /**
   * Stores the *digest* of a single-use token (`digestToken` in
   * `src/lib/auth/tokenDigest.ts`) — never the raw value, which exists only
   * inside the emailed link.
   */
  createVerificationToken(identifier: string, tokenDigest: string, expires: Date): Promise<void>;
  /**
   * Deletes the token (single-use, whether or not it turns out to be valid)
   * and reports whether it was found and not yet expired. Takes the digest,
   * matching what `createVerificationToken` stored.
   */
  consumeVerificationToken(identifier: string, tokenDigest: string, now: Date): Promise<boolean>;
}
