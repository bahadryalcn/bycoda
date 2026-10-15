import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import type { HarnessEvent } from "../../../integrations/harness/core/types";
import { mapCodexNotification } from "../../../integrations/harness/providers/codex/codexProtocol";
import type { CodexEntry } from "../../../platform/tauri/sessionImport";
import type { Block, Session } from "../model/session";

/**
 * Codex rollouts are not the app-server notification stream the live adapter
 * parses: they record the model's own items (`response_item`) rather than
 * thread items, so they cannot be fed through `handleNotification` as they
 * are. Rust reduces a rollout to messages and tool calls; this turns each
 * tool call into the thread item the app-server would have reported for it
 * and lets the adapter's own mapping render it, so the rows match the ones a
 * live Codex session shows. What the rollout does not hold — reasoning (it is
 * stored encrypted), plan updates, subagent trees — is simply absent.
 */

const SHELL_TOOLS = new Set([
  "shell_command",
  "shell",
  "exec_command",
  "local_shell",
  "container.exec",
]);

/** `Exit code: N`, wall time, then the output: how Codex wraps a shell result. */
export function parseShellOutput(raw: string | null | undefined): {
  output: string;
  failed: boolean;
} {
  const text = raw ?? "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const meta = record.metadata as Record<string, unknown> | undefined;
      if (typeof record.output === "string") {
        return {
          output: record.output,
          failed: typeof meta?.exit_code === "number" && meta.exit_code !== 0,
        };
      }
    }
  } catch {
    // Not JSON: the plain-text wrapper below.
  }
  const wrapped = /^Exit code: (-?\d+)\r?\n(?:Wall time: [^\n]*\r?\n)?(?:Output:\r?\n)?/.exec(text);
  if (!wrapped) return { output: text, failed: false };
  return {
    output: text.slice(wrapped[0].length),
    failed: Number(wrapped[1]) !== 0,
  };
}

type PatchChange = {
  path: string;
  kind: { type: "add" | "update" | "delete" };
  diff: string;
};

/** The files an `apply_patch` envelope touches, each with its own hunk text. */
export function parseApplyPatch(patch: string): PatchChange[] {
  const changes: PatchChange[] = [];
  let current: PatchChange | null = null;
  for (const line of patch.split(/\r?\n/)) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      current = {
        path: header[2].trim(),
        kind: { type: header[1].toLowerCase() as PatchChange["kind"]["type"] },
        diff: "",
      };
      changes.push(current);
      continue;
    }
    if (!current || line.startsWith("*** ")) continue;
    current.diff += `${line}\n`;
  }
  return changes;
}

function humanize(name: string): string {
  const words = name.replace(/[_.-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
}

/** The events the live adapter would have produced for one tool call. */
export function codexToolEvents(entry: CodexEntry, id: string): HarnessEvent[] {
  const name = entry.name ?? "";
  const input = entry.input ?? "";
  const mapped = (item: Record<string, unknown>) =>
    mapCodexNotification("item/completed", { item: { id, ...item } }).events;

  if (SHELL_TOOLS.has(name)) {
    const result = parseShellOutput(entry.output);
    return mapped({
      type: "commandExecution",
      command: input,
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
      status: result.failed ? "failed" : "completed",
      aggregatedOutput: result.output,
    });
  }
  if (name === "apply_patch") {
    const changes = parseApplyPatch(input);
    if (changes.length > 0) {
      const failed = /verification failed|error/i.test(entry.output ?? "");
      return mapped({
        type: "fileChange",
        status: failed ? "failed" : "completed",
        changes,
      });
    }
  }
  if (name === "web_search") {
    return mapped({ type: "webSearch", query: input, status: "completed" });
  }
  const result = entry.output?.trim();
  return [
    {
      type: "tool.updated",
      callId: id,
      title: name === "exec" ? "Run code" : humanize(name),
      kind: "other",
      status: "completed",
      ...(result ? { detail: result } : {}),
    },
  ];
}

/** Rebuild a Codex thread's transcript from the entries Rust read out of its rollout. */
export function buildCodexSession(input: {
  base: Session;
  entries: readonly CodexEntry[];
}): Session {
  let session: Session = { ...input.base, blocks: [] };
  const apply = (events: readonly HarnessEvent[]) => {
    for (const event of events) session = applyHarnessEvent(session, event);
  };
  input.entries.forEach((entry, index) => {
    if (entry.kind === "user") {
      const block: Block = {
        id: crypto.randomUUID(),
        role: "user",
        text: entry.text,
        ...(entry.at ? { startedAt: entry.at } : {}),
      };
      session = { ...session, blocks: [...session.blocks, block] };
    } else if (entry.kind === "assistant") {
      apply([{ type: "message.delta", text: entry.text }, { type: "message.completed" }]);
    } else {
      apply(codexToolEvents(entry, entry.callId || `import-${index}`));
    }
  });
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.streaming ? { ...block, streaming: false } : block,
    ),
  };
}
