import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import {
  allocateAddresses,
  editFile,
  glob,
  grep,
  readFile,
  vaultRel,
  writeFile,
  ToolError,
} from "@/lib/engine/vaultFs";

const vault = () => process.env.VAULT_PATH!;

describe("vault confinement", () => {
  it("accepts relative and in-vault absolute paths", () => {
    expect(vaultRel("wiki/entities/Movies.md")).toBe("wiki/entities/Movies.md");
    expect(vaultRel(path.join(vault(), "wiki/log.md"))).toBe("wiki/log.md");
  });
  it("rejects escapes and .git", () => {
    expect(() => vaultRel("../etc/passwd")).toThrow(ToolError);
    expect(() => vaultRel("/etc/passwd")).toThrow(ToolError);
    expect(() => vaultRel(".git/config")).toThrow(ToolError);
  });
  it("rejects a symlink that points out of the vault", async () => {
    fs.symlinkSync("/etc", path.join(vault(), "wiki/movies/escape"));
    expect(() => readFile("wiki/movies/escape/hostname")).toThrow(/outside the vault/);
    // writing to a not-yet-existing path under the symlink is refused too
    await expect(writeFile("wiki/movies/escape/new/Thing.md", "x")).rejects.toThrow(/outside the vault/);
    // and grep never reads through it
    const secret = fs.mkdtempSync(path.join(require("os").tmpdir(), "outside-"));
    fs.writeFileSync(path.join(secret, "s.md"), "TOPSECRET\n");
    fs.symlinkSync(path.join(secret, "s.md"), path.join(vault(), "wiki/movies/leak.md"));
    expect(grep({ pattern: "TOPSECRET" })).toBe("No matches found");
  });
});

describe("Read / Glob / Grep", () => {
  it("reads raw text and reports missing files", () => {
    expect(readFile("wiki/entities/Movies.md")).toContain("## Watchlist");
    expect(() => readFile("wiki/nope.md")).toThrow(/does not exist/);
  });
  it("pages long files with offset/limit", () => {
    const out = readFile("wiki/entities/Movies.md", 1, 3);
    expect(out.split("\n").slice(0, 3)).toEqual(["---", "type: entity", 'title: "Movies"']);
    expect(out).toContain("pass offset to read more");
  });
  it("globs vault-relative patterns", () => {
    expect(glob("wiki/entities/*.md")).toEqual(["wiki/entities/Movies.md"]);
    expect(glob("wiki/**/_index.md")).toContain("wiki/movies/_index.md");
    expect(glob("wiki/movies/")).toContain("wiki/movies/_index.md");
    expect(glob("*.md", "wiki/entities")).toEqual(["wiki/entities/Movies.md"]);
  });
  it("greps with line numbers, file mode, and case folding", () => {
    expect(grep({ pattern: "^## Watchlist", path: "wiki/entities" })).toMatch(/^wiki\/entities\/Movies\.md:\d+:## Watchlist/);
    expect(grep({ pattern: "watchlist", ignoreCase: true, filesOnly: true, path: "wiki/entities" })).toBe(
      "wiki/entities/Movies.md"
    );
    expect(grep({ pattern: "zzzqqq" })).toBe("No matches found");
  });
});

describe("Edit / Write", () => {
  it("edits exactly one match and refuses ambiguity", async () => {
    await writeFile("wiki/movies/Heat (1995).md", "a\nverdict: loved\nb\nverdict: loved\n");
    await expect(editFile("wiki/movies/Heat (1995).md", "verdict: loved", "verdict: liked")).rejects.toThrow(
      /Found 2 matches/
    );
    await expect(editFile("wiki/movies/Heat (1995).md", "a\nverdict: loved", "a\nverdict: liked")).resolves.toMatch(
      /Edited/
    );
    expect(fs.readFileSync(path.join(vault(), "wiki/movies/Heat (1995).md"), "utf8")).toBe(
      "a\nverdict: liked\nb\nverdict: loved\n"
    );
  });
  it("uses the exact failure text the prompt's retry rule keys on", async () => {
    await expect(editFile("wiki/entities/Movies.md", "not in the file", "x")).rejects.toThrow(
      /String to replace not found/
    );
  });
  it("treats $ in replacements literally", async () => {
    await writeFile("wiki/movies/Money (2000).md", "price: X\n");
    await editFile("wiki/movies/Money (2000).md", "X", "$& $1 $$");
    expect(readFile("wiki/movies/Money (2000).md")).toBe("price: $& $1 $$\n");
  });
  it("only writes where the movie-expert rules allow", async () => {
    await expect(writeFile("wiki/concepts/Other.md", "x")).rejects.toThrow(/writes are limited/);
    await expect(writeFile("scripts/allocate-address.sh", "x")).rejects.toThrow(/writes are limited/);
    await expect(writeFile("wiki/movies/genres/Neo-noir.md", "x")).resolves.toMatch(/Created/);
    await expect(writeFile(".raw/.manifest.json", "{}")).resolves.toMatch(/Created/);
  });
  it("serializes concurrent edits to one file", async () => {
    await writeFile("wiki/log.md", "0\n");
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => editFile("wiki/log.md", `${i}\n`, `${i}\n${i + 1}\n`))
    );
    expect(readFile("wiki/log.md").trim().split("\n")).toHaveLength(11);
  });
  it("mustBeNew refuses to overwrite", async () => {
    await writeFile("wiki/movies/Alien (1979).md", "x");
    await expect(writeFile("wiki/movies/Alien (1979).md", "y", { mustBeNew: true })).rejects.toThrow(/already exists/);
  });
});

describe("address allocation", () => {
  it("shares the counter and lock with scripts/allocate-address.sh", () => {
    const counter = path.join(vault(), ".vault-meta/address-counter.txt");
    fs.writeFileSync(counter, "41\n");
    expect(allocateAddresses(3)).toEqual(["c-000042", "c-000043", "c-000044"]);
    const fromScript = execFileSync("bash", [path.join(vault(), "scripts/allocate-address.sh")], {
      encoding: "utf8",
    }).trim();
    expect(fromScript).toBe("c-000045");
    expect(allocateAddresses(1)).toEqual(["c-000046"]);
    expect(fs.existsSync(path.join(vault(), ".vault-meta/.address.lock.d"))).toBe(false);
  });
  it("rejects silly counts and a corrupt counter", () => {
    expect(() => allocateAddresses(0)).toThrow();
    fs.writeFileSync(path.join(vault(), ".vault-meta/address-counter.txt"), "oops");
    expect(() => allocateAddresses(1)).toThrow(/corrupt/);
  });
});
