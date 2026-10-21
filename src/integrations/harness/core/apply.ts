import { trimAndCapText } from "../../../shared/lib/cappedText";
import { hasReadableText } from "../../../features/sessions/model/transcriptActivity";
import { executionUserIndex } from "../../../features/sessions/model/executionTurn";
import { boundedToolPreview } from "../../../features/sessions/model/toolInspection";
import { knownToolKindTitle } from "../../../shared/lib/toolKindTitles";
import { looksLikeCallId as isCallId } from "../../../shared/lib/records";
import type {
  AgentRunMeta,
  AgentStep,
  Attachment,
  Block,
  Session,
  TaskListItem,
  ToolPreview,
} from "../../../features/sessions/model/session";
import {
  dropContextWindow,
  mergeContextUsage,
} from "../../../features/sessions/model/contextUsage";
import {
  mergeSessionUsage,
  resetProcessCounters,
} from "../../../features/sessions/model/sessionUsage";
import { displayPath } from "../../../shared/lib/paths";
import {
  composeToolTitle,
  isAgentTool,
  isFileTool,
  isWeakToolTitle,
  mergeToolPreview,
  stubFilePreview,
} from "./preview";
import {
  AGENT_PROMPT_CHARS,
  budgetStepOutputs,
  capHeadTail,
  capStepOutput,
} from "../../../features/sessions/model/agentOutput";
import { joinStreamText } from "./streamText";
import { registerStreamingTextUpdate } from "../../../features/sessions/model/stableBlocks";
import { registerBlockChanges } from "../../../features/sessions/model/blockChanges";
import { taskListText } from "../../../features/sessions/model/taskList";
import { isReviewablePlan } from "../../../features/sessions/model/plan";
import { resolveModel } from "../../../features/sessions/model/models";
import { loadResumeAtReset } from "../../../features/settings/model/settings";
import { selectedAnswerLabels } from "../../../features/sessions/model/userQuestion";
import type { HarnessEvent } from "./types";

/** Apply one delivery batch without copying the transcript for every token. */
export function applyHarnessEvents(session: Session, events: readonly HarnessEvent[]): Session {
  let next = session;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event.type !== "message.delta" && event.type !== "reasoning.delta") {
      next = applyHarnessEvent(next, event);
      continue;
    }
    const texts = [event.text];
    while (index + 1 < events.length) {
      const following = events[index + 1];
      if (following.type !== event.type) break;
      texts.push(following.text);
      index++;
    }
    if (next.retryMessage) next = { ...next, retryMessage: undefined };
    next = patchStreaming(
      next,
      event.type === "message.delta" ? "assistant" : "reasoning",
      texts,
      true,
    );
  }
  return next;
}

export type ApplyHarnessEventOptions = {
  /** The desktop's "Resume at reset" setting, for callers that cannot read it. */
  resumeAtReset?: boolean;
};

