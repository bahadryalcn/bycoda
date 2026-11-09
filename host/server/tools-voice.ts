import { randomUUID } from "node:crypto";
import { monotonicNow } from "../../src/shared/lib/time/timestamps";
import { voiceGlobalToolAllowed } from "../../src/shared/model/voiceToolScope";
import { isAssistantObservationAction } from "../assistant/observations/assistant-observation-tools";
import { isRoomNotebookAction } from "../assistant/room/assistant-room-notebook";
import { isGlobalRuntimeRead } from "../conversation/conversation-management-runtime";
import { isManagementAction } from "../conversation/conversation-management-tools";
import { managedDiscoveryResult, managedMcpCatalog } from "../mcp/mcp-http";
import { serializedResponse } from "../sync/sync-transfer";
import { HostVoiceToolDisclosure } from "../voice/voice-tool-disclosure";
import { voiceToolsForScope } from "../voice/voice-tool-scope";
import {
  parseVoiceToolCall,
  prepareVoiceToolDispatch,
  validateVoiceToolList,
} from "../voice/voice-tools";
import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
export async function handleVoiceTools(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "assistant"
    | "featureMeta"
    | "social"
    | "assistantPorts"
    | "executeAccountSocial"
    | "roomNotebook"
    | "conversationManagementRuntime"
    | "conversationDesktop"
    | "globalServerManagement"
    | "globalAssistantManagement"
    | "withRoomProjectScope"
    | "conversationAccess"
    | "runtimeLogAccess"
  >,
  request: Pick<
    HttpToolRequest,
    | "request"
    | "socialPrincipal"
    | "runtimePrincipal"
    | "conversationPrincipal"
    | "token"
    | "input"
    | "params"
    | "response"
    | "voiceToolLog"
    | "voiceDisclosure"
    | "tokenHash"
    | "endResult"
    | "result"
    | "releaseVoiceTool"
    | "voiceBrowserOwner"
  >,
) {
  // Voice is an owner-started desktop surface, never an escalation route
  // for a provider, social peer or browser-origin request.
  if (
    request.request.headers.origin ||
    request.socialPrincipal ||
    request.runtimePrincipal ||
    request.conversationPrincipal ||
    !(await dependencies.engine.store.authenticated(request.token))
  )
    throw new Error("Native owner device required for voice tools.");
  const ownerToken = request.token;
  if (request.input.method === "voice.tools.list") {
    validateVoiceToolList(request.params);
    const project =
      request.params.projectId === undefined
        ? undefined
        : await dependencies.engine.store.project(String(request.params.projectId));
    if (!project) {
      const thread = await dependencies.assistant.threadBinding(String(request.params.threadId));
      if (!thread || thread.id !== request.params.threadId || thread.projectId)
        throw new Error("A verified global assistant thread is required.");
    }
    if (request.params.sessionId !== undefined) {
      const own = await dependencies.featureMeta(String(request.params.sessionId));
      if (!project || own.projectId !== project.id)
        throw new Error("Voice tool session belongs to another project.");
    }
    if (!(await dependencies.engine.store.authenticated(ownerToken)))
      throw new Error("Native owner authority revoked.");
    const tools = voiceToolsForScope({
      ...(project ? { projectId: project.id } : {}),
      ...(request.params.threadId === undefined
        ? {}
        : { threadId: String(request.params.threadId) }),
      ...(request.params.sessionId === undefined
        ? {}
        : { sessionId: String(request.params.sessionId) }),
    });
    request.response.end(JSON.stringify({ result: { tools } }));
    return true;
  }
  const call = parseVoiceToolCall(request.params);
  request.voiceToolLog = {
    action: call.action,
    requestId: call.requestId ?? null,
    startedAt: monotonicNow(),
    outcome: "response",
  };
  console.info("Voice tool started", {
    action: request.voiceToolLog.action,
    requestId: request.voiceToolLog.requestId,
  });
  if (call.causalContextId) {
    request.voiceDisclosure = new HostVoiceToolDisclosure(
      {
        authorized: async () =>
          !request.response.destroyed &&
          (await dependencies.engine.store.authenticated(ownerToken)),
        begin: (input) => dependencies.assistant.beginVoiceToolDisclosure(input),
        finish: (id, source) => dependencies.assistant.finishVoiceToolDisclosure(id, source),
        fail: (id) => dependencies.assistant.failVoiceToolDisclosure(id),
      },
      serializedResponse,
    );
    await request.voiceDisclosure.begin(call.causalContextId, call.requestId!);
    request.response.once("close", () => {
      void request.voiceDisclosure?.fail().catch(() => undefined);
    });
  }
  if (
    !call.projectId &&
    (call.family === "social" ||
      (call.family === "conversation" &&
        isAssistantObservationAction(call.action) &&
        call.accountId))
  ) {
    if (
      !call.causalContextId ||
      !call.threadId ||
      !call.requestId ||
      !request.voiceDisclosure ||
      !dependencies.social.retireAssistantVoiceGenerations
    )
      throw new Error(
        "Account-scoped voice disclosure is unavailable until the active voice generation can be revoked.",
      );
    const authorized = async () =>
      !request.response.destroyed && !!(await dependencies.engine.store.authenticated(ownerToken));
    const admission = {
      environmentId: dependencies.engine.store.environmentId,
      deviceHash: request.tokenHash,
      authorized,
    };
    const generation = await dependencies.assistant.pendingVoiceGeneration(
      call.causalContextId,
      call.requestId,
      call.threadId,
    );
    const qualifiedCall = {
      threadId: call.threadId,
      ...(call.accountId ? { accountId: call.accountId } : {}),
      family: call.family,
      action: call.action,
      input: call.input,
      requestId: call.requestId,
    };
    request.voiceDisclosure.bind({
      threadId: call.threadId,
      ...(call.accountId ? { accountId: call.accountId } : {}),
      family: call.family,
      action: call.action,
    });
    const output = await dependencies.assistantPorts.roomManagement!(qualifiedCall, admission);
    const proofs = output.contributorAccounts;
    if (!proofs || (call.accountId && !proofs.some((proof) => proof.accountId === call.accountId)))
      throw new Error("Room account provenance is unavailable.");
    request.voiceDisclosure.bindAccountProofs(proofs);
    await dependencies.social.withAssistantAccountProofs(
      call.threadId,
      proofs,
      authorized,
      async (valid) => {
        if (proofs.length)
          await dependencies.social.registerAssistantVoiceLease(
            {
              threadId: call.threadId!,
              generationKey: generation.generationKey,
              deviceHash: request.tokenHash,
              accounts: proofs,
            },
            valid,
          );
        if (!valid()) throw new Error("Room account scope revoked.");
        await request.endResult(
          output.value,
          async () => {
            if (!(await authorized())) throw new Error("Native owner authority revoked.");
          },
          true,
        );
        await dependencies.assistantPorts.roomObservationDelivered?.(
          call.threadId!,
          [{ source: output.source, value: output.value }],
          proofs,
          valid,
        );
      },
    );
    return true;
  }
  if (
    call.family === "conversation" &&
    isAssistantObservationAction(call.action) &&
    (call.input.nativeLibrary === true || call.input.source === "native-session")
  ) {
    const nativeSession = call.input.source === "native-session";
    if (
      !call.threadId ||
      !call.requestId ||
      !call.causalContextId ||
      !request.voiceDisclosure ||
      call.accountId ||
      (nativeSession ? !call.projectId : !!call.projectId)
    )
      throw new Error(
        "Native observation voice disclosure requires the original Room and active voice generation.",
      );
    const authorized = async () =>
      !request.response.destroyed && !!(await dependencies.engine.store.authenticated(ownerToken));
    const admission = {
      environmentId: dependencies.engine.store.environmentId,
      deviceHash: request.tokenHash,
      authorized,
    };
    const qualifiedCall = {
      threadId: call.threadId,
      ...(call.projectId ? { projectId: call.projectId } : {}),
      family: "conversation" as const,
      action: call.action,
      input: call.input,
      requestId: call.requestId,
    };
    const generation = await dependencies.assistant.pendingVoiceGeneration(
      call.causalContextId,
      call.requestId,
      call.threadId,
    );
    request.voiceDisclosure.bind({
      threadId: call.threadId,
      ...(call.projectId ? { projectId: call.projectId } : {}),
      family: call.family,
      action: call.action,
      nativeLibrary: true,
    });
    const output = await dependencies.assistantPorts.roomManagement!(qualifiedCall, admission);
    const nativeProofs = output.contributorNativeProofs;
    if (!nativeProofs?.length) throw new Error("Native library provenance is unavailable.");
    request.voiceDisclosure.bindNativeProofs(nativeProofs);
    const projectProofs = output.contributorProjects ?? [];
    if (nativeSession && !projectProofs.some((proof) => proof.projectId === call.projectId))
      throw new Error("Native session project provenance is unavailable.");
    if (projectProofs.length) request.voiceDisclosure.bindProjectProofs(projectProofs);
    await dependencies.assistantPorts.withNativeVoiceRuntimeRegistration!(
      {
        threadId: call.threadId,
        generationKey: generation.generationKey,
        nativeProofs,
        projectProofs,
        accountProofs: [],
      },
      admission,
      async (valid) => {
        if (!valid()) throw new Error("Native library scope revoked.");
        await request.endResult(
          output.value,
          async () => {
            if (!(await authorized()) || !valid())
              throw new Error("Native owner authority revoked.");
          },
          true,
        );
        await dependencies.assistantPorts.roomObservationDelivered?.(
          call.threadId!,
          [{ source: output.source, value: output.value }],
          [],
          valid,
          projectProofs,
          nativeProofs,
        );
      },
    );
    return true;
  }
  if (call.family === "conversation" && isAssistantObservationAction(call.action)) {
    if (!call.threadId || !call.requestId || !!call.projectId === !!call.accountId)
      throw new Error("Choose one verified observation scope and a Room thread.");
    const authorized = async () =>
      !request.response.destroyed && !!(await dependencies.engine.store.authenticated(ownerToken));
    const admission = {
      environmentId: dependencies.engine.store.environmentId,
      deviceHash: request.tokenHash,
      authorized,
    };
    const qualifiedCall = {
      threadId: call.threadId,
      ...(call.projectId ? { projectId: call.projectId } : {}),
      ...(call.accountId ? { accountId: call.accountId } : {}),
      family: "conversation" as const,
      action: call.action,
      input: call.input,
      requestId: call.requestId,
    };
    request.voiceDisclosure?.bind({
      threadId: call.threadId,
      ...(call.projectId ? { projectId: call.projectId } : {}),
      ...(call.accountId ? { accountId: call.accountId } : {}),
      family: call.family,
      action: call.action,
    });
    const output = await dependencies.assistantPorts.roomManagement!(qualifiedCall, admission);
    const send = () =>
      request.endResult(
        output.value,
        async () => {
          if (!(await authorized())) throw new Error("Native owner authority revoked.");
        },
        true,
      );
    if (call.projectId) {
      request.voiceDisclosure?.bindProjectProofs(output.contributorProjects ?? []);
      const projectProofs = output.contributorProjects ?? [];
      const projects = [
        ...new Set([call.projectId, ...projectProofs.map((proof) => proof.projectId)]),
      ];
      await dependencies.assistantPorts.withRoomProjectDisclosure!(
        call.threadId,
        projects,
        admission,
        async (valid) => {
          if (!valid()) throw new Error("Room project scope revoked.");
          await send();
          await dependencies.assistantPorts.roomObservationDelivered?.(
            call.threadId!,
            [{ source: output.source, value: output.value }],
            [],
            valid,
            projectProofs,
          );
        },
        projectProofs,
      );
    } else {
      if (!output.contributorAccounts?.some((proof) => proof.accountId === call.accountId))
        throw new Error("Room account provenance is unavailable.");
      await dependencies.social.withAssistantAccountProofs(
        call.threadId,
        output.contributorAccounts,
        authorized,
        async (valid) => {
          if (!valid()) throw new Error("Room account scope revoked.");
          await send();
        },
      );
    }
    return true;
  }
  if (!call.projectId) {
    const authorizeGlobal = async () => {
      if (
        request.response.destroyed ||
        !(await dependencies.engine.store.authenticated(ownerToken))
      )
        return false;
      const thread = await dependencies.assistant.threadBinding(call.threadId!);
      return !!thread && thread.id === call.threadId && !thread.projectId;
    };
    if (!voiceGlobalToolAllowed(call.family, call.action) || !(await authorizeGlobal()))
      throw new Error(
        "A verified global assistant thread and supported global operation are required.",
      );
    request.voiceDisclosure?.bind({
      threadId: call.threadId,
      ...(call.accountId ? { accountId: call.accountId } : {}),
      family: call.family,
      action: call.action,
    });
    if (call.family === "social") {
      if (call.accountId)
        request.result = await dependencies.executeAccountSocial(
          {
            ...call,
            threadId: call.threadId!,
            accountId: call.accountId,
            requestId: call.requestId!,
          },
          request.tokenHash,
          authorizeGlobal,
        );
      else if (call.action === "accounts.list")
        request.result = await dependencies.social.listAssistantAccounts(
          call.threadId!,
          request.tokenHash,
          call.input,
        );
      else throw new Error("Choose an explicitly granted social account.");
    } else if (isRoomNotebookAction(call.action))
      request.result = await dependencies.roomNotebook.call(
        call.action,
        call.input,
        {
          kind: "assistant-thread",
          threadId: call.threadId!,
          environmentId: dependencies.engine.store.environmentId,
        },
        authorizeGlobal,
        call.requestId!,
      );
    else if (isGlobalRuntimeRead(call.action))
      request.result = await dependencies.conversationManagementRuntime.call(
        call.action as import("../conversation/conversation-management-runtime").RuntimeManagementAction,
        call.input,
        {
          kind: "assistant-thread",
          threadId: call.threadId!,
          environmentId: dependencies.engine.store.environmentId,
        },
        authorizeGlobal,
      );
    else if (call.action === "tools.list")
      request.result = {
        environmentId: dependencies.engine.store.environmentId,
        tools: voiceToolsForScope({}),
      };
    else if (["tools.search", "tools.describe", "tools.status"].includes(call.action))
      request.result = managedDiscoveryResult(call.action, call.input, managedMcpCatalog());
    else if (
      [
        "servers.list",
        "servers.get",
        "servers.ssh.execute",
        "servers.ssh.status",
        "servers.ssh.cancel",
      ].includes(call.action)
    )
      request.result = await dependencies.conversationDesktop.callAssistantThread(
        call.action,
        call.input,
        { threadId: call.threadId!, environmentId: dependencies.engine.store.environmentId },
        authorizeGlobal,
      );
    else if (call.action === "servers.ssh.save" || call.action === "servers.ssh.remove") {
      if (
        typeof call.input.operationId !== "string" ||
        !call.input.operationId ||
        typeof call.input.expectedInventoryRevision !== "string" ||
        !/^[a-f0-9]{64}$/.test(call.input.expectedInventoryRevision)
      )
        throw new Error(
          "Read the server inventory and provide its revision and a stable operationId.",
        );
      request.result = await dependencies.globalServerManagement.call(
        call.action,
        { requestId: call.input.operationId, serverInput: call.input },
        {
          kind: "assistant-thread",
          threadId: call.threadId!,
          environmentId: dependencies.engine.store.environmentId,
        },
        authorizeGlobal,
      );
    } else {
      if (!isManagementAction(call.action))
        throw new Error("Unsupported global assistant operation.");
      request.result = await dependencies.globalAssistantManagement.call(
        call.action,
        call.input,
        {
          kind: "assistant-thread",
          threadId: call.threadId!,
          environmentId: dependencies.engine.store.environmentId,
        },
        authorizeGlobal,
      );
    }
    await request.endResult(request.result, async () => {
      if (!(await authorizeGlobal())) throw new Error("Native owner authority revoked.");
    });
    return true;
  }
  if (
    call.threadId &&
    !call.sessionId &&
    !(call.family === "conversation" && call.action === "desktop.status")
  ) {
    const inputRequestId =
      typeof call.input.requestId === "string"
        ? call.input.requestId
        : typeof call.input.operationId === "string"
          ? call.input.operationId
          : undefined;
    const readOnly =
      /(?:^|\.)(?:list|get|read|status|search|describe|inspect|runs|schema|sources)$/.test(
        call.action,
      );
    if (!call.requestId && !inputRequestId && !readOnly)
      throw new Error("A stable Room operation identity is required.");
    const requestId = call.requestId ?? inputRequestId ?? randomUUID();
    // Normal completion retires the socket too. Preserve authority
    // through final lease settlement while rejecting premature close.
    const authorized = async () =>
      (!request.response.destroyed || request.response.writableFinished) &&
      !!(await dependencies.engine.store.authenticated(ownerToken));
    const qualifiedCall = {
      threadId: call.threadId,
      projectId: call.projectId,
      family: call.family,
      action: call.action,
      input: call.input,
      requestId,
    };
    request.voiceDisclosure?.bind({
      threadId: call.threadId,
      projectId: call.projectId,
      family: call.family,
      action: call.action,
    });
    const output = await dependencies.assistantPorts.roomManagement!(qualifiedCall, {
      environmentId: dependencies.engine.store.environmentId,
      deviceHash: request.tokenHash,
      authorized,
    });
    request.voiceDisclosure?.bindProjectProofs(output.contributorProjects ?? []);
    await dependencies.withRoomProjectScope(qualifiedCall, authorized, async () => {
      if (
        !output.source.projectCwd ||
        (await dependencies.engine.store.project(call.projectId!)).cwd !== output.source.projectCwd
      )
        throw new Error("Voice project identity changed before disclosure.");
      await request.endResult(output.value, async () => {
        if (!(await authorized())) throw new Error("Native owner authority revoked.");
      });
      if (!request.response.writableFinished)
        await new Promise<void>((resolve, reject) => {
          request.response.once("finish", resolve);
          request.response.once("close", () =>
            request.response.writableFinished
              ? resolve()
              : reject(new Error("Voice response delivery is unknown.")),
          );
        });
    });
    return true;
  }
  const delegated = await prepareVoiceToolDispatch(request.params, {
    authorized: async () =>
      !request.response.destroyed && (await dependencies.engine.store.authenticated(ownerToken)),
    environmentId: dependencies.engine.store.environmentId,
    deviceHash: request.tokenHash,
    threadIdentity: (id) => dependencies.assistant.threadBinding(id),
    sessionIdentity: async (sessionId) => {
      const own = await dependencies.featureMeta(sessionId);
      await dependencies.engine.store.project(own.projectId);
      return { projectId: own.projectId, provider: own.session.harness };
    },
    issuers: {
      conversation: dependencies.conversationAccess,
      social: dependencies.social,
      "runtime-logs": dependencies.runtimeLogAccess,
    },
  });
  request.releaseVoiceTool = delegated.release;
  request.voiceDisclosure?.bind(delegated.source);
  request.voiceBrowserOwner = delegated.browserOwner;
  request.response.once("close", delegated.release);
  if (request.response.destroyed) {
    delegated.release();
    throw new Error("Voice tool connection closed.");
  }
  request.token = delegated.token;
  request.input.method = delegated.method;
  request.params = delegated.params;
  if (delegated.family === "conversation")
    request.conversationPrincipal = await dependencies.conversationAccess.principalForToken(
      request.token,
    );
  else if (delegated.family === "social")
    request.socialPrincipal = await dependencies.social.principalForToken(request.token);
  else
    request.runtimePrincipal = await dependencies.runtimeLogAccess.principalForToken(request.token);

  return false;
}
