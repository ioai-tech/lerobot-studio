import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/dist-lib/**',
    '**/coverage/**',
    'node_modules/**',
    'tests/fixtures/datasets/**',
    '**/*.d.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactRefresh.configs.vite],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // ESLint 10 / react-hooks@7 的 flat.recommended 默认启用 React Compiler
      // 规则集（set-state-in-effect / refs 等），会把大量既有合法模式标成 error。
      // 升级期保留经典 hooks 规则；Compiler 规则另开迁移。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // 既有代码大量使用 any；保持升级可合并，不在此 PR 做类型净化
      '@typescript-eslint/no-explicit-any': 'off',
      // ESLint 10 新增：既有 Error 包装模式未统一 attach cause
      'preserve-caught-error': 'off',
      // Context hooks and shadcn variants intentionally share their component module.
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: [
            'useDockviewApi',
            'useLoading',
            'useToast',
            'useI18nController',
            'useTranslationBridge',
            'reportIntlError',
            'badgeVariants',
            'buttonVariants',
            'tabsListVariants',
            'usePortalContainer',
            'metadata',
          ],
        },
      ],
    },
  },
]);