export function applyHarnessEvent(
  session: Session,
  event: HarnessEvent,
  options: ApplyHarnessEventOptions = {},
): Session {
  if (
    session.retryMessage &&
    [
      "message.delta",
      "reasoning.delta",
      "tool.started",
      "tool.updated",
      "session.started",
      "session.error",
      "turn.started",
      "question.asked",
      "approval.requested",
      "image.generated",
    ].includes(event.type)
  ) {
    session = { ...session, retryMessage: undefined };
  }
  switch (event.type) {
    case "message.delta":
      return patchStreaming(session, "assistant", event.text, true);
    case "message.completed":
      return finishRole(session, "assistant");
    case "image.generated":
      if (!("path" in event)) return session;
      return appendImage(session, event);
    case "reasoning.delta":
      return patchStreaming(session, "reasoning", event.text, true);
    case "reasoning.completed":
      return finishRole(session, "reasoning");
    case "tool.started":
      return upsertTool(session, {
        callId: event.callId,
        title: event.title,
        kind: event.kind,
        status: event.status,
        preview: event.preview,
        streaming: true,
        agentModel: event.agentModel,
        agentPrompt: event.agentPrompt,
        ...(event.background ? { background: true } : {}),
      });
    case "tool.updated":
      return upsertTool(session, {
        callId: event.callId,
        title: event.title,
        kind: event.kind,
        status: event.status,
        detail: event.detail,
        preview: event.preview,
        streaming:
          event.status !== "completed" && event.status !== "failed" && event.status !== "stopped",
        agentModel: event.agentModel,
        agentPrompt: event.agentPrompt,
      });
    case "agent.step":
      return recordAgentStep(session, event);
    case "agent.context":
      return recordAgentContext(session, event);
    case "approval.requested":
      return attachApproval(session, event);
    case "approval.resolved": {
      const changed: Block[] = [];
      const blocks = session.blocks.map((block) => {
        if (
          block.approval?.requestId !== event.requestId ||
          block.approval.decided === event.decision
        )
          return block;
        const next = { ...block, approval: { ...block.approval, decided: event.decision } };
        changed.push(next);
        return next;
      });
      if (changed.length === 0) return session;
      registerBlockChanges(session.blocks, blocks, changed);
      return { ...session, blocks };
    }
    case "question.asked":
      return {
        ...session,
        pendingQuestion: {
          requestId: event.requestId,
          questions: event.questions,
          ...(event.title ? { title: event.title } : {}),
          ...(event.autoResolveAt != null ? { autoResolveAt: event.autoResolveAt } : {}),
        },
      };
    case "question.updated":
      return session.pendingQuestion?.requestId === event.requestId &&
        session.pendingQuestion.autoResolveAt !== event.autoResolveAt
        ? {
            ...session,
            pendingQuestion: {
              ...session.pendingQuestion,
              autoResolveAt: event.autoResolveAt,
            },
          }
        : session;
    case "question.resolved": {
      const pending = session.pendingQuestion;
      if (pending?.requestId !== event.requestId) return session;
      const reply = event.decision === "answered" ? event.reply : undefined;
      const questionAnswers = reply
        ? pending.questions.flatMap((question) => {
            const labels = selectedAnswerLabels(question, reply);
            return labels.length ? [{ prompt: question.prompt, answers: labels }] : [];
          })
        : [];
      const text = questionAnswers
        .map(({ prompt, answers }) => `${prompt}\n${answers.join("\n")}`)
        .join("\n\n");
      const next = { ...session, pendingQuestion: undefined };
      // Keep the running turn and its streaming blocks intact. This answer is
      // a mid-turn user message, not a newly submitted turn.
      if (!text) return next;
      const answered = appendSteerUser(next, text);
      answered.blocks[answered.blocks.length - 1] = {
        ...answered.blocks[answered.blocks.length - 1],
        questionAnswers,
      };
      return { ...answered, busy: session.busy };
    }
    case "context": {
      const context = mergeContextUsage(session.context, {
        used: event.used,
        window: event.window,
      });
      if (
        session.context &&
        session.context.used === context.used &&
        session.context.window === context.window
      )
        return session;
      return { ...session, context };
    }
    case "usage": {
      const usage = mergeSessionUsage(session.usage, event);
      const previous = session.usage;
      if (
        previous &&
        previous.costUsd === usage.costUsd &&
        previous.apiMs === usage.apiMs &&
        previous.lastProcessCostUsd === usage.lastProcessCostUsd &&
        previous.lastProcessApiMs === usage.lastProcessApiMs
      )
        return session;
      return { ...session, usage };
    }
    case "session.started":
      return session.usage ? { ...session, usage: resetProcessCounters(session.usage) } : session;
    case "turn.metrics":
      return mergeTurnMetrics(session, event);
    case "tasks.updated":
      return upsertTaskList(session, event);
    case "background.updated":
      if (event.tasks.length === 0) {
        if (!session.backgroundTasks) return session;
        const { backgroundTasks: _cleared, backgroundAgents: _agents, ...rest } = session;
        return rest;
      }
      if (
        session.backgroundAgents === event.agents &&
        session.backgroundTasks?.length === event.tasks.length &&
        session.backgroundTasks.every((task, index) => task === event.tasks[index])
      )
        return session;
      return {
        ...session,
        backgroundTasks: event.tasks,
        backgroundAgents: event.agents,
      };
    case "plan":
      return upsertPlan(session, event);
    case "session.error":
      return appendBlock(failStreaming(session), {
        id: crypto.randomUUID(),
        role: "system",
        text: event.message,
        notice: "error",
      });
    case "session.providerBound":
      return session.providerSessionId === event.providerSessionId
        ? session
        : { ...session, providerSessionId: event.providerSessionId };
    case "turn.started": {
      const index = lastMatchingBlock(session.blocks, (block) => block.role === "user");
      if (index < 0) return session;
      const block = session.blocks[index];
      if (block.providerTurnId === event.providerTurnId) return session;
      const blocks = session.blocks.slice();
      blocks[index] = { ...block, providerTurnId: event.providerTurnId };
      return { ...session, blocks };
    }
    case "session.configChanged":
      if (
        (!event.model || event.model === session.model) &&
        (!event.modelSettings ||
          (session.modelSettings &&
            Object.entries(event.modelSettings).every(
              ([key, value]) => session.modelSettings?.[key] === value,
            )))
      )
        return session;
      return {
        ...session,
        ...(event.model ? { model: event.model } : {}),
        ...(event.model && event.model !== session.model
          ? { context: dropContextWindow(session.context) }
          : {}),
        ...(event.modelSettings
          ? {
              modelSettings: {
                ...session.modelSettings,
                ...event.modelSettings,
              },
            }
          : {}),
      };
    case "status":
      if (event.key === "provider-retry")
        return session.retryMessage === event.text
          ? session
          : { ...session, retryMessage: event.text };
      if (/^(?:Retrying\b|Reconnecting\b)/i.test(event.text.trim())) {
        session = { ...session, retryMessage: event.text };
      }
      return event.key
        ? upsertKeyedStatus(session, event.key, event.text)
        : appendStatus(session, event.text);
    case "usage.limited":
      return {
        ...session,
        usageLimit: {
          ...(event.resetsAt != null ? { resetsAt: event.resetsAt } : {}),
          // Armed even before the reset time is known; a later lookup fills it in.
          // A repeated limit event keeps the choice already made for this one.
          resumeAtReset:
            session.usageLimit?.resumeAtReset ?? options.resumeAtReset ?? loadResumeAtReset(),
        },
      };
    case "interjection":
      // A visible boundary the user must not miss, so unlike status it never
      // deduplicates and never reads as turn lifecycle.
      return appendBlock(session, {
        id: crypto.randomUUID(),
        role: "system",
        text: event.text,
        interjection: {
          customType: event.customType,
          ...(event.severity ? { severity: event.severity } : {}),
        },
      });
    default:
      return session;
  }
}

