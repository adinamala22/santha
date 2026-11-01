declare module '*/design/tokens/tailwind.tokens.js' {
  const tokens: {
    colors: { indigo: { DEFAULT: string; 700: string; 300: string; 100: string } } & Record<string, unknown>;
    fontFamily: Record<string, string[]>;
  };
  export default tokens;
}
