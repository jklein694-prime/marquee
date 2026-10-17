// In-process file tools over the vault for the Claude API engine — the
// replacements for Claude Code's Read/Glob/Grep/Edit/Write, minus the process
// spawn per call. Every path is confined to the vault, and writes are further
// limited to the pages the movie-expert rules let the agent touch (hub,
// wiki/movies/**, the archive, log.md, the address manifest) — the prompt's
// "Never touch" list, enforced in code instead of trusted.
import fs from "fs";
import path from "path";
import { VAULT } from "../vault";

export class ToolError extends Error {}

const WRITABLE = [
  /^wiki\/entities\/Movies\.md$/,
  /^wiki\/entities\/Movies-archive\.md$/,
  /^wiki\/log\.md$/,
  /^wiki\/movies\/.+\.md$/,
  /^\.raw\/\.manifest\.json$/,
];

function root(): string {
  return path.resolve(process.env.VAULT_PATH || VAULT);
}

/** vault-relative posix path for a model-supplied path (absolute or relative) */
export function vaultRel(p: string): string {
  if (typeof p !== "string" || !p.trim()) throw new ToolError("path is required");
  const base = root();
  // the model often echoes the old cwd-style absolute paths; accept those that
  // land inside the vault, reject anything that escapes it
  const abs = path.resolve(base, p.trim());
  const rel = path.relative(base, abs);
  if (rel === "" ) return "";
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))
    throw new ToolError(`path is outside the vault: ${p}`);
  const posix = rel.split(path.sep).join("/");
  if (posix === ".git" || posix.startsWith(".git/")) throw new ToolError("the .git directory is off limits");
  return posix;
}

function absOf(rel: string): string {
  const abs = path.join(root(), rel);
  // a symlink inside the vault pointing out of it is still outside
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    try {
      real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {}
  }
  const r = path.relative(fs.realpathSync(root()), real);
  if (r.startsWith("..") || path.isAbsolute(r)) throw new ToolError(`path resolves outside the vault: ${rel}`);
  return abs;
}

function assertWritable(rel: string) {
  if (!WRITABLE.some((re) => re.test(rel)))
    throw new ToolError(
      `writes are limited to the hub, wiki/movies/**, Movies-archive.md, wiki/log.md and .raw/.manifest.json — not ${rel}`
    );
}

// --- per-file write queue: one writer per file, in order -------------------------
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(rel: string, fn: () => T): Promise<T> {
  const prev = queues.get(rel) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(rel, next);
  void next.finally(() => {
    if (queues.get(rel) === next) queues.delete(rel);
  }).catch(() => {});
  return next;
}

function atomicWrite(abs: string, text: string) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, abs); // readers (graph view, Obsidian) never see half a file
}

// --- Read ------------------------------------------------------------------------
const MAX_READ_LINES = 2000;

export function readFile(p: string, offset?: number, limit?: number): string {
  const rel = vaultRel(p);
  const abs = absOf(rel);
  let text: string;
  try {
    if (fs.statSync(abs).isDirectory()) throw new ToolError(`${rel} is a directory — use Glob to list it`);
    text = fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError(`File does not exist: ${rel}`);
  }
  const lines = text.split("\n");
  const start = Math.max(0, (offset ?? 1) - 1);
  const end = Math.min(lines.length, start + (limit ?? MAX_READ_LINES));
  const body = lines.slice(start, end).join("\n");
  const more = end < lines.length ? `\n\n[showing lines ${start + 1}-${end} of ${lines.length}; pass offset to read more]` : "";
  return body + more;
}

// --- Glob --------------------------------------------------------------------------
function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" matches zero or more directories
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close > i) {
        re += "(?:" + glob.slice(i + 1, close).split(",").map(escape).join("|") + ")";
        i = close;
      } else re += "\\{";
    } else re += escape(c);
  }
  return new RegExp("^" + re + "$");
}
const escape = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

function walk(dirAbs: string, relBase: string, out: string[], cap: number) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= cap) return;
    if (e.name === ".git" || e.name === "node_modules") continue;
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dirAbs, e.name), rel, out, cap);
    else out.push(rel);
  }
}

const MAX_FILES = 20000;

function listFiles(under: string): string[] {
  const out: string[] = [];
  walk(under ? absOf(under) : root(), under, out, MAX_FILES);
  return out;
}

