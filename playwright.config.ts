import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

// End-to-end tests run the production build against the mock chat engine and
// a throwaway copy of the fixture vault. Nothing touches a real vault or the
// repo's data/ directory. Build first: `npm run build && npm run test:e2e`.
//
// The scratch root is created once by the runner process and inherited by
// workers through the environment, so every process agrees on the paths.
if (!process.env.MARQUEE_E2E_ROOT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "marquee-e2e-"));
  fs.cpSync(path.join(__dirname, "tests/e2e/fixtures/vault"), path.join(root, "vault"), { recursive: true });
  process.env.MARQUEE_E2E_ROOT = root;
}
const ROOT = process.env.MARQUEE_E2E_ROOT;
const PORT = Number(process.env.MARQUEE_E2E_PORT ?? 3999);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // phone viewports + touch on Chromium: the only browser CI installs. The
    // real-Safari pass is the manual device checklist (docs/DEVICE-CHECKLIST.md).
    { name: "iphone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "android", use: { ...devices["Pixel 5"], defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/graph`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      MARQUEE_ENGINE: "mock",
      MOCK_STEP_MS: "30",
      VAULT_PATH: path.join(ROOT, "vault"),
      MARQUEE_DATA_DIR: path.join(ROOT, "data"),
      TMDB_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