function mergeTurnMetrics(
  session: Session,
  event: Extract<HarnessEvent, { type: "turn.metrics" }>,
): Session {
  let userIndex = -1;
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    if (session.blocks[index].role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return session;

  const current = session.blocks[userIndex];
  const metrics = {
    ...(current.turnMetrics ?? {}),
    ...(event.inputTokens != null ? { inputTokens: event.inputTokens } : {}),
    ...(event.outputTokens != null ? { outputTokens: event.outputTokens } : {}),
    ...(event.cacheReadTokens != null ? { cacheReadTokens: event.cacheReadTokens } : {}),
    ...(event.cacheWriteTokens != null ? { cacheWriteTokens: event.cacheWriteTokens } : {}),
    ...(event.cacheHitPercent != null ? { cacheHitPercent: event.cacheHitPercent } : {}),
  };
  const blocks = session.blocks.slice();
  blocks[userIndex] = { ...current, turnMetrics: metrics };
  return { ...session, blocks };
}

function upsertPlan(session: Session, event: Extract<HarnessEvent, { type: "plan" }>): Session {
  const key = event.key?.trim() || undefined;
  const lastUser = lastMatchingBlock(session.blocks, (block) => block.role === "user");
  const existing = lastMatchingBlock(session.blocks, (block, index) => {
    if (block.role !== "plan") return false;
    if (key) {
      return block.plan?.key === key || (!block.plan?.key && index > lastUser);
    }
    return index > lastUser;
  });
  const streaming = event.streaming ?? false;

  if (existing >= 0) {
    const current = session.blocks[existing];
    const text = event.append
      ? joinStreamText(current.text, event.text)
      : event.text || current.text;
    const blocks = session.blocks.slice();
    blocks[existing] = {
      ...current,
      text,
      streaming,
      plan: {
        ...(current.plan ?? { status: streaming ? "streaming" : "ready" }),
        ...(key ? { key } : {}),
        status: streaming ? "streaming" : "ready",
        ...(!streaming && text ? { originalText: text, edited: false } : {}),
      },
    };
    return { ...session, blocks };
  }

  if (!event.text) return session;
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "plan",
    text: event.text,
    streaming,
    plan: {
      ...(key ? { key } : {}),
      status: streaming ? "streaming" : "ready",
      ...(!streaming ? { originalText: event.text } : {}),
    },
  });
}

function upsertTaskList(
  session: Session,
  event: Extract<HarnessEvent, { type: "tasks.updated" }>,
): Session {
  const key = event.key?.trim() || undefined;
  const lastUser = lastMatchingBlock(session.blocks, (block) => block.role === "user");
  const existing = lastMatchingBlock(session.blocks, (block, index) => {
    if (block.role !== "tasks") return false;
    if (key) {
      if (block.taskList?.key !== key) return false;
      // A list from another provider conversation stays as history.
      return (
        !event.providerSessionId || block.taskList?.providerSessionId === event.providerSessionId
      );
    }
    return index > lastUser;
  });
  const previousItems = existing >= 0 ? session.blocks[existing].taskList?.items : undefined;
  const items = previousItems
    ? event.merge
      ? mergeTaskListItems(previousItems, event.items)
      : event.authoritative
        ? event.items
        : preserveTaskListLabels(previousItems, event.items)
    : event.items;

  if (items.length === 0) {
    if (existing < 0) return session;
    return {
      ...session,
      blocks: session.blocks.filter((_, index) => index !== existing),
    };
  }

  const taskList = {
    ...(key ? { key } : {}),
    ...(event.providerSessionId ? { providerSessionId: event.providerSessionId } : {}),
    ...(event.explanation?.trim() ? { explanation: event.explanation.trim() } : {}),
    items,
  };
  const text = taskListText(items);
  if (existing >= 0) {
    const blocks = session.blocks.slice();
    blocks[existing] = {
      ...blocks[existing],
      text,
      taskList,
    };
    return { ...session, blocks };
  }

  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "tasks",
    text,
    taskList,
  });
}

function mergeTaskListItems(existing: TaskListItem[], updates: TaskListItem[]): TaskListItem[] {
  if (updates.length === 0) return existing;
  const items = existing.slice();
  const indexById = new Map<string, number>();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index].id;
    if (id) indexById.set(id, index);
  }

  for (const update of updates) {
    const index = update.id
      ? (indexById.get(update.id) ?? items.findIndex((item) => item.text === update.text))
      : items.findIndex((item) => item.text === update.text);
    if (index < 0) {
      items.push(update);
      if (update.id) indexById.set(update.id, items.length - 1);
      continue;
    }
    const current = items[index];
    items[index] = {
      ...(current.id || update.id ? { id: current.id ?? update.id } : {}),
      // A merge update changes state. Full snapshots remain responsible for
      // intentional task renames or reordered lists.
      text: current.text,
      status: update.status,
    };
  }
  return items;
}

function preserveTaskListLabels(
  existing: TaskListItem[],
  snapshot: TaskListItem[],
): TaskListItem[] {
  const existingById = new Map(
    existing.flatMap((item) => (item.id ? [[item.id, item] as const] : [])),
  );
  return snapshot.map((item) => {
    const previous = item.id ? existingById.get(item.id) : undefined;
    return previous && previous.text !== item.text ? { ...item, text: previous.text } : item;
  });
}

function lastMatchingBlock(
  blocks: Block[],
  predicate: (block: Block, index: number) => boolean,
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (predicate(blocks[index], index)) return index;
  }
  return -1;
}

