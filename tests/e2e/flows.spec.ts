import { test, expect } from "@playwright/test";
import { isMobile, openPanel, stubSearch } from "./helpers";

// End-to-end flows against the mock engine (PLAN.md §5.2). The mock echoes
// the message it was sent and ends on an options widget when the text
// contains "widget"; /api/predict is scripted; TMDB is stubbed per test.
test.describe("flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("Talk movies & shows…")).toBeVisible();
  });

  test("chat: reply streams, widget answers continue the same session", async ({ page }) => {
    await page.getByPlaceholder("Talk movies & shows…").fill("hello widget");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Mock reply to: hello widget")).toBeVisible();
    await page.getByRole("button", { name: "Option A" }).click();
    await expect(page.getByText("Mock reply to: Option A")).toBeVisible();
    // the answered widget is inert, not gone
    await expect(page.getByRole("button", { name: "Option A" })).toBeDisabled();
  });

  test("chat: transcript is rebuilt after a reload, and New chat clears it", async ({ page }) => {
    await page.getByPlaceholder("Talk movies & shows…").fill("remember me");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Mock reply to: remember me")).toBeVisible();
    await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
    await page.reload();
    await expect(page.getByText("remember me", { exact: true })).toBeVisible();
    await expect(page.getByText("Mock reply to: remember me")).toBeVisible();
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page.getByText("Mock reply to: remember me")).toHaveCount(0);
    await expect(page.getByText("Find me something to watch")).toBeVisible();
  });

  test("a finished turn refetches the taste graph when it is shown", async ({ page }) => {
    let graphFetches = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/graph") graphFetches++;
    });
    await openPanel(page, "Graph", "Taste Graph");
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect.poll(() => graphFetches).toBeGreaterThanOrEqual(1);
    const before = graphFetches;
    // phones: the chat replaces the panel; a hidden graph fetches nothing
    // until it is shown again (desktop keeps it beside the chat)
    if (isMobile(page)) await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.getByPlaceholder("Talk movies & shows…").fill("I watched Heat");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Mock reply to: I watched Heat")).toBeVisible();
    await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
    if (isMobile(page)) {
      // the bottom bar hides while the chat box has focus (keyboard up)
      await page.getByPlaceholder("Talk movies & shows…").blur();
      await page.getByRole("button", { name: "Graph", exact: true }).click();
    }
    await expect.poll(() => graphFetches, { timeout: 10_000 }).toBeGreaterThan(before);
  });

  test("watchlist: save a suggestion, log it as watched, it leaves the list", async ({ page }) => {
    await openPanel(page, "List", "Watchlist");
    const mine = page.getByTestId("my-watchlist").locator("article", { hasText: "Thief (1981)" });
    // the data dir is shared across the profiles of one run: an earlier
    // profile may have left it saved (a saved title leaves the suggestions)
    if (!(await mine.count())) {
      const suggestion = page.getByTestId("suggestions").locator("article", { hasText: "Thief (1981)" }).first();
      await expect(suggestion).toBeVisible();
      await suggestion.getByRole("button", { name: "Save" }).click();
    }
    await expect(page.getByText("Nothing saved yet")).toHaveCount(0);
    await expect(mine).toBeVisible();
    await mine.getByRole("button", { name: "Watched it" }).click();
    await mine.getByRole("radio", { name: "8" }).click();
    await mine.getByRole("button", { name: "Log it" }).click();
    await expect(mine.getByText("logging…")).toBeVisible();
    // the silent turn runs on the mock engine, then the item is removed
    await expect(mine).toHaveCount(0, { timeout: 15_000 });
  });

  test("quick rate: search, rate, logged in the background", async ({ page }) => {
    await stubSearch(page);
    await openPanel(page, "Rate", "Quick Rate");
    await page.getByPlaceholder("Search a title…").locator("visible=true").fill("thief");
    await page.getByRole("button", { name: /Thief/ }).first().click();
    await page.getByRole("radio", { name: "9" }).click();
    await page.getByRole("button", { name: "Log it" }).click();
    await expect(page.getByText(/logging Thief \(1981\)/i)).toBeVisible();
    await expect(page.getByText("Logged Thief (1981) — 9/10.")).toBeVisible({ timeout: 15_000 });
    // ready for the next one
    await expect(page.getByPlaceholder("Search a title…").locator("visible=true")).toBeVisible();
  });

  test("quick rate: a missing TMDB key is reported, not 'No results'", async ({ page }) => {
    await openPanel(page, "Rate", "Quick Rate");
    await page.getByPlaceholder("Search a title…").locator("visible=true").fill("thief");
    await expect(page.getByText(/TMDB_API_KEY is not set/)).toBeVisible();
  });

  test("screen test: scripted screening ends on a verdict that can be saved", async ({ page }) => {
    await stubSearch(page);
    if ((page.viewportSize()?.width ?? 1440) < 768) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("button", { name: /Screen Test/ }).first().click();
    } else {
      await page.getByRole("button", { name: "Screen Test" }).first().click();
    }
    await page.getByPlaceholder("Search a title…").locator("visible=true").fill("insider");
    await page.getByRole("button", { name: /The Insider/ }).first().click();
    await expect(page.getByText(/Screening The Insider/)).toBeVisible();
    await expect(page.getByText("Louie predicts 7–8")).toBeVisible({ timeout: 20_000 });
    // the data dir is shared across the profiles of one run: a previous
    // profile may already have saved this title
    const save = page.getByRole("button", { name: "+ My watchlist" });
    if (await save.count()) {
      await save.click();
      await expect(page.getByRole("button", { name: "Added." })).toBeVisible();
    } else {
      await expect(page.getByText("Already on your watchlist")).toBeVisible();
    }
    await page.getByRole("button", { name: "Search another" }).click();
    await expect(page.getByPlaceholder("Search a title…").locator("visible=true")).toBeVisible();
  });
});
