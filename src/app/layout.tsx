import type { Metadata, Viewport } from 'next';
import { Rubik } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import '@/styles/globals.css';
import {
  THEME_COOKIE,
  THEME_BOOTSTRAP_SCRIPT,
  parseThemeCookie,
  resolveTheme,
} from '@/lib/theme';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

/**
 * Rubik, self-hosted through `next/font` — §6.3 forbids an external font CDN.
 * `next/font/google` downloads and serves the file from our own origin at build
 * time, so there is no runtime request to Google and no third-party beacon,
 * which §12's analytics position also requires.
 */
const rubik = Rubik({
  subsets: ['latin'],
  variable: '--font-rubik',
  display: 'swap',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Parity',
  description:
    'Which booking channel wins, by how much, and what you forfeit by choosing wrong.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // §6.7: the comparator must be fully usable at 390px. Blocking zoom on a
  // dense data screen would be hostile, so it stays available.
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const preference = parseThemeCookie(cookieStore.get(THEME_COOKIE)?.value);

  // When the preference is explicit we know the answer server-side and can
  // stamp it into the first byte — no script, no flash. When it is `system` we
  // fall back to the client hint header if the browser sent one, and only then
  // to the blocking bootstrap script below.
  const hint = (await headers()).get('sec-ch-prefers-color-scheme');
  const hasCookie = cookieStore.has(THEME_COOKIE);
  // No hint means guess light: the system is light-first (measured re-skin,
  // D-158), and the bootstrap script corrects from matchMedia before paint.
  const systemPrefersDark = hint ? hint === 'dark' : false;
  const resolved = resolveTheme(preference, systemPrefersDark);

  // The script runs only on the very first visit, before any cookie exists.
  const needsBootstrap = !hasCookie && !hint;

  return (
    <html lang="en" data-theme={resolved} suppressHydrationWarning className={rubik.variable}>
      <head>
        {needsBootstrap ? (
          // eslint-disable-next-line react/no-danger -- A static, self-contained
          // constant with no interpolation. It must run synchronously before
          // first paint; §6.2 makes "no flash of the wrong theme" an acceptance
          // criterion, and a deferred script cannot satisfy that.
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        ) : null}
      </head>
      <body className="bg-canvas text-text-primary font-ui antialiased">
        <ThemeProvider initialPreference={preference} initialResolved={resolved}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
