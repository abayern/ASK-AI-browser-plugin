import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.output/**',
      '.wxt/**',
      'dist/**',
      'coverage/**',
      '.pnpm-store/**',
      '.pnpm-cache/**',
      '.pnpm-state/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // 安全边界：除 background 外，任何 UI / 内容脚本都不得导入密钥模块。
    // 这条规则让「Content Script 拿不到 API Key」成为机制保证，而不只靠人工约束。
    files: ['entrypoints/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    ignores: ['entrypoints/background/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/config/secret', '**/core/config/secret.ts', '**/core/config/secret.js'],
              message:
                'API Key 只能由 background 读取。UI 层请通过 config/getStatus 消息获取脱敏摘要，不得直接导入 core/config/secret。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...(reactHooks.configs.recommended?.rules ?? {}) },
  },
);
