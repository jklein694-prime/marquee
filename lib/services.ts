// Collapses raw TMDB provider names into their source platform. TMDB emits many
// near-duplicates for one service — storefront variants ("Paramount+ Amazon
// Channel"), pricing tiers ("Peacock Premium Plus"), and ad flavors ("Netflix
// Standard with Ads"). We only care about the underlying source, so map them all
// to one canonical name.

// Known source platforms, longest/most-specific first so prefix matching
// resolves "Paramount Plus ..." before any shorter brand could interfere.
const BRANDS = [
  "Amazon Prime Video", "Apple TV", "Paramount Plus", "HBO Max",
  "Acorn TV", "BritBox", "Disney Plus", "Peacock", "Netflix", "Hulu",
  "Kanopy", "Philo", "Spectrum On Demand", "YouTube TV", "fuboTV",
  "Starz", "Showtime", "AMC Plus", "MGM Plus", "Crunchyroll", "Tubi",
  "Pluto TV", "Mubi", "Max",
];

export function canonicalService(name: string): string {
  // normalize "+" → " Plus" and collapse whitespace so "Paramount+" and
  // "AcornTV" match the spaced brand names
  const n = name.replace(/\+/g, " Plus").replace(/\s+/g, " ").trim();
  const key = n.replace(/\s/g, "").toLowerCase();
  const hit = BRANDS.find((b) => key.startsWith(b.replace(/\s/g, "").toLowerCase()));
  if (hit) return hit;
  // fallback for brands not in the list: strip storefront / ad suffixes so
  // unknown providers still collapse their variants
  return n
    .replace(/ (Amazon Channel|Apple TV Channel|Roku (Premium )?Channel|Standard with Ads|with Ads)$/i, "")
    .trim();
}

// collapse + dedupe an array of raw provider names
export const canonicalServices = (names: string[]): string[] =>
  [...new Set(names.map(canonicalService))];
