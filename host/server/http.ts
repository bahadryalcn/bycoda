import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { HOST_PROTOCOL_VERSION } from "../../src/features/connections/model/protocol";
import { elapsedSince } from "../../src/shared/lib/time/timestamps";
import { AssistantResponseValidationSchema } from "../../src/shared/model/host-contracts/assistant";
import { mcpMetricName, perfMetrics } from "../diagnostics/perf-metrics";
import { HostDomainAuthorizationError, HostDomainOutcomeError } from "../domains/context";
import { RequestAuthorizationError } from "../store-db";
import { serializedResponse } from "../sync/sync-transfer";
import { HostVoiceToolDisclosure } from "../voice/voice-tool-disclosure";
import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
import { dispatchOwnerRpc } from "./owner-rpc";
import { body } from "./support";
import { handleAssistantObservationTools } from "./tools-assistant-observation";
import { handleConversationTools } from "./tools-conversation";
import { handleRuntimeLogsTools } from "./tools-runtime-logs";
import { handleSocialTools } from "./tools-social";
import { handleVoiceTools } from "./tools-voice";
export function createHttpRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "mcpHttp"
    | "socialTransport"
    | "webControl"
    | "lifecycle"
    | "controls"
    | "bulkHandler"
    | "mobilePairing"
    | "social"
    | "runtimeLogAccess"
    | "conversationAccess"
    | "socialPeers"
    | "httpTokenHashes"
    | "nativeDevicesOwner"
    | "nativeDeliveryOwner"
    | "nativeServicesOwner"
    | "requestWorkspaceOwner"
    | "devServerAccess"
    | "withWorkspaceOwner"
    | "tasks"
    | "assistant"
    | "assistantPorts"
    | "withRoomProjectScope"
    | "conversationDesktop"
    | "nativeAdmissionOwner"
    | "featureMeta"
    | "executeAccountSocial"
    | "roomNotebook"
    | "conversationManagementRuntime"
    | "globalServerManagement"
    | "globalAssistantManagement"
    | "projectSessionList"
    | "localSessionReference"
    | "featureSession"
    | "roomWorkspace"
    | "conversationThreadCrews"
    | "conversationThreadWork"
    | "conversationManagement"
    | "conversationDesktopControl"
    | "conversationWorkspace"
    | "conversationRuntimeReads"
    | "inHost"
    | "explicitSkillNames"
    | "crews"
    | "conversationStewards"
    | "conversationTaskQueue"
    | "conversationDelegation"
    | "conversationGoals"
    | "conversationProject"
    | "browserRuntime"
    | "workspace"
    | "runtimeLogs"
    | "terminalLogs"
    | "refreshLogSources"
    | "logMonitors"
    | "deviceHost"
    | "devicePreviews"
    | "conversationPreviews"
    | "sharedBrowser"
    | "devServers"
    | "diagnostics"
    | "nativeServicesService"
    | "managedWorkspaces"
    | "workspaceForOwnerRpc"
    | "managed"
    | "nativeWorkspacesService"
    | "nativeDeliveryService"
    | "nativeBufferUploads"
    | "workspaceOwnerDeviceId"
    | "workspacePolicy"
    | "featureClaims"
    | "terminalService"
    | "nativeServiceUploads"
    | "desktopControl"
    | "desktopHelper"
    | "devServersService"
    | "environmentService"
    | "persistenceService"
    | "voiceCloud"
    | "localVoice"
    | "voiceSetup"
    | "providers"
    | "genericAcp"
    | "catalogs"
    | "handoffHistory"
    | "nativeDevicesService"
    | "projectsService"
    | "modelsService"
    | "sessionService"
    | "heldPolls"
    | "remoteChanges"
    | "desktop"
    | "sessionSourceEpoch"
    | "projectChangeSnapshot"
    | "taskChangeEtag"
    | "gitWatches"
    | "desktopRecheckMs"
    | "desktopWatch"
    | "adopt"
    | "startWorkspaceActivity"
    | "desktopDelete"
    | "invalidateSessionCopies"
    | "sessionQueues"
    | "commandService"
    | "withinBeat"
    | "desktopCommandDelivery"
    | "renewRunLeases"
    | "heartbeatEffects"
    | "providerInbox"
    | "hostNotes"
    | "adoptedChanges"
    | "renewQueueLeases"
    | "runLeases"
    | "queueDrainer"
    | "queueSessionKnown"
    | "writerTransfers"
    | "hostRuns"
    | "sessionQueueService"
    | "attachmentOwnership"
    | "scopedDesktopCall"
    | "desktopSigningSecret"
    | "readSessionView"
    | "notesService"
    | "goals"
    | "automations"
    | "automationsService"
    | "crewsService"
    | "sprintsService"
    | "tasksService"
    | "goalsService"
    | "stewardsService"
    | "bindQuestionUpload"
    | "mobileLan"
    | "mobileAccess"
    | "tunnels"
    | "gitService"
    | "fileService"
  >,
) {
  let closing = false;
  const requests = new Set<Promise<void>>();
  const server = createServer(
    { requestTimeout: 20_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
    (request, response) => {
      if (closing) {
        response.writeHead(503).end(JSON.stringify({ error: "Host is stopping." }));
        return;
      }
      const accepted = dependencies.engine.store.db.outsideScope(async () => {
        const mcpMetric = mcpMetricName(request.url ?? "");
        if (mcpMetric) {
          await perfMetrics.measure(
            mcpMetric,
            async () => await dependencies.mcpHttp.handle(request, response, server),
          );
          return;
        }
        if (await dependencies.mcpHttp.handle(request, response, server)) return;
        if (await dependencies.socialTransport.http(request, response)) return;
        if (dependencies.webControl?.handle(request, response)) return;
        if (request.url === "/lifecycle" && dependencies.lifecycle) {
          dependencies.lifecycle(request, response);
          return;
        }
        if (
          request.url === "/native-authority/bootstrap" &&
          dependencies.controls?.nativeAuthorityBootstrap
        ) {
          dependencies.controls.nativeAuthorityBootstrap(request, response);
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        let dispatchStarted: number | undefined;
        let dispatchMethod: unknown;
        let deviceEffectAdmitted = false;
        let releaseVoiceTool: (() => void) | undefined;
        let voiceDisclosure: HostVoiceToolDisclosure | undefined;
        let voiceBrowserOwner: string | undefined;
        const resultScopeReleases: Array<() => void> = [];
        const resultScopeSettlements: Promise<void>[] = [];
        let voiceToolLog:
          | { action: string; requestId: string | null; startedAt: number; outcome: string }
          | undefined;
        try {
          if (await dependencies.bulkHandler(request, response)) return;
          if (await dependencies.mobilePairing.handle(request, response)) return;
          // Desktop native HTTP supplies credentials. This endpoint intentionally
          // accepts no browser origin and provides no permissive CORS escape hatch.
          if (
            !(
              dependencies.webControl?.acceptsRpc(request) ||
              (!request.headers.origin && request.method === "POST" && request.url === "/rpc")
            )
          ) {
            response
              .writeHead(403)
              .end(JSON.stringify({ error: "Unsupported request origin or route" }));
            return;
          }
          const credential = request.headers.authorization?.match(
            /^Bearer ([A-Za-z0-9_-]{43})$/,
          )?.[1];
          let socialPrincipal = credential
            ? await dependencies.social.principalForToken(credential)
            : undefined;
          let runtimePrincipal = credential
            ? await dependencies.runtimeLogAccess.principalForToken(credential)
            : undefined;
          let conversationPrincipal = credential
            ? await dependencies.conversationAccess.principalForToken(credential)
            : undefined;
          let peerIdentity = credential
            ? await dependencies.socialPeers.authenticated(credential)
            : undefined;
          if (
            !credential ||
            (!socialPrincipal &&
              !runtimePrincipal &&
              !conversationPrincipal &&
              !peerIdentity &&
              !(await dependencies.engine.store.authenticated(credential)))
          ) {
            response.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" }).end(
              JSON.stringify({
                error: "Device credential is invalid or revoked",
              }),
            );
            return;
          }
          let token: string = credential;
          let tokenIdentity = dependencies.httpTokenHashes.get(request.socket);
          if (tokenIdentity?.token !== token) {
            tokenIdentity = { token, hash: createHash("sha256").update(token).digest("hex") };
            dependencies.httpTokenHashes.set(request.socket, tokenIdentity);
          }
          const tokenHash = tokenIdentity.hash;
          const pollState = { revoked: false };
          const input = await body(request);
          // Reading a request body yields: a device may have been revoked since
          // the headers arrived. Reject it before dispatching any operation.
          socialPrincipal = socialPrincipal
            ? await dependencies.social.principalForToken(token)
            : undefined;
          runtimePrincipal = runtimePrincipal
            ? await dependencies.runtimeLogAccess.principalForToken(token)
            : undefined;
          conversationPrincipal = conversationPrincipal
            ? await dependencies.conversationAccess.principalForToken(token)
            : undefined;
          peerIdentity = peerIdentity
            ? await dependencies.socialPeers.authenticated(token)
            : undefined;
          if (
            !socialPrincipal &&
            !runtimePrincipal &&
            !conversationPrincipal &&
            !peerIdentity &&
            !(await dependencies.engine.store.authenticated(token))
          ) {
            response.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" }).end(
              JSON.stringify({
                error: "Device credential is invalid or revoked",
              }),
            );
            return;
          }
          if (input.version !== HOST_PROTOCOL_VERSION)
            throw new Error("Incompatible protocol version");
          if (
            input.method !== "environment.describe" &&
            input.environmentId !== dependencies.engine.store.environmentId
          )
            throw new Error("Host identity changed; reconnect this machine explicitly");
          let params =
            input.params && typeof input.params === "object" && !Array.isArray(input.params)
              ? (input.params as Record<string, unknown>)
              : {};
          const transportToken = token;
          const resultAuthorities: Array<() => Promise<boolean>> = [];
          const domainContext = {
            deviceEffectAdmitted: () => {
              deviceEffectAdmitted = true;
            },
            nativeDevices: dependencies.nativeDevicesOwner(token),
            nativeDelivery: dependencies.nativeDeliveryOwner(token),
            retainResultAuthority: (check: () => Promise<boolean>) => {
              resultAuthorities.push(check);
            },
            nativeServices: dependencies.nativeServicesOwner(token, (read) => {
              let resolveReady!: (value: unknown) => void;
              let rejectReady!: (reason: unknown) => void;
              const ready = new Promise<unknown>((resolve, reject) => {
                resolveReady = resolve;
                rejectReady = reject;
              });
              let release!: () => void;
              const released = new Promise<void>((resolve) => {
                release = resolve;
              });
              let published = false;
              const settled = read(async (value, valid) => {
                if (published) throw new Error("Native browser result was already published.");
                published = true;
                resultAuthorities.push(async () => valid());
                resolveReady(value);
                await released;
              });
              resultScopeReleases.push(release);
              resultScopeSettlements.push(settled);
              void settled
                .then(() => {
                  if (!published) rejectReady(new Error("Native browser result is unavailable."));
                })
                .catch(rejectReady);
              return ready;
            }),
            workspaceOwner: dependencies.requestWorkspaceOwner(token),
            principalId: tokenHash,
            devServerAccess: (
              method: string,
              params: Record<string, unknown>,
              authorize: () => Promise<void>,
            ) => dependencies.devServerAccess.handle(method, params, transportToken, authorize),
            retargetTask: (id: string, target: unknown, autoMerge: unknown) =>
              dependencies.withWorkspaceOwner(transportToken, (owner) =>
                dependencies.tasks.retarget(id, target, autoMerge, owner),
              ),
            authorized: async () => await dependencies.engine.store.authenticated(transportToken),
            closing: () => closing || response.destroyed,
          };
          // Scope the timer to dispatch, including all early returns and failures.
          // Never retain input/params or error contents in the metrics collector.
          dispatchStarted = performance.now();
          dispatchMethod = input.method;
          let result: unknown;
          const endResult = async (
            value: unknown,
            verify?: () => Promise<void>,
            awaitWrite = false,
          ) => {
            const inline = serializedResponse(value);
            const body = voiceDisclosure
              ? await voiceDisclosure.body(value)
              : inline === undefined
                ? JSON.stringify({ result: value })
                : `{"result":${inline}}`;
            await verify?.();
            if (awaitWrite || voiceDisclosure) {
              await new Promise<void>((resolve, reject) => {
                const closed = () => {
                  cleanup();
                  reject(new Error("Response closed before write completed."));
                };
                const failed = (error: Error) => {
                  cleanup();
                  reject(error);
                };
                const cleanup = () => {
                  response.off("close", closed);
                  response.off("error", failed);
                };
                response.once("close", closed);
                response.once("error", failed);
                response.end(body, () => {
                  try {
                    voiceDisclosure?.markSent();
                    cleanup();
                    resolve();
                  } catch (error) {
                    cleanup();
                    reject(error);
                  }
                });
              });
            } else response.end(body);
          };
          if (
            input.method === "assistant.request" &&
            (params.op === "observation.delivery.list" ||
              params.op === "observation.delivery.refresh")
          ) {
            return await handleAssistantObservationTools(dependencies, {
              get request() {
                return request;
              },
              get peerIdentity() {
                return peerIdentity;
              },
              get socialPrincipal() {
                return socialPrincipal;
              },
              set socialPrincipal(value: HttpToolRequest["socialPrincipal"]) {
                socialPrincipal = value;
              },
              get runtimePrincipal() {
                return runtimePrincipal;
              },
              set runtimePrincipal(value: HttpToolRequest["runtimePrincipal"]) {
                runtimePrincipal = value;
              },
              get conversationPrincipal() {
                return conversationPrincipal;
              },
              set conversationPrincipal(value: HttpToolRequest["conversationPrincipal"]) {
                conversationPrincipal = value;
              },
              get token() {
                return token;
              },
              set token(value: HttpToolRequest["token"]) {
                token = value;
              },
              get params() {
                return params;
              },
              set params(value: HttpToolRequest["params"]) {
                params = value;
              },
              get endResult() {
                return endResult;
              },
            });
          }
          if (await dependencies.mcpHttp.rpc(input.method, params, token, response)) return;
          if (peerIdentity) {
            result = await dependencies.engine.store.db.withAuthorization(
              async () => !!(await dependencies.socialPeers.authenticated(transportToken)),
              () => dependencies.socialPeers.peerRpc(peerIdentity, String(input.method), params),
            );
            if (!(await dependencies.socialPeers.authenticated(token)))
              throw new Error("Peer authority revoked.");
            response.end(JSON.stringify({ result }));
            return;
          }
          if (input.method === "voice.tools.list" || input.method === "voice.tools.call") {
            if (
              await handleVoiceTools(dependencies, {
                get request() {
                  return request;
                },
                get socialPrincipal() {
                  return socialPrincipal;
                },
                set socialPrincipal(value: HttpToolRequest["socialPrincipal"]) {
                  socialPrincipal = value;
                },
                get runtimePrincipal() {
                  return runtimePrincipal;
                },
                set runtimePrincipal(value: HttpToolRequest["runtimePrincipal"]) {
                  runtimePrincipal = value;
                },
                get conversationPrincipal() {
                  return conversationPrincipal;
                },
                set conversationPrincipal(value: HttpToolRequest["conversationPrincipal"]) {
                  conversationPrincipal = value;
                },
                get token() {
                  return token;
                },
                set token(value: HttpToolRequest["token"]) {
                  token = value;
                },
                get input() {
                  return input;
                },
                get params() {
                  return params;
                },
                set params(value: HttpToolRequest["params"]) {
                  params = value;
                },
                get response() {
                  return response;
                },
                get voiceToolLog() {
                  return voiceToolLog;
                },
                set voiceToolLog(value: HttpToolRequest["voiceToolLog"]) {
                  voiceToolLog = value;
                },
                get voiceDisclosure() {
                  return voiceDisclosure;
                },
                set voiceDisclosure(value: HttpToolRequest["voiceDisclosure"]) {
                  voiceDisclosure = value;
                },
                get tokenHash() {
                  return tokenHash;
                },
                get endResult() {
                  return endResult;
                },
                get result() {
                  return result;
                },
                set result(value: HttpToolRequest["result"]) {
                  result = value;
                },
                get releaseVoiceTool() {
                  return releaseVoiceTool;
                },
                set releaseVoiceTool(value: HttpToolRequest["releaseVoiceTool"]) {
                  releaseVoiceTool = value;
                },
                get voiceBrowserOwner() {
                  return voiceBrowserOwner;
                },
                set voiceBrowserOwner(value: HttpToolRequest["voiceBrowserOwner"]) {
                  voiceBrowserOwner = value;
                },
              })
            )
              return;
          }
          if (socialPrincipal && input.method !== "social.tools.call")
            throw new Error("Session social credentials cannot access other host operations.");
          if (runtimePrincipal && input.method !== "runtimeLogs.tools.call")
            throw new Error("Session log credentials only permit reading runtime logs.");
          if (conversationPrincipal && input.method !== "conversation.tools.call")
            throw new Error("Session conversation credentials only permit Conversation Tools.");
          if (input.method === "conversation.tools.call") {
            return await handleConversationTools(dependencies, {
              get conversationPrincipal() {
                return conversationPrincipal;
              },
              set conversationPrincipal(value: HttpToolRequest["conversationPrincipal"]) {
                conversationPrincipal = value;
              },
              get params() {
                return params;
              },
              set params(value: HttpToolRequest["params"]) {
                params = value;
              },
              get token() {
                return token;
              },
              set token(value: HttpToolRequest["token"]) {
                token = value;
              },
              get result() {
                return result;
              },
              set result(value: HttpToolRequest["result"]) {
                result = value;
              },
              get endResult() {
                return endResult;
              },
              get tokenHash() {
                return tokenHash;
              },
              get voiceBrowserOwner() {
                return voiceBrowserOwner;
              },
              set voiceBrowserOwner(value: HttpToolRequest["voiceBrowserOwner"]) {
                voiceBrowserOwner = value;
              },
            });
          }
          if (input.method === "runtimeLogs.tools.call") {
            return await handleRuntimeLogsTools(dependencies, {
              get runtimePrincipal() {
                return runtimePrincipal;
              },
              set runtimePrincipal(value: HttpToolRequest["runtimePrincipal"]) {
                runtimePrincipal = value;
              },
              get token() {
                return token;
              },
              set token(value: HttpToolRequest["token"]) {
                token = value;
              },
              get params() {
                return params;
              },
              set params(value: HttpToolRequest["params"]) {
                params = value;
              },
              get result() {
                return result;
              },
              set result(value: HttpToolRequest["result"]) {
                result = value;
              },
              get endResult() {
                return endResult;
              },
            });
          }
          if (typeof input.method === "string" && input.method.startsWith("social.")) {
            return await handleSocialTools(dependencies, {
              get socialPrincipal() {
                return socialPrincipal;
              },
              set socialPrincipal(value: HttpToolRequest["socialPrincipal"]) {
                socialPrincipal = value;
              },
              get token() {
                return token;
              },
              set token(value: HttpToolRequest["token"]) {
                token = value;
              },
              get tokenHash() {
                return tokenHash;
              },
              get input() {
                return input;
              },
              get result() {
                return result;
              },
              set result(value: HttpToolRequest["result"]) {
                result = value;
              },
              get params() {
                return params;
              },
              set params(value: HttpToolRequest["params"]) {
                params = value;
              },
              get domainContext() {
                return domainContext;
              },
              get endResult() {
                return endResult;
              },
            });
          }
          await dependencies.engine.store.db.withAuthorization(
            () => dependencies.engine.store.authenticated(token),
            async () => {
              await dispatchOwnerRpc(dependencies, {
                input,
                params,
                get result() {
                  return result;
                },
                set result(value: unknown) {
                  result = value;
                },
                token,
                domainContext,
                tokenHash,
                request,
                pollState,
                response,
                get closing() {
                  return closing;
                },
              });
            },
          );
          const finishResult = () =>
            endResult(
              result,
              async () => {
                for (const check of resultAuthorities)
                  if (!(await check())) throw new Error("Result authority expired.");
              },
              input.method === "assistant.request" ||
                input.method === "native.services.assistant.browser.panel",
            );
          if (input.method === "assistant.request") {
            await dependencies.assistant.withResponseDisclosure(
              AssistantResponseValidationSchema.parse(result),
              {
                environmentId: dependencies.engine.store.environmentId,
                deviceHash: tokenHash,
                authorized: domainContext.authorized,
              },
              finishResult,
            );
          } else await finishResult();
        } catch (error) {
          if (voiceToolLog) voiceToolLog.outcome = "error";
          if (!response.destroyed && !response.headersSent)
            response
              .writeHead(
                error instanceof RequestAuthorizationError ||
                  error instanceof HostDomainAuthorizationError ||
                  (error instanceof HostDomainOutcomeError &&
                    (error.cause instanceof RequestAuthorizationError ||
                      error.cause instanceof HostDomainAuthorizationError))
                  ? 401
                  : 400,
              )
              .end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : "Host request failed",
                  ...(deviceEffectAdmitted
                    ? { code: "HOST_DEVICE_OPERATION_UNCONFIRMED", delivery: "unknown" }
                    : error instanceof HostDomainOutcomeError
                      ? { delivery: error.delivery }
                      : {}),
                  ...(typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  error.code === "HOST_CONTROL_RECEIPT_UNCONFIRMED" &&
                  "controlApplied" in error &&
                  error.controlApplied === true
                    ? { code: "HOST_CONTROL_RECEIPT_UNCONFIRMED", delivery: "unknown" }
                    : {}),
                }),
              );
          else if (!response.destroyed && !response.writableEnded) response.destroy();
        } finally {
          for (const release of resultScopeReleases) release();
          await Promise.allSettled(resultScopeSettlements);
          if (voiceToolLog)
            console.info("Voice tool", {
              action: voiceToolLog.action,
              requestId: voiceToolLog.requestId,
              elapsedMs: elapsedSince(voiceToolLog.startedAt),
              outcome:
                response.destroyed && !response.writableEnded
                  ? "disconnected"
                  : voiceToolLog.outcome,
            });
          await voiceDisclosure?.fail().catch(() => undefined);
          releaseVoiceTool?.();
          if (dispatchStarted !== undefined)
            perfMetrics.recordDuration(dispatchMethod, performance.now() - dispatchStarted);
        }
      });
      requests.add(accepted);
      void accepted
        .catch(() => {
          if (!response.destroyed) {
            if (!response.headersSent)
              response.writeHead(500).end(JSON.stringify({ error: "Host request failed." }));
            else response.destroy();
          }
        })
        .finally(() => requests.delete(accepted));
    },
  );
  return {
    get closing() {
      return closing;
    },
    set closing(value: typeof closing) {
      closing = value;
    },
    requests,
    server,
  };
}
