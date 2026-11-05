import { createHash } from "node:crypto";
import { z } from "zod";
import { NativeAssistantBrowserPanelParamsSchema } from "../../src/shared/model/host-contracts/native-services";
import {
  ingestNativeObservations,
  nativeObservationOperation,
} from "../assistant/observations/assistant-native-observations";
import { createRoomNativeSourceAdapter } from "../assistant/room/assistant-room-native-adapter";
import { validateConversationTool } from "../conversation/conversation-tools";
import { createHostAutomationsService } from "../domains/automations/service";
import { type HostDomainContext } from "../domains/context";
import { createHostCrewsService } from "../domains/crews/service";
import { createHostPersistenceService } from "../domains/environment/persistence-service";
import { createModelsService } from "../domains/models/service";
import { createNativeDeliveryService } from "../domains/native-delivery/service";
import { createNativeDevicesService } from "../domains/native-devices/service";
import { createNativeServicesService } from "../domains/native-services/service";
import { createNativeServiceUploadService } from "../domains/native-services/upload";
import { createNativeBufferUploadService } from "../domains/native-workspaces/buffer-upload";
import { createNativeWorkspacesService } from "../domains/native-workspaces/service";
import { createHostStewardsService } from "../domains/stewards/service";
import { createNativeDeliveryStore } from "../native-delivery/native-delivery-store";
import { bindNativeDeliveryOwner } from "../ports/native-delivery";
import { bindNativeDevicesOwner } from "../ports/native-devices";
import { bindNativeServicesOwner } from "../ports/native-services";
import { nativeBufferUploadPlatform } from "../ports/native-workspaces";
import { hostProviderAccounts } from "../providers/provider-accounts";
import type { ServerBindings } from "./bindings";
export function createNativeRuntime(
  dependencies: Pick<
    ServerBindings,
    | "automations"
    | "stewards"
    | "crews"
    | "engine"
    | "managed"
    | "workspaceForOwnerRpc"
    | "managedWorkspaces"
    | "models"
    | "providers"
    | "deviceHost"
    | "devicePreviews"
    | "nativeAdmissionOwner"
    | "roomAttestationSigner"
    | "assistant"
    | "roomDelegationTarget"
    | "social"
    | "socialPeers"
    | "conversationAccess"
    | "runtimeLogAccess"
    | "terminalLogs"
    | "conversationDesktop"
    | "desktopControl"
    | "visibilityFence"
    | "observationJournal"
    | "withRoomProjectScope"
    | "roomBrowser"
    | "assistantWorkspaceOwner"
    | "nativeVoiceLeases"
    | "retireNativeVoiceGenerations"
    | "visibilityAdmission"
    | "workspace"
    | "inHost"
    | "desktop"
    | "mcpBridgeMetadata"
    | "requestWorkspaceOwner"
  >,
) {
  const automationsService = createHostAutomationsService({
    automations: dependencies.automations,
  });
  const stewardsService = createHostStewardsService({ stewards: dependencies.stewards });
  const crewsService = createHostCrewsService({ crews: dependencies.crews });
  const crewOperation =
    (method: Parameters<typeof crewsService.call>[0]) =>
    (params: Record<string, unknown>, context: HostDomainContext) =>
      crewsService.call(method, params, context);
  const persistenceService = createHostPersistenceService({
    status: () => dependencies.engine.store.db.persistenceHealth(),
    recover: (authorized) =>
      dependencies.engine.store.db.withAuthorization(authorized, () =>
        dependencies.engine.store.db.recoverPersistence(),
      ),
  });
  const nativeWorkspacesService = createNativeWorkspacesService({
    managed: dependencies.managed,
    workspace: dependencies.workspaceForOwnerRpc,
    touchActivity: (id) => dependencies.managedWorkspaces.touchActivity(id),
  });
  const modelsService = createModelsService({
    read: dependencies.models,
    accounts: hostProviderAccounts,
    providers: dependencies.providers,
  });
  const nativeDevicesService = createNativeDevicesService();
  const nativeDevicesOwner = (token: string) =>
    bindNativeDevicesOwner(
      {
        store: dependencies.engine.store,
        host: dependencies.deviceHost,
        previews: dependencies.devicePreviews,
      },
      createHash("sha256").update(token).digest("hex"),
      () => dependencies.engine.store.authenticated(token),
    );
  const nativeServicesService = createNativeServicesService();
  const nativeDeliveryService = createNativeDeliveryService();
  const nativeDeliveryJournal = createNativeDeliveryStore(dependencies.engine.store);
  const nativeServiceUploads = createNativeServiceUploadService({
    environmentId: dependencies.engine.store.environmentId,
    platform: nativeBufferUploadPlatform,
    execute: (target, params, context) => nativeServicesService.call(target, params, context),
    deliver: (target, identity, paramsJson, context) =>
      nativeDeliveryService.call(
        "native.services.delivery.apply",
        { ...identity, target, paramsJson },
        context,
      ),
  });
  type NativeBrowserResultLifetime = (
    read: (publish: (value: unknown, valid: () => boolean) => Promise<void>) => Promise<void>,
  ) => Promise<unknown>;
  const nativeServicesOwner = (token: string, retainBrowserResult?: NativeBrowserResultLifetime) =>
    bindNativeServicesOwner(
      {
        store: dependencies.engine.store,
        delegation: (action, input, authorized) =>
          action === "publicKey" ||
          action === "nativeChallenge" ||
          action === "origin" ||
          action === "attest"
            ? createRoomNativeSourceAdapter({
                environmentId: dependencies.engine.store.environmentId,
                admission: dependencies.nativeAdmissionOwner,
                signer: dependencies.roomAttestationSigner,
                thread: (id) => dependencies.assistant.threadBinding(id),
              })(action, input, authorized)
            : dependencies.roomDelegationTarget(action, input, authorized),
        social: dependencies.social,
        peers: dependencies.socialPeers,
        conversation: dependencies.conversationAccess,
        runtimeLogs: dependencies.runtimeLogAccess,
        terminalLogs: dependencies.terminalLogs,
        desktop: dependencies.conversationDesktop,
        desktopControl: dependencies.desktopControl,
        assistantName: () => dependencies.assistant.identityName(),
        assistantPresence: () => dependencies.assistant.nativePresenceStatus(),
        visibilityEpoch: async () => ({ epoch: dependencies.visibilityFence.currentEpoch() }),
        observationsIngest: async (raw) => {
          const envelope = z
            .strictObject({ operationJson: z.string().max(32768), proof: z.unknown() })
            .parse(raw);
          const operation = nativeObservationOperation.parse(JSON.parse(envelope.operationJson));
          const proof =
            envelope.proof as import("../assistant/native/assistant-native-admission").NativeAdmissionProof;
          if (
            operation.hostId !== dependencies.engine.store.environmentId ||
            proof?.challenge?.installationId !== operation.installationId
          )
            throw new Error("Native observation source changed.");
          const revision = await dependencies.nativeAdmissionOwner.consume(
            {
              installationId: operation.installationId,
              hostId: dependencies.engine.store.environmentId,
              action: "assistant.observations.ingest",
              requestDigest: createHash("sha256").update(envelope.operationJson).digest("hex"),
            },
            proof,
          );
          const projects = await dependencies.engine.store.projects();
          const scopes = operation.entries.flatMap((entry) => {
            const project = entry.sourceCwd
              ? projects.find((project) => project.cwd === entry.sourceCwd)
              : undefined;
            return project ? [{ projectId: project.id, cwd: project.cwd }] : [];
          });
          return dependencies.nativeAdmissionOwner.withEffect(
            operation.installationId,
            revision,
            (lease) =>
              dependencies.engine.store.withProjectIdentityRead(scopes, (projectValid) =>
                ingestNativeObservations({
                  store: dependencies.engine.store,
                  journal: dependencies.observationJournal,
                  operation,
                  verifiedHostId: dependencies.engine.store.environmentId,
                  verifiedInstallationId: operation.installationId,
                  valid: () => lease.valid() && projectValid(),
                  resolve: async (cwd) => {
                    const project = scopes.find((project) => project.cwd === cwd);
                    return project
                      ? {
                          projectId: project.projectId,
                          valid: () => lease.valid() && projectValid(),
                        }
                      : null;
                  },
                  resolvePersonal: async () => ({ valid: () => lease.valid() && projectValid() }),
                }),
              ),
          );
        },
        browserPanel: retainBrowserResult
          ? async (raw) => {
              const params = NativeAssistantBrowserPanelParamsSchema.parse(raw);
              if (
                !params.projectCwd ||
                params.projectCwd.length > 4096 ||
                params.projectCwd.includes("\u0000")
              )
                throw new Error("Invalid Room browser project path.");
              if (params.environmentId !== dependencies.engine.store.environmentId)
                throw new Error("Room browser Host changed.");
              const thread = await dependencies.assistant.threadBinding(params.threadId);
              if (!thread || (thread.projectId && thread.projectId !== params.projectId))
                throw new Error("Room browser source changed.");
              if (
                (await dependencies.engine.store.project(params.projectId)).cwd !==
                params.projectCwd
              )
                throw new Error("Room browser project changed.");
              const { requestId: inputRequestId, takeover, ...input } = params.input;
              if (params.action === "browser.input" && inputRequestId !== params.requestId)
                throw new Error("Original browser input identity changed.");
              if (
                takeover !== undefined &&
                (params.action !== "browser.claim" || typeof takeover !== "boolean")
              )
                throw new Error("Invalid browser control request.");
              // The native panel echoes its current lease on status/claim. It is
              // not a target override and does not grant control for either read.
              if (params.action === "browser.status" || params.action === "browser.claim")
                delete input.leaseId;
              validateConversationTool(params.action, input);
              const deviceHash = createHash("sha256").update(token).digest("hex");
              const authorized = async () =>
                !!(await dependencies.engine.store.authenticated(token)) &&
                !!(await dependencies.assistant.threadBinding(params.threadId));
              const call = {
                threadId: params.threadId,
                projectId: params.projectId,
                family: "conversation" as const,
                action: params.action,
                input,
                requestId: params.requestId,
              };
              return retainBrowserResult(async (publish) =>
                dependencies.withRoomProjectScope(
                  call,
                  authorized,
                  async (valid, captured) => {
                    if (captured.projectCwd !== params.projectCwd)
                      throw new Error("Room browser project changed during qualification.");
                    const rawResult = await dependencies.roomBrowser.call(
                      params.action,
                      input,
                      {
                        environmentId: params.environmentId,
                        projectId: params.projectId,
                        projectCwd: captured.projectCwd,
                        threadId: params.threadId,
                        deviceHash,
                      },
                      params.requestId,
                      async () => valid() && (await authorized()) && valid(),
                      { takeover: takeover === true },
                    );
                    let value = rawResult;
                    if (params.action === "browser.input") {
                      const receipt = rawResult as { state?: string; result?: object };
                      if (receipt.state !== "completed" || !receipt.result)
                        throw new Error(
                          `Browser input outcome is unknown. Original operation: ${params.requestId}. Check its status; do not resend it.`,
                        );
                      value = { ...receipt.result, operationId: params.requestId };
                    }
                    await publish(value, valid);
                  },
                  deviceHash,
                ),
              );
            }
          : undefined,
        authorizeAssistantNotification: (input) =>
          dependencies.assistant.authorizeObservedNotification(
            input,
            createHash("sha256").update(token).digest("hex"),
          ),
        authorizeAssistantWorkspace: (input) =>
          dependencies.assistantWorkspaceOwner.authorize(
            { ...input, environmentId: dependencies.engine.store.environmentId },
            createHash("sha256").update(token).digest("hex"),
          ),
        visibilityRevoke: async () => {
          const drained = dependencies.visibilityFence.revokeAll();
          const epoch = dependencies.visibilityFence.currentEpoch();
          return dependencies.nativeVoiceLeases.retireAll(
            dependencies.retireNativeVoiceGenerations,
            async (valid) => {
              await drained;
              if (!valid()) throw new Error("Native voice closure is not confirmed.");
              return { epoch };
            },
          );
        },
        visibilityReopen: (input, authorized) =>
          dependencies.visibilityAdmission.reopen(input, authorized),
        setAssistantPresence: async (state) => {
          await dependencies.assistant.request({ op: "presence.set", state }, "owner");
        },
        workspace: dependencies.workspace,
        inHost: dependencies.inHost,
        desktopProjectCwd: (id) => dependencies.desktop.projectCwdAsync(id),
        describe: dependencies.mcpBridgeMetadata,
      },
      createHash("sha256").update(token).digest("hex"),
      () => dependencies.engine.store.authenticated(token),
    );
  const nativeDeliveryOwner = (token: string) =>
    bindNativeDeliveryOwner(
      {
        store: dependencies.engine.store,
        journal: nativeDeliveryJournal,
        workspaceOwner: dependencies.requestWorkspaceOwner(token),
        services: nativeServicesOwner(token),
      },
      createHash("sha256").update(token).digest("hex"),
      () => dependencies.engine.store.authenticated(token),
    );
  const nativeBufferUploads = createNativeBufferUploadService({
    environmentId: dependencies.engine.store.environmentId,
    platform: nativeBufferUploadPlatform,
    update: (params, context) =>
      nativeWorkspacesService.call("native.buffers.update", params, context),
    deliver: (identity, paramsJson, context) =>
      nativeDeliveryService.call(
        "native.buffers.delivery.apply",
        { ...identity, paramsJson },
        context,
      ),
  });
  return {
    automationsService,
    stewardsService,
    crewsService,
    crewOperation,
    persistenceService,
    nativeWorkspacesService,
    modelsService,
    nativeDevicesService,
    nativeDevicesOwner,
    nativeServicesService,
    nativeDeliveryService,
    nativeDeliveryJournal,
    nativeServiceUploads,
    nativeServicesOwner,
    nativeDeliveryOwner,
    nativeBufferUploads,
  };
}