export function glob(pattern: string, dir?: string): string[] {
  const base = dir ? vaultRel(dir) : "";
  // a pattern like "wiki/movies/Heat*" is vault-relative; with a dir it's relative to it
  let pat = pattern.trim().replace(/^\.\//, "");
  if (path.isAbsolute(pat)) pat = vaultRel(pat);
  const full = base ? `${base}/${pat}` : pat;
  const re = globToRegex(full);
  // a bare directory ("wiki/movies/") lists its direct files
  const dirOnly = /\/$/.test(full) ? new RegExp("^" + escape(full) + "[^/]+$") : null;
  return listFiles(base)
    .filter((f) => (dirOnly ? dirOnly.test(f) : re.test(f)))
    .sort()
    .slice(0, 500);
}

// --- Grep --------------------------------------------------------------------------
export function grep(opts: {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  filesOnly?: boolean;
}): string {
  let re: RegExp;
  try {
    re = new RegExp(opts.pattern, opts.ignoreCase ? "i" : "");
  } catch (err) {
    throw new ToolError(`invalid regex: ${(err as Error).message}`);
  }
  const base = opts.path ? vaultRel(opts.path) : "";
  let files: string[];
  try {
    files = base && fs.statSync(absOf(base)).isFile() ? [base] : listFiles(base);
  } catch {
    throw new ToolError(`no such path: ${base}`);
  }
  const fileRe = opts.glob ? globToRegex(opts.glob.includes("/") ? opts.glob : `**/${opts.glob}`) : null;
  const hits: string[] = [];
  const matchedFiles: string[] = [];
  for (const f of files) {
    if (fileRe && !fileRe.test(f)) continue;
    if (!/\.(md|json|txt|canvas|base|ya?ml)$/i.test(f)) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(root(), f), "utf8");
    } catch {
      continue;
    }
    let found = false;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        found = true;
        if (opts.filesOnly) break;
        hits.push(`${f}:${i + 1}:${lines[i].slice(0, 300)}`);
        if (hits.length >= 300) break;
      }
    }
    if (found) matchedFiles.push(f);
    if (hits.length >= 300) break;
  }
  if (opts.filesOnly) return matchedFiles.length ? matchedFiles.join("\n") : "No matches found";
  return hits.length ? hits.join("\n") : "No matches found";
}

// --- Edit / Write ------------------------------------------------------------------
export async function editFile(p: string, oldStr: string, newStr: string, replaceAll = false): Promise<string> {
  const rel = vaultRel(p);
  assertWritable(rel);
  const abs = absOf(rel);
  return serialized(rel, () => {
    const exists = fs.existsSync(abs);
    if (!exists) {
      if (oldStr === "") {
        atomicWrite(abs, newStr);
        return `Created ${rel}`;
      }
      throw new ToolError(`File does not exist: ${rel}`);
    }
    if (oldStr === newStr) throw new ToolError("old_string and new_string are identical — nothing to change");
    const text = fs.readFileSync(abs, "utf8");
    if (oldStr === "") throw new ToolError("old_string is empty but the file exists — use Write to replace a whole file");
    const count = text.split(oldStr).length - 1;
    if (count === 0)
      throw new ToolError("String to replace not found in file. Read the file again and retry with the exact current text.");
    if (count > 1 && !replaceAll)
      throw new ToolError(
        `Found ${count} matches of old_string — add surrounding context to make it unique, or set replace_all`
      );
    const next = replaceAll ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
    atomicWrite(abs, next);
    return `Edited ${rel}${replaceAll && count > 1 ? ` (${count} replacements)` : ""}`;
  });
}

export async function writeFile(p: string, content: string, opts: { mustBeNew?: boolean } = {}): Promise<string> {
  const rel = vaultRel(p);
  assertWritable(rel);
  const abs = absOf(rel);
  return serialized(rel, () => {
    const existed = fs.existsSync(abs);
    if (existed && opts.mustBeNew) throw new ToolError(`${rel} already exists — page-writer only creates new pages`);
    atomicWrite(abs, content);
    return `${existed ? "Overwrote" : "Created"} ${rel}`;
  });
}

// --- Address allocation (same counter + lock as scripts/allocate-address.sh) -------
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function allocateAddresses(count: number): string[] {
  const n = Math.floor(count);
  if (!(n >= 1 && n <= 50)) throw new ToolError("count must be between 1 and 50");
  const meta = path.join(root(), ".vault-meta");
  const counter = path.join(meta, "address-counter.txt");
  const lock = path.join(meta, ".address.lock.d");
  fs.mkdirSync(meta, { recursive: true });
  // mkdir is atomic: the shell script and this share the same spinlock
  let tries = 0;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      if (++tries >= 100) throw new ToolError("address lock timeout");
      sleepSync(50);
    }
  }
  try {
    const raw = (fs.existsSync(counter) ? fs.readFileSync(counter, "utf8").trim() : "") || "0";
    if (!/^\d+$/.test(raw)) throw new ToolError(`address counter corrupt: ${raw}`);
    const cur = Number(raw);
    const out: string[] = [];
    for (let i = 1; i <= n; i++) out.push(`c-${String(cur + i).padStart(6, "0")}`);
    fs.writeFileSync(counter, `${cur + n}\n`);
    return out;
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch {}
  }
}
