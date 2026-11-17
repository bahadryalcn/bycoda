import type { z } from "zod";
import type { SideQuestionParamsSchema } from "../../src/shared/model/host-contracts/side-chat";
import { buildBtwPrompt, supportsBtwHarness } from "../../src/features/sessions/model/btw";
import { nativeModelId } from "../../src/features/sessions/model/models";
import { sessionWorkCwd, type Session } from "../../src/features/sessions/model/session";
import { registerBuiltinHarnesses } from "../../src/integrations/harness/core/register";
import { runHarnessTextPrompt } from "../../src/integrations/harness/core/registry";

type Params = z.output<typeof SideQuestionParamsSchema>;

export const SIDE_QUESTION_TIMEOUT_MS = 120_000;

/**
 * Answers one by-the-way question from a snapshot of the session, exactly like the desktop side thread:
 * an isolated, non-persistent text run that never writes to the session. `authorize` re-checks the
 * caller after the transcript is read and before the provider is started.
 */
export async function askSideQuestion(
  params: Params,
  ports: {
    session(sessionId: string): Promise<{ session: Session }>;
    authorize(): Promise<void>;
    run?: typeof runHarnessTextPrompt;
  },
  signal?: AbortSignal,
): Promise<{ answer: string }> {
  registerBuiltinHarnesses();
  const { session } = await ports.session(params.sessionId);
  const harness = session.harness;
  if (!supportsBtwHarness(harness))
    throw new Error("Side questions are not available for this agent.");
  const cwd = sessionWorkCwd(session);
  if (!cwd || cwd === "~" || session.worktreeRemoved)
    throw new Error("A project working directory is required for this question.");
  const lastBlock = session.blocks[session.blocks.length - 1];
  if (!lastBlock) throw new Error("The session has no messages yet.");
  const now = Date.now();
  const messages = [
    ...(params.history ?? []).map((message, index) => ({
      id: `h${index}`,
      role: message.role,
      text: message.text,
      createdAt: now,
    })),
    { id: "q", role: "user" as const, text: params.question, createdAt: now },
  ];
  const prompt = buildBtwPrompt({
    blocks: session.blocks,
    cwd,
    thread: {
      id: "side",
      sourceEndBlockId: lastBlock.id,
      createdAt: now,
      updatedAt: now,
      status: "running",
      messages,
    },
  });
  await ports.authorize();
  const answer = await (ports.run ?? runHarnessTextPrompt)({
    harness,
    cwd,
    model: nativeModelId(session.model).trim() || undefined,
    modelSettings: session.modelSettings,
    providerAccountId: session.providerAccountId,
    intent: "plan",
    ephemeral: true,
    prompt,
    timeoutMs: SIDE_QUESTION_TIMEOUT_MS,
    signal,
  });
  const trimmed = answer.trim();
  if (!trimmed) throw new Error("The agent returned no answer.");
  return { answer: trimmed.slice(0, 64000) };
}
