import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "jetson/**", "vault-template/**", "public/sw.js"]),
  {
    rules: {
      // posters come from TMDB and the app is self-hosted on a Jetson: the
      // image optimizer would spend Nano CPU re-encoding them (see PLAN.md §4.6)
      "@next/next/no-img-element": "off",
    },
  },
]);
