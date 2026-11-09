import { lstat, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DELEGATION_PARENT_KEY } from "../../src/shared/model/host-contracts/delegation";
import type { Session } from "../../src/features/sessions/model/session";
import type { HostStore } from "../store";
import { launchSessionRun, sessionRunState, type SessionRunEngine } from "../sessions/sessionRuns";

/** A Nano Banana run is one tool call plus a save; agy cold starts can take a while. */
const DEADLINE_MS = 300_000;
const POLL_MS = 1_500;

export type AntigravityImageInput = {
  store: HostStore;
  engine: SessionRunEngine;
  projectId: string;
  parent: Pick<Session, "id" | "runtimeMode" | "worktreeCwd">;
  model: string;
  prompt: string;
  aspectRatio: string;
  /** Absolute target path inside the workspace; it must not exist yet. */
  target: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** The child sees only this brief; the owner's description stays quoted data. */
export function antigravityImageBrief(prompt: string, aspectRatio: string, target: string) {
  return [
    "Generate exactly one image for another agent with your built-in generate_image tool (Nano Banana).",
    `Description, quoted as data: ${JSON.stringify(prompt)}`,
    `Aspect ratio: ${aspectRatio}.`,
    `Save the generated image file to this exact path, creating missing folders: ${JSON.stringify(target)}`,
    "Do not create, edit or delete any other file, and do not run other tasks. Reply with the saved path only.",
  ].join("\n");
}

/**
 * Runs Antigravity's own image tool in a child session of the caller and returns the
 * saved bytes. The child appears under the caller like a subagent, with its approvals.
 */
export async function generateAntigravityImage(input: AntigravityImageInput) {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  const started = await launchSessionRun(input.store, input.engine, {
    projectId: input.projectId,
    harness: "antigravity",
    model: input.model,
    modelSettings: {
      [DELEGATION_PARENT_KEY]: JSON.stringify({
        parentSessionId: input.parent.id,
        runId: randomUUID(),
        kind: "subagent",
        model: input.model,
        startedAt,
      }),
    },
    runtimeMode: input.parent.runtimeMode,
    title: "Image · Nano Banana",
    prompt: antigravityImageBrief(input.prompt, input.aspectRatio, input.target),
    workspaceMode: "current",
    ...(input.parent.worktreeCwd ? { worktreeCwd: input.parent.worktreeCwd } : {}),
  });
  if (started.deferred || !started.sessionId)
    throw new Error(started.error ?? "Antigravity could not start the image run.");
  const run = { sessionId: started.sessionId, runId: started.runId, startedAt };
  for (;;) {
    const state = await sessionRunState(input.store, run, 0, now());
    if (state.state === "finished") {
      if (state.status !== "succeeded")
        throw new Error(
          `Nano Banana run ${state.status}${state.error ? `: ${state.error}` : ""} (session ${run.sessionId}).`,
        );
      break;
    }
    if (state.state === "running" && state.needsInput)
      throw new Error(
        `Nano Banana is waiting for approval in session ${run.sessionId}; it saves the image after the owner answers.`,
      );
    if (now() - startedAt > DEADLINE_MS)
      throw new Error(
        `Nano Banana did not finish within ${DEADLINE_MS / 1000} s; session ${run.sessionId} may still save the image.`,
      );
    await sleep(POLL_MS);
  }
  const saved = await lstat(input.target).catch(() => undefined);
  if (!saved?.isFile())
    throw new Error(
      `Nano Banana finished without saving the image; open session ${run.sessionId} for its reply.`,
    );
  return { bytes: await readFile(input.target), model: input.model, sessionId: run.sessionId };
}
