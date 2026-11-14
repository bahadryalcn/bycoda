import type { Block } from "./session";
import { isFailedStatus } from "./transcriptActivity";

/**
 * An `agents.delegate` / `agents.consult` call that failed before a child session
 * existed (model unavailable, skill preparation, limits). Nothing in the Host names a
 * child, so the parent transcript's own tool block is all there is: it stands in as a
 * failed subagent card. The model's own retry is the only retry; the arguments are not
 * kept on the block, so nothing here can re-issue the call.
 */

const ASK_TOOL = /(?:^|[:_.])agents[_.](delegate|consult)$/i;

/** The call's own tool name, however the provider spells the Host tool. */
function askKind(block: Block): "delegate" | "consult" | undefined {
  if (block.role !== "tool") return undefined;
  const name = [block.tool?.title, block.tool?.preview?.title, block.text].find(
    (value) => value && ASK_TOOL.test(value.trim()),
  );
  const kind = name ? ASK_TOOL.exec(name.trim())?.[1]?.toLowerCase() : undefined;
  return kind === "delegate" || kind === "consult" ? kind : undefined;
}

/** The error a failed call returned: its `error` field, else the whole text. */
function errorText(detail: string, failed: boolean): string {
  try {
    const value: unknown = JSON.parse(detail);
    if (value && typeof value === "object") {
      const row = value as { error?: unknown; sessionId?: unknown };
      if (typeof row.sessionId === "string" && row.sessionId) return "";
      const error = row.error;
      if (typeof error === "string" && error.trim()) return error.trim();
      if (error && typeof error === "object") {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message.trim();
      }
      if (error === undefined) return failed ? detail.trim() : "";
      return detail.trim();
    }
  } catch {
    // Plain text: used as is when the call is marked failed.
  }
  return detail.trim();
}

/**
 * The failed card for `block`, or undefined when it is not a settled, failed
 * delegate/consult call or it did start a child.
 */
export function failedAskCard(block: Block): Block | undefined {
  const kind = askKind(block);
  const detail = block.tool?.detail?.trim();
  if (!kind || !detail) return undefined;
  const status = block.tool?.status?.toLowerCase() ?? "";
  if (status === "running" || status === "pending" || status === "in_progress") return undefined;
  // A completed call is a failure only when its result is an error object.
  const error = errorText(detail, isFailedStatus(status));
  if (!error || (!isFailedStatus(status) && !/^\s*\{[\s\S]*"error"/.test(detail))) return undefined;
  const title = kind === "consult" ? "Advisor" : "Subagent";
  const preview = block.tool?.preview;
  const model = preview?.kind === "read" && preview.path ? preview.path : undefined;
  return {
    id: block.id,
    role: "tool",
    text: title,
    ...(block.startedAt !== undefined ? { startedAt: block.startedAt } : {}),
    tool: { kind: "subagent", title, status: "failed", detail: error },
    agentRun: { name: title, ...(model ? { model } : {}), steps: [] },
  };
}
