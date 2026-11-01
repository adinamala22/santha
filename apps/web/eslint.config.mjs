import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'next-env.d.ts', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Design system: no ad-hoc hex colours in components — use token classes / CSS variables.
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/], TemplateElement[value.raw=/#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/]', message: 'Use design tokens, not hex colours.' },
      ],
    },
  },
  { files: ['**/*.test.ts', '**/*.test.tsx'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { console: 'readonly' } } },
);
