import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { openPanel, stubSearch } from "./helpers";

// Visual regression gate: the phone screens as pixels. The force-graph canvas
// is non-deterministic (simulation seeds, timing) so it is hidden for the
// shot; everything around it — the ground, the capsule, the count pill,
// cards, the scale, chat chrome — is compared. The committed baselines are
// rendered by the CI runner (the "visual baselines" workflow); refresh them
// there after an intentional visual change and review the diff in the PR
// like any other change. A laptop renders text a little differently, so a
// local run may differ by a few percent: CI is the judge, and
//   npx playwright test visual --update-snapshots
// gives you local baselines to iterate against until then.
test.describe("visual", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "phone only");
  });

  const shot = (page: Page, name: string) =>
    expect(page).toHaveScreenshot(`${name}.png`, {
      stylePath: path.join(__dirname, "visual.css"),
      animations: "disabled",
      // text rasterizes a little differently from one Linux (freetype) to
      // the next, so single pixels may drift in colour; a layout or token
      // regression moves whole regions and still fails
      threshold: 0.35,
      maxDiffPixelRatio: 0.03,
    });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Graph", exact: true })).toBeVisible();
  });

  test("chat", async ({ page }) => {
    await page.waitForTimeout(400);
    await shot(page, "chat");
  });

  test("graph", async ({ page }) => {
    await openPanel(page, "Graph", "Graph");
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.waitForTimeout(1500);
    await shot(page, "graph");
    await page.getByRole("button", { name: "Legend" }).click();
    await shot(page, "graph-legend");
  });

  test("watchlist", async ({ page, request }) => {
    // the data dir is shared across a run: start from an empty list whatever
    // ran before, save Thief from the suggestions, and clear it again after
    const clear = async () => {
      const list = (await (await request.get("/api/watchlist")).json()) as { user?: { title: string }[] };
      for (const it of list.user ?? []) await request.post("/api/watchlist", { data: { action: "remove", title: it.title } });
    };
    await clear();
    await page.reload();
    await openPanel(page, "List", "Watchlist");
    await page.getByTestId("suggestions").locator("article", { hasText: "Thief (1981)" }).getByRole("button", { name: "Save" }).click();
    const mine = page.getByTestId("my-watchlist").locator("article", { hasText: "Thief (1981)" });
    await expect(mine).toBeVisible();
    await expect(page.getByText("Nothing saved yet")).toHaveCount(0);
    await shot(page, "watchlist");
    await mine.getByRole("button", { name: "Watched it" }).click();
    await mine.getByRole("radio", { name: "8" }).click();
    await shot(page, "watchlist-review");
    await clear();
  });

  test("quick rate", async ({ page }) => {
    await stubSearch(page);
    await openPanel(page, "Rate", "Quick Rate");
    await page.getByPlaceholder("Search a title…").locator("visible=true").fill("thief");
    await page.getByRole("button", { name: /Thief/ }).first().click();
    await page.getByRole("radio", { name: "7" }).click();
    await shot(page, "quick-rate");
  });
});
