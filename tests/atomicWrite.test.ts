import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeJsonAtomic, writeTextAtomic } from "@/lib/atomicWrite";

describe("atomic writes", () => {
  it("creates parent directories and leaves no temp file behind", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const file = path.join(dir, "nested", "deep", "x.json");
    writeJsonAtomic(file, { a: 1 });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ a: 1 });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["x.json"]);
  });

  it("replaces the previous content in one step", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const file = path.join(dir, "t.txt");
    writeTextAtomic(file, "one");
    writeTextAtomic(file, "two");
    expect(fs.readFileSync(file, "utf8")).toBe("two");
    expect(fs.readdirSync(dir)).toEqual(["t.txt"]);
  });

  it("keeps the old file when the write fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const file = path.join(dir, "keep.txt");
    writeTextAtomic(file, "safe");
    // a directory where the temp file would go makes the rename fail
    const bad = path.join(dir, "keep.txt.dir");
    fs.mkdirSync(bad);
    expect(() => writeTextAtomic(path.join(bad, "..", "keep.txt.dir"), "x")).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("safe");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
