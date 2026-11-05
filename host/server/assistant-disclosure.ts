import { createHash, randomUUID } from "node:crypto";
import { monotonicNow } from "../../src/shared/lib/time/timestamps";
import { captureRoomProject } from "../assistant/management/assistant-management-dispatch";
import { type NativeLibraryProof } from "../assistant/native/assistant-native-library-proof";
import { type NativeVoiceLease } from "../assistant/native/assistant-native-voice-leases";
import { verifyAssistantNotificationReceipt } from "../assistant/native/assistant-notification-receipt";
import { type NativeObservationCapture } from "../assistant/observations/assistant-native-observation-page";
import { withVoiceGenerationsRetired } from "../assistant/voice/assistant-voice-retirement";
import { registerAssistantNarration } from "./assistant-narration";
import type { ServerBindings } from "./bindings";
export function createAssistantDisclosureRuntime(
  dependencies: Pick<
    ServerBindings,
    | "social"
    | "engine"
    | "nativeAdmissionOwner"
    | "conversationDesktop"
    | "assistantPorts"
    | "roomVisibleProject"
    | "visibilityAdmission"
    | "assistant"
    | "observationJournal"
  >,
) {
  dependencies.social.retireAssistantVoiceGenerations = async (generations, effect) => {
    const authorized = async () => {
      try {
        await dependencies.engine.store.db.checkAuthorization();
        for (const generation of generations)
          if (
            !(await dependencies.engine.store.db
              .prepare("SELECT id FROM devices WHERE hash=?")
              .get(generation.deviceHash))
          )
            return false;
        return true;
      } catch {
        return false;
      }
    };
    const expected = generations.map((generation) => ({
      environmentId: dependencies.engine.store.environmentId,
      threadId: generation.threadId,
      generationKey: generation.generationKey,
      requestId: randomUUID(),
      operationHash: createHash("sha256")
        .update(
          JSON.stringify([
            generation.threadId,
            generation.generationKey,
            generation.deviceHash,
            generation.accounts,
          ]),
        )
        .digest("hex"),
    }));
    return withVoiceGenerationsRetired(
      {
        admission: dependencies.nativeAdmissionOwner,
        relay: (item, check) => {
          const generation = generations.find(
            (value) =>
              value.threadId === item.threadId && value.generationKey === item.generationKey,
          );
          if (!generation) throw new Error("Voice generation retirement source changed.");
          return dependencies.conversationDesktop.callAssistantThread(
            "voice.generation.retire",
            {
              generationKey: item.generationKey,
              requestId: item.requestId,
              operationHash: item.operationHash,
            },
            {
              threadId: item.threadId,
              environmentId: item.environmentId,
              targetDeviceHash: generation.deviceHash,
            },
            check,
          ) as Promise<{ relayId: string; envelope: unknown }>;
        },
      },
      expected,
      authorized,
      effect,
    );
  };
  dependencies.assistantPorts.roomAccountProofsValid = async (threadId, proofs) =>
    dependencies.social.assistantAccountProofsValid(threadId, proofs);
  const retireNativeVoiceGenerations = async <T>(
    generations: NativeVoiceLease[],
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T> => {
    const authorized = async () => {
      try {
        await dependencies.engine.store.db.checkAuthorization();
        for (const generation of generations) {
          if (
            generation.environmentId !== dependencies.engine.store.environmentId ||
            !(await dependencies.engine.store.db
              .prepare("SELECT id FROM devices WHERE hash=?")
              .get(generation.deviceHash))
          )
            return false;
        }
        return true;
      } catch {
        return false;
      }
    };
    const expected = generations.map((generation) => ({
      environmentId: generation.environmentId,
      threadId: generation.threadId,
      generationKey: generation.generationKey,
      requestId: randomUUID(),
      operationHash: createHash("sha256")
        .update(JSON.stringify(["native.voice.retire", generation]))
        .digest("hex"),
    }));
    return withVoiceGenerationsRetired(
      {
        admission: dependencies.nativeAdmissionOwner,
        relay: (item, check) => {
          const generation = generations.find(
            (value) =>
              value.threadId === item.threadId && value.generationKey === item.generationKey,
          );
          if (!generation) throw new Error("Native voice retirement source changed.");
          return dependencies.conversationDesktop.callAssistantThread(
            "voice.generation.retire",
            {
              generationKey: item.generationKey,
              requestId: item.requestId,
              operationHash: item.operationHash,
            },
            {
              threadId: item.threadId,
              environmentId: item.environmentId,
              targetDeviceHash: generation.deviceHash,
            },
            check,
          ) as Promise<{ relayId: string; envelope: unknown }>;
        },
      },
      expected,
      authorized,
      effect,
    );
  };
  dependencies.assistantPorts.roomProjectProofsValid = async (proofs) => {
    try {
      if (proofs.length > 1000) return false;
      const seen = new Map<string, string>();
      for (const proof of proofs) {
        if (
          !proof.projectId ||
          !proof.cwd ||
          (seen.has(proof.projectId) && seen.get(proof.projectId) !== proof.cwd) ||
          (await dependencies.engine.store.project(proof.projectId)).cwd !== proof.cwd
        )
          return false;
        seen.set(proof.projectId, proof.cwd);
      }
      return true;
    } catch {
      return false;
    }
  };
  dependencies.assistantPorts.withRoomAccountDisclosure = async (
    threadId,
    proofs,
    admission,
    effect,
  ) =>
    dependencies.social.withAssistantAccountProofs(
      threadId,
      proofs,
      async () => !admission.signal?.aborted && (await admission.authorized()),
      effect,
    );
  dependencies.assistantPorts.roomManagementVisible = async (threadId, projectIds, admission) => {
    if (projectIds.length > 1000) return false;
    try {
      for (const id of new Set(projectIds))
        if (!(await dependencies.roomVisibleProject(id, threadId, admission))) return false;
      return true;
    } catch {
      return false;
    }
  };
  const withRoomProjectScope = async <T>(
    call: import("../assistant/management/assistant-management-turn").RoomManagementCall,
    authorized: () => Promise<boolean>,
    body: (
      valid: () => boolean,
      source: {
        deviceHash: string;
        projectCwd: string;
        installationId: string;
        registryRevision: string;
        visibilityEpoch: number;
        policyGeneration: string;
      },
    ) => Promise<T>,
    expectedDeviceHash?: string,
  ): Promise<T> => {
    if (!call.projectId) throw new Error("A project target is required for native scope.");
    const project = await dependencies.engine.store.project(call.projectId);
    const operationHash = createHash("sha256")
      .update(JSON.stringify([call.family, call.action, call.input]))
      .digest("hex");
    const captured = (await dependencies.conversationDesktop.callAssistantThread(
      "privacy.scope.capture",
      { action: call.action, requestId: call.requestId, operationHash },
      {
        threadId: call.threadId,
        environmentId: dependencies.engine.store.environmentId,
        projectId: call.projectId,
        targetProjectCwd: project.cwd,
        ...(expectedDeviceHash ? { targetDeviceHash: expectedDeviceHash } : {}),
      },
      authorized,
    )) as { relayId: string; envelope: unknown; deviceHash: string };
    if (!/^[a-f0-9]{64}$/.test(captured.deviceHash))
      throw new Error("Native project source device is unavailable.");
    if (expectedDeviceHash && captured.deviceHash !== expectedDeviceHash)
      throw new Error("Native project source device changed.");
    return dependencies.visibilityAdmission.withCapture(
      captured.envelope,
      {
        environmentId: dependencies.engine.store.environmentId,
        threadId: call.threadId,
        projectId: call.projectId,
        targetCwd: project.cwd,
        action: call.action,
        requestId: call.requestId,
        operationHash,
        relayId: captured.relayId,
      },
      authorized,
      (valid, identity) =>
        dependencies.engine.store.withProjectIdentityRead(
          [{ projectId: call.projectId!, cwd: project.cwd }],
          (identityValid) =>
            dependencies.engine.store.db.withAuthorization(
              async () =>
                valid() && identityValid() && (await authorized()) && valid() && identityValid(),
              async () => {
                captureRoomProject(call.projectId!, project.cwd);
                return body(() => valid() && identityValid(), {
                  deviceHash: captured.deviceHash,
                  projectCwd: project.cwd,
                  ...identity,
                });
              },
            ),
        ),
    );
  };
  let taskNotificationReadyUntil = 0;
  const withNativeObservationScope = async <T>(
    threadId: string,
    requestId: string,
    input: unknown,
    authorized: () => Promise<boolean>,
    body: (
      valid: () => boolean,
      proof: NativeLibraryProof,
      capture: NativeObservationCapture,
      deviceHash: string,
    ) => Promise<T>,
    targetDeviceHash?: string,
  ): Promise<T> => {
    if ((await dependencies.assistant.globalRoomBinding())?.id !== threadId)
      throw new Error("Native library requires the original Global Room.");
    const operationHash = createHash("sha256")
      .update(JSON.stringify(["native.observations", threadId, requestId, input]))
      .digest("hex");
    const captured = (await dependencies.conversationDesktop.callAssistantThread(
      "privacy.account.capture",
      { requestId, operationHash },
      {
        threadId,
        environmentId: dependencies.engine.store.environmentId,
        ...(targetDeviceHash ? { targetDeviceHash } : {}),
      },
      authorized,
    )) as { relayId: string; envelope: { operationJson: string }; deviceHash: string };
    if (!/^[a-f0-9]{64}$/.test(captured.deviceHash))
      throw new Error("Native library source device is unavailable.");
    return dependencies.visibilityAdmission.withAccountCapture(
      captured.envelope,
      {
        environmentId: dependencies.engine.store.environmentId,
        threadId,
        relayId: captured.relayId,
        requestId,
        operationHash,
      },
      authorized,
      (valid, identity) => {
        const proof: NativeLibraryProof = {
          environmentId: dependencies.engine.store.environmentId,
          threadId,
          ...identity,
        };
        const original = JSON.parse(captured.envelope.operationJson) as {
          projectionRevision: number;
          policyDigest: string;
          privacyRevision: number;
        };
        const capture = {
          ...proof,
          projectionRevision: original.projectionRevision,
          policyDigest: original.policyDigest,
          privacyRevision: original.privacyRevision,
        };
        return dependencies.engine.store.db.withAuthorization(
          async () => valid() && (await authorized()) && valid(),
          () => body(valid, proof, capture, captured.deviceHash),
        );
      },
    );
  };
  const withNativeSessionScope = async <T>(
    call: import("../assistant/management/assistant-management-turn").RoomManagementCall,
    authorized: () => Promise<boolean>,
    body: (
      valid: () => boolean,
      proof: NativeLibraryProof,
      capture: NativeObservationCapture,
      deviceHash: string,
      cwd: string,
    ) => Promise<T>,
  ) => {
    if (!call.projectId || (await dependencies.assistant.globalRoomBinding())?.id !== call.threadId)
      throw new Error(
        "Native session observations require the original global Room and exact project.",
      );
    const project = await dependencies.engine.store.project(call.projectId);
    const operationHash = createHash("sha256")
      .update(
        JSON.stringify([
          "native.session.observations",
          call.threadId,
          call.projectId,
          project.cwd,
          call.requestId,
          call.input,
        ]),
      )
      .digest("hex");
    const projectCapture = (await dependencies.conversationDesktop.callAssistantThread(
      "privacy.scope.capture",
      { action: call.action, requestId: call.requestId, operationHash },
      {
        threadId: call.threadId,
        environmentId: dependencies.engine.store.environmentId,
        projectId: call.projectId,
        targetProjectCwd: project.cwd,
      },
      authorized,
    )) as { relayId: string; envelope: unknown; deviceHash: string };
    if (!/^[a-f0-9]{64}$/.test(projectCapture.deviceHash))
      throw new Error("Native session source device unavailable.");
    const accountCapture = (await dependencies.conversationDesktop.callAssistantThread(
      "privacy.account.capture",
      { requestId: call.requestId, operationHash },
      {
        threadId: call.threadId,
        environmentId: dependencies.engine.store.environmentId,
        targetDeviceHash: projectCapture.deviceHash,
      },
      authorized,
    )) as { relayId: string; envelope: { operationJson: string }; deviceHash: string };
    if (accountCapture.deviceHash !== projectCapture.deviceHash)
      throw new Error("Native session source device changed.");
    const expectedProject = {
      environmentId: dependencies.engine.store.environmentId,
      threadId: call.threadId,
      projectId: call.projectId,
      targetCwd: project.cwd,
      action: call.action,
      requestId: call.requestId,
      operationHash,
      relayId: projectCapture.relayId,
    };
    const expectedAccount = {
      environmentId: dependencies.engine.store.environmentId,
      threadId: call.threadId,
      requestId: call.requestId,
      operationHash,
      relayId: accountCapture.relayId,
    };
    return dependencies.visibilityAdmission.withCaptures(
      [{ envelope: projectCapture.envelope, expected: expectedProject }],
      authorized,
      (valid, identity) =>
        dependencies.engine.store.withProjectIdentityRead(
          [{ projectId: call.projectId!, cwd: project.cwd }],
          async (identityValid) => {
            if (!valid() || !identityValid()) throw new Error("Native session source changed.");
            captureRoomProject(call.projectId!, project.cwd);
            const original = JSON.parse(accountCapture.envelope.operationJson) as {
              projectionRevision: number;
              policyDigest: string;
              privacyRevision: number;
            };
            const proof: NativeLibraryProof = {
              environmentId: dependencies.engine.store.environmentId,
              threadId: call.threadId,
              ...identity,
            };
            return body(
              () => valid() && identityValid(),
              proof,
              { ...proof, ...original },
              projectCapture.deviceHash,
              project.cwd,
            );
          },
        ),
      [{ envelope: accountCapture.envelope, expected: expectedAccount }],
    );
  };
  dependencies.assistantPorts.observedTaskDeliveryConfigured = () => true;
  dependencies.assistantPorts.observationTasksReady = () =>
    monotonicNow() < taskNotificationReadyUntil;
  dependencies.assistantPorts.pollObservedTasks = async (projectIds, accept, active) => {
    const room = await dependencies.assistant.globalRoomBinding();
    if (!room) throw new Error("Assistant global Room source is unavailable.");
    let incomplete = false;
    for (const projectId of [...new Set(projectIds)]) {
      const authorized = async () =>
        active() &&
        (await dependencies.assistant.globalRoomBinding())?.id === room.id &&
        (await dependencies.assistant.manualProjectAllowed(projectId));
      if (!(await authorized())) {
        incomplete = true;
        continue;
      }
      const call = {
        threadId: room.id,
        projectId,
        family: "conversation" as const,
        action: "observations.read",
        input: {},
        requestId: randomUUID(),
      };
      try {
        await withRoomProjectScope(call, authorized, async (scopeValid, source) => {
          const valid = () => active() && scopeValid();
          const page = await dependencies.observationJournal.read(
            "chief:task",
            { projectId },
            authorized,
            async (event) =>
              event.source === "task" &&
              event.projectIds.length === 1 &&
              event.projectIds[0] === projectId,
            valid,
            3,
            3000,
            "task",
          );
          if (page.status === "gap")
            throw new Error(
              "Task observation history has a retention gap; owner resnapshot is required.",
            );
          for (const event of page.events) {
            if (!(await accept(event, valid))) break;
            await dependencies.observationJournal.acknowledge(
              "chief:task",
              { projectId },
              event.sequence,
              authorized,
              valid,
            );
          }
          const targets = (await dependencies.assistant.observedNotificationTargets()).filter(
            (target) => target.projectId === projectId,
          );
          for (const target of targets) {
            if (!valid()) throw new Error("Task notification source changed.");
            const prior = await dependencies.assistant.observedNotificationIntent(target.id);
            if (prior?.state === "accepted" || prior?.state === "suppressed") continue;
            if (
              prior &&
              prior.state !== "prepared" &&
              (prior.threadId !== room.id ||
                prior.projectId !== projectId ||
                prior.deviceHash !== source.deviceHash)
            )
              continue;
            const intent =
              prior && prior.state !== "prepared"
                ? prior
                : await dependencies.assistant.prepareObservedNotification(
                    room.id,
                    target.id,
                    projectId,
                    source.deviceHash,
                    valid,
                  );
            if (!intent) continue;
            const requestId = `observation-${intent.operationHash}`;
            const input = {
              notificationId: intent.notificationId,
              kind: intent.kind,
              requestId,
              operationHash: intent.operationHash,
              projectCwds: [source.projectCwd],
            };
            const expected = {
              environmentId: dependencies.engine.store.environmentId,
              threadId: room.id,
              notificationId: intent.notificationId,
              kind: intent.kind,
              requestId,
              operationHash: intent.operationHash,
            };
            const relay = (
              action: "assistant.notification.status" | "assistant.notification.deliver",
            ) =>
              dependencies.conversationDesktop.callAssistantThread(
                action,
                input,
                {
                  threadId: room.id,
                  environmentId: dependencies.engine.store.environmentId,
                  targetDeviceHash: source.deviceHash,
                },
                authorized,
              ) as Promise<{ relayId: string; envelope: unknown }>;
            const status = await verifyAssistantNotificationReceipt(
              dependencies.nativeAdmissionOwner,
              await relay("assistant.notification.status"),
              expected,
              authorized,
            );
            taskNotificationReadyUntil =
              status.permission === "granted" ? monotonicNow() + 15_000 : 0;
            if (intent.state === "pending" || intent.state === "unknown") {
              if (status.state === "accepted" || status.state === "suppressed")
                await dependencies.assistant.settleObservedNotification(intent, status.state);
              continue;
            }
            if (status.permission !== "granted" || !valid()) continue;
            if (!(await dependencies.assistant.armObservedNotification(intent, valid))) continue;
            if (status.state === "accepted" || status.state === "suppressed") {
              await dependencies.assistant.settleObservedNotification(intent, status.state);
              continue;
            }
            try {
              const receipt = await verifyAssistantNotificationReceipt(
                dependencies.nativeAdmissionOwner,
                await relay("assistant.notification.deliver"),
                expected,
                authorized,
              );
              await dependencies.assistant.settleObservedNotification(intent, receipt.state);
            } catch (error) {
              await dependencies.assistant.settleObservedNotification(intent, "unknown");
              throw error;
            }
          }
        });
      } catch {
        taskNotificationReadyUntil = 0;
        incomplete = true;
      }
    }
    if (incomplete)
      throw new Error("Some task observation sources were unavailable or need resnapshot.");
  };
  registerAssistantNarration(dependencies);

  dependencies.social.withRoomSendSource = async (source, effect) => {
    if (!(await dependencies.social.roomSendSourceAdmission!(source)))
      throw new Error("Room social source changed.");
    return dependencies.assistantPorts.withSummarySourceDisclosure!(
      source.threadId,
      source.projectId ? [{ projectId: source.projectId, cwd: source.projectCwd! }] : [],
      [{ accountId: source.accountId, version: source.accountGrantVersion }],
      effect,
    );
  };
  return {
    retireNativeVoiceGenerations,
    withRoomProjectScope,
    get taskNotificationReadyUntil() {
      return taskNotificationReadyUntil;
    },
    set taskNotificationReadyUntil(value: typeof taskNotificationReadyUntil) {
      taskNotificationReadyUntil = value;
    },
    withNativeObservationScope,
    withNativeSessionScope,
  };
}
