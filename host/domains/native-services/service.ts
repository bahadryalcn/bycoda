import {
  NATIVE_SERVICES_RPC_SCHEMAS,
  NativeAssistantBrowserPanelParamsSchema,
  type NativeServiceMethod,
} from "../../../src/shared/model/host-contracts/native-services";
import {
  assertDomainAuthority,
  HostDomainAuthorizationError,
  type HostDomainContext,
} from "../context";

// Existing HTTP names are mapped only inside this owner domain service.
const NATIVE_SERVICE_LEGACY_METHODS = Object.freeze({
  "runtimeLogs.bridge.describe": "native.services.runtimeLogs.bridge.describe",
  "runtimeLogs.access.issue": "native.services.runtimeLogs.access.issue",
  "runtimeLogs.terminals.append": "native.services.runtimeLogs.terminals.append",
  "conversation.bridge.describe": "native.services.conversation.bridge.describe",
  "conversation.access.issue": "native.services.conversation.access.issue",
  "conversation.desktop.take": "native.services.conversation.desktop.take",
  "conversation.desktop.finish": "native.services.conversation.desktop.finish",
  "conversation.desktop.authorize": "native.services.conversation.desktop.authorize",
  "social.bridge.describe": "native.services.social.bridge.describe",
  "social.access.issue": "native.services.social.access.issue",
  "social.native.status": "native.services.social.native.status",
  "social.native.enroll": "native.services.social.native.enroll",
  "social.native.register": "native.services.social.native.register",
  "social.native.authority": "native.services.social.native.authority",
  "social.native.reset": "native.services.social.native.reset",
} as const);

