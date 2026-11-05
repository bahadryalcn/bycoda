import { randomUUID } from "node:crypto";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
} from "../../src/shared/model/host-contracts/assistant";
import { verifyAssistantNotificationReceipt } from "../assistant/native/assistant-notification-receipt";
import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
export async function handleAssistantObservationTools(
  dependencies: Pick<
    ServerBindings,
    | "assistant"
    | "engine"
    | "assistantPorts"
    | "withRoomProjectScope"
    | "conversationDesktop"
    | "nativeAdmissionOwner"
  >,
  request: Pick<
    HttpToolRequest,
    | "request"
    | "peerIdentity"
    | "socialPrincipal"
    | "runtimePrincipal"
    | "conversationPrincipal"
    | "token"
    | "params"
    | "endResult"
  >,
) {
  if (
    request.request.headers.origin ||
    request.peerIdentity ||
    request.socialPrincipal ||
    request.runtimePrincipal ||
    request.conversationPrincipal
  )
    throw new Error("Native owner device required for notification recovery.");
  const ownerToken = request.token;
  if (!ownerToken) throw new Error("Native owner device required for notification recovery.");
  const recovery = AssistantRequestValidationSchema.parse(request.params);
  if (recovery.op !== "observation.delivery.list" && recovery.op !== "observation.delivery.refresh")
    throw new Error("Invalid notification recovery request.");
  const room = await dependencies.assistant.canonicalGlobalRoomBinding();
  const ownerAuthorized = async () => await dependencies.engine.store.authenticated(ownerToken);
  const authorized = async () =>
    !!room &&
    (await dependencies.assistant.canonicalGlobalRoomBinding())?.id === room.id &&
    (await ownerAuthorized()) &&
    (await dependencies.assistantPorts.manualProjectVisible?.(recovery.projectId)) === true;
  if (!room || !(await authorized()))
    throw new Error("Notification recovery source is unavailable.");
  const target = {
    threadId: room.id,
    projectId: recovery.projectId,
    family: "conversation" as const,
    action: recovery.op,
    input:
      recovery.op === "observation.delivery.refresh"
        ? { notificationId: recovery.notificationId }
        : {},
    requestId: randomUUID(),
  };
  await dependencies.withRoomProjectScope(target, authorized, async (valid, source) => {
    let rows: {
      notificationId: string;
      projectId: string;
      state: "pending" | "unknown" | "accepted" | "suppressed";
    }[];
    if (recovery.op === "observation.delivery.list")
      rows = await dependencies.assistant.observedNotificationRecovery(recovery.projectId);
    else {
      const intent = await dependencies.assistant.observedNotificationIntent(
        recovery.notificationId,
      );
      if (
        !intent ||
        intent.projectId !== recovery.projectId ||
        intent.threadId !== room.id ||
        intent.deviceHash !== source.deviceHash
      )
        throw new Error("Reconnect the original notification device to check its status.");
      const requestId = `observation-${intent.operationHash}`;
      const nativeInput = {
        notificationId: intent.notificationId,
        kind: intent.kind,
        requestId,
        operationHash: intent.operationHash,
        projectCwds: [source.projectCwd],
      };
      const captured = (await dependencies.conversationDesktop.callAssistantThread(
        "assistant.notification.status",
        nativeInput,
        {
          threadId: room.id,
          environmentId: dependencies.engine.store.environmentId,
          targetDeviceHash: intent.deviceHash,
        },
        authorized,
      )) as { relayId: string; envelope: unknown };
      const receipt = await verifyAssistantNotificationReceipt(
        dependencies.nativeAdmissionOwner,
        captured,
        {
          environmentId: dependencies.engine.store.environmentId,
          threadId: room.id,
          notificationId: intent.notificationId,
          kind: intent.kind,
          requestId,
          operationHash: intent.operationHash,
        },
        authorized,
      );
      if (receipt.state !== "unknown")
        await dependencies.assistant.settleObservedNotification(intent, receipt.state);
      rows = [
        {
          notificationId: intent.notificationId,
          projectId: intent.projectId,
          state: receipt.state === "unknown" ? "unknown" : receipt.state,
        },
      ];
    }
    if (!valid()) throw new Error("Notification recovery scope changed.");
    await request.endResult(
      AssistantResponseValidationSchema.parse({ observationDeliveries: rows }),
      async () => {
        if (!valid() || !(await authorized()))
          throw new Error("Notification recovery authority changed.");
      },
      true,
    );
  });
  return;
}
