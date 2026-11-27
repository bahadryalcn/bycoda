import { errorText } from "../../../shared/lib/errors";
import { t } from "../../../shared/i18n";

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
 * Delete conversations, at most `concurrency` at a time (default one). A
 * failure is recorded and the rest still run; a conversation that started
 * running in the meantime is skipped.
 */
export async function deleteSessionsInBulk(
  sessionIds: readonly string[],
  options: {
    isRunning: (sessionId: string) => boolean;
    /** Resolves false when the conversation was kept; throws on an error. */
    deleteOne: (sessionId: string) => Promise<boolean | void>;
    onProgress?: (completed: number, total: number) => void;
    concurrency?: number;
  },
): Promise<BulkSessionDeleteResult> {
  const result: BulkSessionDeleteResult = {
    deleted: [],
    skipped: [],
    failed: [],
  };
  const report = () =>
    options.onProgress?.(
      result.deleted.length + result.skipped.length + result.failed.length,
      sessionIds.length,
    );
  const deleteNext = async (sessionId: string) => {
    if (options.isRunning(sessionId)) {
      result.skipped.push(sessionId);
      return;
    }
    try {
      if ((await options.deleteOne(sessionId)) === false) {
        result.failed.push({ sessionId });
      } else {
        result.deleted.push(sessionId);
      }
    } catch (error) {
      const detail = errorText(error);
      if (RUNNING_REFUSAL.test(detail)) result.skipped.push(sessionId);
      else result.failed.push({ sessionId, error: detail });
    }
  };
  options.onProgress?.(0, sessionIds.length);
  let next = 0;
  const worker = async () => {
    while (next < sessionIds.length) {
      await deleteNext(sessionIds[next++]!);
      report();
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? 1, sessionIds.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return result;
}

/**
 * What a bulk delete did, as counts. The words are produced by `bulkDeleteNoticeText`
 * in the owner's language; `text` is only for a message that was translated where it
 * was raised (a refused start, an unexpected error).
 */
export type BulkDeleteNotice =
  | {
      kind: "outcome";
      deleted: number;
      skipped: number;
      failed: number;
      /** First raw error of a failed deletion, kept verbatim. */
      failureDetail?: string | undefined;
    }
  | { kind: "text"; text: string };

export function bulkDeleteNotice(
  result: Pick<BulkSessionDeleteResult, "deleted" | "skipped" | "failed">,
): BulkDeleteNotice {
  return {
    kind: "outcome",
    deleted: result.deleted.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
    failureDetail: result.failed.find((entry) => entry.error)?.error,
  };
}

/** Translated sentences for what a bulk delete left behind; null when nothing needs saying. */
export function bulkDeleteNoticeText(notice: BulkDeleteNotice): string | null {
  return bulkDeleteNoticeTextWith(notice, t);
}

export function bulkDeleteNoticeTextWith(
  notice: BulkDeleteNotice,
  t: (message: string, values?: Record<string, unknown>) => string,
): string | null {
  if (notice.kind === "text") return notice.text;
  const parts: string[] = [];
  if (notice.deleted > 0) {
    parts.push(
      notice.deleted === 1
        ? t("1 conversation deleted.")
        : t("{p0} conversations deleted.", { p0: notice.deleted }),
    );
  }
  if (notice.skipped > 0) {
    parts.push(
      notice.skipped === 1
        ? t("1 running conversation was skipped.")
        : t("{p0} running conversations were skipped.", { p0: notice.skipped }),
    );
  }
  if (notice.failed > 0) {
    const detail = notice.failureDetail;
    if (detail) {
      parts.push(
        notice.failed === 1
          ? t("1 conversation could not be deleted: {p0}.", { p0: detail })
          : t("{p0} conversations could not be deleted: {p1}.", {
              p0: notice.failed,
              p1: detail,
            }),
      );
    } else {
      parts.push(
        notice.failed === 1
          ? t("1 conversation could not be deleted.")
          : t("{p0} conversations could not be deleted.", { p0: notice.failed }),
      );
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
