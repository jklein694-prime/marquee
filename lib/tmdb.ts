import { canonicalServices } from "./services";

const BASE = "https://api.themoviedb.org/3";
const KEY = process.env.TMDB_API_KEY;

export type Media = "movie" | "tv";

async function tmdb(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", KEY ?? "");
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

interface Summary {
  id: number;
  title: string;
  year?: string;
  media: Media;
  overview: string;
  vote_average: number;
  poster_path: string | null;
}

function trim(m: {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  vote_average?: number;
  poster_path?: string | null;
}, media: Media): Summary {
  return {
    id: m.id,
    title: m.title ?? m.name ?? "",
    year: (m.release_date ?? m.first_air_date)?.slice(0, 4),
    media,
    overview: (m.overview ?? "").slice(0, 200),
    vote_average: m.vote_average ?? 0,
    poster_path: m.poster_path ?? null,
  };
}

export async function search(query: string, year?: number, media: Media = "movie") {
  const d = await tmdb(`/search/${media}`, {
    query,
    [media === "tv" ? "first_air_date_year" : "year"]: year,
  });
  return d.results.slice(0, 5).map((r: Parameters<typeof trim>[0]) => trim(r, media));
}

export async function details(id: number, media: Media = "movie") {
  const d = await tmdb(`/${media}/${id}`, {
    append_to_response: "credits,watch/providers,videos",
  });
  const providers = d["watch/providers"]?.results?.US;
  const videos: { site: string; type: string; key: string }[] = d.videos?.results ?? [];
  const yt = videos.filter((v) => v.site === "YouTube");
  const trailerKey = (yt.find((v) => v.type === "Trailer") ?? yt[0])?.key;
  return {
    ...trim(d, media),
    overview: d.overview ?? "", // full-length; trim()'s copy is clipped to 200 chars for list views
    runtime: d.runtime ?? d.episode_run_time?.[0],
    seasons: d.number_of_seasons,
    genres: (d.genres ?? []).map((g: { name: string }) => g.name),
    director:
      media === "tv"
        ? (d.created_by ?? []).map((c: { name: string }) => c.name).join(", ") || undefined
        : d.credits?.crew?.find((c: { job: string }) => c.job === "Director")?.name,
    streaming: canonicalServices((providers?.flatrate ?? []).map((p: { provider_name: string }) => p.provider_name)),
    trailer: trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : undefined,
  };
}

// searches movies and tv together and tags each hit with its real media type —
// avoids guessing movie vs tv up front, which is how title collisions happen
export async function searchMulti(query: string) {
  const d = await tmdb("/search/multi", { query });
  return (d.results as Array<Record<string, unknown>>)
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({
      ...trim(r as Parameters<typeof trim>[0], r.media_type as Media),
      popularity: (r.popularity as number) ?? 0,
    }));
}

export async function similar(id: number, media: Media = "movie") {
  const d = await tmdb(`/${media}/${id}/recommendations`);
  return d.results.slice(0, 8).map((r: Parameters<typeof trim>[0]) => trim(r, media));
}

export async function discover(opts: {
  media?: Media;
  with_genres?: string;
  date_gte?: string;
  date_lte?: string;
  sort_by?: string;
}) {
  const media = opts.media ?? "movie";
  const dateField = media === "tv" ? "first_air_date" : "primary_release_date";
  const d = await tmdb(`/discover/${media}`, {
    with_genres: opts.with_genres,
    [`${dateField}.gte`]: opts.date_gte,
    [`${dateField}.lte`]: opts.date_lte,
    sort_by: opts.sort_by ?? "vote_average.desc",
    "vote_count.gte": 200,
  });
  return d.results.slice(0, 10).map((r: Parameters<typeof trim>[0]) => trim(r, media));
}
