// Picks the chat engine. MARQUEE_ENGINE forces one (api | agent-sdk | mock);
// otherwise an ANTHROPIC_API_KEY selects the fast Claude API engine and a
// subscription-only install (CLAUDE_CODE_OAUTH_TOKEN, no key) keeps the
// Agent SDK engine, which is the only one that can use that token.
import type { ChatEngine } from "./types";
import { runApiChatTurn } from "./api";
import { runLegacyChatTurn } from "./legacy";
import { runMockChatTurn } from "./mock";

export type EngineName = "api" | "agent-sdk" | "mock";

export function engineName(): EngineName {
  const forced = process.env.MARQUEE_ENGINE;
  if (forced === "api" || forced === "agent-sdk" || forced === "mock") return forced;
  return process.env.ANTHROPIC_API_KEY ? "api" : "agent-sdk";
}

export function chatEngine(): ChatEngine {
  const name = engineName();
  return name === "api" ? runApiChatTurn : name === "mock" ? runMockChatTurn : runLegacyChatTurn;
}
