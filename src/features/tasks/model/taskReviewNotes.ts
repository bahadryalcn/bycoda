import { NO_VERDICT, type TaskReviewNote } from "./hostTasks";

export type ReviewFinding = Pick<
  TaskReviewNote,
  "finding" | "suggestion" | "details" | "kind" | "category"
>;
const FINDING_LIMIT = 2000;
const SUGGESTION_LIMIT = 1000;
const MAX_FINDINGS = 12;

/** Explicit findings, with a legacy verdict as the fallback. Ordinary prose is
 * not classified as defects, nor are infrastructure errors treated as reviews. */
export function reviewFindings(
  reply: string,
  review: { verdict: "pass" | "fail"; note: string },
): ReviewFinding[] {
  const blocks = [...reply.matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (const block of blocks.reverse()) {
    try {
      const value: unknown = JSON.parse(block[1]);
      if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray((value as { reviewNotes?: unknown }).reviewNotes)
      )
        continue;
      const notes = (value as { reviewNotes: unknown[] }).reviewNotes
        .flatMap((entry): ReviewFinding[] => {
          if (!entry || typeof entry !== "object") return [];
          const note = entry as Record<string, unknown>;
          if (typeof note.finding !== "string" || !note.finding.trim()) return [];
          const kind = note.kind === "suggestion" ? "suggestion" : "finding";
          if (review.verdict === "pass" && kind !== "suggestion") return [];
          return [
            {
              finding: note.finding.trim().slice(0, FINDING_LIMIT),
              ...(typeof note.suggestion === "string" && note.suggestion.trim()
                ? {
                    suggestion: note.suggestion.trim().slice(0, SUGGESTION_LIMIT),
                  }
                : {}),
              kind,
              // External acceptance requires an explicit next action. Prose alone
              // never changes scheduling or turns an unperformed check into PASS.
              ...(note.category === "external" &&
              typeof note.suggestion === "string" &&
              note.suggestion.trim()
                ? { category: "external" as const }
                : {}),
            },
          ];
        })
        .slice(0, MAX_FINDINGS);
      if (notes.length) {
        if (review.verdict === "fail" && !notes.some((note) => note.kind === "finding"))
          return [
            {
              finding: review.note.trim().slice(0, FINDING_LIMIT),
              kind: "finding" as const,
            },
            ...notes,
          ].slice(0, MAX_FINDINGS);
        return notes;
      }
    } catch {
      // Old reviews and malformed optional notes still retain their verdict.
    }
  }
  return review.verdict === "fail" && review.note !== NO_VERDICT && review.note.trim()
    ? [
        {
          finding: review.note.trim().slice(0, FINDING_LIMIT),
          ...(reply.trim()
            ? {
                details: reply.trim().split(/\r?\n/).slice(0, -1).join("\n").trim().slice(0, 6000),
              }
            : {}),
          kind: "finding",
        },
      ]
    : [];
}

export const findingKey = (finding: string) =>
  finding
    .trim()
    // Line movement in the same file must not manufacture a new defect.
    .replace(/(\.[a-z\d]+):\d+(?:[-–]\d+)?\b/gi, "$1")
    .replace(/\s+/g, " ")
    .toLowerCase();

export function reviewRepairStop(
  findings: readonly ReviewFinding[],
  previous: readonly string[] | undefined,
): { reason: "external" | "no_progress"; message: string } | undefined {
  const required = findings.filter((note) => note.kind === "finding");
  if (!required.length) return undefined;
  if (required.every((note) => note.category === "external"))
    return {
      reason: "external",
      message: `External verification required. ${required.map((note) => note.suggestion).join(" ")}`,
    };
  const current = [...new Set(required.map((note) => findingKey(note.finding)))].sort();
  const earlier = [...new Set(previous?.map(findingKey) ?? [])].sort();
  if (earlier.length && JSON.stringify(current) === JSON.stringify(earlier))
    return {
      reason: "no_progress",
      message:
        "The same findings remain after correction. Inspect the attempt and review before retrying; another identical run will not unblock dependencies.",
    };
  return undefined;
}

/** Repeated findings retain their identity and read state. A resolved finding
 * returning is reopened and unread; repeating it in the same session is idempotent. */
