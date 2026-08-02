import { test, expect } from './support/test';
import { THEME_COOKIE } from '../src/lib/theme';

/**
 * §10.1 theme test / §6.2 acceptance criterion.
 *
 * "Load with a `theme=light` cookie under a forced `prefers-color-scheme:
 * dark` and assert the first painted frame is light" — §6.2 calls "no flash
 * of the wrong theme" an acceptance criterion, not a nicety.
 *
 * Two independent checks, deliberately:
 *
 * 1. **The raw server response**, fetched before any script runs. This is
 *    the strongest possible evidence of "no flash": `src/app/layout.tsx`
 *    reads the cookie server-side and stamps `data-theme` into the HTML it
 *    sends, so if this is right there is no client-side frame in which the
 *    wrong theme could ever have been painted — there is nothing to flash
 *    from.
 * 2. **The rendered page**, forced to `prefers-color-scheme: dark` at the
 *    browser level (via the `use.colorScheme` project setting overridden per
 *    test below) with the light cookie set — proving the explicit cookie
 *    preference wins over the OS signal, both in the DOM attribute and in
 *    the actually-computed canvas colour.
 */
test.describe('Theme — no flash of the wrong theme', () => {
  test.use({ colorScheme: 'dark' });

  test('a light theme cookie wins over a forced dark OS preference, from the very first byte', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: THEME_COOKIE, value: 'light', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await test.step('the raw HTML response already carries data-theme="light"', async () => {
      const response = await context.request.get('/compare');
      expect(response.ok()).toBe(true);
      const html = await response.text();
      expect(html).toContain('data-theme="light"');
      expect(html).not.toContain('data-theme="dark"');
    });

    await test.step('the rendered page reflects light — attribute and actual colour', async () => {
      await page.goto('/compare');

      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(theme).toBe('light');

      // §6.2's light canvas is #f7f6fa = rgb(247, 246, 250). Checking the
      // computed colour (not just the attribute) catches the case where the
      // attribute is right but a stray dark-mode style still won.
      const backgroundColor = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      expect(backgroundColor).toBe('rgb(247, 246, 250)');
    });

    await test.step('no color-scheme mismatch remains after hydration settles', async () => {
      await page.waitForLoadState('networkidle');
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(theme).toBe('light');
    });
  });
});
