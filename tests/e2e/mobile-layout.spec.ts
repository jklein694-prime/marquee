import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectLayoutClean, isMobile, openPanel, stubSearch } from "./helpers";

// Layout gate (PLAN.md §3 acceptance): every screen, including open forms and
// menus, must have no horizontal overflow, no tap target under 44px, and no
// text under 12px. Runs on the phone profiles only; desktop keeps its density.
test.describe("mobile layout gate", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 768, "phone profiles only");

  test.beforeEach(async ({ page }) => {
    await stubSearch(page);
    await page.goto("/");
    await expect(page.getByPlaceholder("Talk movies & shows…")).toBeVisible();
  });

  test("home and chat", async ({ page }) => {
    await expectLayoutClean(page, "home");
    await page.getByPlaceholder("Talk movies & shows…").fill("I watched Heat, loved it. widget");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Mock reply to")).toBeVisible();
    await expectLayoutClean(page, "chat while busy");
    await expect(page.getByText("Pick one")).toBeVisible();
    await expectLayoutClean(page, "chat with widget");
  });

  test("graph", async ({ page }) => {
    await openPanel(page, "Graph", "Taste Graph");
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.waitForTimeout(1500);
    await expectLayoutClean(page, "graph 2d");
  });

  test("watchlist with review form and menu", async ({ page }) => {
    await openPanel(page, "List", "Watchlist");
    await expect(page.getByText("Thief (1981)").first()).toBeVisible();
    await expectLayoutClean(page, "watchlist");
    await page.getByRole("button", { name: "Watched it" }).first().click();
    await expect(page.getByText(/how was it/i)).toBeVisible();
    await expectLayoutClean(page, "watchlist review form");
    await page.getByRole("button", { name: "More actions" }).first().click();
    await expect(page.getByRole("button", { name: "Not interested" }).first()).toBeVisible();
    await expectLayoutClean(page, "watchlist menu");
  });

  test("quick rate with a picked title", async ({ page }) => {
    await openPanel(page, "Rate", "Quick Rate");
    await page.getByPlaceholder("Search a title…").locator("visible=true").fill("thief");
    await page.getByRole("button", { name: /Thief/ }).first().click();
    await expect(page.getByText(/how was it/i)).toBeVisible();
    await expectLayoutClean(page, "quick rate review form");
  });

  test("more, help, screen test, booth", async ({ page }) => {
    test.skip(!isMobile(page));
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expectLayoutClean(page, "more");
    await page.getByRole("button", { name: /Help/ }).first().click();
    await expect(page.getByText("how it works")).toBeVisible();
    await expectLayoutClean(page, "help");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: /Screen Test/ }).first().click();
    await expectLayoutClean(page, "screen test");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: /Projection Booth/ }).first().click();
    await expectLayoutClean(page, "booth");
  });

  test("keyboard-height viewport keeps the chat input reachable", async ({ page }) => {
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: vp.height - 336 });
    await expect(page.getByPlaceholder("Talk movies & shows…")).toBeInViewport();
    await expectLayoutClean(page, "chat with keyboard");
  });

  test("color contrast (axe)", async ({ page }) => {
    // axe bundles its own playwright-core typings; the runtime object is the same
    const results = await new AxeBuilder({ page: page as never }).withTags(["wcag2aa"]).include("body").analyze();
    const contrast = results.violations.filter((v) => v.id === "color-contrast");
    expect(contrast.map((v) => v.nodes.map((n) => n.html).slice(0, 5)), "contrast violations").toEqual([]);
  });
});