type UserTurnExtra = {
  secondOpinion?: Block["secondOpinion"];
  noteCard?: Block["noteCard"];
  ciContext?: string;
  internal?: boolean;
  bycoda?: boolean;
  intent?: Block["intent"];
  appRequestId?: string;
};

function userTurnFields(extra?: UserTurnExtra) {
  return {
    ...(extra?.secondOpinion ? { secondOpinion: extra.secondOpinion } : {}),
    ...(extra?.noteCard ? { noteCard: extra.noteCard } : {}),
    ...(extra?.ciContext ? { ciContext: extra.ciContext } : {}),
    ...(extra?.internal ? { internal: true } : {}),
    ...(extra?.bycoda ? { bycoda: true } : {}),
    ...(extra?.intent ? { intent: extra.intent } : {}),
    ...(extra?.appRequestId ? { appRequestId: extra.appRequestId } : {}),
  };
}

function turnModelFields(session: Session) {
  const model = resolveModel(session.harness, session.model);
  return {
    turnModel: {
      harness: session.harness,
      id: session.model,
      name: model.name,
    },
  };
}

export function appendUser(
  session: Session,
  text: string,
  attachments: Attachment[] = [],
  extra?: UserTurnExtra,
): Session {
  session = settlePendingApprovals(session);
  return appendBlock(
    { ...session, busy: true, retryMessage: undefined },
    {
      id: crypto.randomUUID(),
      role: "user",
      text,
      startedAt: Date.now(),
      ...turnModelFields(session),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...userTurnFields(extra),
    },
  );
}

/** Append a follow-up user message during an active turn without sealing streams. */
export function appendSteerUser(
  session: Session,
  text: string,
  attachments: Attachment[] = [],
  extra?: UserTurnExtra,
): Session {
  const owner = session.blocks[executionUserIndex(session.blocks)];
  return {
    ...session,
    busy: true,
    blocks: [
      ...session.blocks,
      {
        id: crypto.randomUUID(),
        role: "user",
        text,
        ...(owner ? { continuationOf: owner.id } : {}),
        ...turnModelFields(session),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...userTurnFields(extra),
      },
    ],
  };
}

export function stopStreaming(session: Session, endedAt = Date.now()): Session {
  const {
    backgroundTasks: _cleared,
    backgroundAgents: _agents,
    ...settled
  } = settlePendingApprovals(session);
  return {
    ...settled,
    busy: false,
    retryMessage: undefined,
    pendingQuestion: undefined,
    blocks: stampTurnDuration(
      settled.blocks
        .filter((block) => !isBareProseStream(block))
        .map((block) =>
          stopBlockProgress(block.streaming ? endOpenAgentRun(block, endedAt) : block),
        ),
      endedAt,
    ),
  };
}

/**
 * Approval request ids are live only for the turn that produced them. Once
 * that turn has stopped (or a later turn is about to start), leaving one
 * undecided makes its old Allow/Deny controls and notification actionable
 * even though the harness can no longer receive the response.
 */
function settlePendingApprovals(session: Session): Session {
  let changed = false;
  const blocks = session.blocks.flatMap((block) => {
    if (!block.approval || block.approval.decided) return [block];
    changed = true;
    if (block.role === "approval") return [];
    const status = block.tool?.status?.toLowerCase() ?? "";
    const toolFinished =
      status === "completed" ||
      status === "success" ||
      status === "failed" ||
      status === "error" ||
      status === "stopped" ||
      status === "cancelled" ||
      status === "canceled";
    return [
      {
        ...block,
        streaming: false,
        ...(block.tool && !toolFinished ? { tool: { ...block.tool, status: "cancelled" } } : {}),
        approval: { ...block.approval, decided: "cancelled" as const },
      },
    ];
  });
  return changed ? { ...session, blocks } : session;
}

/**
 * A terminal provider failure also settles work whose final tool event was
 * lost with the transport. Leaving those calls `in_progress` hides the real
 * failure behind a neutral completed-turn summary.
 */
function failStreaming(session: Session): Session {
  const openTools = new Set(
    session.blocks.flatMap((block) => {
      if (block.role !== "tool" && block.role !== "approval") return [];
      const status = block.tool?.status?.toLowerCase() ?? "";
      return block.streaming ||
        status === "in_progress" ||
        status === "pending" ||
        status === "running"
        ? [block.id]
        : [];
    }),
  );
  const stopped = stopStreaming(session);
  return {
    ...stopped,
    blocks: stopped.blocks.map((block) => {
      const open = openTools.has(block.id);
      const pendingApproval = !!block.approval && !block.approval.decided;
      if (!open && !pendingApproval) return block;
      return {
        ...(open ? endOpenAgentRun(block, Date.now()) : block),
        streaming: false,
        ...(block.tool && open ? { tool: { ...block.tool, status: "failed" } } : {}),
        ...(block.approval && !block.approval.decided
          ? { approval: { ...block.approval, decided: "cancelled" as const } }
          : {}),
      };
    }),
  };
}

/**
 * Harnesses without a structured plan event return their plan as the final
 * assistant message. Convert only that final message after the turn has
 * actually ended; progress commentary earlier in the turn must stay normal
 * assistant text.
 */
