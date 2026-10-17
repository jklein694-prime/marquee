import { test, expect } from "@playwright/test";
import { idleRepaints, openPanel, stubSearch } from "./helpers";

// Render-loop gates (PLAN.md §4): the graph must not repaint while nothing is
// moving, and a long streamed reply must not make typing lag.
test.describe("render performance gates", () => {
  test.beforeEach(async ({ page }) => {
    await stubSearch(page);
    await page.goto("/");
    await expect(page.getByPlaceholder("Talk movies & shows…")).toBeVisible();
  });

  test("2D graph is idle when nothing is hot", async ({ page }) => {
    await openPanel(page, "Graph", "Taste Graph");
    await expect(page.locator("canvas").first()).toBeVisible();
    // let the force layout settle
    await page.waitForTimeout(4000);
    const repaints = await idleRepaints(page, 2000);
    expect(repaints, "canvas repaints in 2s while idle").toBeLessThanOrEqual(5);
  });

  test("three.js never loads unless 3D is chosen", async ({ page }) => {
    const heavy: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/_next/static/chunks/")) heavy.push(res.url());
    });
    await openPanel(page, "Graph", "Taste Graph");
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.waitForTimeout(1000);
    // the three.js chunk is >1MB raw; nothing that large should have loaded
    const sizes = await Promise.all(
      heavy.map(async (u) => {
        const r = await page.request.get(u);
        return (await r.body()).length;
      })
    );
    expect(Math.max(0, ...sizes), "largest chunk loaded for the 2D graph").toBeLessThan(800_000);
  });

  test("typing stays responsive during a long streamed reply", async ({ page }) => {
    const input = page.getByPlaceholder("Talk movies & shows…");
    await input.fill("long");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Mock reply to")).toBeVisible();
    // measure input latency while the reply streams in
    const latency = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const el = document.querySelector<HTMLInputElement>("input[placeholder]")!;
          el.focus();
          const t0 = performance.now();
          el.value = "x";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          requestAnimationFrame(() => resolve(performance.now() - t0));
        })
    );
    expect(latency, "ms from input event to next frame").toBeLessThan(100);
  });
});
