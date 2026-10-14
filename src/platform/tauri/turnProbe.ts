import { invoke } from "@tauri-apps/api/core";
import type { TurnTailState } from "../../features/sessions/model/turnRecovery";
import type { TurnSteps } from "../../features/sessions/model/turnSteps";

export type TurnTail = {
  state: TurnTailState;
  /** The final assistant message of a turn that ended. */
  finalText?: string;
};

/** Reads the end of the provider's own transcript (Claude Code or Codex), read-only. */
export function probeTurnTail(input: {
  provider: string;
  providerSessionId: string;
  cwd: string;
  providerAccountId?: string;
}): Promise<TurnTail> {
  return invoke<TurnTail>("probe_turn_tail", {
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    cwd: input.cwd,
    providerAccountId: input.providerAccountId ?? null,
  });
}

/**
 * The records of the provider's last turn (from its prompt on), read backwards
 * from the end of the transcript up to a cap. Null when no transcript is found.
 */
export function readTurnSteps(input: {
  provider: string;
  providerSessionId: string;
  cwd: string;
  providerAccountId?: string;
}): Promise<TurnSteps | null> {
  return invoke<TurnSteps | null>("read_turn_steps", {
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    cwd: input.cwd,
    providerAccountId: input.providerAccountId ?? null,
  });
}
