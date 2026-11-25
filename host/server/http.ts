import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import {
  HOST_PROTOCOL_VERSION,
  protocolMismatchMessage,
} from "../../src/features/connections/model/protocol";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { AssistantResponseValidationSchema } from "../../src/shared/model/host-contracts/assistant";
import { hostRpcHasEffect } from "../../src/shared/model/host-contracts/effects";
import { getHostRpcMethod } from "../../src/shared/model/host-contracts/methods";
import { trackRpc } from "../diagnostics/loop-stall";
import { createLogger } from "../diagnostics/logger";
import { failureFields } from "../diagnostics/failure-fields";
import { mcpMetricName, perfMetrics, syncDbTiming } from "../diagnostics/perf-metrics";
import { runWithRequestTrace, startRequestTrace } from "../diagnostics/request-trace";
import { HostDomainAuthorizationError, HostDomainOutcomeError } from "../domains/context";
import { requestingDeviceName } from "../desktop/remoteActivity";
import { memoized } from "../desktop/requester-name";
import {
  checkDeviceProof,
  DEVICE_PROOF_REFUSAL_HEADERS,
  deviceProofRefusalBody,
} from "../security/device-proof";
import { createTunnelIngress, refusesPhoneOnTunnel, requestIngress } from "../security/ingress";
import { HostDbClosingError } from "../storage/store-read-pool";
import { RequestAuthorizationError } from "../store-db";
import { serializedResponse } from "../sync/sync-transfer";
import { HostVoiceToolDisclosure } from "../voice/voice-tool-disclosure";
import type { ServerBindings } from "./bindings";
import { endResponseAndAwaitWrite } from "./http-response-write";
import { assertResponseFits, HostResultTooLargeError } from "./http-result-limit";
import type { HttpToolRequest } from "./http-tool-context";
import {
  dispatchOwnerRpc,
  HostStoppingError,
  isInternalFailure,
  OwnerRpcCancelledError,
  OwnerRpcDeadlineError,
  ownerRpcDeadlineMs,
  slowRpcThresholdMs,
} from "./owner-rpc";
import { body, boundRequestReceive, REQUEST_RECEIVE_TIMEOUT_MS } from "./support";
import { handleAssistantObservationTools } from "./tools-assistant-observation";
import { handleConversationTools } from "./tools-conversation-redacted";
import { handleRuntimeLogsTools } from "./tools-runtime-logs";
import { handleSocialTools } from "./tools-social";
import { handleVoiceTools } from "./tools-voice";

/**
 * A request that names another environment. The structured code lets clients tell this apart
 * from unrelated errors that only mention "identity changed". The message text stays unchanged
 * for older clients that still match it.
 * shortcut: constant lives here until the shared protocol constants (#1082) own it.
 */
class HostIdentityMismatchError extends Error {
  readonly code = "HOST_IDENTITY_MISMATCH";
  constructor() {
    super("Host identity changed; reconnect this machine explicitly");
  }
}

