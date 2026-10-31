import { invoke } from "@tauri-apps/api/core";
import {
  buildBudgetedHandoff,
  handoffHistory,
  type BudgetedHandoff,
  type HandoffHistory,
  type HandoffHistoryMessage,
} from "../../features/sessions/model/handoffBudget";
import { modelContextWindow } from "../../features/sessions/model/models";
import type { Session } from "../../features/sessions/model/session";
import { parseRemotePath } from "../../features/connections/model/remoteProjects";
import { hostFeatureRequest } from "../../features/connections/model/hostFeatureClient";

/** The archive writers reject more than 20,000 messages or 8 MiB; stay below both. */
const ARCHIVE_MAX_MESSAGES = 19_000;
const ARCHIVE_MAX_BYTES = 7 * 1024 * 1024;
const encoder = new TextEncoder();
const bytesOf = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).length;

/**
 * Keeps the archive inside the writer's limits for a very long conversation. The
 * first user message and the most recent messages stay; the middle is replaced by
 * one note saying how much was left out. The full transcript is never touched.
 */
export function fitHandoffArchive(history: HandoffHistory): {
  history: HandoffHistory;
  omitted: number;
} {
  const { messages, ...rest } = history;
  const sizes = messages.map(bytesOf);
  const baseBytes = bytesOf({ ...rest, messages: [] });
  const total = sizes.reduce((sum, size) => sum + size, baseBytes);
  if (messages.length <= ARCHIVE_MAX_MESSAGES && total <= ARCHIVE_MAX_BYTES)
    return { history, omitted: 0 };
  const noteReserve = 1024;
  let budget = ARCHIVE_MAX_BYTES - baseBytes - noteReserve;
  let slots = ARCHIVE_MAX_MESSAGES - 1;
  const firstUserIndex = messages.findIndex(
    (message) => message.role === "user",
  );
  const kept = new Set<number>();
  if (firstUserIndex >= 0 && sizes[firstUserIndex] <= ARCHIVE_MAX_BYTES / 16) {
    kept.add(firstUserIndex);
    budget -= sizes[firstUserIndex];
    slots--;
  }
  const clipped = new Map<number, HandoffHistoryMessage>();
  for (let index = messages.length - 1; index >= 0 && slots > 0; index--) {
    if (kept.has(index)) continue;
    if (sizes[index] <= budget) {
      kept.add(index);
      budget -= sizes[index];
      slots--;
      continue;
    }
    // One oversized recent message: keep its tail so the newest part survives.
    if (
      !clipped.size &&
      kept.size <= (firstUserIndex >= 0 ? 1 : 0) &&
      budget > 4096
    ) {
      const text = messages[index].text.slice(-Math.floor((budget - 2048) / 4));
      clipped.set(index, {
        ...messages[index],
        text: `[start omitted]\n${text}`,
      });
      kept.add(index);
      budget = 0;
    }
    break;
  }
  const omitted = messages.length - kept.size;
  const note: HandoffHistoryMessage = {
    id: "handoff-archive-omitted",
    role: "assistant",
    text: `[bycoda note: this conversation was too long for the handoff archive. ${omitted} message(s) between the first request and the most recent ones were left out of this file; the full conversation remains in the original session.]`,
  };
  const ordered = [...kept].sort((a, b) => a - b);
  const result: HandoffHistoryMessage[] = [];
  let noteAdded = false;
  ordered.forEach((index, position) => {
    if (!noteAdded && position > 0 && index - ordered[position - 1] > 1) {
      result.push(note);
      noteAdded = true;
    }
    result.push(clipped.get(index) ?? messages[index]);
  });
  if (!noteAdded) result.unshift(note);
  return { history: { ...rest, messages: result }, omitted };
}

/** Persist on the owning machine before forgetting the outgoing provider session. */
export async function prepareBudgetedHandoff(
  session: Session,
  brief: string,
  request: string,
): Promise<BudgetedHandoff> {
  const { history, omitted } = fitHandoffArchive(handoffHistory(session));
  let historyPath: string | undefined;
  let saveFailed = false;
  try {
    const archive = parseRemotePath(session.cwd)
      ? await hostFeatureRequest<{ path: string }>(
          session.cwd,
          "handoff-history-v1",
          "handoff_history_save",
          { history },
        )
      : await invoke<{ path: string }>("handoff_history_save", { history });
    historyPath = archive.path;
  } catch (error) {
    // The archive is optional context: continue with the recap and recent messages.
    console.warn("[handoff] history archive could not be saved", error);
    saveFailed = true;
  }
  const budgeted = buildBudgetedHandoff(session, {
    contextWindow: modelContextWindow(session.model, session.harness),
    request,
    brief,
    historyPath,
  });
  if (budgeted.notice) return budgeted;
  if (saveFailed)
    return {
      ...budgeted,
      notice:
        "Earlier conversation could not be saved for the new provider. It receives the recap and the most recent messages only; the full conversation remains in this session.",
    };
  if (omitted > 0)
    return {
      ...budgeted,
      notice: `This conversation is very long: ${omitted} older message(s) were left out of the saved handoff history. The full conversation remains in this session.`,
    };
  return budgeted;
}
