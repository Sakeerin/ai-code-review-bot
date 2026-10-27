import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import next from '@next/eslint-plugin-next'
import { fileURLToPath } from 'node:url'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '.bun-cache/**',
      '**/.next/**',
      '**/.source/**',
      '**/.turbo/**',
      '**/dist/**',
      '**/out/**',
      '**/.wrangler/**',
      '**/next-env.d.ts',
      '**/drizzle/meta/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/dashboard/**/*.{ts,tsx}', 'apps/docs/**/*.{ts,tsx}'],
    plugins: { '@next/next': next },
    settings: {
      next: {
        rootDir: ['apps/dashboard/', 'apps/docs/'].map((path) =>
          fileURLToPath(new URL(path, import.meta.url)),
        ),
      },
    },
    rules: { ...next.configs.recommended.rules },
  },
)
