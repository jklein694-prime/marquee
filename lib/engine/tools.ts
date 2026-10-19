// Tool set for the Claude API engine. Names match the Agent SDK engine's
// (Read, Edit, mcp__ui__present_options, mcp__tmdb__search_movie, Task, ...)
// so the prompt, the booth trace, the activity strip and the 3D "thinking"
// animation all keep working unchanged across engines.
import { z } from "zod";
import { defineTool, type ToolDef } from "./loop";
import { allocateAddresses, editFile, glob, grep, readFile, writeFile, ToolError } from "./vaultFs";
import { recFilter } from "../recFilter";
import { search, details, similar, discover } from "../tmdb";
import type { Emit } from "./types";

const json = (data: unknown) => (typeof data === "string" ? data : JSON.stringify(data));
const media = z.enum(["movie", "tv"]).optional();

// --- vault file tools ----------------------------------------------------------------
export const readTool = defineTool({
  name: "Read",
  description:
    "Read a vault file. file_path is relative to the vault root (e.g. wiki/entities/Movies.md). Returns the raw text. Independent reads belong in ONE message — they run in parallel.",
  schema: z.object({
    file_path: z.string(),
    offset: z.number().int().positive().optional().describe("1-based first line, for long files"),
    limit: z.number().int().positive().optional().describe("max lines (default 2000)"),
  }),
  run: (a) => readFile(a.file_path, a.offset, a.limit),
});

export const globTool = defineTool({
  name: "Glob",
  description:
    'List vault files matching a glob pattern, vault-relative ("wiki/movies/*.md", "wiki/movies/**/Heat*", "wiki/movies/genres/"). Optional path narrows the base directory.',
  schema: z.object({ pattern: z.string(), path: z.string().optional() }),
  run: (a) => {
    const files = glob(a.pattern, a.path);
    return files.length ? files.join("\n") : "No files found";
  },
});

export const grepTool = defineTool({
  name: "Grep",
  description:
    "Regex search across vault text files. Returns file:line:text matches (or just file names with output_mode files_with_matches). path narrows to a directory or file; glob filters file names (e.g. *.md).",
  schema: z.object({
    pattern: z.string(),
    path: z.string().optional(),
    glob: z.string().optional(),
    "-i": z.boolean().optional().describe("case-insensitive"),
    output_mode: z.enum(["content", "files_with_matches"]).optional(),
  }),
  run: (a) =>
    grep({
      pattern: a.pattern,
      path: a.path,
      glob: a.glob,
      ignoreCase: a["-i"],
      filesOnly: a.output_mode === "files_with_matches",
    }),
});

