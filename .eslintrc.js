/**
 * ESLint config — none existed before this file. `eslint-config-next` is
 * already a devDependency; this just wires it up plus the two project-specific
 * rules the spec calls for in §6.1/§6.7 and the layering rule DECISIONS.md
 * D-033 says is "enforced by an ESLint `no-restricted-imports` rule rather
 * than left to discipline."
 *
 * A plain `.js` file (not `.json`) so the reasoning for each rule can live
 * next to it as a real comment instead of being lost.
 */
module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  ignorePatterns: [
    'node_modules/**',
    '.next/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'drizzle/**',
  ],
  overrides: [
    {
      // §6.1: "No component may contain a raw hex, rgba, px font size, or px
      // radius. Everything references a token. A grep for `#` inside
      // `src/components/` returns nothing but comments." This enforces the
      // hex/rgba half of that sentence at lint time. Matches any string or
      // template-literal chunk containing a hex color or an rgb()/rgba() call
      // — catches both `className="..."` and `style={{ color: '#fff' }}`.
      files: ['src/components/**/*.{ts,tsx}'],
      excludedFiles: ['src/components/**/__tests__/**', 'src/components/**/*.test.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'Literal[value=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
            message:
              'No raw hex colors in src/components/** (§6.1) — reference a design token from src/styles/tokens.css instead.',
          },
          {
            selector:
              'TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
            message:
              'No raw hex colors in src/components/** (§6.1) — reference a design token from src/styles/tokens.css instead.',
          },
          {
            selector: 'Literal[value=/\\brgba?\\(/]',
            message:
              'No raw rgb()/rgba() colors in src/components/** (§6.1) — reference a design token (e.g. --glass) instead.',
          },
          {
            selector: 'TemplateElement[value.raw=/\\brgba?\\(/]',
            message:
              'No raw rgb()/rgba() colors in src/components/** (§6.1) — reference a design token (e.g. --glass) instead.',
          },
        ],
      },
    },
    {
      // §6.7 / DECISIONS.md D-052: "--brand is never used as a text colour in
      // any component" — it clears contrast in light mode (6.5:1) but not
      // dark (3.3:1), and a component cannot know which theme it is rendering
      // in. Applied repo-wide, not just src/components/**, because
      // src/app/** and src/features/** also render Tailwind class strings
      // that could smuggle `text-brand` in.
      files: ['src/**/*.{ts,tsx}'],
      excludedFiles: ['src/**/__tests__/**', 'src/**/*.test.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'Literal[value=/\\btext-brand\\b/]',
            message:
              '`text-brand` is never a text colour (§6.7, DECISIONS.md D-052) — it is 3.3:1 in dark mode. Use text-primary/text-secondary/text-muted; --brand is for fills, borders and large text only.',
          },
          {
            selector: 'TemplateElement[value.raw=/\\btext-brand\\b/]',
            message:
              '`text-brand` is never a text colour (§6.7, DECISIONS.md D-052) — it is 3.3:1 in dark mode. Use text-primary/text-secondary/text-muted; --brand is for fills, borders and large text only.',
          },
        ],
      },
    },
    {
      // DECISIONS.md D-033: "The domain layer imports nothing from
      // infrastructure; this is enforced by an ESLint `no-restricted-imports`
      // rule rather than left to discipline." Covers both the `@/` alias and
      // relative imports, since either can reach src/infrastructure/**.
      files: ['src/domain/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '@/infrastructure',
                  '@/infrastructure/*',
                  '**/infrastructure/*',
                  '**/infrastructure',
                ],
                message:
                  'src/domain/** must not import from src/infrastructure/** — the domain layer is the innermost hexagonal ring (DECISIONS.md D-033). Depend on a port in src/application/ports/ instead.',
              },
            ],
          },
        ],
      },
    },
  ],
};
