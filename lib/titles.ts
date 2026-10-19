// Loose title equality, shared by the server and the client: page names swap
// ":" for " -", the app stores "Thief (1981)" while a hub bullet or a TMDB hit
// may say "Thief" with the year apart, and case differs. Compare on lowercased
// alphanumerics, with and without a trailing "(year)".
export const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** the normalized title without a trailing year, e.g. "thief (1981)" → "thief" */
export const normBare = (t: string) => norm(t.replace(/\s*\((19|20)\d{2}\)\s*$/, ""));

/** every key a title can match under: as written and without its year */
export function titleKeys(title: string, year?: number | string): string[] {
  const keys = new Set([norm(title), normBare(title)]);
  if (year) keys.add(norm(`${title} (${year})`));
  return [...keys];
}

/** true when two titles name the same thing by any of their keys */
export function sameTitle(a: string, b: string): boolean {
  const ka = titleKeys(a);
  const kb = new Set(titleKeys(b));
  return ka.some((k) => kb.has(k));
}