export function createNativeServicesService() {
  const call = async (
    method: NativeServiceMethod,
    raw: Record<string, unknown>,
    context: HostDomainContext,
    options: { legacy?: boolean } = {},
  ) => {
    await assertDomainAuthority(context);
    const owner = context.nativeServices;
    if (!owner) throw new HostDomainAuthorizationError();
    // Desktop authorization has always rejected unknown keys, even on HTTP.
    const params: Record<string, unknown> =
      options.legacy &&
      method !== "native.services.conversation.desktop.authorize" &&
      method !== "native.services.desktop.stop" &&
      method !== "native.services.desktop.status"
        ? raw
        : NATIVE_SERVICES_RPC_SCHEMAS[method].params.parse(raw);
    let result: unknown;
    if (method.startsWith("native.services.assistant.delegation.")) {
      if (!owner.delegation) throw new Error("Native Room delegation is unavailable.");
      const action = method.slice("native.services.assistant.delegation.".length) as
        | "publicKey"
        | "origin"
        | "nativeChallenge"
        | "attest"
        | "issue"
        | "issue.status"
        | "challenge"
        | "call"
        | "revoke";
      result = await owner.delegation(action, (params.input ?? {}) as Record<string, unknown>);
    } else if (method === "native.services.assistant.visibility.epoch") {
      if (!owner.visibilityEpoch) throw new Error("Native visibility fence is unavailable.");
      result = await owner.visibilityEpoch();
    } else if (method === "native.services.assistant.notification.authorize") {
      if (!owner.authorizeAssistantNotification)
        throw new Error("Assistant notification authorization is unavailable.");
      const input = params.input as {
        threadId: string;
        notificationId: string;
        operationHash: string;
      };
      if (
        !input.threadId ||
        input.threadId.length > 200 ||
        !input.notificationId ||
        input.notificationId.length > 200 ||
        !/^[a-f0-9]{64}$/.test(input.operationHash)
      )
        throw new Error("Invalid Assistant notification authorization identity.");
      result = await owner.authorizeAssistantNotification(input);
    } else if (method === "native.services.assistant.browser.panel") {
      if (!owner.browserPanel) throw new Error("Room browser panel transport is unavailable.");
      result = await owner.browserPanel(NativeAssistantBrowserPanelParamsSchema.parse(params));
    } else if (method === "native.services.assistant.observations.ingest") {
      if (!owner.observationsIngest) throw new Error("Native observation owner is unavailable.");
      result = await owner.observationsIngest(params.input as Record<string, unknown>);
    } else if (method === "native.services.assistant.workspace.authorize") {
      if (!owner.authorizeAssistantWorkspace)
        throw new Error("Assistant workspace authorization is unavailable.");
      const input = params.input as { threadId: string; requestId: string; operationHash: string };
      if (
        !input.threadId ||
        input.threadId.length > 200 ||
        !input.requestId ||
        input.requestId.length > 200 ||
        !/^[a-f0-9]{64}$/.test(input.operationHash)
      )
        throw new Error("Invalid Assistant workspace authorization identity.");
      result = await owner.authorizeAssistantWorkspace(input);
    } else if (method === "native.services.assistant.visibility.revoke") {
      if (!owner.visibilityRevoke) throw new Error("Native visibility fence is unavailable.");
      result = await owner.visibilityRevoke();
    } else if (method === "native.services.assistant.visibility.reopen") {
      if (!owner.visibilityReopen) throw new Error("Native visibility fence is unavailable.");
      result = await owner.visibilityReopen(params.input as Record<string, unknown>);
    } else if (method === "native.services.assistant.presence.get") {
      if (!owner.assistantPresence) throw new Error("Native assistant presence is unavailable.");
      result = await owner.assistantPresence();
    } else if (method === "native.services.assistant.presence.set") {
      if (!owner.setAssistantPresence) throw new Error("Native assistant presence is unavailable.");
      result = await owner.setAssistantPresence(params.state as "present" | "away" | "dnd");
    } else if (method === "native.services.desktop.status") {
      if (!owner.desktopStatus) throw new Error("Native desktop status is unavailable.");
      result = await owner.desktopStatus();
    } else if (method === "native.services.desktop.status.wait") {
      if (!owner.waitDesktopStatus) throw new Error("Native desktop status wait is unavailable.");
      result = await owner.waitDesktopStatus(String(params.afterRevision), Number(params.timeoutMs), context.signal);
    } else if (method === "native.services.desktop.stop") {
      if (!owner.stopDesktop) throw new Error("Native desktop Stop is unavailable.");
      result = await owner.stopDesktop();
    } else if (method.endsWith(".bridge.describe"))
      result = await owner.describe(
        method.includes("runtimeLogs")
          ? "runtime-logs"
          : method.includes("conversation")
            ? "conversation"
            : "social",
      );
    else if (method.endsWith(".access.issue"))
      result = await owner.issue(
        method.includes("runtimeLogs")
          ? "runtime-logs"
          : method.includes("conversation")
            ? "conversation"
            : "social",
        String(params.sessionId ?? ""),
        params.expectedScope,
      );
    else if (method === "native.services.runtimeLogs.terminals.append")
      result = await owner.appendTerminal(params);
    else if (method === "native.services.conversation.desktop.take")
      result = await owner.desktop.take();
    else if (method === "native.services.conversation.desktop.finish")
      result = await owner.desktop.finish(
        String(params.id ?? ""),
        params.result,
        typeof params.error === "string" ? params.error : undefined,
      );
    else if (method === "native.services.conversation.desktop.authorize")
      result = await owner.desktop.authorize(String(params.id), String(params.action));
    else if (method === "native.services.social.native.status")
      result = await owner.social.status();
    else if (method === "native.services.social.native.enroll")
      result = await owner.social.enroll(String(params.environmentId ?? ""));
    else if (method === "native.services.social.native.register")
      result = await owner.social.register(params);
    else if (method === "native.services.social.native.authority")
      result = await owner.social.authority(params);
    else if (method === "native.services.social.native.reset") result = await owner.social.reset();
    else result = await owner.format(params);
    await assertDomainAuthority(context);
    return result ?? null;
  };
  return {
    call,
    legacy(
      method: keyof typeof NATIVE_SERVICE_LEGACY_METHODS,
      params: Record<string, unknown>,
      context: HostDomainContext,
    ) {
      return call(NATIVE_SERVICE_LEGACY_METHODS[method], params, context, { legacy: true });
    },
  };
}
