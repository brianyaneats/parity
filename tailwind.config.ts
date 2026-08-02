import type { Config } from 'tailwindcss';

/**
 * Tailwind mirrors `src/styles/tokens.css` — §6.1.
 *
 * Every entry below resolves to a CSS custom property rather than a literal, so
 * this file adds *no* design values of its own. Editing a colour here is
 * impossible; you edit the token, and both the CSS and the Tailwind class
 * follow. That is what makes "swap the design system in one file" true rather
 * than aspirational.
 *
 * Consequence worth stating: because these are `var()` references, both themes
 * work through the same class names. `bg-surface-1` is correct in light and in
 * dark, and no component ever branches on the theme.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        glass: 'var(--glass)',
        'glass-hover': 'var(--glass-hover)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',

        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',

        brand: 'var(--brand)',
        'brand-deep': 'var(--brand-deep)',
        'accent-lime': 'var(--accent-lime)',
        'accent-lime-ink': 'var(--accent-lime-ink)',
        'accent-coral': 'var(--accent-coral)',
        'accent-coral-ink': 'var(--accent-coral-ink)',
        'accent-pink': 'var(--accent-pink)',

        'status-good': 'var(--status-good)',
        'status-warning': 'var(--status-warning)',
        'status-critical': 'var(--status-critical)',
        'status-ink': 'var(--status-ink)',

        'series-1': 'var(--series-1)',
        'series-2': 'var(--series-2)',
        'series-3': 'var(--series-3)',

        'focus-ring': 'var(--focus-ring)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      spacing: {
        1: 'var(--s-1)',
        2: 'var(--s-2)',
        3: 'var(--s-3)',
        4: 'var(--s-4)',
        5: 'var(--s-5)',
        6: 'var(--s-6)',
        7: 'var(--s-7)',
        8: 'var(--s-8)',
        // The sidebar is `position: fixed`, so the main column has to reserve
        // its width as padding. These live in `spacing` and not only in `width`
        // because `pl-*` resolves against the spacing scale — defining them
        // under `width` alone makes `pl-sidebar` a no-op class that emits
        // nothing, and the sidebar then silently covers the left edge of every
        // screen at ≥ 640px. See DECISIONS.md D-120.
        sidebar: 'var(--sidebar-width)',
        rail: 'var(--sidebar-rail)',
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        display: ['var(--t-display-size)', { lineHeight: 'var(--t-display-lh)', fontWeight: 'var(--t-display-weight)' }],
        h1: ['var(--t-h1-size)', { lineHeight: 'var(--t-h1-lh)', fontWeight: 'var(--t-h1-weight)' }],
        h2: ['var(--t-h2-size)', { lineHeight: 'var(--t-h2-lh)', fontWeight: 'var(--t-h2-weight)' }],
        h3: ['var(--t-h3-size)', { lineHeight: 'var(--t-h3-lh)', fontWeight: 'var(--t-h3-weight)' }],
        body: ['var(--t-body-size)', { lineHeight: 'var(--t-body-lh)', fontWeight: 'var(--t-body-weight)' }],
        sm: ['var(--t-sm-size)', { lineHeight: 'var(--t-sm-lh)', fontWeight: 'var(--t-sm-weight)' }],
        xs: ['var(--t-xs-size)', { lineHeight: 'var(--t-xs-lh)', fontWeight: 'var(--t-xs-weight)' }],
        label: [
          'var(--t-label-size)',
          {
            lineHeight: 'var(--t-label-lh)',
            fontWeight: 'var(--t-label-weight)',
            letterSpacing: 'var(--t-label-tracking)',
          },
        ],
      },
      boxShadow: {
        e1: 'var(--e-1)',
        e2: 'var(--e-2)',
        glass: 'var(--e-glass)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease)',
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
      },
      width: {
        sidebar: 'var(--sidebar-width)',
        rail: 'var(--sidebar-rail)',
        inputs: 'var(--input-column)',
      },
    },
  },
  plugins: [],
};

export default config;
