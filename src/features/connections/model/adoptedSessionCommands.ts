import { invoke } from "@tauri-apps/api/core";
import type { Attachment } from "../../sessions";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";
import { loadRemoteCapabilities, remoteRequest } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { CommandReceipt, HostCommand, HostSession, RemoteMachine } from "./protocol";
import { providerSteerCapability } from "./protocol";
import { uploadRemoteAttachments } from "./remoteAttachments";
import { desktopQueueClientId } from "./sharedQueueClient";
import type { SharedQueue } from "./sharedQueue";
import { noteAdoptedBeat } from "./hostWake";
import { remoteIntentAuthority } from "./remoteOutbox";
import { newRequestId } from "../../../shared/lib/id/requestId";
import { QueueDeferredError } from "./sharedQueue";
import { classifyCommandFailure } from "./remoteCommandRetry";
import { followUpRefusalEvent, steerWaitReason } from "./queueState";
import { withTimeout } from "../../../shared/lib/withTimeout";

const submitting = new Set<string>();
export const adoptedFollowUpPending = (sessionId: string): boolean => submitting.has(sessionId);
async function localMachine() {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines.find(isLocalSyncMachine);
  if (!machine)
    throw new QueueDeferredError("Host unavailable. Check the connection and try again.");
  return machine;
}

/** A mirrored transcript is not a local provider turn. Address its owning host,
 * fence against the live run, and reconcile a lost acknowledgement without replay. */
export async function sendAdoptedFollowUp(input: {
  sessionId: string;
  text: string;
  attachments: Attachment[];
  queuedMessageId?: string;
  /** Captured from the displayed mirror or selected row before attachment preparation. */
  authorityGeneration?: number;
  isCurrent: () => boolean;
  onDispatch?: () => void;
}): Promise<boolean> {
  if (submitting.has(input.sessionId)) return false;
  const authority = remoteIntentAuthority(input);
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
      if (
        queue.claim &&
        (queue.claim.id !== input.queuedMessageId ||
          queue.claim.clientId !== desktopQueueClientId ||
          !capabilities?.includes("sessions.queue.claimDispatch"))
      )
        throw new QueueDeferredError("Another send owns this queue. Wait for its confirmation.");
      queued = {
        id: input.queuedMessageId,
        clientId: desktopQueueClientId,
        revision: queue.revision,
        selected: true,
        ...(queue.leased ? { leaseAware: true } : {}),
        ...(queue.drain?.holder === desktopQueueClientId ? { epoch: queue.drain.epoch } : {}),
        ...(queue.claim ? { claimToken: queue.claim.token } : {}),
      };
    }
    if (
      snapshot.status === "running" &&
      (snapshot.executionOwner === "desktop" || !snapshot.runId || snapshot.runId === "desktop")
    )
      throw new QueueDeferredError(
        "This turn is running in the desktop app. New messages are queued until it finishes.",
      );
    if (
      snapshot.status === "running" &&
      !capabilities?.includes(providerSteerCapability(snapshot.session.harness))
    )
      throw new QueueDeferredError(
        "This host cannot steer the active turn. The message remains queued.",
      );
    const command: HostCommand = {
      ...(snapshot.status === "running"
        ? { type: "steer" as const, runId: snapshot.runId! }
        : { type: "send" as const }),
      commandId: newRequestId(),
      ...authority,
      sessionId: input.sessionId,
      text: input.text,
      attachments,
      ...(queued ? { queued } : {}),
    };
    input.onDispatch?.();
    try {
      await remoteRequest<CommandReceipt>(machine.id, "commands.dispatch", command);
    } catch (error) {
      const failure = classifyCommandFailure(error);
      if (command.type === "steer" && failure === "definitive" && steerWaitReason(String(error)))
        throw new QueueDeferredError(String(error));
      if (failure === "not-sent") throw new QueueDeferredError(String(error));
      if (failure === "definitive") {
        if (
          String(error).includes("Host rejected request:") &&
          followUpRefusalEvent(String(error)) === "coordination"
        )
          throw new QueueDeferredError(String(error));
        throw error;
      }
      const receipt = capabilities?.includes("commands.status")
        ? await remoteRequest<CommandReceipt | null>(machine.id, "commands.status", {
            commandId: command.commandId,
          }).catch((statusError: unknown) => {
            if (
              command.type === "steer" &&
              classifyCommandFailure(statusError) === "definitive" &&
              steerWaitReason(String(statusError))
            )
              throw new QueueDeferredError(String(statusError));
            return null;
          })
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

const STOP_CONFIRM_MS = 15_000;
type AdoptedStopObservation = Pick<HostSession, "status" | "runId" | "revision">;
const adoptedStops = new Map<string, { observe?: (state: AdoptedStopObservation) => void }>();
const adoptedStopListeners = new Set<() => void>();

export function subscribeAdoptedStopping(listener: () => void): () => void {
  adoptedStopListeners.add(listener);
  return () => adoptedStopListeners.delete(listener);
}

export function isAdoptedTurnStopping(sessionId: string): boolean {
  return adoptedStops.has(sessionId);
}

export function observeAdoptedStop(sessionId: string, state: AdoptedStopObservation): void {
  adoptedStops.get(sessionId)?.observe?.(state);
}

export async function cancelAdoptedTurn(
  sessionId: string,
  expectedRunId?: string,
  authorityGeneration?: number,
): Promise<void> {
  if (adoptedStops.has(sessionId)) return;
  const pending: { observe?: (state: AdoptedStopObservation) => void } = {};
  adoptedStops.set(sessionId, pending);
  for (const listener of adoptedStopListeners) listener();
  try {
    const authority = remoteIntentAuthority({ authorityGeneration });
    const machine = await localMachine();
    const load = () =>
      remoteRequest<HostSession>(
        machine.id,
        "sessions.get",
        { sessionId },
        true,
        true,
        machine.environmentId,
      );
    const snapshot = await load();
    if (snapshot.status !== "running") return;
    if (!expectedRunId || !snapshot.runId)
      throw new Error("The active Host turn could not be verified. Try Stop again.");
    if (snapshot.runId !== expectedRunId) return;

    const ended = (state: AdoptedStopObservation) =>
      state.status !== "running" || (!!state.runId && state.runId !== expectedRunId);
    const settled = new Promise<void>((resolve) => {
      pending.observe = (state) => {
        if (state.revision > snapshot.revision && ended(state)) resolve();
      };
    });
    try {
      await remoteRequest(
        machine.id,
        "commands.dispatch",
        {
          type: "cancel",
          commandId: newRequestId(),
          ...authority,
          sessionId,
          runId: expectedRunId,
        },
        false,
        true,
        machine.environmentId,
      );
    } catch (error) {
      const latest = await load().catch(() => undefined);
      if (!latest || !ended(latest)) throw error;
      return;
    }

    // Acceptance only records the command. Keep Stop pending until the mirror
    // sees the original run close, then fall back to one fresh read at the deadline.
    noteAdoptedBeat({ ids: [sessionId], reset: false });
    try {
      await withTimeout(settled, STOP_CONFIRM_MS, "Host Stop confirmation");
    } catch {
      const latest = await load().catch(() => undefined);
      if (!latest || !ended(latest))
        throw new Error("The Host has not confirmed that the turn stopped. Try Stop again.");
    }
  } finally {
    adoptedStops.delete(sessionId);
    for (const listener of adoptedStopListeners) listener();
    noteAdoptedBeat({ ids: [sessionId], reset: false });
  }
}
