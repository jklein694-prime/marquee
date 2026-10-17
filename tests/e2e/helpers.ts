import { expect, type Page } from "@playwright/test";

export const FAKE_SEARCH = [
  { id: 1, title: "Thief", year: "1981", media: "movie", poster_path: null },
  { id: 2, title: "The Insider", year: "1999", media: "movie", poster_path: null },
  { id: 3, title: "Mindhunter", year: "2017", media: "tv", poster_path: null },
];

/** TMDB is never reachable in tests: answer /api/search with fixed hits. */
export async function stubSearch(page: Page) {
  await page.route("**/api/search**", (route) => route.fulfill({ json: FAKE_SEARCH }));
}

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Open a panel by its mobile bottom-nav label or desktop tab label. */
export async function openPanel(page: Page, mobileLabel: string, desktopLabel: string) {
  const name = isMobile(page) ? mobileLabel : desktopLabel;
  await page.getByRole("button", { name, exact: true }).first().click();
}

export interface LayoutReport {
  overflow: boolean;
  small: { text: string; w: number; h: number }[];
  tiny: string[];
}

/**
 * The mobile layout gate: no horizontal overflow, every interactive element at
 * least 44x44 CSS px, no text under 12px. Elements may opt out with
 * data-allow-small (desktop-only density, decorative) — use sparingly.
 */
export async function layoutReport(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = document.documentElement.scrollWidth > vw + 1;
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    };
    const small: { text: string; w: number; h: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role=button]")) {
      if (!visible(el) || el.closest("[data-allow-small]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44)
        small.push({
          text: (el.textContent || el.getAttribute("aria-label") || (el as HTMLInputElement).placeholder || "").trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
    }
    const tiny = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!visible(el) || el.children.length || !(el.textContent || "").trim()) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) tiny.add(`${fs}px: ${(el.textContent || "").trim().slice(0, 30)}`);
    }
    return { overflow, small, tiny: [...tiny] };
  });
}

export async function expectLayoutClean(page: Page, screen: string) {
  const r = await layoutReport(page);
  expect(r.overflow, `${screen}: horizontal overflow`).toBe(false);
  expect(r.small, `${screen}: tap targets under 44px`).toEqual([]);
  expect(r.tiny, `${screen}: text under 12px`).toEqual([]);
}

/** Count animation frames over `ms` while nothing should be moving. */
export async function idleFrames(page: Page, ms = 2000): Promise<number> {
  return page.evaluate(
    (ms) =>
      new Promise<number>((resolve) => {
        let n = 0;
        const orig = window.requestAnimationFrame;
        window.requestAnimationFrame = (cb) => orig.call(window, (t) => (n++, cb(t)));
        setTimeout(() => {
          window.requestAnimationFrame = orig;
          resolve(n);
        }, ms);
      }),
    ms
  );
}
