import { test as base, expect } from '@playwright/test';
import { signInAsDemoUser } from './auth';

/**
 * This suite's `test`, extended so every test starts already signed in as
 * the seeded demo account (§10.3's flows all open with "Sign in →" — see
 * `e2e/support/auth.ts` for the mechanism and why it is a real session
 * cookie rather than the `PARITY_DEMO_USER` dev fixture).
 *
 * Every spec file in `e2e/` imports `test`/`expect` from here, not from
 * `@playwright/test` directly, so this is the one place "signed in" is
 * wired — a test that genuinely needs to be unauthenticated (there are none
 * today) would import the plain `test` from `@playwright/test` instead.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await signInAsDemoUser(context);
    await use(context);
  },
});

export { expect };