export function addReviewNotes(
  previous: readonly TaskReviewNote[],
  findings: readonly ReviewFinding[],
  sessionId: string | undefined,
  now: number,
  nextId: () => string,
): TaskReviewNote[] {
  const notes = [...previous];
  for (const finding of findings) {
    const at = notes.findIndex(
      (note) =>
        note.kind === finding.kind && findingKey(note.finding) === findingKey(finding.finding),
    );
    if (at < 0) {
      notes.push({
        ...finding,
        id: nextId(),
        sessionId,
        ...(sessionId ? { sessionIds: [sessionId] } : {}),
        createdAt: now,
        updatedAt: now,
        occurrences: 1,
      });
      continue;
    }
    const note = notes[at];
    if (sessionId && note.sessionId === sessionId) continue;
    notes[at] = {
      ...note,
      ...finding,
      category: finding.category,
      sessionId,
      sessionIds: [
        ...new Set([
          ...(note.sessionIds ?? (note.sessionId ? [note.sessionId] : [])),
          ...(sessionId ? [sessionId] : []),
        ]),
      ],
      updatedAt: now,
      occurrences: note.occurrences + 1,
      readAt: note.resolvedAt !== undefined ? undefined : note.readAt,
      resolvedAt: undefined,
    };
  }
  return notes;
}

/** Repair legacy duplicates caused only by changed line numbers. Keep the first
 * identity, all review links, and conservative open/unread state. */
export function coalesceReviewNotes(previous: readonly TaskReviewNote[]): TaskReviewNote[] {
  const result: TaskReviewNote[] = [];
  for (const note of previous) {
    const at = result.findIndex(
      (other) => other.kind === note.kind && findingKey(other.finding) === findingKey(note.finding),
    );
    if (at < 0) {
      result.push(note);
      continue;
    }
    const first = result[at];
    const sessions = [
      ...new Set([
        ...(first.sessionIds ?? (first.sessionId ? [first.sessionId] : [])),
        ...(note.sessionIds ?? (note.sessionId ? [note.sessionId] : [])),
      ]),
    ];
    const latest = first.updatedAt >= note.updatedAt ? first : note;
    result[at] = {
      ...latest,
      id: first.id,
      sessionIds: sessions,
      createdAt: Math.min(first.createdAt, note.createdAt),
      occurrences: Math.max(sessions.length, first.occurrences, note.occurrences),
      readAt:
        first.readAt === undefined || note.readAt === undefined
          ? undefined
          : Math.max(first.readAt, note.readAt),
      resolvedAt:
        first.resolvedAt === undefined || note.resolvedAt === undefined
          ? undefined
          : Math.max(first.resolvedAt, note.resolvedAt),
    };
  }
  return result;
}

export function resolveReviewFindings(
  notes: readonly TaskReviewNote[],
  now: number,
): TaskReviewNote[] {
  return notes.map((note) =>
    note.kind === "finding" && note.resolvedAt === undefined
      ? { ...note, resolvedAt: now, updatedAt: now }
      : note,
  );
}

/** A failed review may still verify earlier defects fixed. Only explicit known
 * IDs from the same structured review are resolved; absent findings prove nothing. */
export function resolveReviewedNotes(
  notes: readonly TaskReviewNote[],
  reply: string,
  now: number,
): TaskReviewNote[] {
  for (const block of [...reply.matchAll(/```json\s*([\s\S]*?)```/gi)].reverse()) {
    try {
      const value = JSON.parse(block[1]);
      if (!Array.isArray(value?.reviewNotes)) continue;
      if (!Array.isArray(value.resolvedNoteIds)) return [...notes];
      const ids: unknown[] = value.resolvedNoteIds;
      if (
        ids.length > 12 ||
        ids.some(
          (id) =>
            typeof id !== "string" ||
            !notes.some((note) => note.id === id && note.kind === "finding"),
        )
      )
        return [...notes];
      return notes.map((note) =>
        ids.includes(note.id) && note.resolvedAt === undefined
          ? { ...note, resolvedAt: now, updatedAt: now }
          : note,
      );
    } catch {
      /* Ignore malformed optional review metadata. */
    }
  }
  return [...notes];
}

export function unreadReviewNotes(notes: readonly TaskReviewNote[] = []): number {
  return notes.filter((note) => note.readAt === undefined).length;
}

/** Only open findings are requirements; suggestions remain optional. */
export function openReviewNotesPrompt(notes: readonly TaskReviewNote[] = []): string {
  const open = notes.filter((note) => note.resolvedAt === undefined);
  if (!open.length) return "";
  return [
    "Open review notes for this task. Fix findings against the original spec; suggestions are optional. A note's status does not replace the task's checks or review.",
    ...open.map(
      (note) =>
        `[${note.kind}${note.category === "external" ? ": external verification" : ""}] ${note.finding}\nNote id: ${note.id}${note.suggestion ? `\nSuggested correction: ${note.suggestion}` : ""}${note.details ? `\nReview details: ${note.details}` : ""}`,
    ),
  ]
    .join("\n\n")
    .slice(0, 12_000);
}
