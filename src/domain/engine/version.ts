/**
 * Engine version — §4.3.
 *
 * Stamped onto every persisted comparison. A saved comparison always renders
 * from its own snapshot under the version that produced it; recomputing creates
 * a **new** row rather than overwriting the old one. That immutability is what
 * makes the savings ledger auditable, which §1.5 lists as a success criterion.
 *
 * Bump on any change that could alter a returned number. Adding a field that
 * nothing reads is a patch; changing an order of operations is not.
 */
export const ENGINE_VERSION = '1.0.0';
