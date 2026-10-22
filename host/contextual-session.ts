import { createHash } from "node:crypto";
import type { HostSession, ContextualSessionInput, ContextualSessionPreview, RemoteProvider } from "../src/features/connections/model/protocol";
import { buildDeterministicHandoff, sessionThroughTurn } from "../src/features/sessions/model/handoff";
import { buildSecondOpinionRequest, harnessForTurn, turnEditedFiles, turnUserRequest } from "../src/features/sessions/model/secondOpinion";
import { runtimeModeUnavailableReason } from "../src/features/sessions/model/session";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

/** Exact context from the authoritative source; never binds or invokes a provider. */
export function previewContextualSession(source: HostSession, input: ContextualSessionInput,
  canonicalAdoption = false): ContextualSessionPreview {
  const adoptedRevision = canonicalAdoption && source.desktop?.revision === input.expectedRevision && source.desktop.updatedAt === source.updatedAt;
  if (source.session.id !== input.sessionId || source.revision !== input.expectedRevision && !adoptedRevision)
    throw new Error("The source conversation changed. Review the context again.");
  if (source.status === "running" || source.session.busy || source.session.worktreeRemoved)
    throw new Error("Wait for the source conversation to finish before transferring context.");
  const unavailableMode = runtimeModeUnavailableReason(input.harness, source.session.runtimeMode);
  if (unavailableMode) throw new Error(unavailableMode);
  const blocks = source.session.blocks;
  const selected = blocks.findIndex((block) => block.id === input.sourceBlockId);
  const reply = blocks[selected];
  if (!reply || !["assistant", "plan", "tasks"].includes(reply.role) || reply.streaming || reply.draft || reply.internal || !reply.text.trim())
    throw new Error("Select a completed reply from the source conversation.");
  let start = selected;
  while (start >= 0 && blocks[start]?.role !== "user") start--;
  if (start < 0) throw new Error("The selected reply has no source request.");
  let end = selected + 1;
  while (end < blocks.length && blocks[end]?.role !== "user") end++;
  const turn = blocks.slice(start, end).filter((block) => !block.draft && !block.internal);
  if (turn.some((block) => block.streaming)) throw new Error("The selected turn is still streaming.");
  const from = harnessForTurn(blocks, turn, source.session.harness) as RemoteProvider;
  if (input.mode === "handoff" && input.harness === from)
    throw new Error("Choose another provider for handoff. Account switching is not supported here.");
  const sourceModel = turn.find((block) => block.role === "user")?.turnModel?.id ?? source.session.model;
  if (input.mode === "secondOpinion" && input.harness === from && input.model === sourceModel)
    throw new Error("Choose a different provider or model for a second opinion.");
  const cwd = source.session.worktreeCwd || source.session.cwd;
  const sliced = sessionThroughTurn(source.session, turn);
  const request = turnUserRequest(turn);
  const second = input.mode === "secondOpinion" ? buildSecondOpinionRequest({ from, to: input.harness, turn, cwd }) : undefined;
  const contextText = second?.prompt ?? buildDeterministicHandoff(sliced);
  const files = turnEditedFiles(input.mode === "handoff" ? sliced.blocks : turn, cwd);
  const turnBlockIds = turn.map((block) => block.id);
  const sourceSettings = source.session.modelSettings ?? {};
  const boundedStrings: [unknown, number][] = [[source.session.id, 200], [source.projectId, 200], [cwd, 4096],
    [source.session.title, 10_000], [source.session.model, 200], [source.session.branch ?? "", 4096],
    [source.session.providerAccountId ?? "", 512], [contextText, 16_000], [request, 16_000],
    ...files.map((file): [unknown, number] => [file, 4096]), ...turnBlockIds.map((id): [unknown, number] => [id, 200])];
  if (turnBlockIds.length > 1000 || Object.keys(sourceSettings).length > 20 ||
      Object.entries(sourceSettings).some(([key, value]) => key.length > 64 || typeof value !== "string" || value.length > 128) ||
      boundedStrings.some(([value, limit]) => typeof value !== "string" || value.length > limit))
    throw new Error("The recorded context exceeds the review limit. Select a smaller completed turn.");
  // Bind exact outgoing content and its source identity, not unbounded historical tool output.
  // The independent revision check above still rejects a changed source before first adoption.
  const packet = JSON.stringify(canonical({ source: { id: source.session.id, projectId: source.projectId,
    status: source.status, title: source.session.title, cwd, branch: source.session.branch,
    harness: source.session.harness, model: source.session.model, modelSettings: sourceSettings,
    runtimeMode: source.session.runtimeMode, providerAccountId: source.session.providerAccountId },
    input: { ...input, expectedRevision: undefined }, turnBlockIds, files, contextText }));
  if (new TextEncoder().encode(packet).length > 64_000)
    throw new Error("The recorded context exceeds the review limit. Select a smaller completed turn.");
  const digest = createHash("sha256").update(packet).digest("hex");
  return { ...input, digest, sourceProvider: from, account: "host-default", cwd,
    projectId: source.projectId, runtimeMode: source.session.runtimeMode, request, files,
    turnBlockIds, contextText,
    ...(second ? { secondOpinion: second.options.secondOpinion } : {}) };
}
