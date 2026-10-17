// Shared contract between the chat engines (Claude API, legacy Agent SDK) and
// the turn manager that runs them in the background. An engine streams UI
// events through emit and resolves when the turn is over; it never touches
// the HTTP request, so a phone dropping its connection can't end a turn.

export interface TurnEvent {
  type: string;
  [key: string]: unknown;
}

export type Emit = (ev: TurnEvent) => void;

export interface ChatTurnInput {
  message: string; // final text for the model (silent-turn tags already applied)
  sessionId?: string; // engine-specific conversation id; undefined = fresh
  signal: AbortSignal; // aborted only by an explicit Stop
}

export interface ChatTurnResult {
  sessionId?: string;
}

export type ChatEngine = (input: ChatTurnInput, emit: Emit) => Promise<ChatTurnResult>;
