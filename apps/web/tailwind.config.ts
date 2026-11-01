import type { Config } from 'tailwindcss';
// Single source of truth for colours/radii/shadows: design/tokens. Never add hex values here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tokens = require('../../design/tokens/tailwind.tokens.js');

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      ...tokens,
      fontFamily: {
        sans: ['var(--font-poppins)', ...tokens.fontFamily.sans],
        telugu: ['var(--font-telugu)', ...tokens.fontFamily.telugu],
      },
    },
  },
  plugins: [],
};
export default config;
