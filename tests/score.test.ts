import { describe, expect, it } from "vitest";
import { normalizeScore } from "@/lib/score";

describe("normalizeScore", () => {
  it("accepts the watchlist formats as they are", () => {
    expect(normalizeScore("8")).toBe("8");
    expect(normalizeScore("8-9")).toBe("8-9");
    expect(normalizeScore("10")).toBe("10");
  });

  it("repairs the ways a model actually writes a score", () => {
    expect(normalizeScore("8/10")).toBe("8");
    expect(normalizeScore("8–9")).toBe("8-9");
    expect(normalizeScore("8 to 9")).toBe("8-9");
    expect(normalizeScore(" 7.5 ")).toBe("7");
    expect(normalizeScore("8-8")).toBe("8");
  });

  it("rejects what is not a score", () => {
    expect(normalizeScore("eight")).toBeNull();
    expect(normalizeScore("0")).toBeNull();
    expect(normalizeScore("11")).toBeNull();
    expect(normalizeScore("1981")).toBeNull();
    expect(normalizeScore("")).toBeNull();
  });
});
