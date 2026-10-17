import path from "path";
import { MOVIES_DIR, mdFiles } from "./vault";
import { activeSnoozes, notInterested } from "./watchlist";

// loose title equality: page names swap ":" for " -" and snoozes are lowercased,
// so compare on lowercased alphanumerics only ("Spider-Man - No Way Home (2021)"
// == "spider-man: no way home (2021)")
export const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// hard gate for recommendation cards: a wiki/movies/ page existing means SEEN
// (pages exist only for seen titles — ground truth, unlike the trimmed hub
// table), active snoozes mean "not now", and the hub's "## Not interested"
// section is a permanent veto. Enforced here so a forgetful model can never
// surface any of them in the UI.
export function recFilter(movies: { title: string; year: number }[]) {
  const blocked = new Set<string>();
  for (const f of mdFiles(MOVIES_DIR)) blocked.add(norm(path.basename(f, ".md")));
  for (const s of activeSnoozes()) blocked.add(norm(s));
  for (const t of notInterested()) blocked.add(norm(t));
  const dropped: string[] = [];
  const kept = movies.filter((m) => {
    const hit = blocked.has(norm(`${m.title} (${m.year})`)) || blocked.has(norm(m.title));
    if (hit) dropped.push(`${m.title} (${m.year})`);
    return !hit;
  });
  return { kept, dropped };
}
