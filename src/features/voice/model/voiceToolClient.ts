import { hostFeatureRequest } from "../../connections/model/hostFeatureClient";
import { remoteSessionFor } from "../../connections/model/connections";
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
  causalContext?: {
    id: string;
    receive: (context: unknown, disclosure: unknown, requestId: string) => void;
  };
};
export type VoiceToolCall = {
  family: VoiceToolFamily;
  action: string;
  input: Record<string, unknown>;
  /** Reuse for an uncertain invocation. Individual tool schemas may also require an input requestId. */
  requestId?: string;
};

export const VOICE_TOOLS_CAPABILITY = "voice.tools.v1";

function source(target: VoiceToolTarget): { sessionId?: string; threadId?: string } {
  if (!target.cwd.trim()) throw new Error("Choose a project before using voice tools.");
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
    (target.causalContext && !call.requestId)
  )
    throw new Error("The voice tool request is invalid.");
  const result = await hostFeatureRequest<unknown>(
    target.cwd,
    VOICE_TOOLS_CAPABILITY,
    "voice.tools.call",
    {
      ...context,
      family: call.family,
      action: call.action,
      input: call.input,
      ...(call.requestId === undefined ? {} : { requestId: call.requestId }),
      ...(target.causalContext ? { causalContextId: target.causalContext.id } : {}),
    },
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
  target.causalContext.receive(
    envelope.voiceContext,
    envelope.voiceDisclosure,
    call.requestId ?? "",
  );
  return envelope.value;
}