export function promoteLastAssistantToPlan(session: Session, key?: string): Session {
  let lastUser = -1;
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    if (session.blocks[index].role === "user") {
      lastUser = index;
      break;
    }
  }

  if (session.blocks.some((block, index) => index > lastUser && block.role === "plan")) {
    return session;
  }

  let assistant = -1;
  for (let index = session.blocks.length - 1; index > lastUser; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "assistant" && block.text.trim()) {
      assistant = index;
      break;
    }
  }
  if (assistant < 0) return session;

  const blocks = session.blocks.slice();
  const block = blocks[assistant];
  if (!isReviewablePlan(block.text)) return session;
  blocks[assistant] = {
    ...block,
    role: "plan",
    streaming: false,
    plan: {
      ...(key ? { key } : {}),
      status: "ready",
      originalText: block.text,
      edited: false,
    },
  };
  return { ...session, blocks };
}

function stopBlockProgress(block: Block): Block {
  let stopped = block.streaming ? { ...block, streaming: false } : block;
  if (stopped.orchestration?.status === "planning") {
    stopped = {
      ...stopped,
      orchestration: {
        ...stopped.orchestration,
        status: "invalid",
        error: "Planning was interrupted. Generate the assignments again.",
      },
    };
  }
  if (stopped.role === "plan" && stopped.plan?.status === "streaming") {
    stopped = {
      ...stopped,
      plan: {
        ...stopped.plan,
        status: "ready",
        originalText: stopped.text,
        edited: false,
      },
    };
  }
  const current = stopped.taskList;
  if (!current?.items.some((item) => item.status === "in_progress")) {
    return stopped;
  }
  const items = current.items.map((item) =>
    item.status === "in_progress" ? { ...item, status: "pending" as const } : item,
  );
  return {
    ...stopped,
    text: taskListText(items),
    taskList: { ...current, items },
  };
}

function stampTurnDuration(blocks: Block[], endedAt: number): Block[] {
  const lastUser = executionUserIndex(blocks);
  if (lastUser < 0) return blocks;
  const user = blocks[lastUser];
  if (user.durationMs != null || user.startedAt == null) return blocks;
  const next = blocks.slice();
  next[lastUser] = {
    ...user,
    durationMs: Math.max(0, endedAt - user.startedAt),
  };
  return next;
}

/** Status pings repeat; keep one row per run instead of stacking identical lines. */
function appendStatus(session: Session, text: string): Session {
  const trimmed = text.trim();
  if (!trimmed) return session;
  const last = [...session.blocks].reverse().find((block) => block.role !== "reasoning");
  if (last?.role === "system" && last.text === trimmed) return session;
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "system",
    text: trimmed,
  });
}

function upsertKeyedStatus(session: Session, key: string, text: string): Session {
  const trimmed = text.trim();
  const turnStart = lastMatchingBlock(session.blocks, (block) => block.role === "user");
  const index = lastMatchingBlock(
    session.blocks,
    (block, at) => at > turnStart && block.statusKey === key,
  );
  if (index < 0) {
    if (!trimmed) return session;
    return appendBlock(session, {
      id: crypto.randomUUID(),
      role: "system",
      text: trimmed,
      statusKey: key,
    });
  }
  if (session.blocks[index].text === trimmed) return session;
  const blocks = session.blocks.slice();
  if (trimmed) blocks[index] = { ...blocks[index], text: trimmed };
  else blocks.splice(index, 1);
  return { ...session, blocks };
}

function appendImage(
  session: Session,
  event: Extract<HarnessEvent, { type: "image.generated"; path: string }>,
): Session {
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "image",
    text: "",
    image: {
      path: event.path,
      name: event.name,
      mimeType: event.mimeType,
      size: event.size,
      ...(event.alt ? { alt: event.alt } : {}),
    },
  });
}

function appendBlock(session: Session, block: Block): Session {
  const changed: Block[] = [];
  const removed: string[] = [];
  const blocks =
    block.role === "system" && !block.interjection
      ? session.blocks.slice()
      : sealLastStream(session.blocks, changed, removed);
  blocks.push(block);
  changed.push(block);
  registerBlockChanges(session.blocks, blocks, changed, removed);
  return { ...session, blocks };
}

/** Only ordinary status rows leave an open prose stream intact. */
function patchStreaming(
  session: Session,
  role: "assistant" | "reasoning",
  input: string | readonly string[],
  streaming: boolean,
): Session {
  if (role === "reasoning" && (typeof input === "string" ? !input : input.every((text) => !text)))
    return session;
  let index = session.blocks.length - 1;
  while (
    index >= 0 &&
    session.blocks[index].role === "system" &&
    !session.blocks[index].interjection
  )
    index--;
  const last = session.blocks[index];
  // A completion closes one provider message. The next delta is a new message
  // even when no tool or status row landed between them; joining the two can
  // turn separate Markdown blocks into text such as `commitConnect`.
  if (last?.role === role && last.streaming) {
    // Harness delta events are exact increments. Providers normalize full
    // snapshots at their protocol boundary before emitting these events.
    const nextText = last.text + (typeof input === "string" ? input : input.join(""));
    if (nextText === last.text && last.streaming === streaming) return session;
    const blocks = session.blocks.slice();
    blocks[index] = {
      ...last,
      text: nextText,
      streaming,
    };
    if (last.streaming === streaming) registerStreamingTextUpdate(session.blocks, blocks, index);
    else registerBlockChanges(session.blocks, blocks, [blocks[index]]);
    return { ...session, blocks };
  }
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role,
    text: typeof input === "string" ? input : input.join(""),
    streaming,
  });
}

