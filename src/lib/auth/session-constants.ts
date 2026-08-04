/**
 * Session constants safe for any runtime.
 *
 * `middleware.ts` runs on the Edge runtime, where `session.ts`'s imports
 * (`node:crypto`, `next/headers`) do not exist — so the one value both sides
 * need lives here, importable from either. `session.ts` re-exports it, so
 * server-side code keeps its single import point.
 */
export const SESSION_COOKIE = 'parity-session';
