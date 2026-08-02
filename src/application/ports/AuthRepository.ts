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
  createVerificationToken(identifier: string, token: string, expires: Date): Promise<void>;
  /**
   * Deletes the token (single-use, whether or not it turns out to be valid)
   * and reports whether it was found and not yet expired.
   */
  consumeVerificationToken(identifier: string, token: string, now: Date): Promise<boolean>;
}
