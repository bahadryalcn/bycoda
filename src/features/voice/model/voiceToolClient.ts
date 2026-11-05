import {
  captureVoiceToolHost,
  featureHost,
  hostFeatureRequest,
} from "../../connections/model/hostFeatureClient";
import { remoteRequest, remoteSessionFor } from "../../connections/model/connections";
import {
  AssistantVoiceDisclosureSchema,
  type AssistantVoiceDisclosureSource,
} from "../../../shared/model/assistantVoiceContext";
import {
  isVoiceToolFamily,
  readVoiceToolCatalog,
  VOICE_TOOL_ACTION,
  selectVoiceTools,
  type VoiceToolFamily,
  type VoiceToolSelection,
} from "./voiceToolCatalog";

/** The app captures this context; model arguments never choose the source authority. */
export type VoiceToolTarget = {
  cwd: string;
  sessionId?: string;
  threadId?: string;
  environmentId?: string;
  causalContext?: {
    id: string;
    environmentId?: string;
    receive: (
      context: unknown,
      disclosure: unknown,
      requestId: string,
      expectedSource?: AssistantVoiceDisclosureSource,
    ) => void;
  };
};
export type VoiceToolCall = {
  family: VoiceToolFamily;
  action: string;
  accountId?: string;
  input: Record<string, unknown>;
  /** Reuse for an uncertain invocation. Individual tool schemas may also require an input requestId. */
  requestId?: string;
};

export const VOICE_TOOLS_CAPABILITY = "voice.tools.v1";

function source(target: VoiceToolTarget): { sessionId?: string; threadId?: string } {
  if (!target.cwd.trim() && !target.threadId)
    throw new Error("Open a verified assistant conversation before using tools.");
  if (!target.cwd.trim() && target.sessionId !== undefined)
    throw new Error("A coding session requires its exact project target.");
  if (target.sessionId !== undefined && (!target.sessionId.trim() || target.sessionId.length > 300))
    throw new Error("The voice tool session is invalid.");
  const sessionId =
    target.sessionId && target.cwd.startsWith("remote://")
      ? (remoteSessionFor(target.sessionId) ?? target.sessionId)
      : target.sessionId;
  if (target.threadId !== undefined && (!target.threadId.trim() || target.threadId.length > 200))
    throw new Error("The assistant thread identity is invalid.");
  if (
    target.causalContext &&
    (target.cwd.startsWith("remote://") ||
      !target.threadId ||
      !target.causalContext.id.trim() ||
      target.causalContext.id.length > 200)
  )
    throw new Error("The voice tool result could not be verified. Check its original operation.");
  if (target.cwd.startsWith("remote://") && !sessionId)
    throw new Error("Open a session on this Host before using project tools.");
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(!target.cwd.startsWith("remote://") && target.threadId
      ? { threadId: target.threadId }
      : {}),
  };
}

/** Never caches permission-sensitive catalogs across sessions, projects or reconnects. */
export async function discoverVoiceTools(
  target: VoiceToolTarget,
  selection: VoiceToolSelection = {},
) {
  const context = source(target);
  if (!target.cwd.trim()) {
    const host = await captureVoiceToolHost(target.environmentId);
    const response = await host.request<unknown>("voice.tools.list", context);
    return selectVoiceTools(readVoiceToolCatalog(response), selection);
  }
  const response = await hostFeatureRequest<unknown>(
    target.cwd,
    VOICE_TOOLS_CAPABILITY,
    "voice.tools.list",
    context,
  );
  return selectVoiceTools(readVoiceToolCatalog(response), selection);
}

