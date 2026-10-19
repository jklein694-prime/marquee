// Score parsing shared by the Screen Test engines. No SDK imports here: the
// API engine must not pull the Agent SDK into its module graph.

// "8", "8-9", "8–9", "8 to 9", "8/10", "8.5" → the watchlist's "8" / "8-9";
// null when it is not a score at all
export function normalizeScore(raw: string): string | null {
  const m = String(raw)
    .trim()
    .match(/^(10|[1-9])(?:\.\d+)?(?:\s*(?:-|–|to)\s*(10|[1-9])(?:\.\d+)?)?(?:\s*\/\s*10)?$/i);
  if (!m) return null;
  return m[2] && m[2] !== m[1] ? `${m[1]}-${m[2]}` : m[1];
}

/** the follow-up sent when a screening turn ends without a verdict */
export const VERDICT_NUDGE =
  'You ended your turn without calling mcp__predict__verdict. Do not read anything else: call mcp__predict__verdict now with the score your analysis supports (predicted like "8" or "8-9") and a 2-3 sentence why, then end your turn.';
