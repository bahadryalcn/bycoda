import type {
  AssistantActivity,
  AssistantNote,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import { isoTimestamp, utcDay } from "../../../src/shared/lib/time/timestamps";

export type AssistantDailyNoteDeps = {
  ports: {
    listNotes?(): Promise<AssistantNote[]>;
    saveNote?(input: {
      id?: string;
      title: string;
      body: string;
      expectedUpdatedAt?: number;
    }): Promise<unknown>;
    onError?(error: unknown): void;
  };
  runtime<T>(id: string, fallback: T): Promise<T>;
  now(): number;
};

/** Appends new activity lines to the day's assistant note, keeping event markers for dedupe. */
export async function appendAssistantDailyNote(
  deps: AssistantDailyNoteDeps,
  profile: AssistantProfile,
  events: AssistantActivity[],
  options: { strict?: boolean; day?: string } = {},
) {
  if (!deps.ports.listNotes || !deps.ports.saveNote) {
    if (options.strict) throw new Error("Global assistant notes are unavailable on this Host.");
    return;
  }
  const title = `${profile.name || "Computer use"} · ${options.day ?? utcDay(deps.now())}`;
  if (await deps.runtime(`notebookSuppressed:${title}`, false)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const note = (await deps.ports.listNotes()).find(
        (item) => item.title === title && item.tags.includes("assistant"),
      );
      const additions = events
        .filter((event) => !note?.body.includes(`<!-- assistant-event:${event.id} -->`))
        .map(
          (event) =>
            `- ${isoTimestamp(event.createdAt)?.slice(11, 16) ?? "--:--"} UTC · ${event.summary} <!-- assistant-event:${event.id} -->`,
        );
      if (!additions.length) return;
      const body = [note?.body ?? "", ...additions].filter(Boolean).join("\n");
      if (body.length > 100000)
        throw new Error(
          "The daily assistant note reached its size limit; History retains the remaining events.",
        );
      await deps.ports.saveNote({
        ...(note ? { id: note.id } : {}),
        title,
        body,
        expectedUpdatedAt: note?.updatedAt ?? 0,
      });
      return;
    } catch (error) {
      if (attempt === 1) {
        if (options.strict) throw error;
        deps.ports.onError?.(error);
      }
    }
  }
}
