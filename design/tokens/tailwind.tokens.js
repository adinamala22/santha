// Santha Tailwind theme extension — spread into tailwind.config.js `theme.extend` for apps/web.
module.exports = {
  colors: {
    indigo: { DEFAULT: "#1F2A5C", 700: "#16204A", 300: "#8A93B8", 100: "#E6E9F4" },
    marigold: { DEFAULT: "#F5A623", 600: "#D98C0F", 100: "#FDEBC8" },
    cream: "#FFF8EC", slate: "#5B6478", ink: "#1A1D29", leaf: "#2E9E6B", chilli: "#D9453D", sky: "#EAF0FF",
    eta: "#E3F4EB", ondarkmuted: "#C9CFE3",
  },
  fontFamily: { sans: ["Poppins", "system-ui", "sans-serif"], telugu: ["Noto Sans Telugu", "Poppins", "sans-serif"] },
  borderRadius: { xs: "6px", sm: "8px", md: "12px", lg: "16px", xl: "24px", pill: "999px" },
  boxShadow: { card: "0 1px 2px rgba(31,42,92,.06), 0 4px 12px rgba(31,42,92,.06)", sheet: "0 -4px 24px rgba(31,42,92,.12)" },
};
