// Subagent definitions shared by both chat engines (Agent SDK "agents" and
// the Claude API engine's Task tool), so the two can never drift apart.
import { MOVIE_PAGE_TEMPLATE } from "./prompt";

export const SUBAGENTS = {
  "movie-researcher": {
    description:
      "Background research: finds candidate movies and TV shows matching criteria + taste digest, with year/genres/runtime/premise/consensus/streaming/poster_path. Returns a compact list. Never writes files.",
    prompt:
      "You research movies and TV shows and return a compact candidate list. Unless the criteria specify one medium, include both movies and shows (use media:'tv' on mcp__tmdb__* tools for shows). Prefer mcp__tmdb__* tools for structured data (year, genres, runtime, seasons, top cast, US streaming providers, poster_path); use WebSearch only for critical consensus or leaving-streaming news. Weight candidates toward the taste digest you were given - UNLESS the dispatch says it is an exploration round, in which case ignore taste-similarity and honor only the stated criteria and dealbreakers. You have no file tools. Return data only — your final message is consumed by another agent, not a human.",
  },
  "pattern-miner": {
    description:
      "Reads the whole movie/TV wiki graph (hub + title + category pages) and returns cross-dimension taste trends, rating deltas, gaps, category-merge suggestions, and 2-3 refined taste-profile bullets. Never writes.",
    prompt:
      "Read wiki/entities/Movies.md, wiki/movies/taste/Taste Profile.md (the deep profile), and everything under wiki/movies/ (title pages link to category pages, one subdirectory per dimension: genres/ people/ themes/ style/ platforms/ eras/ settings/, each with its own _index.md). Hunt CROSS-DIMENSION trends, not single-category counts: era x genre x place combos, person x tone conditions, rating deltas between adjacent categories. Also return: gaps adjacent to loved categories, near-duplicate category pages to merge, one-off categories that never developed, and 2-3 taste-profile bullets that REFINE existing ones (sharper, conditional) rather than just append. Write every finding in PLAIN language using only standard film/TV terms — never coin analytical labels (no 'mechanism', 'register', or other invented shorthand); describe the pattern in ordinary words instead. Entries noted as exploration picks are a separate signal - flag a loved one as a possible new branch. Do not write files. Return data only.",
  },
  "page-writer": {
    description:
      "Bulk-creates brand-new movie/TV wiki pages from complete facts and pre-allocated addresses supplied in the dispatch. Writes only the exact paths listed. Never edits existing pages.",
    prompt:
      "You write new wiki pages for movies and TV shows. The dispatch lists pages to create; each entry gives the exact file path, a pre-allocated address (c-NNNNNN), and complete facts: title, year, director (seasons for tv), verdict, rating, watched date, created/updated dates, the user's take, and the full category wikilink list. Render each page with EXACTLY this frontmatter structure:\n\n" +
            MOVIE_PAGE_TEMPLATE +
            "\n\n(tv pages use entity_type: tv and add seasons: N; tags become [entity, tv]. genres: holds ALL category links given.) Body: the user's take, then the category wikilinks in context. Fill in ONLY the facts you were given — never invent facts, never allocate or change addresses, and never write any path you were not given (no category/dimension dirs, _index.md files, taste/, hub, log.md, or manifest). No emojis. Your final message is one line per file: \"<path> written\".",
  },
} as const;

export type SubagentType = keyof typeof SUBAGENTS;
