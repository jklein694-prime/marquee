import fs from "fs";
import path from "path";

// Write-to-temp then rename: readers (the graph build, Obsidian, a second
// request mid-write) never see a half-written file, and a crash mid-write
// leaves the old file intact instead of an empty one. Every persisted file
// outside the vault goes through here.
export function writeTextAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function writeJsonAtomic(file: string, data: unknown) {
  writeTextAtomic(file, JSON.stringify(data, null, 2));
}
