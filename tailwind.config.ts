import type { Config } from "tailwindcss";
import { theme } from "./src/theme/tokens";

// Every color, font, radius, and size comes from design/tokens.json (plus src/theme/extra.json).
// Components use the token names (bg-app, text-muted, rounded-control, h-control), never raw hex.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: theme,
  },
} satisfies Config;