function attachApproval(
  session: Session,
  event: Extract<HarnessEvent, { type: "approval.requested" }>,
): Session {
  const index = findToolForApproval(session, event);
  if (index >= 0) {
    const blocks = session.blocks.slice();
    const prev = blocks[index];
    const preview = mergeToolPreview(event.preview, prev.tool?.preview);
    const label =
      finalToolLabel(
        session,
        event.kind ?? prev.tool?.kind,
        preferLabel(event.title, prev.tool?.title, prev.text),
        preview,
      ) || prev.text;
    blocks[index] = {
      ...prev,
      text: label || prev.text,
      tool: prev.tool
        ? {
            ...prev.tool,
            kind: event.kind ?? prev.tool.kind,
            title: label || prev.tool.title,
            ...(preview ? { preview } : {}),
          }
        : event.callId
          ? {
              callId: event.callId,
              title: label,
              kind: event.kind,
              ...(preview ? { preview } : {}),
            }
          : prev.tool,
      approval: { requestId: event.requestId },
    };
    registerBlockChanges(session.blocks, blocks, [blocks[index]]);
    return { ...session, blocks };
  }
  const preview = event.preview;
  const label =
    finalToolLabel(session, event.kind, preferLabel(event.title), preview) || kindTitle(event.kind);
  return appendBlock(session, {
    id: crypto.randomUUID(),
    role: "tool",
    text: label,
    tool: {
      ...(event.callId ? { callId: event.callId } : {}),
      title: label,
      kind: event.kind,
      ...(preview ? { preview } : {}),
    },
    approval: { requestId: event.requestId },
  });
}

function findToolForApproval(
  session: Session,
  event: Extract<HarnessEvent, { type: "approval.requested" }>,
): number {
  if (event.callId) {
    const byId = session.blocks.findIndex((block) => block.tool?.callId === event.callId);
    // An explicit call id is authoritative; title similarity is not identity.
    return byId;
  }
  const needle = normalizeLabel(event.title);

  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role !== "tool" || block.approval) continue;
    const label = normalizeLabel(block.text || block.tool?.title || "");
    if (needle && label === needle) return i;
  }
  return -1;
}

