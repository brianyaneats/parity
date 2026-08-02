import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

/**
 * `/` — §7.1: "signed out → /login, signed in → /compare".
 *
 * There is no landing page. The product answers one question per stay, and the
 * screen that answers it is the front door.
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? '/compare' : '/login');
}