export function createHttpRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "mcpHttp"
    | "mcpHub"
    | "socialTransport"
    | "webControl"
    | "lifecycle"
    | "controls"
    | "bulkHandler"
    | "mobilePairing"
    | "mobileIngressSecret"
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
    | "roomFiles"
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
    | "conversationSecrets"
    | "pullRequestWatchTools"
    | "pullRequestWatch"
    | "conversationProject"
    | "browserRuntime"
    | "workspace"
    | "runtimeLogs"
    | "runtimeLogWaiter"
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
    | "workspaceOwnerDeviceId"
    | "workspacePolicy"
    | "featureClaims"
    | "terminalService"
    | "terminals"
    | "nativeServiceUploads"
    | "desktopControl"
    | "desktopHelper"
    | "devServersService"
    | "environmentService"
    | "persistenceService"
    | "voiceCloud"
    | "localVoice"
    | "voiceSetup"
    | "pushDevices"
    | "pushNotifications"
    | "approvals"
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
    | "remoteActivity"
    | "invalidateSessionCopies"
    | "invalidateModelCatalog"
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
    | "mobileTailnet"
    | "tunnels"
    | "tunnelIngress"
    | "gitService"
    | "fileService"
    | "decisionModels"
    | "featureDirectory"
    | "accountPlatform"
  >,
) {
  let closing = false;
  const requests = new Set<Promise<void>>();
  // Signals of /rpc calls still in flight, aborted when the Host starts closing.
  const liveRequests = new Set<AbortController>();
  const serverOptions = {
    requestTimeout: REQUEST_RECEIVE_TIMEOUT_MS,
    headersTimeout: 10_000,
    maxHeaderSize: 8192,
  };
  const server = createServer(serverOptions, (request, response) => {
    if (closing) {
      response.writeHead(503).end(JSON.stringify({ error: "Host is stopping." }));
      return;
    }
    // Shorter receive window until the RPC credential is accepted (see disarmReceive below).
    const disarmReceive = boundRequestReceive(request);
    const trace = startRequestTrace("http");
    const inRequestScope = (work: () => Promise<void>) =>
      runWithRequestTrace(trace, () => dependencies.engine.store.db.outsideScope(work));
    const accepted = inRequestScope(async () => {
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
      // Public, credential-free identity preflight for account-discovered routes.
      // It discloses no device, account or workspace metadata and grants no access.
      if (
        request.method === "GET" &&
        request.url === "/.well-known/bycoda-host" &&
        !request.headers.origin
      ) {
        response
          .writeHead(200)
          .end(JSON.stringify({ environmentId: dependencies.engine.store.environmentId }));
        return;
      }
      // Receipt instant: every wait below, including FIFO storage queueing for the
      // credential check, is already spent from the request's own deadlines.
      const ingressAt = monotonicNow();
      let dispatchStarted: number | undefined;
      let dispatchMethod: unknown;
      let deviceEffectAdmitted = false;
      let releaseVoiceTool: (() => void) | undefined;
      let voiceDisclosure: HostVoiceToolDisclosure | undefined;
      let voiceBrowserOwner: string | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let liveAbort: AbortController | undefined;
      const resultScopeReleases: Array<() => void> = [];
      const resultScopeSettlements: Promise<void>[] = [];
      let voiceToolLog: HttpToolRequest["voiceToolLog"];
      let voiceToolFailure: ReturnType<typeof failureFields> | undefined;
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
            !(await dependencies.engine.store.authenticateIncomingDevice(credential)))
        ) {
          response.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" }).end(
            JSON.stringify({
              error: "Device credential is invalid or revoked",
            }),
          );
          return;
        }
        // Authority comes from the credential and the Host's own ingress, never the socket
        // address: every forwarder reaches this listener from loopback.
        const ingress = requestIngress(request, dependencies.mobileIngressSecret);
        const deviceAuthority =
          socialPrincipal || runtimePrincipal || conversationPrincipal || peerIdentity
            ? undefined
            : await dependencies.engine.store.deviceAuthority(credential);
        // Phones on the tunnel ingress were refused before any route ran.
        if (ingress === "invalid") {
          response
            .writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" })
            .end(JSON.stringify({ error: "Device credential is invalid or revoked" }));
          return;
        }
        // A paired device proves possession of its key on every request (never bearer alone).
        if (deviceAuthority) {
          const proof = checkDeviceProof({
            request,
            token: credential,
            environmentId: dependencies.engine.store.environmentId,
            ingress,
            binding: deviceAuthority.binding,
          });
          if (!proof.ok) {
            response
              .writeHead(401, {
                "Content-Type": "application/json",
                ...DEVICE_PROOF_REFUSAL_HEADERS,
              })
              .end(deviceProofRefusalBody(proof.reason));
            return;
          }
        }
        let token: string = credential;
        let tokenIdentity = dependencies.httpTokenHashes.get(request.socket);
        if (tokenIdentity?.token !== token) {
          tokenIdentity = { token, hash: createHash("sha256").update(token).digest("hex") };
          dependencies.httpTokenHashes.set(request.socket, tokenIdentity);
        }
        const tokenHash = tokenIdentity.hash;
        const pollState = { revoked: false };
        // Accepted credential: the upload may use the server's full receive window.
        disarmReceive();
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
        // Message is written for the connecting client's user: it names which
        // side to update instead of a bare "incompatible".
        const mismatch = protocolMismatchMessage(
          HOST_PROTOCOL_VERSION,
          typeof input.version === "number" ? input.version : Number.NaN,
        );
        if (mismatch) throw new Error(mismatch);
        if (
          input.method !== "environment.describe" &&
          input.environmentId !== dependencies.engine.store.environmentId
        )
          throw new HostIdentityMismatchError();
        let params =
          input.params && typeof input.params === "object" && !Array.isArray(input.params)
            ? (input.params as Record<string, unknown>)
            : {};
        const syncMethod =
          input.method === "sync.pull" || input.method === "sync.push" ? input.method : undefined;
        const syncCallId =
          typeof params.syncCallId === "string" && /^[a-z0-9-]{1,64}$/i.test(params.syncCallId)
            ? params.syncCallId
            : undefined;
        const syncTiming: NonNullable<ReturnType<typeof syncDbTiming.getStore>> = { dbWaitMs: 0 };
        let syncAdmittedAt = ingressAt;
        let syncHandlerMs = 0;
        let syncSerializationMs = 0;
        const syncTimings = () => ({
          receiveToAdmitMs: elapsedSince(ingressAt, syncAdmittedAt),
          dbWaitMs: syncTiming.dbWaitMs,
          handlerMs: Math.max(0, syncHandlerMs - syncTiming.dbWaitMs),
          serializationMs: syncSerializationMs,
          loopMaxRecentMs: perfMetrics.recentLoopMaxMs(),
        });
        const transportToken = token;
        const resultAuthorities: Array<() => Promise<boolean>> = [];
        // Handlers see one signal for the client hanging up before its answer was
        // written, the dispatcher's per-method deadline and the Host shutting down.
        const requestAbort = new AbortController();
        const signal = requestAbort.signal;
        liveAbort = requestAbort;
        liveRequests.add(requestAbort);
        if (closing) requestAbort.abort(new HostStoppingError());
        else if (response.destroyed) requestAbort.abort();
        else
          response.once("close", () => {
            if (!response.writableEnded) requestAbort.abort();
          });
        const deadlineMs = ownerRpcDeadlineMs(String(input.method), params);
        if (Number.isFinite(deadlineMs))
          deadline = setTimeout(
            () => requestAbort.abort(new DOMException("Host RPC deadline", "TimeoutError")),
            deadlineMs,
          );
        const domainContext = {
          ingressAt,
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
          requesterName: memoized(() => requestingDeviceName(dependencies.engine.store, token)),
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
          signal,
          closing: () => closing || response.destroyed,
        };
        // Scope the timer to dispatch, including all early returns and failures.
        // Never retain input/params or error contents in the metrics collector.
        dispatchStarted = performance.now();
        dispatchMethod = input.method;
        let result: unknown;
        const methodHasEffect = hostRpcHasEffect(
          String(input.method),
          getHostRpcMethod(String(input.method))?.kind ?? "unknown",
        );
        const endResult = async (
          value: unknown,
          verify?: () => Promise<void>,
          awaitWrite = false,
        ) => {
          const inline = serializedResponse(value);
          const serializationStartedAt = syncMethod ? monotonicNow() : 0;
          let body = voiceDisclosure
            ? await voiceDisclosure.body(value)
            : inline === undefined
              ? JSON.stringify({ result: value })
              : `{"result":${inline}}`;
          // A non-empty result object: append metadata without encoding its records again.
          if (syncMethod && body.endsWith("}}") && !body.endsWith("{}}")) {
            syncSerializationMs = elapsedSince(serializationStartedAt);
            body = `${body.slice(0, -2)},"timings":${JSON.stringify(syncTimings())}}}`;
          }
          // After authority: a revoked device gets its 401, never a size hint. Before any
          // write: the work is done and its receipt kept, so only the answer is withheld.
          await verify?.();
          assertResponseFits(body, methodHasEffect);
          if (awaitWrite || voiceDisclosure)
            await endResponseAndAwaitWrite(response, body, () => voiceDisclosure?.markSent());
          else response.end(body);
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
        if (
          await dependencies.mcpHttp.rpc(
            input.method,
            params,
            token,
            response,
            request.socket.remoteAddress,
          )
        )
          return;
        if (peerIdentity) {
          result = await dependencies.engine.store.db.withAuthorization(
            async () => !!(await dependencies.socialPeers.authenticated(transportToken)),
            () => dependencies.socialPeers.peerRpc(peerIdentity, String(input.method), params),
          );
          if (!(await dependencies.socialPeers.authenticated(token)))
            throw new Error("Peer authority revoked.");
          const peerBody = JSON.stringify({ result });
          assertResponseFits(peerBody, methodHasEffect);
          response.end(peerBody);
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
            get response() {
              return response;
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
        const dispatch = () =>
          dependencies.engine.store.db.withAuthorization(
            () => dependencies.engine.store.authenticated(token),
            async () => {
              const method = String(input.method);
              if (syncMethod) syncAdmittedAt = monotonicNow();
              // Only registered names are recorded; a held long poll is never a stall suspect.
              const done = trackRpc(
                getHostRpcMethod(method) ? method : "unknown",
                undefined,
                slowRpcThresholdMs(method, params) > slowRpcThresholdMs("", {}),
              );
              try {
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
                  thisComputer:
                    ingress === "direct" &&
                    !request.headers.origin &&
                    deviceAuthority?.localDesktop === true,
                  pollState,
                  response,
                  get closing() {
                    return closing;
                  },
                });
              } finally {
                if (syncMethod) syncHandlerMs = elapsedSince(syncAdmittedAt);
                done();
              }
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
        if (syncMethod) {
          try {
            await syncDbTiming.run(syncTiming, dispatch);
            await finishResult();
          } finally {
            const complete = () => {
              const totalMs = elapsedSince(ingressAt);
              if (totalMs >= 2_000)
                createLogger("host.sync").warn("slow call", {
                  method: syncMethod,
                  callId: syncCallId,
                  totalMs,
                  ...syncTimings(),
                });
            };
            if (signal.aborted && syncTiming.work) {
              const completeAfterAbort = () => {
                syncHandlerMs = elapsedSince(syncAdmittedAt);
                complete();
              };
              void syncTiming.work
                .then(completeAfterAbort, completeAfterAbort)
                .catch(() => undefined);
            } else complete();
          }
        } else {
          await dispatch();
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
        }
      } catch (error) {
        if (voiceToolLog) {
          voiceToolLog.outcome = "error";
          voiceToolFailure = failureFields(error);
        }
        const internal = isInternalFailure(error);
        if (!response.destroyed && !response.headersSent)
          response
            .writeHead(
              error instanceof OwnerRpcDeadlineError
                ? 504
                : error instanceof HostStoppingError
                  ? 503
                  : error instanceof RequestAuthorizationError ||
                      error instanceof HostDomainAuthorizationError ||
                      (error instanceof HostDomainOutcomeError &&
                        (error.cause instanceof RequestAuthorizationError ||
                          error.cause instanceof HostDomainAuthorizationError))
                    ? 401
                    : internal
                      ? 500
                      : 400,
            )
            .end(
              JSON.stringify({
                error: !internal && error instanceof Error ? error.message : "Host request failed",
                ...(deviceEffectAdmitted
                  ? { code: "HOST_DEVICE_OPERATION_UNCONFIRMED", delivery: "unknown" }
                  : error instanceof OwnerRpcDeadlineError || error instanceof HostStoppingError
                    ? { code: error.code, delivery: error.delivery }
                    : error instanceof HostDomainOutcomeError
                      ? { delivery: error.delivery }
                      : error instanceof OwnerRpcCancelledError ||
                          error instanceof HostDbClosingError
                        ? { code: error.code }
                        : {}),
                ...(error instanceof HostIdentityMismatchError ? { code: error.code } : {}),
                // An admitted device effect keeps its own unconfirmed code above.
                ...(error instanceof HostResultTooLargeError && !deviceEffectAdmitted
                  ? {
                      code: error.code,
                      maxBytes: error.maxBytes,
                      ...(error.effect ? { delivery: "unknown" } : {}),
                    }
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
        clearTimeout(deadline);
        if (liveAbort) liveRequests.delete(liveAbort);
        for (const release of resultScopeReleases) release();
        await Promise.allSettled(resultScopeSettlements);
        if (voiceToolLog)
          console.info("Voice tool", {
            action: voiceToolLog.action,
            requestId: voiceToolLog.requestId,
            elapsedMs: elapsedSince(voiceToolLog.startedAt),
            ...(voiceToolLog.stage ? { stage: voiceToolLog.stage } : {}),
            ...voiceToolFailure,
            outcome:
              response.destroyed && !response.writableEnded ? "disconnected" : voiceToolLog.outcome,
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
  });
  // Public tunnels reach the Host only through this second loopback listener, so a tunnelled
  // request is never mistaken for this computer. It opens and closes with the Host.
  const tunnelIngress = createTunnelIngress(
    server,
    serverOptions,
    // Phones use a public tunnel only when the owner allowed it; read per request.
    refusesPhoneOnTunnel(
      () => dependencies.tunnels.allowsPhonesOverPublic(),
      async (token) => (await dependencies.engine.store.deviceAuthority(token))?.kind,
    ),
  );
  server.once("listening", () => {
    void tunnelIngress.listen().catch((error: unknown) => {
      createLogger("host.http").warn("tunnel ingress failed", failureFields(error));
    });
  });
  server.once("close", () => void tunnelIngress.close().catch(() => undefined));
  // Node's 5 s default equals the desktop's idle heartbeat, so the desktop reused sockets
  // the Host was just closing and reported a healthy Host as unreachable. Clients poll
  // far more often than this; an idle socket costs nothing on loopback.
  server.keepAliveTimeout = 65_000;
  return {
    get closing() {
      return closing;
    },
    /**
     * Shutdown aborts every /rpc call in flight with `HostStoppingError`, so held polls and
     * unbounded methods answer 503 after the stop grace instead of holding the drain.
     */
    set closing(value: typeof closing) {
      closing = value;
      if (value) for (const live of liveRequests) live.abort(new HostStoppingError());
    },
    requests,
    server,
    tunnelIngress,
  };
}
