import { buildOutgoingHandoffPrompt } from "./handoff";
import {
  cancelHarnessTurn,
  respondHarnessApproval,
  respondHarnessQuestion,
  sendHarnessTurn,
} from "../../../integrations/harness/core/registry";
import { beginHandoffPhase } from "../../../integrations/harness/core/handoffPhase";
import { mergeStream } from "../../../integrations/harness/core/streamText";
import type { HarnessId } from "./session";

/** The deterministic packet is the fallback, so the recap gets a short, hard cap. */
const HANDOFF_TIMEOUT_MS = 15_000;

export async function requestOutgoingHandoff(input: {
  harness: HarnessId;
  sessionId: string;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  userRequest: string;
}): Promise<string> {
  let brief = "";
  const endPhase = beginHandoffPhase(input.harness, "summarizing");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const turn = sendHarnessTurn({
    harness: input.harness,
    sessionId: input.sessionId,
    cwd: input.cwd,
    model: input.model,
    modelSettings: input.modelSettings,
    providerAccountId: input.providerAccountId,
    runtimeMode: "supervised",
    text: buildOutgoingHandoffPrompt(input.userRequest),
    onEvent: (event) => {
      if (event.type === "message.delta") {
        brief = mergeStream(brief, event.text);
      }
      if (event.type === "approval.requested") {
        respondHarnessApproval(
          input.harness,
          input.sessionId,
          event.requestId,
          "deny",
          event.occurrenceId,
        );
      }
      if (event.type === "question.asked") {
        respondHarnessQuestion(input.harness, input.sessionId, event.requestId, {
          kind: "skipped",
        });
      }
    },
  }).catch(() => {
    // Caller falls back to the deterministic packet.
  });
  // The cap must end the wait even when the turn has not reached the adapter yet
  // (queue, retirement drain, bridges): Stop only bumps its epoch there. The turn is
  // cancelled and finishes in the background; the caller then stops this provider.
  const capped = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      cancelHarnessTurn(input.harness, input.sessionId).catch(() => {});
      resolve();
    }, HANDOFF_TIMEOUT_MS);
  });
  try {
    await Promise.race([turn, capped]);
  } finally {
    clearTimeout(timer);
    endPhase();
  }
  return brief.trim();
}