/** No success conversion and no automatic retries: accepted/queued/uncertain remain distinct. */
export async function callVoiceTool(
  target: VoiceToolTarget,
  call: VoiceToolCall,
): Promise<unknown> {
  const context = source(target);
  if (
    !isVoiceToolFamily(call.family) ||
    !VOICE_TOOL_ACTION.test(call.action) ||
    call.action.length > 200 ||
    !call.input ||
    typeof call.input !== "object" ||
    Array.isArray(call.input) ||
    (call.requestId !== undefined && (!call.requestId.trim() || call.requestId.length > 300)) ||
    (target.causalContext && !call.requestId) ||
    (call.accountId !== undefined &&
      (!(
        call.family === "social" ||
        (call.family === "conversation" &&
          ["observations.read", "observations.ack", "observations.resnapshot"].includes(
            call.action,
          ))
      ) ||
        !!target.cwd.trim() ||
        !call.accountId.trim() ||
        call.accountId.length > 200)) ||
    (!target.cwd.trim() &&
      call.family === "social" &&
      call.action !== "accounts.list" &&
      !call.accountId)
  )
    throw new Error("The voice tool request is invalid.");
  const params = {
    ...context,
    family: call.family,
    action: call.action,
    ...(call.accountId ? { accountId: call.accountId } : {}),
    input: call.input,
    ...(call.requestId === undefined ? {} : { requestId: call.requestId }),
    ...(target.causalContext ? { causalContextId: target.causalContext.id } : {}),
  };
  // Capture the exact transport subject once; a later cache refresh must not
  // route this operation to a replacement Host/project while proof is pending.
  let expectedSource: AssistantVoiceDisclosureSource | undefined;
  const result = !target.cwd.trim()
    ? await (async () => {
        const bound = await captureVoiceToolHost(
          target.causalContext?.environmentId ?? target.environmentId,
        );
        expectedSource = {
          environmentId: bound.machine.environmentId,
          threadId: context.threadId!,
          ...(call.accountId ? { accountId: call.accountId } : {}),
          family: call.family,
          action: call.action,
        };
        return bound.request<unknown>("voice.tools.call", params);
      })()
    : target.causalContext
      ? await (async () => {
          const bound = await featureHost(target.cwd, VOICE_TOOLS_CAPABILITY);
          expectedSource = {
            environmentId: bound.machine.environmentId,
            projectId: bound.projectId,
            threadId: context.threadId!,
            ...(context.sessionId ? { sessionId: context.sessionId } : {}),
            family: call.family,
            action: call.action,
          };
          return remoteRequest<unknown>(bound.machine.id, "voice.tools.call", {
            ...params,
            projectId: bound.projectId,
          });
        })()
      : await hostFeatureRequest<unknown>(
          target.cwd,
          VOICE_TOOLS_CAPABILITY,
          "voice.tools.call",
          params,
        );
  if (!target.causalContext) return result;
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    Object.keys(result).some(
      (key) => !["value", "voiceContext", "voiceDisclosure"].includes(key),
    ) ||
    !Object.prototype.hasOwnProperty.call(result, "value")
  )
    throw new Error("The voice tool result could not be verified. Check its original operation.");
  const envelope = result as { value: unknown; voiceContext?: unknown; voiceDisclosure?: unknown };
  const disclosure = AssistantVoiceDisclosureSchema.parse(envelope.voiceDisclosure);
  if (disclosure.source) {
    if (
      !expectedSource ||
      Object.keys(expectedSource).some(
        (key) =>
          disclosure.source?.[key as keyof AssistantVoiceDisclosureSource] !==
          expectedSource?.[key as keyof AssistantVoiceDisclosureSource],
      ) ||
      disclosure.source.sessionId !== expectedSource.sessionId ||
      disclosure.source.projectId !== expectedSource.projectId ||
      disclosure.source.accountId !== expectedSource.accountId
    )
      throw new Error("The voice tool result could not be verified. Check its original operation.");
  } else if (!disclosure.verified) {
    // Older Hosts cannot authenticate previously unsupported tool output. Never
    // replay a possibly applied operation to obtain a different receipt.
    throw new Error("The voice tool result could not be verified. Check its original operation.");
  }
  target.causalContext.receive(
    envelope.voiceContext,
    envelope.voiceDisclosure,
    call.requestId ?? "",
    expectedSource,
  );
  return envelope.value;
}
