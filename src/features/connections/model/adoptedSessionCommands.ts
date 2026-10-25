import { invoke } from "@tauri-apps/api/core";
import type { Attachment } from "../../sessions/model/session";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";
import { loadRemoteCapabilities, remoteRequest } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { CommandReceipt, HostCommand, HostSession, RemoteMachine } from "./protocol";
import { uploadRemoteAttachments } from "./remoteAttachments";
import { desktopQueueClientId } from "./sharedQueueClient";
import type { SharedQueue } from "./sharedQueue";
import { noteAdoptedBeat } from "./hostWake";

const submitting = new Set<string>();
export const adoptedFollowUpPending = (sessionId: string): boolean => submitting.has(sessionId);
async function localMachine() {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines.find(isLocalSyncMachine);
  if (!machine) throw new Error("Host unavailable. Check the connection and try again.");
  return machine;
}

/** A mirrored transcript is not a local provider turn. Address its owning host,
 * fence against the live run, and reconcile a lost acknowledgement without replay. */
export async function sendAdoptedFollowUp(input: {
  sessionId: string;
  text: string;
  attachments: Attachment[];
  queuedMessageId?: string;
  isCurrent: () => boolean;
  onDispatch?: () => void;
}): Promise<boolean> {
  if (submitting.has(input.sessionId)) return false;
  submitting.add(input.sessionId);
  try {
    const machine = await localMachine();
    const capabilities = await loadRemoteCapabilities(machine.environmentId);
    const attachments = await uploadRemoteAttachments(machine.id, input.attachments, {
      environmentId: machine.environmentId,
      resumable: capabilities?.includes("attachments.resume"),
    });
    // Upload may outlive the run. Read again rather than steering the previous run.
    const snapshot = await remoteRequest<HostSession>(machine.id, "sessions.get", {
      sessionId: input.sessionId,
    });
    if (!input.isCurrent()) return false;
    if (snapshot.status === "interrupted")
      throw new Error(
        "The host turn was interrupted. Review the conversation before sending again.",
      );
    let queued: HostCommand["queued"];
    if (input.queuedMessageId) {
      const queue = await remoteRequest<SharedQueue>(machine.id, "sessions.queue.get", {
        sessionId: input.sessionId,
        clientId: desktopQueueClientId,
      });
      if (!input.isCurrent()) return false;
      queued = {
        id: input.queuedMessageId,
        clientId: desktopQueueClientId,
        revision: queue.revision,
        selected: true,
      };
    }
    if (
      snapshot.status === "running" &&
      (snapshot.executionOwner === "desktop" || !snapshot.runId || snapshot.runId === "desktop")
    )
      throw new Error(
        "This turn is running in the desktop app. New messages are queued until it finishes.",
      );
    if (snapshot.status === "running" && !capabilities?.includes("sessions.steer"))
      throw new Error("This host cannot steer the active turn. The message remains queued.");
    const command: HostCommand = {
      ...(snapshot.status === "running"
        ? { type: "steer" as const, runId: snapshot.runId! }
        : { type: "send" as const }),
      commandId: crypto.randomUUID(),
      sessionId: input.sessionId,
      text: input.text,
      attachments,
      ...(queued ? { queued } : {}),
    };
    input.onDispatch?.();
    try {
      await remoteRequest<CommandReceipt>(machine.id, "commands.dispatch", command);
    } catch (error) {
      if (String(error).includes("Host rejected request:")) throw error;
      const receipt = capabilities?.includes("commands.status")
        ? await remoteRequest<CommandReceipt | null>(machine.id, "commands.status", {
            commandId: command.commandId,
          }).catch(() => null)
        : null;
      if (!receipt)
        throw new DeliveryUnknownError(
          "Delivery is not confirmed. The message is held and will not be sent again automatically.",
          Promise.resolve("unknown"),
        );
    }
    noteAdoptedBeat({ ids: [input.sessionId], reset: false });
    return true;
  } finally {
    submitting.delete(input.sessionId);
  }
}

export async function cancelAdoptedTurn(sessionId: string, expectedRunId?: string): Promise<void> {
  const machine = await localMachine();
  const snapshot = await remoteRequest<HostSession>(machine.id, "sessions.get", { sessionId });
  if (snapshot.status !== "running" || !snapshot.runId) return;
  if (expectedRunId && snapshot.runId !== expectedRunId) return;
  await remoteRequest(machine.id, "commands.dispatch", {
    type: "cancel",
    commandId: crypto.randomUUID(),
    sessionId,
    runId: snapshot.runId,
  });
  noteAdoptedBeat({ ids: [sessionId], reset: false });
}
