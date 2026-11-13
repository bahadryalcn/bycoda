import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { sessionConversationPage } from "../../src/features/agent-app/model/sessionConversation";
import { conversationSessionPage } from "../../src/shared/model/conversationSessionPage";
import { roomAccountResult } from "../assistant/management/assistant-management-dispatch";
import { NativeAdmissionOwner } from "../assistant/native/assistant-native-admission";
import { type NativeLibraryProof } from "../assistant/native/assistant-native-library-proof";
import { AssistantNativeVoiceLeases } from "../assistant/native/assistant-native-voice-leases";
import { AssistantVisibilityAdmission } from "../assistant/native/assistant-visibility-admission";
import { AssistantVisibilityFence } from "../assistant/native/assistant-visibility-fence";
import { AssistantWorkspaceOwner } from "../assistant/native/assistant-workspace-owner";
import {
  AssistantBackgroundEffect,
  BackgroundEffectStateError,
  type BackgroundEffectActor,
  type BackgroundEffectSource,
} from "../assistant/native/assistant-background-effect";
import { verifyWorkspaceReceipt } from "../assistant/native/assistant-workspace-receipt";
import { transferAssistantWorkspaceOperation } from "../assistant/native/assistant-workspace-transfer";
import { AssistantObservationHostPages } from "../assistant/observations/assistant-observation-host-pages";
import { AssistantObservationJournal } from "../assistant/observations/assistant-observation-journal";
import { AssistantObservationNativePages } from "../assistant/observations/assistant-observation-native-pages";
import { AssistantObservationPages } from "../assistant/observations/assistant-observation-pages";
import { installAssistantObservationProducers } from "../assistant/observations/assistant-observation-producers";
import {
  AssistantObservationProjectPages,
  collectGoalObservationProjects,
} from "../assistant/observations/assistant-observation-project-pages";
import { observationRoomConsumer } from "../assistant/observations/assistant-observation-tools";
import { createRoomBrowserTools } from "../assistant/room/assistant-room-browser";
import { hostRoomDelegationStore } from "../assistant/room/assistant-room-delegation-store";
import { createRoomDevServerTools } from "../assistant/room/assistant-room-dev-servers";
import { createRoomFileTools } from "../assistant/room/assistant-room-files";
import { createAssistantFolderTools } from "../assistant/folders/assistant-folder-tools";
import { createRoomNativeTargetAdapter } from "../assistant/room/assistant-room-native-target";
import { AssistantRoomNotebook } from "../assistant/room/assistant-room-notebook";
import {
  executeRoomSessionAction,
  isRoomSessionAction,
} from "../assistant/room/assistant-room-session";
import { createRoomTerminalTools } from "../assistant/room/assistant-room-terminals";
import { isRoomWorkspaceAction } from "../assistant/room/assistant-room-workspace";
import {
  ConversationManagementTools,
  managementPage,
  type ManagementReceipt,
} from "../conversation/conversation-management-tools";
import type { ConversationTool } from "../conversation/conversation-tools";
import { validateConversationTool } from "../conversation/conversation-tools";
import type { ServerBindings } from "./bindings";
export function createAssistantNativeRuntime(
  dependencies: Pick<
    ServerBindings,
    | "social"
    | "engine"
    | "socialTransport"
    | "assistant"
    | "withRoomProjectScope"
    | "projectSessionList"
    | "featureSession"
    | "localSessionReference"
    | "conversationThreadWork"
    | "tasks"
    | "assistantPorts"
    | "approveManagementOperation"
    | "conversationWorkspace"
    | "hostNotes"
    | "workspace"
    | "devServers"
    | "terminals"
    | "sharedBrowser"
    | "conversationPreviews"
    | "browserRuntime"
    | "conversationDesktop"
  >,
) {
  const executeAccountSocial = async (
    call: {
      threadId: string;
      accountId: string;
      action: string;
      input: Record<string, unknown>;
      requestId: string;
    },
    deviceHash: string,
    authorized: () => Promise<boolean>,
    includeProof = false,
  ) => {
    if (!(await authorized())) throw new Error("Room account authority revoked.");
    const grant = await dependencies.social.issueAccountThreadGrant(
      call.threadId,
      call.accountId,
      deviceHash,
    );
    try {
      const principal = await dependencies.social.principalForToken(grant.token);
      if (!principal || !(await authorized())) throw new Error("Room account authority revoked.");
      const grantAuthorization = dependencies.social.authorization(grant.token);
      const grantCheck =
        typeof grantAuthorization === "function" ? grantAuthorization : grantAuthorization.check;
      const check = async () => (await authorized()) && (await grantCheck());
      const result = await dependencies.engine.store.db.withAuthorization(check, () =>
        dependencies.socialTransport.rpc(principal, "social.tools.call", {
          action: call.action,
          input: call.input,
          requestId: call.requestId,
        }),
      );
      if (!(await check())) throw new Error("Room account authority revoked.");
      return includeProof
        ? roomAccountResult(result, [
            { accountId: grant.scope.accountId, version: grant.scope.version },
          ])
        : result;
    } finally {
      dependencies.social.revokeSessionGrant(grant.token);
    }
  };
  const visibilityFence = new AssistantVisibilityFence();
  const nativeAdmissionOwner = new NativeAdmissionOwner(
    process.env.BYCODA_NATIVE_ADMISSION_REGISTRY ??
      join(dirname(dependencies.engine.store.attachmentDir), "native-admission-registry.json"),
    dependencies.engine.store.environmentId,
    !process.env.BYCODA_NATIVE_ADMISSION_REGISTRY,
  );
  const roomDelegationTarget = createRoomNativeTargetAdapter({
    environmentId: dependencies.engine.store.environmentId,
    admission: nativeAdmissionOwner,
    store: hostRoomDelegationStore(dependencies.engine.store),
    withProject: async (
      projectId,
      actions,
      requestId,
      operationHash,
      expectedNative,
      authorized,
      body,
    ) => {
      const room = await dependencies.assistant.globalRoomBinding();
      if (!room) throw new Error("Target Host Room source is unavailable.");
      const current = async () =>
        (await authorized()) && (await dependencies.assistant.globalRoomBinding())?.id === room.id;
      return dependencies.withRoomProjectScope(
        {
          threadId: room.id,
          projectId,
          family: "conversation",
          action: "delegation.target",
          input: { actions: [...actions], operationHash },
          requestId,
        },
        current,
        async (valid, captured) => {
          // The reviewed origin and the target's live privacy owner may be distinct
          // enrolled installations. One registry lease fences both original keys.
          if (
            captured.registryRevision !== expectedNative.revision ||
            !(await nativeAdmissionOwner.current(
              expectedNative.installationId,
              expectedNative.revision,
            ))
          )
            throw new Error("Target Host Native delegation source changed.");
          return body(valid, captured.projectCwd);
        },
      );
    },
    execute: async (action, input, principal, _requestId, authorized) => {
      const { expectedUpdatedAt: _expectedUpdatedAt, ...canonicalInput } = input;
      validateConversationTool(action, action === "tasks.update" ? canonicalInput : input);
      if (!(await authorized())) throw new Error("Delegated Room authority revoked.");
      if (action === "sessions.list") {
        const { list } = await dependencies.projectSessionList(principal.projectId);
        return conversationSessionPage(
          list.map((row) => ({ ...row, busy: row.status === "running" })),
          input,
        );
      }
      if (action === "sessions.read") {
        const target = await dependencies.featureSession(String(input.sessionId));
        if (target.projectId !== principal.projectId)
          throw new Error("Conversation belongs to another project.");
        return sessionConversationPage(
          { ...target.session, busy: target.status === "running" },
          input,
          await dependencies.localSessionReference(target.session.id),
        );
      }
      if (action === "tasks.create" || action === "tasks.update")
        return dependencies.conversationThreadWork.callDelegated(
          action,
          input,
          principal,
          authorized,
        );
      const rows = (await dependencies.tasks.list(principal.projectId)).filter(
        (row) => row.projectId === principal.projectId,
      );
      if (action === "tasks.list") return managementPage(rows, input);
      if (action === "tasks.get") {
        const item = rows.find((row) => row.id === input.taskId);
        if (!item) throw new Error("Task is unavailable in the delegated project.");
        return item;
      }
      throw new Error("Delegated write operations are unavailable.");
    },
  });
  const visibilityAdmission = new AssistantVisibilityAdmission(
    dependencies.engine.store.environmentId,
    nativeAdmissionOwner,
    visibilityFence,
  );
  const observationJournal = new AssistantObservationJournal(dependencies.engine.store);
  const observationPages = new AssistantObservationPages(dependencies.engine.store);
  const observationNativePages = new AssistantObservationNativePages(dependencies.engine.store);
  const observationHostPages = new AssistantObservationHostPages(dependencies.engine.store);
  const nativeVoiceLeases = new AssistantNativeVoiceLeases(dependencies.engine.store);
  const nativeObservationGeneration = (proof: NativeLibraryProof) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          proof.environmentId,
          proof.threadId,
          proof.installationId,
          proof.issuer,
          proof.registryRevision,
          proof.visibilityEpoch,
          proof.policyGeneration,
        ]),
      )
      .digest("hex");
  const observationProjectPages = new AssistantObservationProjectPages(dependencies.engine.store);
  const assistantWorkspaceOwner = new AssistantWorkspaceOwner(dependencies.engine.store);
  const assistantBackgroundEffect = new AssistantBackgroundEffect(dependencies.engine.store);
  const executeBackgroundEffect = async (input: {
    operationId: string;
    projectId?: string;
    operation: { action: BackgroundEffectSource["action"]; input: Record<string, unknown> };
    execute: (actor: BackgroundEffectActor) => Promise<unknown>;
  }) => {
    const room = await dependencies.assistant.globalRoomBinding();
    if (!room) throw new Error("Global Assistant Room unavailable.");
    const environmentId = dependencies.engine.store.environmentId;
    const current = async () => (await dependencies.assistant.globalRoomBinding())?.id === room.id;
    const source: BackgroundEffectSource = {
      environmentId,
      threadId: room.id,
      operationId: input.operationId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      action: input.operation.action,
      input: JSON.parse(JSON.stringify(input.operation.input)) as Record<string, unknown>,
    };
    const prepared = await assistantBackgroundEffect.prepare(
      source,
      input.execute,
      Date.now() + 45_000,
    );
    if (prepared.state === "completed") return prepared.result;
    const { state: _state, ...payload } = prepared;
    const reply = (await dependencies.conversationDesktop.callAssistantThread(
      "assistant.background.effect",
      payload,
      { threadId: room.id, environmentId },
      current,
    )) as { state?: unknown; result?: unknown };
    if (reply?.state === "denied") {
      await assistantBackgroundEffect.deny({
        environmentId,
        threadId: room.id,
        operationId: input.operationId,
        operationHash: prepared.operationHash,
        challenge: prepared.challenge,
      });
      throw new BackgroundEffectStateError("denied", prepared.expiresAt);
    }
    if (reply?.state !== "completed")
      throw new Error("Background effect result is unavailable; inspect its receipt.");
    const receipt = await assistantBackgroundEffect.status(source);
    if (receipt.state !== "completed")
      throw new Error("Background effect completion is not recorded.");
    return receipt.result;
  };
  const backgroundEffectStatus = async (input: {
    operationId: string;
    projectId?: string;
    operation: { action: BackgroundEffectSource["action"]; input: Record<string, unknown> };
  }) => {
    const room = await dependencies.assistant.canonicalGlobalRoomBinding();
    if (!room) throw new Error("Global Assistant Room unavailable.");
    return assistantBackgroundEffect.status({
      environmentId: dependencies.engine.store.environmentId,
      threadId: room.id,
      operationId: input.operationId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      action: input.operation.action,
      input: input.operation.input,
    });
  };
  dependencies.assistantPorts.roomObservationDelivered = async (
    threadId,
    observations,
    proofs,
    valid,
    projectProofs = [],
    nativeProofs = [],
  ) => {
    for (const item of observations) {
      if (!item || typeof item !== "object") continue;
      const observation = item as {
        source?: {
          family?: string;
          action?: string;
          projectId?: string;
          accountId?: string;
          nativeLibrary?: boolean;
        };
        value?: {
          state?: string;
          observationSource?: unknown;
          snapshot?: {
            snapshotId?: unknown;
            offset?: unknown;
            nextOffset?: unknown;
            coverage?: unknown;
          };
        };
      };
      const source = observation.source,
        snapshot = observation.value?.snapshot;
      if (
        source?.family !== "conversation" ||
        source.action !== "observations.resnapshot" ||
        observation.value?.state !== "incomplete" ||
        !snapshot ||
        typeof snapshot.snapshotId !== "string" ||
        !Number.isSafeInteger(snapshot.offset) ||
        !Number.isSafeInteger(snapshot.nextOffset)
      )
        continue;
      if (
        source.nativeLibrary &&
        source.projectId &&
        !source.accountId &&
        observation.value?.observationSource === "native-session"
      ) {
        const proof = nativeProofs.find(
          (item) =>
            item.threadId === threadId &&
            item.environmentId === dependencies.engine.store.environmentId,
        );
        const project = projectProofs.find((item) => item.projectId === source.projectId);
        if (
          !proof ||
          !project ||
          !Array.isArray(snapshot.coverage) ||
          snapshot.coverage.length !== 1 ||
          snapshot.coverage[0] !== "native-session"
        )
          throw new Error("Native session disclosure provenance unavailable.");
        const generation = createHash("sha256")
          .update(
            JSON.stringify([nativeObservationGeneration(proof), source.projectId, project.cwd]),
          )
          .digest("hex");
        await observationNativePages.delivered(
          {
            threadId,
            installationId: proof.installationId,
            generation,
            consumer: observationRoomConsumer(threadId, generation, "native-session"),
            source: "native-session",
          },
          snapshot.snapshotId,
          Number(snapshot.offset),
          Number(snapshot.nextOffset),
          valid,
        );
        continue;
      }
      if (source.nativeLibrary && !source.projectId && !source.accountId) {
        const selected = observation.value?.observationSource;
        const proof = nativeProofs.find(
          (proof) =>
            proof.threadId === threadId &&
            proof.environmentId === dependencies.engine.store.environmentId,
        );
        if (
          !proof ||
          (selected !== "note" && selected !== "server" && selected !== "crew") ||
          !Array.isArray(snapshot.coverage) ||
          snapshot.coverage.length !== 1 ||
          snapshot.coverage[0] !== selected
        )
          throw new Error("Native observation disclosure proof is unavailable.");
        const generation = nativeObservationGeneration(proof);
        if (selected === "crew") {
          await observationHostPages.delivered(
            {
              threadId,
              generation,
              consumer: observationRoomConsumer(threadId, generation, selected),
            },
            snapshot.snapshotId,
            Number(snapshot.offset),
            Number(snapshot.nextOffset),
            valid,
          );
          continue;
        }
        await observationNativePages.delivered(
          {
            threadId,
            installationId: proof.installationId,
            generation,
            consumer: observationRoomConsumer(threadId, generation, selected),
            source: selected,
          },
          snapshot.snapshotId,
          Number(snapshot.offset),
          Number(snapshot.nextOffset),
          valid,
        );
        continue;
      }
      if (source.projectId && !source.accountId) {
        const selected = observation.value?.observationSource;
        if (
          (selected !== "task" && selected !== "session" && selected !== "goal") ||
          !Array.isArray(snapshot.coverage) ||
          snapshot.coverage.length !== 1 ||
          snapshot.coverage[0] !== selected
        )
          throw new Error("Observation page project provenance is unavailable.");
        const goalProofs =
          selected === "goal"
            ? await collectGoalObservationProjects(dependencies.engine.store, source.projectId)
            : undefined;
        if (
          goalProofs?.some(
            (expected) =>
              !projectProofs.some(
                (actual) => actual.projectId === expected.projectId && actual.cwd === expected.cwd,
              ),
          )
        )
          throw new Error("Goal observation disclosure scope changed.");
        await observationProjectPages.delivered(
          {
            threadId,
            projectId: source.projectId,
            source: selected,
            consumer: observationRoomConsumer(threadId, undefined, selected),
          },
          snapshot.snapshotId,
          Number(snapshot.offset),
          Number(snapshot.nextOffset),
          valid,
          goalProofs,
        );
        continue;
      }
      if (!source.accountId || source.projectId)
        throw new Error("Observation page scope is unavailable.");
      const proof = proofs.find((value) => value.accountId === source.accountId);
      if (!proof) throw new Error("Observation page account provenance is unavailable.");
      await observationPages.delivered(
        {
          threadId,
          accountId: source.accountId,
          version: proof.version,
          consumer: observationRoomConsumer(threadId, proof.version),
        },
        snapshot.snapshotId,
        Number(snapshot.offset),
        Number(snapshot.nextOffset),
        valid,
      );
    }
  };
  let observationCoverage:
    | Awaited<ReturnType<typeof installAssistantObservationProducers>>
    | undefined;
  const roomProjectNotes = new ConversationManagementTools<string>(
    {
      approve: dependencies.approveManagementOperation,
      receipt: async (key) => {
        const row = await dependencies.engine.store.db
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get(key);
        return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
      },
      saveReceipt: async (key, value) => {
        await dependencies.engine.store.db
          .prepare(
            "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(key, JSON.stringify(value));
      },
      execute: async (action, input, principal, authorized) => {
        if (
          principal.kind !== "assistant-thread" ||
          !["notes.create", "notes.update", "notes.delete"].includes(action) ||
          !input.noteInput ||
          typeof input.noteInput !== "object" ||
          Array.isArray(input.noteInput)
        )
          throw new Error("Invalid project note operation.");
        try {
          return await dependencies.conversationWorkspace.call(
            action as ConversationTool,
            input.noteInput as Record<string, unknown>,
            principal,
            undefined,
            authorized,
          );
        } finally {
          await dependencies.hostNotes.settled();
        }
      },
    },
    new Set(),
  );
  const roomResourceReceipts = {
    receipt: async (key: string) => {
      const row = await dependencies.engine.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
    },
    saveReceipt: async (key: string, value: ManagementReceipt) => {
      await dependencies.engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    approve: dependencies.approveManagementOperation,
  };
  const roomFiles = Object.assign(
    createRoomFileTools({
      ...roomResourceReceipts,
      run: (principal, command, input, authorized) =>
        dependencies.workspace.run(
          command,
          input,
          `room:${dependencies.engine.store.environmentId}:${principal.threadId}`,
          authorized,
        ),
    }),
    {
      /** Owner-chosen folders (global Room files) and commands.run (global and project Room). */
      folders: createAssistantFolderTools({
        receipt: roomResourceReceipts.receipt,
        saveReceipt: roomResourceReceipts.saveReceipt,
        folders: async () => {
          const { assistantFolders } = await dependencies.assistant.request(
            { op: "folders.get" },
            "assistant",
          );
          if (!assistantFolders) throw new Error("The Assistant folders are unavailable.");
          return assistantFolders;
        },
        approve: async (operation, principal, authorized) =>
          "projectCwd" in principal
            ? roomResourceReceipts.approve(operation, principal, authorized)
            : ((await dependencies.conversationDesktop.callAssistantThread(
                "management.write.authorize",
                { operation },
                principal,
                authorized,
              )) as { approved?: boolean; operationHash?: string }),
      }),
    },
  );
  const roomDevServers = createRoomDevServerTools({
    ...roomResourceReceipts,
    project: (id) => dependencies.engine.store.project(id),
    handle: (action, input, projects, authorize) =>
      dependencies.devServers.handle(action, input, projects, authorize),
  });
  const roomTerminals = createRoomTerminalTools({
    ...roomResourceReceipts,
    terminals: dependencies.terminals,
    project: (id) => dependencies.engine.store.project(id),
  });
  const roomBrowser = createRoomBrowserTools({
    ...roomResourceReceipts,
    registry: dependencies.sharedBrowser,
    previews: dependencies.conversationPreviews,
    describe: (value) => dependencies.browserRuntime.describe(value),
  });
  const roomSessions = new ConversationManagementTools<string>(
    {
      approve: dependencies.approveManagementOperation,
      receipt: async (key) => {
        const row = await dependencies.engine.store.db
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get(key);
        return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
      },
      saveReceipt: async (key, value) => {
        await dependencies.engine.store.db
          .prepare(
            "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(key, JSON.stringify(value));
      },
      execute: async (action, input, principal, authorized) => {
        if (principal.kind !== "assistant-thread" || !isRoomSessionAction(action))
          throw new Error("A real Room session source is required.");
        return executeRoomSessionAction(
          action,
          input,
          {
            kind: "assistant-thread",
            threadId: principal.threadId,
            projectId: principal.projectId,
            name: await dependencies.assistant.identityName(),
          },
          authorized,
          dependencies.engine.store,
          dependencies.engine,
        );
      },
    },
    new Set(["sessions.submit.status"]),
  );
  const workspaceTransferSource = new AsyncLocalStorage<{
    valid: () => boolean;
    source: {
      deviceHash: string;
      projectCwd: string;
      installationId: string;
      registryRevision: string;
      visibilityEpoch: number;
      policyGeneration: string;
    };
  }>();
  const roomWorkspace = new ConversationManagementTools<string>(
    {
      approve: dependencies.approveManagementOperation,
      receipt: async (key) => {
        const row = await dependencies.engine.store.db
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get(key);
        return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
      },
      saveReceipt: async (key, value) => {
        await dependencies.engine.store.db
          .prepare(
            "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(key, JSON.stringify(value));
      },
      execute: async (action, input, principal, authorized) => {
        if (principal.kind !== "assistant-thread" || !isRoomWorkspaceAction(action))
          throw new Error("A real Room workspace source is required.");
        const project = await dependencies.engine.store.project(principal.projectId);
        if (
          action !== "workspace.sessions.submit.status" &&
          action !== "workspace.operation.status"
        ) {
          const bound = workspaceTransferSource.getStore();
          if (!bound || bound.source.projectCwd !== project.cwd)
            throw new Error("Native workspace scope is unavailable.");
          const current = async () => bound.valid() && (await authorized()) && bound.valid();
          const source = {
            environmentId: dependencies.engine.store.environmentId,
            threadId: principal.threadId,
            projectId: principal.projectId,
            targetProjectCwd: project.cwd,
            targetDeviceHash: bound.source.deviceHash,
            installationId: bound.source.installationId,
            registryRevision: bound.source.registryRevision,
            visibilityEpoch: bound.source.visibilityEpoch,
            policyGeneration: bound.source.policyGeneration,
            action,
            originalInput: input,
            requestId: String(input.requestId),
          };
          return transferAssistantWorkspaceOperation(
            assistantWorkspaceOwner,
            source,
            current,
            bound.valid,
            (value) =>
              dependencies.conversationDesktop.callAssistantThread(
                "workspace.operation.execute",
                value,
                {
                  threadId: principal.threadId,
                  environmentId: dependencies.engine.store.environmentId,
                  projectId: principal.projectId,
                  targetProjectCwd: project.cwd,
                  targetDeviceHash: bound.source.deviceHash,
                },
                current,
              ),
            (value) =>
              verifyWorkspaceReceipt(
                nativeAdmissionOwner,
                value as { relayId: string; envelope: unknown },
                {
                  environmentId: dependencies.engine.store.environmentId,
                  threadId: principal.threadId,
                  projectId: principal.projectId,
                  targetCwd: project.cwd,
                  operationId: source.requestId,
                  action,
                  originalInput: input,
                },
                current,
                bound.source,
              ),
          );
        }
        return dependencies.conversationDesktop.callAssistantThread(
          action,
          input,
          {
            threadId: principal.threadId,
            environmentId: dependencies.engine.store.environmentId,
            projectId: project.id,
            targetProjectCwd: project.cwd,
          },
          authorized,
        );
      },
    },
    new Set(["workspace.sessions.submit.status"]),
  );
  const roomNotebook = new AssistantRoomNotebook(dependencies.assistant, {
    receipt: async (key) => {
      const row = await dependencies.engine.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
    },
    saveReceipt: async (key, value) => {
      await dependencies.engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    approve: async (operation, principal, authorized) =>
      dependencies.conversationDesktop.callAssistantThread(
        "management.write.authorize",
        { operation },
        principal,
        authorized,
      ) as Promise<{ approved?: boolean; operationHash?: string }>,
  });
  const visibleProjectForThread = async (
    id: string,
    threadId: string,
    authorized: () => Promise<boolean>,
  ) => {
    const project = await dependencies.engine.store.project(id);
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = (await dependencies.conversationDesktop.callAssistantThread(
        "organization.read",
        { offset, limit: 100 },
        { threadId, environmentId: dependencies.engine.store.environmentId },
        authorized,
      )) as { items?: Array<{ cwd?: string }>; nextOffset?: number | null };
      if (!Array.isArray(page.items)) return false;
      if (page.items.some((item) => item.cwd === project.cwd)) return true;
      if (page.nextOffset == null || page.nextOffset !== offset + 100) return false;
    }
    return false;
  };
  const roomVisibleProject = async (
    id: string,
    threadId: string,
    admission: import("../assistant/management/assistant-management-turn").RoomManagementAdmission,
  ) => visibleProjectForThread(id, threadId, admission.authorized);
  return {
    executeAccountSocial,
    visibilityFence,
    nativeAdmissionOwner,
    roomDelegationTarget,
    visibilityAdmission,
    observationJournal,
    observationPages,
    observationNativePages,
    observationHostPages,
    nativeVoiceLeases,
    nativeObservationGeneration,
    observationProjectPages,
    assistantWorkspaceOwner,
    assistantBackgroundEffect,
    executeBackgroundEffect,
    backgroundEffectStatus,
    get observationCoverage() {
      return observationCoverage;
    },
    set observationCoverage(value: typeof observationCoverage) {
      observationCoverage = value;
    },
    roomProjectNotes,
    roomResourceReceipts,
    roomFiles,
    roomDevServers,
    roomTerminals,
    roomBrowser,
    roomSessions,
    workspaceTransferSource,
    roomWorkspace,
    roomNotebook,
    visibleProjectForThread,
    roomVisibleProject,
  };
}
