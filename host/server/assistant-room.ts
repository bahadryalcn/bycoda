import { createHash, randomUUID } from "node:crypto";
import {
  captureRoomProject,
  roomAccountResult,
} from "../assistant/management/assistant-management-dispatch";
import { mergeNativeLibraryProofs } from "../assistant/native/assistant-native-library-proof";
import { AssistantRoomInbox } from "../assistant/room/assistant-room-inbox";
import { AssistantRoomRemote } from "../assistant/room/assistant-room-remote";
import { AssistantRoomSocialSend } from "../assistant/room/assistant-room-social-send";
import { captureVoiceRuntimeSource } from "../assistant/voice/assistant-voice-status";
import { validateConversationTool } from "../conversation/conversation-tools";
import { registerRoomManagement } from "./assistant-room-management";
import { createRoomObservationRuntime } from "./assistant-room-observation";
import type { ServerBindings } from "./bindings";
export function createAssistantRoomRuntime(
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
  const roomRemote = new AssistantRoomRemote({
    read: async (key) => {
      const row = await dependencies.engine.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      return row ? JSON.parse(String(row.value)) : undefined;
    },
    write: async (key, value) => {
      await dependencies.engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    native: (action, input, source, authorized) =>
      dependencies.conversationDesktop.callAssistantThread(action, input, source, authorized),
  });
  const roomInbox = new AssistantRoomInbox({
    read: async (key) => {
      const row = await dependencies.engine.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      return row ? JSON.parse(String(row.value)) : undefined;
    },
    write: async (key, value) => {
      await dependencies.engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    execute: (input, source, authorized) =>
      dependencies.conversationDesktop.callAssistantThread(
        "inbox.room.execute",
        input,
        {
          threadId: source.threadId,
          environmentId: source.environmentId,
          projectId: source.projectId,
          targetProjectCwd: source.projectCwd,
          targetDeviceHash: source.deviceHash,
        },
        authorized,
      ),
  });
  const roomSocialSend = new AssistantRoomSocialSend({
    receipt: dependencies.roomResourceReceipts.receipt,
    saveReceipt: dependencies.roomResourceReceipts.saveReceipt,
    approve: (operation, principal, authorized) =>
      dependencies.conversationDesktop.callAssistantThread(
        "management.write.authorize",
        { operation },
        principal,
        authorized,
      ) as Promise<{ approved?: boolean; operationHash?: string }>,
    snapshot: async (proposal, principal, authorized) =>
      dependencies.social.prepareRoomSend(
        proposal,
        principal,
        proposal.projectId
          ? (await dependencies.engine.store.project(proposal.projectId)).cwd
          : null,
        authorized,
      ),
    enqueue: (proposal, snapshot, principal, authorized, review) =>
      dependencies.social.enqueueReviewedRoomSend(
        proposal,
        snapshot,
        principal,
        authorized,
        review,
      ),
    readback: (jobId, principal, authorized) =>
      dependencies.social.roomSendJobStatus(jobId, principal, authorized),
  });
  const executeRoomSocialSend = async (
    call: import("../assistant/management/assistant-management-turn").RoomManagementCall,
    admission: import("../assistant/management/assistant-management-turn").RoomManagementAdmission,
    authorized: () => Promise<boolean>,
  ) => {
    validateConversationTool(call.action, call.input);
    const accountId = String(call.input.accountId),
      projectId = call.input.projectId as string | null;
    if ((call.projectId ?? null) !== projectId || (call.accountId && call.accountId !== accountId))
      throw new Error("Room social target changed.");
    const source = {
      kind: "assistant-thread" as const,
      threadId: call.threadId,
      environmentId: dependencies.engine.store.environmentId,
    };
    const grant = await dependencies.social.issueAccountThreadGrant(
      call.threadId,
      accountId,
      admission.deviceHash,
    );
    const proof = { accountId, version: grant.scope.version };
    const projectProofs = projectId
      ? [{ projectId, cwd: (await dependencies.engine.store.project(projectId)).cwd }]
      : [];
    let scopeValid = () => true;
    const current = async () => scopeValid() && (await authorized()) && scopeValid();
    const qualify = <T>(effect: () => Promise<T>) =>
      dependencies.assistantPorts.withSummarySourceDisclosure!(
        call.threadId,
        projectProofs,
        [proof],
        async (valid) => {
          if (!valid() || !(await authorized())) throw new Error("Room social authority changed.");
          scopeValid = valid;
          for (const project of projectProofs) captureRoomProject(project.projectId, project.cwd);
          try {
            const result = await effect();
            if (!(await current())) throw new Error("Room social authority changed.");
            return result;
          } finally {
            scopeValid = () => true;
          }
        },
      );
    try {
      const result =
        call.action === "social.send.status"
          ? await roomSocialSend.status(source, String(call.input.operationId), current, qualify)
          : await roomSocialSend.submit(call.input, source, current, call.requestId, qualify);
      return roomAccountResult(result ?? { state: "unknown" }, [proof]);
    } finally {
      dependencies.social.revokeSessionGrant(grant.token);
    }
  };
  dependencies.assistantPorts.withRoomResponseDisclosure = async (scopes, admission, effect) => {
    if (scopes.length > 1000 || scopes.reduce((sum, item) => sum + item.projects.length, 0) > 1000)
      throw new Error("Room response source scope is too large.");
    const authorized = async () => {
      if (admission.signal?.aborted || !(await admission.authorized())) return false;
      for (const scope of scopes) {
        const thread = await dependencies.assistant.threadBinding(scope.threadId);
        if (
          !thread ||
          thread.id !== scope.threadId ||
          (thread.projectId && scope.projects.some((id) => id !== thread.projectId)) ||
          (thread.projectId && scope.accounts.length)
        )
          return false;
      }
      return true;
    };
    if (!(await authorized())) throw new Error("Room response authority is unavailable.");
    const nativeProofs = mergeNativeLibraryProofs(
      ...scopes.map((scope) => scope.nativeProofs ?? []),
    );
    for (const scope of scopes)
      for (const proof of scope.nativeProofs ?? []) {
        if (
          proof.environmentId !== dependencies.engine.store.environmentId ||
          proof.threadId !== scope.threadId ||
          (await dependencies.assistant.globalRoomBinding())?.id !== proof.threadId
        )
          throw new Error("Native library response source changed.");
      }
    const requestId = randomUUID();
    const operationHash = createHash("sha256")
      .update(
        JSON.stringify([
          "room.response.disclosure",
          scopes.map((scope) => [scope.threadId, scope.projects.slice().sort()]),
          requestId,
        ]),
      )
      .digest("hex");
    const captures: Array<{
      envelope: unknown;
      expected: import("../assistant/native/assistant-visibility-admission").ExpectedVisibilityCapture;
    }> = [];
    const nativeCaptures: Array<{
      envelope: unknown;
      expected: {
        environmentId: string;
        threadId: string;
        relayId: string;
        requestId: string;
        operationHash: string;
      };
    }> = [];
    for (const proof of nativeProofs) {
      const captured = (await dependencies.conversationDesktop.callAssistantThread(
        "privacy.account.capture",
        { requestId, operationHash },
        { threadId: proof.threadId, environmentId: dependencies.engine.store.environmentId },
        authorized,
      )) as { relayId: string; envelope: unknown };
      nativeCaptures.push({
        envelope: captured.envelope,
        expected: {
          environmentId: dependencies.engine.store.environmentId,
          threadId: proof.threadId,
          requestId,
          operationHash,
          relayId: captured.relayId,
        },
      });
    }
    for (const scope of scopes)
      for (const projectId of scope.projects) {
        const project = await dependencies.engine.store.project(projectId);
        const captured = (await dependencies.conversationDesktop.callAssistantThread(
          "privacy.scope.capture",
          { action: "room.disclosure", requestId, operationHash },
          {
            threadId: scope.threadId,
            environmentId: dependencies.engine.store.environmentId,
            projectId,
            targetProjectCwd: project.cwd,
          },
          authorized,
        )) as { relayId: string; envelope: unknown };
        captures.push({
          envelope: captured.envelope,
          expected: {
            environmentId: dependencies.engine.store.environmentId,
            threadId: scope.threadId,
            projectId,
            targetCwd: project.cwd,
            action: "room.disclosure",
            requestId,
            operationHash,
            relayId: captured.relayId,
          },
        });
      }
    const accountScopes = scopes.filter((scope) => scope.accounts.length);
    const holdAccounts = (index: number, valid: () => boolean): ReturnType<typeof effect> => {
      if (!valid()) throw new Error("Room response scope changed.");
      if (index === accountScopes.length) return effect(valid);
      const scope = accountScopes[index];
      return dependencies.social.withAssistantAccountProofs(
        scope.threadId,
        scope.accounts,
        authorized,
        (accountValid) => holdAccounts(index + 1, () => valid() && accountValid()),
      );
    };
    if (!captures.length && !nativeCaptures.length) return holdAccounts(0, () => true);
    const proofs = scopes.flatMap((scope) => {
      const expected = [...(scope.projectProofs ?? [])];
      if (expected.some((proof) => !scope.projects.includes(proof.projectId)))
        throw new Error("Room response contains an unqualified project source.");
      for (const item of captures.filter((item) => item.expected.threadId === scope.threadId)) {
        const found = expected.filter((proof) => proof.projectId === item.expected.projectId);
        if (found.some((proof) => proof.cwd !== item.expected.targetCwd))
          throw new Error("Room project identity changed before response disclosure.");
        if (!found.length)
          expected.push({ projectId: item.expected.projectId, cwd: item.expected.targetCwd });
      }
      return expected;
    });
    return dependencies.visibilityAdmission.withCaptures(
      captures,
      authorized,
      (valid, identity) => {
        if (
          nativeProofs.some(
            (proof) =>
              proof.installationId !== identity.installationId ||
              proof.issuer !== identity.issuer ||
              proof.registryRevision !== identity.registryRevision ||
              proof.visibilityEpoch !== identity.visibilityEpoch ||
              proof.policyGeneration !== identity.policyGeneration,
          )
        )
          throw new Error("Native library response privacy changed.");
        return dependencies.engine.store.withProjectIdentityRead(proofs, (identityValid) =>
          holdAccounts(0, () => valid() && identityValid()),
        );
      },
      nativeCaptures,
    );
  };
  dependencies.assistantPorts.roomNativeProofsValid = async (proofs, admission) => {
    try {
      const sources = mergeNativeLibraryProofs(proofs);
      if (!sources.length) return true;
      if (!admission) {
        for (const expected of sources) {
          const authorized = async () =>
            expected.environmentId === dependencies.engine.store.environmentId &&
            (await dependencies.assistant.globalRoomBinding())?.id === expected.threadId;
          const current = await dependencies.withNativeObservationScope(
            expected.threadId,
            randomUUID(),
            { action: "native.provenance.check" },
            authorized,
            async (valid, captured) =>
              valid() &&
              dependencies.nativeObservationGeneration(expected) ===
                dependencies.nativeObservationGeneration(captured),
          );
          if (!current) return false;
        }
        return true;
      }
      if (admission.environmentId !== dependencies.engine.store.environmentId) return false;
      return await dependencies.assistantPorts.withRoomResponseDisclosure!(
        sources.map((proof) => ({
          threadId: proof.threadId,
          projects: [],
          accounts: [],
          nativeProofs: [proof],
        })),
        admission,
        async (valid) => valid(),
      );
    } catch {
      return false;
    }
  };
  dependencies.assistantPorts.withNativeVoiceSourcesRetired = (effect) =>
    dependencies.nativeVoiceLeases.retireAll(dependencies.retireNativeVoiceGenerations, effect);
  dependencies.assistantPorts.withNativeVoiceRuntimeRegistration = async (
    input,
    admission,
    effect,
  ) => {
    const authorized = async () =>
      !admission.signal?.aborted &&
      admission.environmentId === dependencies.engine.store.environmentId &&
      /^[a-f0-9]{64}$/.test(admission.deviceHash) &&
      (await admission.authorized()) &&
      (await dependencies.assistant.globalRoomBinding())?.id === input.threadId;
    if (!(await authorized()) || !input.nativeProofs.length)
      throw new Error("Native voice runtime source is unavailable.");
    const requestId = randomUUID();
    const operationHash = createHash("sha256")
      .update(JSON.stringify(["voice.runtime.register", input, admission.deviceHash, requestId]))
      .digest("hex");
    const captured = (await dependencies.conversationDesktop.callAssistantThread(
      "voice.generation.source",
      { generationKey: input.generationKey, requestId, operationHash },
      {
        threadId: input.threadId,
        environmentId: dependencies.engine.store.environmentId,
        targetDeviceHash: admission.deviceHash,
      },
      authorized,
    )) as { relayId: string; envelope: unknown };
    const source = await captureVoiceRuntimeSource(
      dependencies.nativeAdmissionOwner,
      {
        environmentId: dependencies.engine.store.environmentId,
        threadId: input.threadId,
        generationKey: input.generationKey,
        requestId,
        operationHash,
      },
      captured,
      authorized,
    );
    if (
      input.nativeProofs.some(
        (proof) =>
          proof.installationId !== source.installationId ||
          proof.issuer !== source.issuer ||
          proof.registryRevision !== source.revision,
      )
    )
      throw new Error("Native voice runtime belongs to another source.");
    return dependencies.assistantPorts.withRoomResponseDisclosure!(
      [
        {
          threadId: input.threadId,
          projects: input.projectProofs.map((proof) => proof.projectId),
          projectProofs: input.projectProofs,
          accounts: input.accountProofs,
          nativeProofs: input.nativeProofs,
        },
      ],
      admission,
      async (valid) => {
        if (!valid() || !(await authorized()))
          throw new Error("Native voice runtime authority changed.");
        if (input.accountProofs.length)
          await dependencies.social.registerAssistantVoiceLease(
            {
              threadId: input.threadId,
              generationKey: input.generationKey,
              deviceHash: admission.deviceHash,
              accounts: input.accountProofs,
            },
            valid,
          );
        return dependencies.nativeVoiceLeases.withRegistration(
          {
            threadId: input.threadId,
            generationKey: input.generationKey,
            deviceHash: admission.deviceHash,
            nativeProofs: input.nativeProofs,
          },
          () => valid() && !admission.signal?.aborted,
          effect,
        );
      },
    );
  };
  const { executeRoomObservation } = createRoomObservationRuntime(dependencies);
  registerRoomManagement(dependencies, {
    roomRemote,
    executeRoomSocialSend,
    executeRoomObservation,
    roomInbox,
  });
  return { roomRemote, roomInbox, roomSocialSend, executeRoomSocialSend, executeRoomObservation };
}
