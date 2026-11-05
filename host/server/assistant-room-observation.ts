import { createHash, randomUUID } from "node:crypto";
import {
  captureRoomProject,
  roomAccountResult,
} from "../assistant/management/assistant-management-dispatch";
import {
  roomNativeResult,
  type NativeLibraryProof,
} from "../assistant/native/assistant-native-library-proof";
import {
  verifyNativeObservationCompletion,
  verifyNativeObservationPage,
  type NativeObservationCapture,
} from "../assistant/observations/assistant-native-observation-page";
import { type NativePageScope } from "../assistant/observations/assistant-observation-native-pages";
import { collectGoalObservationProjects } from "../assistant/observations/assistant-observation-project-pages";
import {
  executeAssistantObservationTool,
  observationRoomConsumer,
} from "../assistant/observations/assistant-observation-tools";
import type { ServerBindings } from "./bindings";
export function createRoomObservationRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "conversationDesktop"
    | "roomResourceReceipts"
    | "social"
    | "assistantPorts"
    | "assistant"
    | "visibilityAdmission"
    | "withNativeObservationScope"
    | "nativeObservationGeneration"
    | "nativeVoiceLeases"
    | "retireNativeVoiceGenerations"
    | "nativeAdmissionOwner"
    | "observationJournal"
    | "observationHostPages"
    | "observationNativePages"
    | "observationProjectPages"
    | "observationPages"
    | "withNativeSessionScope"
    | "withRoomProjectScope"
    | "roomVisibleProject"
    | "executeAccountSocial"
    | "roomNotebook"
    | "conversationAccess"
    | "runtimeLogAccess"
    | "socialTransport"
    | "refreshLogSources"
    | "runtimeLogs"
    | "conversationManagementRuntime"
    | "globalServerManagement"
    | "globalAssistantManagement"
    | "roomBrowser"
    | "roomTerminals"
    | "roomFiles"
    | "roomDevServers"
    | "roomSessions"
    | "assistantWorkspaceOwner"
    | "roomWorkspace"
    | "workspaceTransferSource"
    | "projectSessionList"
    | "featureSession"
    | "localSessionReference"
    | "conversationThreadCrews"
    | "conversationThreadWork"
    | "conversationManagement"
    | "conversationWorkspace"
    | "roomProjectNotes"
    | "tasks"
    | "goals"
    | "automations"
  >,
) {
  const executeRoomObservation = async (
    call: import("../assistant/management/assistant-management-turn").RoomManagementCall,
    admission: import("../assistant/management/assistant-management-turn").RoomManagementAdmission,
    authorized: () => Promise<boolean>,
  ) => {
    const fetchNativePage = async (
      native: {
        capture: NativeObservationCapture;
        deviceHash: string;
        projectId?: string;
        cwd?: string;
      },
      source: "note" | "server" | "native-session",
      valid: () => boolean,
      pageOffset: number,
      fingerprint?: string,
    ) => {
      const requestId = randomUUID();
      const operationHash = createHash("sha256")
        .update(
          JSON.stringify([
            "native.observations.baseline",
            call.threadId,
            source,
            pageOffset,
            fingerprint,
            requestId,
          ]),
        )
        .digest("hex");
      const captured = (await dependencies.conversationDesktop.callAssistantThread(
        source === "native-session"
          ? "observations.native.projectBaseline"
          : "observations.native.baseline",
        {
          requestId,
          operationHash,
          source,
          offset: pageOffset,
          ...(fingerprint ? { fingerprint } : {}),
        },
        {
          threadId: call.threadId,
          environmentId: dependencies.engine.store.environmentId,
          targetDeviceHash: native.deviceHash,
          ...(source === "native-session"
            ? { projectId: native.projectId, targetProjectCwd: native.cwd }
            : {}),
        },
        authorized,
      )) as { relayId: string; envelope: unknown };
      return verifyNativeObservationPage(
        dependencies.nativeAdmissionOwner,
        native.capture,
        {
          relayId: captured.relayId,
          requestId,
          operationHash,
          source,
          offset: pageOffset,
          ...(source === "native-session"
            ? { projectId: native.projectId, targetCwd: native.cwd }
            : {}),
        },
        captured.envelope,
        valid,
      );
    };
    const run = (
      valid: () => boolean,
      consumerGeneration?: string,
      goalProofs?: { projectId: string; cwd: string }[],
      native?: {
        proof: NativeLibraryProof;
        capture: NativeObservationCapture;
        deviceHash: string;
        projectId?: string;
        cwd?: string;
      },
    ) =>
      executeAssistantObservationTool(
        {
          journal: dependencies.observationJournal,
          consumerGeneration,
          ...(native ? { nativeInstallationId: native.proof.installationId } : {}),
          ...(native
            ? {
                nativeSourceGap: async (_scope: unknown, source: string) => {
                  if (source === "crew")
                    return !(await dependencies.observationHostPages.covered({
                      threadId: call.threadId,
                      generation: consumerGeneration!,
                      consumer: observationRoomConsumer(call.threadId, consumerGeneration, "crew"),
                    }));
                  if (source !== "note" && source !== "server" && source !== "native-session")
                    throw new Error("Native observation source is unavailable.");
                  const status = await fetchNativePage(native, source, valid, 0);
                  const scope: NativePageScope = {
                    threadId: call.threadId,
                    installationId: native.proof.installationId,
                    generation: consumerGeneration!,
                    consumer: observationRoomConsumer(call.threadId, consumerGeneration, source),
                    source,
                  };
                  const [uncertain, covered] = await Promise.all([
                    dependencies.observationNativePages.uncertain(scope),
                    dependencies.observationNativePages.covered(scope),
                  ]);
                  return status.sourceGap || uncertain || !covered;
                },
              }
            : {}),
          authorizeScope: async () => valid() && (await authorized()),
          authorizeEvent: async (_thread, scope, event) =>
            valid() &&
            ("nativeInstallationId" in scope
              ? event.nativeInstallationId === scope.nativeInstallationId &&
                event.projectIds.length === 0 &&
                !event.accountId
              : "hostLibrary" in scope
                ? event.source === "crew" &&
                  event.hostLibrary === true &&
                  event.projectIds.length === 0 &&
                  !event.accountId &&
                  !event.nativeInstallationId
                : "accountId" in scope
                  ? event.source === "social" &&
                    event.accountId === scope.accountId &&
                    event.projectIds.length === 0
                  : event.source !== "social" && event.projectIds.includes(scope.projectId)),
          guard: () => valid,
          resnapshot: async (_thread, scope, _admission, offset, snapshotId, consumer, source) => {
            if ("hostLibrary" in scope) {
              if (!native || !consumerGeneration || source !== "crew")
                throw new Error("Host Crew observation source unavailable.");
              return dependencies.observationHostPages.page(
                { threadId: call.threadId, generation: consumerGeneration, consumer },
                offset,
                snapshotId,
                valid,
              );
            }
            if (
              "nativeInstallationId" in scope ||
              ("projectId" in scope && source === "native-session")
            ) {
              if (
                !native ||
                !consumerGeneration ||
                (source !== "note" && source !== "server" && source !== "native-session")
              )
                return {
                  complete: false,
                  value: { reason: "This Native source has no qualified baseline." },
                };
              return dependencies.observationNativePages.page(
                {
                  threadId: call.threadId,
                  installationId: native.proof.installationId,
                  generation: consumerGeneration,
                  consumer,
                  source,
                },
                offset,
                snapshotId,
                async (pageOffset, fingerprint) => {
                  return fetchNativePage(native, source, valid, pageOffset, fingerprint);
                },
                valid,
                async (request) => {
                  const operationHash = createHash("sha256")
                    .update(
                      JSON.stringify([
                        "native.observations.complete",
                        call.threadId,
                        source,
                        request.fingerprint,
                        request.watermark,
                        request.requestId,
                      ]),
                    )
                    .digest("hex");
                  const captured = (await dependencies.conversationDesktop.callAssistantThread(
                    source === "native-session"
                      ? "observations.native.projectComplete"
                      : "observations.native.complete",
                    { ...request, source, operationHash },
                    {
                      threadId: call.threadId,
                      environmentId: dependencies.engine.store.environmentId,
                      targetDeviceHash: native.deviceHash,
                      ...(source === "native-session"
                        ? { projectId: native.projectId, targetProjectCwd: native.cwd }
                        : {}),
                    },
                    authorized,
                  )) as { relayId: string; envelope: unknown };
                  await verifyNativeObservationCompletion(
                    dependencies.nativeAdmissionOwner,
                    native.capture,
                    {
                      relayId: captured.relayId,
                      requestId: request.requestId,
                      operationHash,
                      source,
                      fingerprint: request.fingerprint,
                      watermark: request.watermark,
                      ...(source === "native-session"
                        ? { projectId: native.projectId, targetCwd: native.cwd }
                        : {}),
                    },
                    captured.envelope,
                    valid,
                  );
                },
              );
            }
            if (!("accountId" in scope)) {
              if (source === "task" || source === "session" || (source === "goal" && goalProofs))
                return dependencies.observationProjectPages.page(
                  { threadId: call.threadId, projectId: scope.projectId, consumer, source },
                  offset,
                  snapshotId,
                  valid,
                  goalProofs,
                );
              return {
                complete: false,
                value: {
                  reason:
                    "Select task, session or goal for a source-qualified project baseline. Other sources require their own visibility-qualified baseline.",
                },
              };
            }
            if (!consumerGeneration)
              throw new Error("Observation account grant generation is unavailable.");
            return dependencies.observationPages.page(
              {
                threadId: call.threadId,
                accountId: scope.accountId,
                version: consumerGeneration,
                consumer,
              },
              offset,
              snapshotId,
              valid,
            );
          },
        },
        call,
        admission,
      );
    if (call.input.nativeLibrary === true) {
      if (call.projectId || call.accountId)
        throw new Error("Native library does not use project or account scope.");
      return dependencies.withNativeObservationScope(
        call.threadId,
        call.requestId,
        call.input,
        authorized,
        async (valid, proof, capture, deviceHash) => {
          const value = await run(
            valid,
            dependencies.nativeObservationGeneration(proof),
            undefined,
            { proof, capture, deviceHash },
          );
          return roomNativeResult(value, [proof]);
        },
      );
    }
    if (call.projectId && call.input.source === "native-session") {
      return dependencies.withNativeSessionScope(
        call,
        authorized,
        async (valid, proof, capture, deviceHash, cwd) => {
          const generation = createHash("sha256")
            .update(
              JSON.stringify([
                dependencies.nativeObservationGeneration(proof),
                call.projectId,
                cwd,
              ]),
            )
            .digest("hex");
          return roomNativeResult(
            await run(valid, generation, undefined, {
              proof,
              capture,
              deviceHash,
              projectId: call.projectId,
              cwd,
            }),
            [proof],
          );
        },
      );
    }
    if (call.projectId && !call.accountId) {
      if (call.input.source === "goal") {
        const proofs = await collectGoalObservationProjects(
          dependencies.engine.store,
          call.projectId,
        );
        return dependencies.assistantPorts.withRoomProjectDisclosure!(
          call.threadId,
          proofs.map((proof) => proof.projectId),
          admission,
          (valid) => {
            for (const proof of proofs) captureRoomProject(proof.projectId, proof.cwd);
            return run(valid, undefined, proofs);
          },
          proofs,
        );
      }
      return dependencies.withRoomProjectScope(call, authorized, (valid) => run(valid));
    }
    if (!call.accountId || call.projectId) throw new Error("Choose exactly one observation scope.");
    const grant = await dependencies.social.issueAccountThreadGrant(
      call.threadId,
      call.accountId,
      admission.deviceHash,
    );
    try {
      const proof = { accountId: grant.scope.accountId, version: grant.scope.version };
      const result = await dependencies.social.withAssistantAccountProofs(
        call.threadId,
        [proof],
        authorized,
        (valid) => run(valid, proof.version),
      );
      return roomAccountResult(result, [proof]);
    } finally {
      dependencies.social.revokeSessionGrant(grant.token);
    }
  };
  return { executeRoomObservation };
}
