import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // forks (not threads) so the setup file can chdir: the app keeps its
    // data/ under process.cwd(), and tests must never write into the repo
    pool: "forks",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20000,
  },
});
