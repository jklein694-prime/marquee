import path from "path";

// Everything the app persists outside the vault (watchlist, snoozes, turn
// logs, sessions, push subscriptions, lint handoff) lives under one data
// directory: MARQUEE_DATA_DIR when set (tests, sandboxes), else ./data under
// the working directory, as before.
//
// Each path is written out with literal segments on purpose: the build
// tracer reads path.join(process.cwd(), "data", "x") as "this subfolder" but
// treats a dynamic join as "the whole project may be read at runtime".
const override = process.env.MARQUEE_DATA_DIR;

export const DATA_DIR = override || path.join(process.cwd(), "data");
export const WATCHLIST_FILE = override ? path.join(override, "watchlist.json") : path.join(process.cwd(), "data", "watchlist.json");
export const SNOOZE_FILE = override ? path.join(override, "snoozed.json") : path.join(process.cwd(), "data", "snoozed.json");
export const TURNS_DIR = override ? path.join(override, "turns") : path.join(process.cwd(), "data", "turns");
export const SESSIONS_DIR = override ? path.join(override, "sessions") : path.join(process.cwd(), "data", "sessions");
export const PUSH_KEYS_FILE = override ? path.join(override, "vapid.json") : path.join(process.cwd(), "data", "vapid.json");
export const PUSH_SUBS_FILE = override ? path.join(override, "push.json") : path.join(process.cwd(), "data", "push.json");
export const LINT_REPORT_FILE = override ? path.join(override, "lint-pending.txt") : path.join(process.cwd(), "data", "lint-pending.txt");
