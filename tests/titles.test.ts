import { describe, expect, it } from "vitest";
import { norm, normBare, sameTitle, titleKeys } from "@/lib/titles";

describe("titles", () => {
  it("normalizes punctuation and case", () => {
    expect(norm("Spider-Man: No Way Home (2021)")).toBe("spider man no way home 2021");
    expect(norm("Spider-Man - No Way Home (2021)")).toBe(norm("spider-man: no way home (2021)"));
  });

  it("strips only a trailing year", () => {
    expect(normBare("Thief (1981)")).toBe("thief");
    expect(normBare("2001: A Space Odyssey (1968)")).toBe("2001 a space odyssey");
    expect(normBare("1917")).toBe("1917");
  });

  it("keys a title with and without its year", () => {
    expect(titleKeys("Thief", 1981)).toEqual(expect.arrayContaining(["thief", "thief 1981"]));
    expect(titleKeys("Thief (1981)")).toEqual(expect.arrayContaining(["thief 1981", "thief"]));
  });

  it("matches the app's spelling against the hub's", () => {
    expect(sameTitle("The Insider", "The Insider (1999)")).toBe(true);
    expect(sameTitle("Thief (1981)", "thief")).toBe(true);
    expect(sameTitle("Heat (1995)", "Heat (2023)")).toBe(true); // same name: never suggest it back
    expect(sameTitle("Heat", "Thief")).toBe(false);
  });
});
