import { z } from "zod";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { VOICE_TOOL_ACTION } from "./voiceToolCatalog";

/** A descriptor carries input, never authority or a raw RPC method. The live catalog and
 * ordinary voice dispatcher validate the exact action and scope again on every press. */
export const VoicePresentedActionButtonSchema = z.strictObject({
  label: z.string().trim().min(1).max(52),
  family: z.enum(["workspace", "conversation", "social", "runtime-logs"]).optional(),
  action: z.string().max(200).regex(VOICE_TOOL_ACTION),
  input: z.record(z.string(), z.unknown()),
  projectPath: z.string().trim().min(1).max(4096).optional(),
  sessionId: z.string().trim().min(1).max(300).optional(),
  accountId: z.string().trim().min(1).max(200).optional(),
});

export type VoicePresentedActionButton = z.infer<typeof VoicePresentedActionButtonSchema>;

export type VoicePresentedActionResponse = {
  status: "accepted" | "queued" | "running" | "pending" | "completed" | "returned";
  preview?: string;
};

/** Retain an effect's original request identity for equivalent JSON inputs. */
export function voicePresentedRequestKey(button: VoicePresentedActionButton) {
  const { label: _label, ...request } = button;
  return JSON.stringify(request, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}

export function voicePresentedActionResponse(
  outcome: unknown,
  result: unknown,
  showPreview: boolean,
): VoicePresentedActionResponse {
  const status =
    outcome === "accepted" ||
    outcome === "queued" ||
    outcome === "running" ||
    outcome === "pending" ||
    outcome === "completed"
      ? outcome
      : "returned";
  if (!showPreview || (status !== "completed" && status !== "returned")) return { status };
  const serialized = JSON.stringify(
    result,
    (key, value: unknown) =>
      /^(?:token|secret|password|authorization|api.?key|(?:access|refresh).?token|credential|dataUrl)$/i.test(
        key,
      )
        ? "[hidden]"
        : typeof value === "string"
          ? value.replace(
              /\b(?:bearer\s+\S+|(?:sk|ghp|xox[baprs])[-_][\w-]{10,}|(?:authorization|password|secret|api[_-]?key|(?:access|refresh)[_-]?token)\s*[:=]\s*[^\r\n]+)/gi,
              "[hidden]",
            )
          : value,
    2,
  );
  return { status, ...(serialized ? { preview: truncateGraphemes(serialized, 4000) } : {}) };
}
