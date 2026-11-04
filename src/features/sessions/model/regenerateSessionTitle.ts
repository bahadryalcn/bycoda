import { generateHarnessTitle } from "../../../integrations/harness";
import { getSession, storedSessionUpdatedAt, upsertSessionIfUnchanged } from "../data/sessionStore";
import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import {
  loadRemoteSession,
  remoteMachineFor,
  remoteSessionFor,
  sessionAccessForMachine,
} from "../../connections/model/connections";
import { sessionExecutionClient } from "../../connections/model/sessionExecutionClient";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { isRemoteProvider, type HostCommand } from "../../connections/model/protocol";
import { formatSessionTitle, type Session } from "./session";
import type { TitleGenerationChoice } from "./titlePreferences";
import { isModelEnabled, modelBelongsToHarness } from "./models";

export type TitleRegenerationOptions = {
  /** Retain this ID after an uncertain Host response; never automatically resend. */
  commandId: string;
  assertWritable: () => void | Promise<void>;
  currentSession?: () => Session | undefined;
};

/** Proven rejection before a title write; UI may start a fresh explicit attempt. */
export class TitleRegenerationConflictError extends Error {
  readonly code = "title-conflict";
  constructor(message = "Conversation title changed. Try again.") {
    super(message);
    this.name = "TitleRegenerationConflictError";
  }
}

/** Regenerates metadata on its existing owner without sending a conversation turn. */
export async function regenerateSessionTitle(
  session: Session,
  target: TitleGenerationChoice,
  options: TitleRegenerationOptions,
): Promise<Session> {
  await options.assertWritable();
  if (!isModelEnabled(target.model))
    throw new Error("This title generation model is disabled. Choose another model in Settings.");
  if (!modelBelongsToHarness(target.harness, target.model))
    throw new Error(
      "The title generation model belongs to another provider. Choose another model in Settings.",
    );
  const expectedTitle = session.title;
  const binding = hostSessionBinding(session);
  const remote = parseRemotePath(session.cwd);
  if (binding || remote) {
    if (binding && !binding.created)
      throw new Error("Verify this conversation's pending creation before changing it.");
    if (!isRemoteProvider(target.harness))
      throw new Error("This provider cannot generate conversation titles.");
    const environmentId = binding?.environmentId ?? remote!.environmentId;
    const machineId = binding?.machineId ?? (await remoteMachineFor(environmentId))?.id;
    if (!machineId) throw new Error("The owning Host route is no longer available.");
    const sessionId = binding?.sessionId ?? remoteSessionFor(session.id) ?? session.id;
    const access = sessionAccessForMachine(machineId, false, true, environmentId);
    const executionClient = sessionExecutionClient(environmentId, access);
    const original = await loadRemoteSession(machineId, sessionId, undefined, { executionClient });
    if (original.session.id !== sessionId || (binding && original.projectId !== binding.projectId))
      throw new Error("The conversation owner changed.");
    if (
      binding?.authorityGeneration != null &&
      original.authorityGeneration !== binding.authorityGeneration
    )
      throw new Error("The conversation authority changed. Reconnect before changing its title.");
    const command: HostCommand = {
      type: "regenerateTitle",
      commandId: options.commandId,
      sessionId,
      expectedTitle,
      harness: target.harness,
      model: target.model,
      modelSettings: target.modelSettings,
      providerAccountId: target.providerAccountId,
      ...(original.authorityGeneration == null
        ? {}
        : { authorityGeneration: original.authorityGeneration }),
    };
    await options.assertWritable();
    const knownReceipt = await access.status(options.commandId);
    if (!knownReceipt && original.session.title !== expectedTitle)
      throw new TitleRegenerationConflictError();
    const receipt = knownReceipt ?? (await access.dispatch(command));
    if (receipt.commandId !== options.commandId || receipt.sessionId !== sessionId)
      throw new Error("The conversation owner changed.");
    const result = await loadRemoteSession(machineId, sessionId, undefined, { executionClient });
    if (result.session.id !== sessionId || result.projectId !== original.projectId)
      throw new Error("The conversation owner changed.");
    // Readback contributes title only; preserve the renderer's active transcript.
    return { ...(options.currentSession?.() ?? session), title: result.session.title };
  }
  const message = session.blocks
    .filter(
      (block) =>
        (block.role === "user" || block.role === "assistant") &&
        !block.draft &&
        !block.internal &&
        block.text?.trim(),
    )
    .map((block) => `${block.role}: ${block.text}`)
    .join("\n\n")
    .slice(-24000);
  if (!message.trim()) throw new Error("Conversation has no messages to generate a title from.");
  const generated = await generateHarnessTitle(target.harness, {
    sessionId: session.id,
    cwd: session.worktreeCwd ?? session.cwd,
    message,
    model: target.model,
    modelSettings: target.modelSettings,
    providerAccountId: target.providerAccountId,
  });
  if (!generated) throw new Error("Could not generate a conversation title. Try again.");
  await options.assertWritable();
  const current = options.currentSession?.();
  if (current && current.title !== expectedTitle) throw new TitleRegenerationConflictError();
  const beforeRead = await storedSessionUpdatedAt(session.id);
  const stored = await getSession(session.id);
  const updatedAt = await storedSessionUpdatedAt(session.id);
  if (updatedAt !== beforeRead)
    throw new TitleRegenerationConflictError(
      "Conversation changed while saving its title. Try again.",
    );
  if (!stored || stored.title !== expectedTitle) throw new TitleRegenerationConflictError();
  const next = { ...stored, title: formatSessionTitle(stored.harness, generated.title) };
  if (!(await upsertSessionIfUnchanged(next, updatedAt)))
    throw new TitleRegenerationConflictError(
      "Conversation changed while saving its title. Try again.",
    );
  return { ...(options.currentSession?.() ?? stored), title: next.title };
}
