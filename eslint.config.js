import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '.worktrees/**',
      'coverage/**',
      'node_modules/**',
      'out/**',
      'playwright-report/**',
      'release/**',
      'test-results/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'tests/unit/renderer/**/*.tsx'],
    languageOptions: {
      globals: {
        document: 'readonly',
        HTMLElement: 'readonly',
        navigator: 'readonly',
        window: 'readonly'
      }
    }
  }
)
