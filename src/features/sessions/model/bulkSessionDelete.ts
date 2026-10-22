export type BulkSessionDeleteResult = {
  deleted: string[];
  /** Running conversations, left untouched. */
  skipped: string[];
  failed: { sessionId: string; error?: string }[];
};

// A host refuses to delete a session that is still running.
const RUNNING_REFUSAL = /stop this session before deleting/i;

export function splitRunningSessions(
  sessionIds: readonly string[],
  runningSessionIds: ReadonlySet<string>,
): { deletable: string[]; running: string[] } {
  const deletable: string[] = [];
  const running: string[] = [];
  for (const id of new Set(sessionIds)) {
    (runningSessionIds.has(id) ? running : deletable).push(id);
  }
  return { deletable, running };
}

/**
 * Delete one conversation at a time. A failure is recorded and the rest still
 * run; a conversation that started running in the meantime is skipped.
 */
export async function deleteSessionsInBulk(
  sessionIds: readonly string[],
  options: {
    isRunning: (sessionId: string) => boolean;
    /** Resolves false when the conversation was kept; throws on an error. */
    deleteOne: (sessionId: string) => Promise<boolean | void>;
    onProgress?: (completed: number, total: number) => void;
  },
): Promise<BulkSessionDeleteResult> {
  const result: BulkSessionDeleteResult = {
    deleted: [],
    skipped: [],
    failed: [],
  };
  options.onProgress?.(0, sessionIds.length);
  for (const sessionId of sessionIds) {
    if (options.isRunning(sessionId)) {
      result.skipped.push(sessionId);
      options.onProgress?.(
        result.deleted.length + result.skipped.length + result.failed.length,
        sessionIds.length,
      );
      continue;
    }
    try {
      if ((await options.deleteOne(sessionId)) === false) {
        result.failed.push({ sessionId });
      } else {
        result.deleted.push(sessionId);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (RUNNING_REFUSAL.test(detail)) result.skipped.push(sessionId);
      else result.failed.push({ sessionId, error: detail });
    }
    options.onProgress?.(
      result.deleted.length + result.skipped.length + result.failed.length,
      sessionIds.length,
    );
  }
  return result;
}

export function bulkDeleteOutcome(result: BulkSessionDeleteResult): string {
  const success =
    result.deleted.length > 0 ? `${conversations(result.deleted.length)} deleted.` : "";
  return [success, bulkDeleteSummary(result)].filter(Boolean).join(" ");
}

const conversations = (count: number, adjective = "") =>
  `${count} ${adjective ? `${adjective} ` : ""}conversation${count === 1 ? "" : "s"}`;

export function bulkDeleteConfirmMessage(deletableCount: number, runningCount: number): string {
  const question = `Delete ${
    deletableCount === 1 ? "this conversation" : conversations(deletableCount)
  }? This can’t be undone.`;
  if (runningCount === 0) return question;
  return `${question}\n\n${conversations(runningCount, "running")} will be skipped.`;
}

/** Short notice for what a bulk delete left behind; null when all went. */
export function bulkDeleteSummary(
  result: Pick<BulkSessionDeleteResult, "skipped" | "failed">,
): string | null {
  const parts: string[] = [];
  if (result.skipped.length > 0) {
    const count = result.skipped.length;
    parts.push(`${conversations(count, "running")} ${count === 1 ? "was" : "were"} skipped`);
  }
  if (result.failed.length > 0) {
    const detail = result.failed.find((entry) => entry.error)?.error;
    parts.push(
      `${conversations(result.failed.length)} could not be deleted${detail ? `: ${detail}` : ""}`,
    );
  }
  return parts.length > 0 ? `${parts.join(". ")}.` : null;
}
