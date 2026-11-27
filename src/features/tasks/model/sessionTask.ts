import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import type { Session } from "../../sessions";
import { newTaskDraft, saveTask, taskMachines, type BoardTask, type TaskDraft } from "./taskClient";

const TITLE_LENGTH = 80;

/** The first non-empty line of the request, as the task's title. */
export function taskTitleFromRequest(request: string): string {
  const first = request.split(/\r?\n/).find((line) => line.trim()) ?? "";
  return truncateGraphemes(first.trim(), TITLE_LENGTH);
}

/** The owner's own `/task` words become the task as typed, on the session's agent and settings. */
export function sessionTaskDraft(
  session: Pick<
    Session,
    "id" | "cwd" | "harness" | "model" | "modelSettings" | "runtimeMode" | "providerAccountId"
  >,
  request: string,
): TaskDraft {
  return {
    ...newTaskDraft(session.cwd, session.harness, session.model),
    ...(session.providerAccountId ? { providerAccountId: session.providerAccountId } : {}),
    modelSettings: session.modelSettings,
    runtimeMode: session.runtimeMode,
    title: taskTitleFromRequest(request),
    prompt: request,
    request,
    origin: { kind: "session", sessionId: session.id },
    maxRunMinutes: 0,
    review: true,
    autoMerge: false,
    continueUntilDone: false,
  };
}

/** One draft per session and request: a repeated or retried send reuses its creation receipt. */
const attempts = new Map<string, { draft: TaskDraft; saving?: Promise<BoardTask> }>();

/** Creates a to-do task from `/task <request>`; the same request sent again yields the same task. */
export function createSessionTask(
  session: Parameters<typeof sessionTaskDraft>[0],
  request: string,
): Promise<BoardTask> {
  const key = JSON.stringify([session.id, request]);
  const attempt = attempts.get(key) ?? { draft: sessionTaskDraft(session, request) };
  attempts.set(key, attempt);
  attempt.saving ??= taskMachines()
    .then((machines) => saveTask(machines, attempt.draft, "todo"))
    .then(
      (task) => {
        attempts.delete(key);
        return task;
      },
      (error: unknown) => {
        // The draft and its creation receipt stay, so a retry reconciles instead of duplicating.
        attempt.saving = undefined;
        throw error;
      },
    );
  return attempt.saving;
}
