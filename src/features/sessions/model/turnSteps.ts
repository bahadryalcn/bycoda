import type { CodexEntry } from "../../../platform/tauri/sessionImport";
import { buildCodexSession } from "../import/codexTranscript";
import { buildImportedSession } from "./claudeSessionImport";
import { markTurnInterrupted, wasTurnInterrupted } from "./inFlight";
import type { Block, BlockRole, Session } from "./session";

/**
 * The steps of a turn that ran while Bycoda was closed, taken from the
 * provider's own transcript and put into the session.
 *
 * Nothing here parses a transcript: the records are converted by the session
 * import (`buildImportedSession` for Claude, `buildCodexSession` for Codex), so
 * tool rows, results and replies look the way they do live. This file decides
 * which of the converted blocks the session is missing and where they go.
 */

/** What `read_turn_steps` returns: the turn's records from its prompt on. */
export type TurnSteps = {
  /** Replayable Claude JSONL. */
  text?: string;
  /** Codex entries. */
  entries?: CodexEntry[];
  /** The prompt that opens the turn is in the records; false when the turn outgrew the read. */
  startReached: boolean;
};

export const EARLIER_STEPS_NOTE = "Earlier steps of this turn are in the CLI transcript.";

/** Roles the transcript is the source of truth for; the rest is Bycoda's own chrome. */
const RECORDED_ROLES = new Set<BlockRole>(["assistant", "reasoning", "tool", "image"]);

const isRecorded = (block: Block) => RECORDED_ROLES.has(block.role);

type Converted = { prompt?: string; blocks: Block[] };

/** The records as session blocks, without the prompt that opens them. */
function convert(session: Session, steps: TurnSteps): Converted | null {
  // The conversion runs on a scratch session so nothing it records (resume
  // binding, ids) can leak into the real one.
  const base: Session = { ...session, id: `turn-steps-${session.id}`, blocks: [], busy: false };
  let built: Session;
  if (steps.text != null) {
    built = buildImportedSession({
      base,
      transcript: steps.text,
      providerSessionId: session.providerSessionId ?? "",
      providerAccountId: session.providerAccountId,
    });
  } else if (steps.entries) {
    built = buildCodexSession({ base, entries: steps.entries });
  } else {
    return null;
  }
  if (!steps.startReached) return { blocks: built.blocks };
  const promptAt = built.blocks.findIndex((block) => block.role === "user");
  if (promptAt < 0) return { blocks: built.blocks };
  return {
    prompt: built.blocks[promptAt].text,
    blocks: built.blocks.slice(promptAt + 1),
  };
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Whether the CLI's prompt is the one the session's last user block holds. The
 * app can add context to what it sends, so containment counts as a match.
 */
function samePrompt(stored: string, sent: string): boolean {
  const a = collapse(stored);
  const b = collapse(sent);
  if (!a || !b) return true;
  return (
    a.includes(b) || b.includes(a) || a.startsWith(b.slice(0, 40)) || b.startsWith(a.slice(0, 40))
  );
}

function toolKey(block: Block): string | undefined {
  const tool = block.tool;
  if (!tool) return undefined;
  if (tool.callId) return `call:${tool.callId}`;
  return `tool:${tool.kind ?? ""}:${tool.title ?? ""}:${JSON.stringify(tool.preview ?? tool.detail ?? "")}`;
}

/** Same step: one tool call, or one text. `grown` is a stored text cut short by the quit. */
function match(stored: Block, converted: Block): "same" | "grown" | null {
  if (stored.role !== converted.role) return null;
  if (converted.tool) {
    const key = toolKey(converted);
    const sameCall = key === toolKey(stored);
    // Codex ids can differ between the live thread item and the rollout: the
    // title and command identify the same call.
    const fallback =
      !!stored.tool &&
      stored.tool.title === converted.tool.title &&
      JSON.stringify(stored.tool.preview ?? "") === JSON.stringify(converted.tool.preview ?? "") &&
      !!converted.tool.preview;
    return sameCall || fallback ? "same" : null;
  }
  const a = stored.text.trim();
  const b = converted.text.trim();
  if (a === b) return "same";
  return a && b.startsWith(a) ? "grown" : null;
}

const settled = (status: string | undefined) => status === "completed" || status === "failed";

/** A stored tool row the quit froze (cancelled, still running) takes what the CLI recorded. */
function refreshed(stored: Block, converted: Block, how: "same" | "grown"): Block {
  if (how === "grown") return { ...stored, text: converted.text, streaming: false };
  if (!stored.tool || !converted.tool || settled(stored.tool.status)) return stored;
  if (!settled(converted.tool.status)) return stored;
  return {
    ...stored,
    tool: {
      ...stored.tool,
      ...converted.tool,
      callId: stored.tool.callId ?? converted.tool.callId,
    },
  };
}

/**
 * Add the steps the session is missing after the last user block, in place of
 * nothing: blocks it already holds stay (a text cut short by the quit is
 * completed, a tool row the quit froze takes its recorded result) and only the
 * records after the last one it holds are appended.
 *
 * The quit note is taken off first and, for an interrupted turn, put back after
 * the steps. Returns the session unchanged when the records cannot be tied to its last
 * turn: a different prompt, or no overlap with steps it already has. A wrong
 * merge would show a turn twice, which is worse than showing less.
 */
export function withTurnSteps(
  session: Session,
  steps: TurnSteps,
  outcome: "finished" | "interrupted",
): Session {
  const converted = convert(session, steps);
  if (!converted) return session;
  const incoming = converted.blocks.filter(isRecorded);
  if (incoming.length === 0) return session;

  const noted = wasTurnInterrupted(session);
  const blocks = noted ? session.blocks.slice(0, -1) : session.blocks;
  let promptAt = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].role === "user") {
      promptAt = index;
      break;
    }
  }
  if (promptAt < 0) return session;
  if (converted.prompt && !samePrompt(blocks[promptAt].text, converted.prompt)) {
    return session;
  }

  const turn = blocks.slice(promptAt + 1);
  const held = turn.map((block) => (isRecorded(block) ? block : null));
  const used = new Set<number>();
  let lastMatch = -1;
  const updated = [...turn];
  incoming.forEach((block, index) => {
    for (let at = 0; at < held.length; at += 1) {
      const candidate = held[at];
      if (!candidate || used.has(at)) continue;
      const how = match(candidate, block);
      if (!how) continue;
      used.add(at);
      updated[at] = refreshed(candidate, block, how);
      lastMatch = index;
      return;
    }
  });
  const hasRecorded = held.some((block) => block != null);
  if (hasRecorded && lastMatch < 0) return session;

  const appended: Block[] = incoming
    .slice(lastMatch + 1)
    .map((block) => ({ ...block, streaming: false }));
  if (lastMatch < 0 && !steps.startReached) {
    appended.unshift({
      id: crypto.randomUUID(),
      role: "system",
      text: EARLIER_STEPS_NOTE,
    });
  }
  const merged: Session = {
    ...session,
    blocks: [...blocks.slice(0, promptAt + 1), ...updated, ...appended],
  };
  // A cut-off turn keeps its note, after the steps, and anything the CLI left
  // running is sealed as the quit would have. A finished turn was not cut off,
  // so the note stays gone.
  return outcome === "interrupted" ? markTurnInterrupted(merged) : merged;
}
