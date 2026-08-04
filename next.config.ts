import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // Never silently ship type errors — §0.4 requires a zero-error build.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  // Moved out of `experimental` in Next 15.5. Left off deliberately: typed
  // routes would break the graceful-degradation pattern where a page links to a
  // route another part of the build has not created yet.
  typedRoutes: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // `unsafe-inline` for scripts is what Next.js's own bootstrap and
          // the theme snippet (`THEME_BOOTSTRAP_SCRIPT`) require without a
          // per-request nonce, and `unsafe-eval` is required by React
          // Refresh in dev only — the meaningful lines are the ones that
          // hard-close exfiltration and embedding: `connect-src 'self'`
          // (nothing phones out — §12 promises the app's data never leaves
          // the deployment), `frame-ancestors 'none'` (X-Frame-Options'
          // modern spelling), and default/img/font locked to self.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              process.env.NODE_ENV === 'production'
                ? "script-src 'self' 'unsafe-inline'"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          // §12: the app knows which hotels the user is considering. No third-party pixels.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
