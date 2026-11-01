import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'openapi.json'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'off', // Nest DI needs runtime imports for injected classes
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Module boundaries: a module may not import another module's internals (repositories, services
      // not exported via its module). Cross-module access goes through exported services or events.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*/*.repository', '../../modules/*/*.repository'],
              message: 'Do not import another module\'s repository; use its exported service or events.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', 'no-restricted-imports': 'off' },
  },
  { files: ['eslint.config.mjs'], ...tseslint.configs.disableTypeChecked },
);
