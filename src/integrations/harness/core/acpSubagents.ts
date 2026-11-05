import type { HarnessEvent } from "./types";
import { isFailedStatus } from "../../../features/sessions/model/transcriptActivity";
import { agentToolTitle, isAgentTool, isAgentToolName, mergeToolPreview } from "./preview";

type Step = Extract<HarnessEvent, { type: "agent.step" }>;

/** Backlog for a parent that never starts or never settles is bounded; a
 * settled parent is retired in retireParent, so these limits only bind when
 * the parent stays unknown or open for a long time. */
const MAX_PENDING_PARENTS = 32;
const MAX_BACKLOG_STEPS = 64;
const MAX_OWNERS = 512;

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  if (map.size >= max) map.delete(map.keys().next().value!);
  map.set(key, value);
}

/** Route explicitly attributed ACP child activity without mixing parent text. */
export class AcpSubagents {
  private tools = new Set<string>();
  private owners = new Map<string, string>();
  private pending = new Map<string, Step[]>();
  private completedParents = new Set<string>();
  private liveChildren = new Set<string>();
  private prose = new Map<string, { id: number; kind: "message" | "reasoning"; text: string }>();
  private sequence = 0;

  isChild(params: unknown): boolean {
    return !!this.parent(params);
  }

  route(params: unknown, events: HarnessEvent[]): HarnessEvent[] {
    const parent = this.parent(params);
    if (!parent) {
      return events.flatMap<HarnessEvent>((event) => {
        if (event.type !== "tool.started" && event.type !== "tool.updated") return [event];
        const owner = this.owners.get(event.callId);
        if (owner) return this.route({ parentToolCallId: owner }, [event]);
        this.tools.add(event.callId);
        const backlog = this.pending.get(event.callId) ?? [];
        this.pending.delete(event.callId);
        if (event.type === "tool.updated" && terminal(event.status)) {
          this.completedParents.add(event.callId);
          this.retireParent(event.callId);
        }
        return [event, ...backlog];
      });
    }
    const output: Step[] = [];
    for (const event of events) {
      if (event.type === "tool.started" || event.type === "tool.updated") {
        setBounded(this.owners, event.callId, parent, MAX_OWNERS);
        if (event.type === "tool.updated" && terminal(event.status))
          this.liveChildren.delete(event.callId);
        else this.liveChildren.add(event.callId);
        this.prose.delete(parent);
        output.push({
          type: "agent.step",
          callId: parent,
          stepId: `tool:${event.callId}`,
          kind: "tool",
          text: event.title ?? "",
          toolKind: event.kind,
          status: event.status,
          // Detail is what a red row opens, so only a call that failed carries
          // one. A settled result is already in the preview, and storing every
          // child's output would weigh the saved session down for nothing.
          ...(event.type === "tool.updated" && isFailedStatus(event.status) && event.detail
            ? { detail: event.detail }
            : {}),
          preview: event.preview,
        });
      } else if (event.type === "message.delta" || event.type === "reasoning.delta") {
        const kind = event.type === "message.delta" ? "message" : "reasoning";
        let prose = this.prose.get(parent);
        if (!prose || prose.kind !== kind) prose = { id: ++this.sequence, kind, text: "" };
        const update = record(record(params)?.update) ?? record(params);
        const type = update?.sessionUpdate ?? update?.session_update ?? update?.type;
        const snapshot = type === "agent_message" || type === "agent_thought";
        prose.text = (snapshot ? event.text : prose.text + event.text).slice(0, 2_000);
        setBounded(this.prose, parent, prose, MAX_PENDING_PARENTS);
        output.push({
          type: "agent.step",
          callId: parent,
          stepId: `${kind}:${prose.id}`,
          kind,
          text: prose.text,
        });
      }
      // Child plans, context meters and lifecycle notifications belong to the
      // child too; they must never replace or finish the parent's own work.
    }
    if (this.tools.has(parent)) {
      this.retireParent(parent);
      return output;
    }
    const backlog = this.pending.get(parent) ?? [];
    for (const step of output) {
      const index = backlog.findIndex((entry) => entry.stepId === step.stepId);
      if (index < 0) {
        if (backlog.length >= MAX_BACKLOG_STEPS) backlog.shift();
        backlog.push(step);
      } else
        backlog[index] = {
          ...backlog[index],
          ...step,
          text: step.text || backlog[index].text,
          toolKind: step.toolKind ?? backlog[index].toolKind,
          status: step.status ?? backlog[index].status,
          preview: mergeToolPreview(step.preview, backlog[index].preview),
        };
    }
    setBounded(this.pending, parent, backlog, MAX_PENDING_PARENTS);
    return [];
  }

  private retireParent(parent: string): void {
    if (!this.completedParents.has(parent)) return;
    for (const [child, owner] of this.owners) {
      if (owner === parent && this.liveChildren.has(child)) return;
    }
    for (const [child, owner] of this.owners) {
      if (owner === parent) this.owners.delete(child);
    }
    this.completedParents.delete(parent);
    this.tools.delete(parent);
    this.pending.delete(parent);
    this.prose.delete(parent);
  }

  private parent(params: unknown): string | undefined {
    const envelope = record(params);
    const update = record(envelope?.update) ?? envelope;
    const tool = record(update?.toolCall) ?? record(update?.tool_call);
    const sources = [tool, update, envelope];
    const id = text(
      tool?.toolCallId ?? tool?.tool_call_id ?? update?.toolCallId ?? update?.tool_call_id,
    );
    let parent: string | undefined;
    for (const source of sources) {
      const meta = record(source?._meta);
      for (const entry of [
        source,
        meta,
        record(meta?.cursor),
        record(meta?.grok),
        record(meta?.["x.ai"]),
        record(meta?.fx),
      ]) {
        parent = text(entry?.parentToolCallId ?? entry?.parent_tool_call_id);
        if (parent) break;
      }
      if (parent) break;
    }
    parent ??= id ? this.owners.get(id) : undefined;
    if (!parent || parent === id) return undefined;
    const seen = new Set<string>();
    while (this.owners.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = this.owners.get(parent)!;
    }
    return seen.has(parent) ? undefined : parent;
  }
}

function terminal(status: string | undefined): boolean {
  return (
    !!status &&
    ["completed", "failed", "error", "cancelled", "canceled"].includes(status.toLowerCase())
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Some ACP servers classify delegation as `other` and identify it in input. */
export function acpAgentInfo(
  update: Record<string, unknown>,
  tool: Record<string, unknown>,
  kind?: string,
  title?: string,
  nativeInput?: unknown,
): { kind: "agent"; title: string; agentModel?: string } | undefined {
  const input = record(
    nativeInput ??
      update.rawInput ??
      tool.rawInput ??
      update.raw_input ??
      tool.raw_input ??
      update.input ??
      tool.input,
  );
  const name = text(input?._toolName ?? input?.toolName ?? update.name ?? tool.name);
  if (!isAgentTool(kind, title) && !(name && isAgentToolName(name))) return undefined;
  const model = text(input?.model);
  return {
    kind: "agent",
    title: agentToolTitle(input ?? {}, title),
    ...(model ? { agentModel: model } : {}),
  };
}
