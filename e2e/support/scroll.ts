import { expect, type Page } from '@playwright/test';

/**
 * §6.7 / §10.3 flow 6: "the comparator must be fully usable at 390px" and the
 * mobile flow must run "with no horizontal scroll at any step." Comparing
 * `scrollWidth` to `clientWidth` on the root element is the direct DOM
 * translation of "no horizontal scroll" — asserted after every meaningful step
 * rather than once at the end, so a regression introduced partway through the
 * flow (e.g. a wide breakdown table appearing on expand) is caught at the step
 * that caused it.
 */
export async function expectNoHorizontalScroll(page: Page, step: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `horizontal overflow after "${step}": ${scrollWidth}px content in a ${clientWidth}px viewport`).toBeLessThanOrEqual(
    clientWidth,
  );
}