export const editTool = defineTool({
  name: "Edit",
  description:
    "Surgical edit: replace old_string with new_string in a vault file. old_string must match the current file text exactly and be unique (or set replace_all). Edits to DIFFERENT files can go in one message; never two Edits to the same file in one message.",
  schema: z.object({
    file_path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  run: (a) => editFile(a.file_path, a.old_string, a.new_string, a.replace_all),
});

export const writeTool = defineTool({
  name: "Write",
  description:
    "Create a vault file (or replace one entirely — prefer Edit for existing pages). Several Writes to different new files can go in one message.",
  schema: z.object({ file_path: z.string(), content: z.string() }),
  run: (a) => writeFile(a.file_path, a.content),
});

export const allocateTool = defineTool({
  name: "allocate_addresses",
  description:
    "Reserve the next wiki address(es) (c-000123 ...) for new movie/category pages — the same counter scripts/allocate-address.sh uses. Ask for all you need in one call.",
  schema: z.object({ count: z.number().int().min(1).max(50) }),
  run: (a) => allocateAddresses(a.count).join("\n"),
});

/** page-writer's Write: brand-new movie pages only, never an existing file */
export const newPageWriteTool = defineTool({
  name: "Write",
  description: "Create one brand-new movie/TV page at the exact path you were given. Fails if the file exists.",
  schema: z.object({ file_path: z.string(), content: z.string() }),
  run: (a) => {
    if (!/^(?:.*\/)?wiki\/movies\/[^/]+\.md$/.test(a.file_path.replace(/\\/g, "/")))
      throw new ToolError("page-writer may only create wiki/movies/<Title (Year)>.md pages");
    return writeFile(a.file_path, a.content, { mustBeNew: true });
  },
});

// --- TMDB --------------------------------------------------------------------------
export const tmdbTools: ToolDef[] = [
  defineTool({
    name: "mcp__tmdb__search_movie",
    description:
      "Search TMDB for a movie or TV show by title (and optional year). Set media:'tv' for shows. Returns id, title, year, media, overview, vote_average, poster_path.",
    schema: z.object({ query: z.string(), year: z.number().optional(), media }),
    run: async (a) => json(await search(a.query, a.year, a.media)),
  }),
  defineTool({
    name: "mcp__tmdb__movie_details",
    description:
      "Full TMDB details for a movie or TV id: runtime, seasons (tv), genres, director/creator, US streaming providers, poster_path. Set media:'tv' for shows.",
    schema: z.object({ id: z.number(), media }),
    run: async (a) => json(await details(a.id, a.media)),
  }),
  defineTool({
    name: "mcp__tmdb__similar_movies",
    description: "TMDB recommendations similar to a movie or TV id. Set media:'tv' for shows.",
    schema: z.object({ id: z.number(), media }),
    run: async (a) => json(await similar(a.id, a.media)),
  }),
  defineTool({
    name: "mcp__tmdb__discover",
    description:
      "Discover well-rated movies or TV shows by TMDB genre ids (comma-separated) and/or date range (YYYY-MM-DD). Set media:'tv' for shows.",
    schema: z.object({
      media,
      with_genres: z.string().optional(),
      date_gte: z.string().optional(),
      date_lte: z.string().optional(),
      sort_by: z.string().optional(),
    }),
    run: async (a) => json(await discover(a)),
  }),
];

// --- UI widgets ----------------------------------------------------------------------
export function uiTools(emit: Emit): ToolDef[] {
  return [
    defineTool({
      name: "mcp__ui__present_options",
      description:
        "Show the user selectable choices inline in chat (chips/checkboxes). After calling this, END YOUR TURN — the selection arrives as the next user message.",
      schema: z.object({
        title: z.string(),
        mode: z.enum(["single", "multi"]),
        options: z.array(z.object({ id: z.string(), label: z.string(), sublabel: z.string().optional() })),
        context: z.string().optional().describe("One line shown under the title"),
      }),
      blocking: true,
      run: (args) => {
        emit({ type: "widget", widget: "options", data: args });
        return "Displayed. End your turn now; the selection arrives as the next user message.";
      },
    }),
    defineTool({
      name: "mcp__ui__movie_checklist",
      description:
        "Ask the user which of these movies they have seen, with a checkbox per movie and an optional 1-10 rating for each seen one. Use when probing viewing history (candidates, classics of a genre, a director's filmography). After calling this, END YOUR TURN — the results arrive as the next user message.",
      schema: z.object({
        title: z.string(),
        movies: z.array(z.object({ title: z.string(), year: z.number().optional() })),
      }),
      blocking: true,
      run: (args) => {
        emit({ type: "widget", widget: "checklist", data: args });
        return "Displayed. End your turn now; the results arrive as the next user message.";
      },
    }),
    defineTool({
      name: "mcp__ui__show_recommendations",
      description:
        "Render rich movie recommendation cards inline in chat. Include poster_path from TMDB when available.",
      schema: z.object({
        movies: z.array(
          z.object({
            title: z.string(),
            year: z.number(),
            why: z.string().describe("One sentence, second person: why THIS user would like it, naming a category they rate high or a title they loved — never a bare premise or tagline"),
            predicted: z
              .string()
              .regex(/^\d+(?:-\d+)?$/)
              .describe('Your projected score for the user, e.g. "8" or "8-9" — the watchlist rejects adds without one'),
            genres: z.array(z.string()).optional(),
            streaming: z.string().optional(),
            poster_path: z.string().optional().describe("TMDB poster_path, e.g. /abc.jpg"),
          })
        ),
      }),
      run: (args) => {
        const { kept, dropped } = recFilter(args.movies);
        if (kept.length) emit({ type: "widget", widget: "recs", data: { ...args, movies: kept } });
        return dropped.length
          ? `${kept.length ? "Cards displayed." : "NO cards displayed."} Dropped (seen, snoozed, or Not interested — never re-suggest these): ${dropped.join(", ")}. ${kept.length < 2 ? "Find replacements so the user still gets 2-3 picks." : ""}`
          : "Cards displayed.";
      },
    }),
  ];
}