function normalizeLabel(value: string): string {
  return value
    .replace(/[→`]/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*·.*$/, "")
    .trim()
    .toLowerCase();
}

function upsertTool(
  session: Session,
  patch: {
    callId: string;
    title?: string;
    kind?: string;
    status?: string;
    detail?: string;
    preview?: ToolPreview;
    streaming: boolean;
    agentModel?: string;
    agentPrompt?: string;
    background?: boolean;
  },
): Session {
  const index = findToolIndex(session, patch);
  const prompt = capAgentPrompt(patch.agentPrompt);
  if (index < 0) {
    const detail = capToolDetail(patch.detail);
    const preview = fillPreview(patch.preview, detail, patch.kind, patch.title);
    const label = finalToolLabel(session, patch.kind, displayLabel(patch), preview);
    return appendBlock(session, {
      id: crypto.randomUUID(),
      role: "tool",
      text: label,
      streaming: patch.streaming,
      ...(patch.agentModel || isAgentTool(patch.kind, label)
        ? {
            agentRun: {
              name: label,
              ...(patch.agentModel ? { model: patch.agentModel } : {}),
              ...(prompt ? { prompt } : {}),
              steps: [],
              startedAt: Date.now(),
            },
          }
        : {}),
      tool: {
        callId: patch.callId,
        title: label,
        kind: patch.kind,
        status: patch.status,
        ...(detail ? { detail } : {}),
        ...(preview ? { preview } : {}),
        ...(patch.background ? { background: true } : {}),
      },
    });
  }
  const prev = session.blocks[index];
  const detail = capToolDetail(patch.detail) ?? prev.tool?.detail;
  const preview = fillPreview(
    mergeToolPreview(patch.preview, prev.tool?.preview),
    detail,
    patch.kind ?? prev.tool?.kind,
    patch.title,
  );
  const label = finalToolLabel(
    session,
    patch.kind ?? prev.tool?.kind,
    displayLabel(patch, prev),
    preview,
  );
  const kind = patch.kind ?? prev.tool?.kind;
  const status = patch.status ?? prev.tool?.status;
  const agentName = prev.agentRun?.steps.length ? prev.agentRun.name : label;
  if (
    prev.text === label &&
    prev.streaming === patch.streaming &&
    prev.tool?.title === label &&
    prev.tool?.kind === kind &&
    prev.tool?.status === status &&
    prev.tool?.detail === detail &&
    (!patch.agentModel || prev.agentRun?.model === patch.agentModel) &&
    (!prompt || prev.agentRun?.prompt === prompt) &&
    (!prev.agentRun || prev.agentRun.name === agentName) &&
    !endsAgentRun(prev.agentRun, patch.streaming) &&
    samePreview(prev.tool?.preview, preview)
  ) {
    return session;
  }
  const blocks = session.blocks.slice();
  blocks[index] = {
    ...prev,
    text: label,
    streaming: patch.streaming,
    ...(patch.agentModel || prev.agentRun
      ? {
          agentRun: {
            steps: prev.agentRun?.steps ?? [],
            ...prev.agentRun,
            name: agentName,
            ...(patch.agentModel ? { model: patch.agentModel } : {}),
            ...(prompt ? { prompt } : {}),
            ...(endsAgentRun(prev.agentRun, patch.streaming) ? { endedAt: Date.now() } : {}),
          },
        }
      : {}),
    tool: {
      callId: patch.callId,
      title: label,
      kind,
      status,
      ...(detail ? { detail } : {}),
      ...(preview ? { preview } : {}),
      ...(prev.tool?.background ? { background: true } : {}),
      ...(prev.tool?.agentContext ? { agentContext: prev.tool.agentContext } : {}),
    },
  };
  registerBlockChanges(session.blocks, blocks, [blocks[index]]);
  return { ...session, blocks };
}

/** Stores a subagent's latest context reading on its parent Agent block. */
function recordAgentContext(
  session: Session,
  event: Extract<HarnessEvent, { type: "agent.context" }>,
): Session {
  const index = session.blocks.findIndex((block) => block.tool?.callId === event.callId);
  if (index < 0) return session;
  const prev = session.blocks[index];
  if (!prev.tool) return session;
  const window = event.window ?? prev.tool.agentContext?.window;
  if (prev.tool.agentContext?.used === event.used && prev.tool.agentContext?.window === window)
    return session;
  const blocks = session.blocks.slice();
  blocks[index] = {
    ...prev,
    tool: { ...prev.tool, agentContext: { used: event.used, ...(window ? { window } : {}) } },
  };
  registerBlockChanges(session.blocks, blocks, [blocks[index]]);
  return { ...session, blocks };
}

/**
 * True when this update is the one that finishes a run that has not been
 * stamped as ended yet. `startedAt` is only ever set when the block is created;
 * `endedAt` is set once and never overwritten by later updates.
 */
function endsAgentRun(run: AgentRunMeta | undefined, streaming: boolean) {
  return !!run && !streaming && run.endedAt === undefined;
}

/** Stamps `endedAt` on runs a turn is closing out, leaving ended ones alone. */
function endOpenAgentRun(block: Block, at: number): Block {
  if (!block.agentRun || block.agentRun.endedAt !== undefined) return block;
  return { ...block, agentRun: { ...block.agentRun, endedAt: at } };
}

const MAX_TOOL_DETAIL_CHARS = 8_000;

function capToolDetail(value: string | undefined): string | undefined {
  return value ? trimAndCapText(value, MAX_TOOL_DETAIL_CHARS) || undefined : undefined;
}

function samePreview(a?: ToolPreview, b?: ToolPreview): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.path === b.path &&
    a.query === b.query &&
    a.fileName === b.fileName &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.contentOnly === b.contentOnly &&
    a.startLine === b.startLine &&
    a.output === b.output &&
    a.inspection?.kind === b.inspection?.kind &&
    a.inspection?.text === b.inspection?.text &&
    a.inspection?.truncated === b.inspection?.truncated &&
    a.lines === b.lines
  );
}

function fillPreview(
  preview: ToolPreview | undefined,
  _detail: string | undefined,
  kind?: string,
  title?: string,
): ToolPreview | undefined {
  preview = boundedToolPreview(preview);
  if (
    preview?.contentOnly ||
    preview?.lines?.some((line) => line.kind === "add" || line.kind === "del")
  ) {
    return preview;
  }
  if (preview) return { ...preview, lines: undefined };
  if (isFileTool(kind, title, preview)) {
    return stubFilePreview(kind, title);
  }
  return undefined;
}

/**
 * How much of a subagent's trail the parent keeps. A delegated run can be
 * thousands of calls long; the transcript only ever shows a window of it, and
 * an unbounded array would grow the saved session without bound.
 */
const MAX_AGENT_STEPS = 300;

const MAX_AGENT_STEP_CHARS = 2_000;

/**
 * Mirrors one subagent action onto its parent Agent tool block. Steps merge by
 * provider id, so a call that starts pending and later completes stays one row
 * instead of appearing twice.
 */
function recordAgentStep(
  session: Session,
  event: Extract<HarnessEvent, { type: "agent.step" }>,
): Session {
  const index = session.blocks.findIndex((block) => block.tool?.callId === event.callId);
  if (index < 0) return session;
  const prev = session.blocks[index];
  const text = capAgentStepText(event.text);
  // A tool step earns a row on its label alone; prose with nothing in it does
  // not.
  if (!text && event.kind !== "tool") return session;

  const run = prev.agentRun;
  const detail = capToolDetail(event.detail);
  // A preview's own output (Cursor reports results there) is the same thing
  // as the step's output; keeping it in one place stops it being stored twice.
  const previewOutput = event.preview?.output;
  const preview = boundedToolPreview(
    event.preview && previewOutput !== undefined
      ? { ...event.preview, output: undefined }
      : event.preview,
  );
  const output = capStepOutput(event.output ?? previewOutput);
  const step: AgentStep = {
    id: event.stepId,
    kind: event.kind,
    text,
    ...(event.toolKind ? { toolKind: event.toolKind } : {}),
    ...(event.status ? { status: event.status } : {}),
    ...(detail ? { detail } : {}),
    ...(preview ? { preview } : {}),
    ...(output ? { output: output.output } : {}),
    ...(output?.truncated ? { outputTruncated: true } : {}),
  };

  const at = run?.steps.findIndex((entry) => entry.id === event.stepId) ?? -1;
  let steps: AgentStep[];
  if (run && at >= 0) {
    const existing = run.steps[at];
    steps = run.steps.slice();
    steps[at] = {
      ...existing,
      ...step,
      // A completion carries the result, not the request: keep the label the
      // call announced itself with rather than letting the result rename it.
      text: text || existing.text,
      preview: mergeToolPreview(preview, existing.preview),
    };
  } else {
    steps = [...(run?.steps ?? []), step];
    if (steps.length > MAX_AGENT_STEPS) {
      steps = steps.slice(steps.length - MAX_AGENT_STEPS);
    }
  }
  if (output || preview?.inspection) steps = budgetStepOutputs(steps);

  const next: AgentRunMeta = {
    ...(run?.model ? { model: run.model } : {}),
    name: event.agentName || run?.name || prev.tool?.title || prev.text || "Subagent",
    ...((event.agentType ?? run?.agentType)
      ? { agentType: event.agentType ?? run?.agentType }
      : {}),
    ...(run?.prompt ? { prompt: run.prompt } : {}),
    steps,
    ...(run?.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
    ...(run?.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
  };
  if (run && sameAgentRun(run, next)) return session;
  const blocks = session.blocks.slice();
  blocks[index] = { ...prev, agentRun: next };
  registerBlockChanges(session.blocks, blocks, [blocks[index]]);
  return { ...session, blocks };
}

function sameAgentRun(a: AgentRunMeta, b: AgentRunMeta): boolean {
  if (a.name !== b.name || a.agentType !== b.agentType || a.model !== b.model) return false;
  if (a.startedAt !== b.startedAt || a.endedAt !== b.endedAt) return false;
  if (a.steps.length !== b.steps.length) return false;
  return a.steps.every((step, index) => sameAgentStep(step, b.steps[index]));
}

function sameAgentStep(a: AgentStep, b: AgentStep): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.text === b.text &&
    a.toolKind === b.toolKind &&
    a.status === b.status &&
    a.detail === b.detail &&
    a.output === b.output &&
    a.outputTruncated === b.outputTruncated &&
    samePreview(a.preview, b.preview)
  );
}

function capAgentPrompt(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? capHeadTail(text, AGENT_PROMPT_CHARS).text : undefined;
}

function capAgentStepText(value: string): string {
  const text = value.trim();
  if (text.length <= MAX_AGENT_STEP_CHARS) return text;
  return `${text.slice(0, MAX_AGENT_STEP_CHARS)}\u2026`;
}

function findToolIndex(session: Session, patch: { callId: string; title?: string }): number {
  if (patch.callId) {
    const byId = session.blocks.findIndex((block) => block.tool?.callId === patch.callId);
    // An explicit call id is authoritative; title similarity is not identity.
    return byId;
  }
  const needle = normalizeLabel(patch.title || "");
  if (!needle) return -1;
  return session.blocks.findIndex((block) => {
    if (block.role !== "tool" || !block.approval || block.tool?.callId) {
      return false;
    }
    return normalizeLabel(block.text || block.tool?.title || "") === needle;
  });
}

function sealLastStream(blocks: Block[], changed?: Block[], removed?: string[]): Block[] {
  let index = blocks.length - 1;
  while (index >= 0 && blocks[index].role === "system" && !blocks[index].interjection) index--;
  const last = blocks[index];
  if (!last?.streaming || (last.role !== "assistant" && last.role !== "reasoning")) {
    return blocks.slice();
  }
  const next = blocks.slice();
  if (isBareProseStream(last)) {
    next.splice(index, 1);
    removed?.push(last.id);
  } else {
    next[index] = { ...last, streaming: false };
    changed?.push(next[index]);
  }
  return next;
}

function isBareProseStream(block: Block): boolean {
  return block.role === "assistant" && !!block.streaming && !hasReadableText(block.text);
}

function displayLabel(patch: { title?: string; kind?: string }, prev?: Block): string {
  return (
    preferLabel(patch.title, prev?.tool?.title, prev?.text) ||
    kindTitle(patch.kind ?? prev?.tool?.kind)
  );
}

function finalToolLabel(
  session: Session,
  kind: string | undefined,
  title: string | undefined,
  preview?: ToolPreview,
): string {
  const path = preview?.path ? displayPath(preview.path, session.cwd) : preview?.fileName;
  return (
    composeToolTitle({
      kind,
      title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd: session.cwd,
    }) ||
    title?.trim() ||
    kindTitle(kind)
  );
}

function preferLabel(...parts: (string | undefined)[]): string {
  const filled = parts
    .filter((part): part is string => !!part?.trim())
    .map((part) => part.trim())
    .filter((part) => !isCallId(part));
  const strong = filled.filter((part) => !isWeakToolTitle(part));
  const compactStrong = strong.filter((part) => compactLabel(part) === part);
  compactStrong.sort((a, b) => b.length - a.length);
  if (compactStrong[0]) return compactStrong[0];
  // A long command is still more useful than an earlier "Shell" placeholder.
  if (strong[0]) return strong[0];
  const compact = filled.filter((part) => compactLabel(part) === part);
  compact.sort((a, b) => b.length - a.length);
  return compact[0] ?? filled[0] ?? "";
}

function compactLabel(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.includes("\n") || trimmed.length > 240) return undefined;
  return trimmed;
}

function kindTitle(kind?: string): string {
  const key = kind?.trim().toLowerCase() ?? "";
  if (!key || key === "other") return "Working";
  return knownToolKindTitle(key, true) ?? key.replace(/^_/, "").replace(/[_-]+/g, " ");
}

function finishRole(session: Session, role: Block["role"]): Session {
  const changed: Block[] = [];
  const removed: string[] = [];
  const blocks = session.blocks
    .filter((block) => {
      if (role !== "assistant" || !isBareProseStream(block)) return true;
      removed.push(block.id);
      return false;
    })
    .map((block) => {
      if (block.role !== role || !block.streaming) return block;
      const next = { ...block, streaming: false };
      changed.push(next);
      return next;
    });
  registerBlockChanges(session.blocks, blocks, changed, removed);
  return { ...session, blocks };
}
