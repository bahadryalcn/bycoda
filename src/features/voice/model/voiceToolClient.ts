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
export type VoiceToolTarget = { cwd: string; sessionId?: string };
export type VoiceToolCall = {
  family: VoiceToolFamily;
  action: string;
  input: Record<string, unknown>;
  /** Reuse for an uncertain invocation. Individual tool schemas may also require an input requestId. */
  requestId?: string;
};

export const VOICE_TOOLS_CAPABILITY = "voice.tools.v1";

function source(target: VoiceToolTarget): { sessionId?: string } {
  if (!target.cwd.trim()) throw new Error("Choose a project before using voice tools.");
  if (target.sessionId !== undefined && (!target.sessionId.trim() || target.sessionId.length > 300))
    throw new Error("The voice tool session is invalid.");
  const sessionId =
    target.sessionId && target.cwd.startsWith("remote://")
      ? (remoteSessionFor(target.sessionId) ?? target.sessionId)
      : target.sessionId;
  return sessionId ? { sessionId } : {};
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
    (call.requestId !== undefined && (!call.requestId.trim() || call.requestId.length > 300))
  )
    throw new Error("The voice tool request is invalid.");
  return hostFeatureRequest<unknown>(target.cwd, VOICE_TOOLS_CAPABILITY, "voice.tools.call", {
    ...context,
    family: call.family,
    action: call.action,
    input: call.input,
    ...(call.requestId === undefined ? {} : { requestId: call.requestId }),
  });
}
