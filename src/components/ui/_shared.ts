/**
 * Small internal helpers shared across the primitives in this folder.
 *
 * Not part of the public API — `index.ts` does not re-export this module,
 * only the components themselves. Centralizing these strings is what keeps
 * every interactive element's focus ring and press motion identical instead
 * of each component inventing its own slightly-different class string.
 */

/**
 * Focus-visible ring — §6.7 / ABSOLUTE CONSTRAINT 4. Every focusable element
 * in this library uses this exact class string so the ring color is always
 * driven by the `--focus-ring` token (lime in dark, brand in light) rather
 * than a component hardcoding a color per theme.
 */
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

/** Same ring, applied via `:focus-within` for composite controls (a bordered
 * box wrapping a plain `<input>`) where the outline belongs on the wrapper,
 * not the native control. */
export const FOCUS_WITHIN_RING =
  'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring';

/**
 * State-change motion — §6.6: transitions on `opacity` and `transform` only,
 * never `height` or another layout-triggering property. Used for hover/active
 * press feedback and icon rotation (e.g. a disclosure chevron).
 */
export const PRESS_TRANSITION = 'transition-transform duration-fast ease-standard';
export const FADE_TRANSITION = 'transition-opacity duration-fast ease-standard';
