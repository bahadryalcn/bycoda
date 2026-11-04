import { createHash } from "node:crypto";
import type { HostStore } from "../../store";
import type { AsyncHostNotes } from "../../host-notes-async";
import type { HostNote } from "../../host-notes";
import type {
  AssistantQuickNoteJob,
  AssistantQuickJob,
} from "../../../src/shared/model/host-contracts/assistant";

export type AssistantQuickReceipt = {
  jobId: string;
  noteId: string;
  fingerprint: string;
  state: "pending" | "writing" | "completed" | "unknown" | "conflict";
  createdAt: number;
  updatedAt: number;
  message: string;
  noteUpdatedAt?: number;
};
export type AssistantQuickResult = {
  state: "completed" | "waiting";
  noteId?: string;
  message: string;
};
export const assistantQuickNoteId = (jobId: string) =>
  `assistant-quick-${createHash("sha256").update(jobId).digest("hex")}`;
export const assistantQuickFingerprint = (job: AssistantQuickJob) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        id: job.id,
        title: job.title,
        request: job.request,
        action: job.quickAction,
      }),
    )
    .digest("hex");
const marker = (id: string) =>
  `assistant-quick:${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
export interface AssistantQuickPorts {
  notes(): Pick<AsyncHostNotes, "get" | "save">;
  /** Rechecked by AsyncHostNotes before its actual SQLite mutation. */
  authorized(job: AssistantQuickNoteJob): Promise<boolean>;
  now?(): number;
}
/** A finite global note creation. There is no generic tool or RPC dispatcher. */
export class HostAssistantQuickJobs {
  readonly ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: HostStore,
    private readonly ports: AssistantQuickPorts,
  ) {
    this.ready = (async () => {
      await store.ready;
      await store.db.scope(() =>
        store.db.exec(
          "CREATE TABLE IF NOT EXISTS assistant_quick_jobs(job_id TEXT PRIMARY KEY,value TEXT NOT NULL)",
        ),
      );
    })();
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  async receipt(jobId: string): Promise<AssistantQuickReceipt | undefined> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_quick_jobs WHERE job_id=?")
      .get(jobId);
    return row ? JSON.parse(row.value) : undefined;
  }
  private async write(record: AssistantQuickReceipt) {
    await this.store.transaction(
      () =>
        this.store.db
          .prepare(
            "INSERT INTO assistant_quick_jobs(job_id,value) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET value=excluded.value",
          )
          .run(record.jobId, JSON.stringify({ ...record, updatedAt: this.now() })),
      "critical",
    );
    return record;
  }
  private matches(note: HostNote | null, job: AssistantQuickNoteJob, noteId: string) {
    return (
      !!note &&
      note.id === noteId &&
      !note.sourceCwd &&
      !note.sourceSessionId &&
      note.tags.includes("assistant") &&
      note.tags.includes(marker(job.id)) &&
      note.title === job.quickAction.title &&
      note.body === job.quickAction.body
    );
  }
  run(job: AssistantQuickNoteJob): Promise<AssistantQuickResult> {
    const task = this.tail.then(() => this.execute(job));
    this.tail = task.catch(() => undefined);
    return task;
  }
  private async execute(job: AssistantQuickNoteJob): Promise<AssistantQuickResult> {
    await this.ready;
    const fingerprint = assistantQuickFingerprint(job),
      noteId = assistantQuickNoteId(job.id);
    let receipt = await this.receipt(job.id);
    if (receipt && (receipt.fingerprint !== fingerprint || receipt.noteId !== noteId))
      return {
        state: "waiting",
        message:
          "The saved quick-job payload changed. Inspect its original note intent; it will not be replayed.",
      };
    if (receipt?.state === "completed")
      return { state: "completed", noteId, message: "The reviewed global note was created." };
    if (!receipt)
      receipt = await this.write({
        jobId: job.id,
        noteId,
        fingerprint,
        state: "pending",
        createdAt: this.now(),
        updatedAt: this.now(),
        message: "The owner reviewed this exact global note creation.",
      });
    let notes: Pick<AsyncHostNotes, "get" | "save">, existing: HostNote | null;
    try {
      notes = this.ports.notes();
      existing = await notes.get(noteId);
    } catch (error) {
      return {
        state: "waiting",
        message: `The quick note cannot be inspected yet. No new write was issued: ${String(error).slice(0, 500)}`,
      };
    }
    if (receipt.state !== "pending") {
      if (this.matches(existing, job, noteId)) {
        await this.write({
          ...receipt,
          state: "completed",
          noteUpdatedAt: existing!.updatedAt,
          message: "The exact owned note was reconciled without another write.",
        });
        return { state: "completed", noteId, message: "The reviewed global note was created." };
      }
      await this.write({
        ...receipt,
        state: existing ? "conflict" : "unknown",
        message: existing
          ? "The note changed or belongs to another source. Inspect it; this quick job will not overwrite it."
          : "The prior note creation has no confirmed result. Inspect Notes; this quick job will not create another note.",
      });
      return {
        state: "waiting",
        message: existing
          ? "The quick note changed or has a different owner. Owner inspection is required."
          : "The quick note result is unknown or missing. Owner inspection is required; no replay was issued.",
      };
    }
    if (existing) {
      await this.write({
        ...receipt,
        state: "conflict",
        message: "The deterministic note ID was already occupied before creation.",
      });
      return {
        state: "waiting",
        message: "A note already occupies this quick job's ID. It was not overwritten.",
      };
    }
    if (!(await this.ports.authorized(job)))
      return {
        state: "waiting",
        message: "This quick job was stopped, paused or changed before note creation.",
      };
    receipt = await this.write({
      ...receipt,
      state: "writing",
      message: "The exact note creation was admitted once; its original identity is retained.",
    });
    try {
      const note = await notes.save(
        {
          id: noteId,
          title: job.quickAction.title,
          body: job.quickAction.body,
          tags: ["assistant", marker(job.id)],
        },
        0,
        undefined,
        async () => {
          await this.store.db.checkAuthorization();
          return this.ports.authorized(job);
        },
      );
      if (!this.matches(note, job, noteId))
        throw new Error("The note receipt did not match its exact global source and payload.");
      await this.write({
        ...receipt,
        state: "completed",
        noteUpdatedAt: note.updatedAt,
        message: "The exact owned global note creation completed.",
      });
      return { state: "completed", noteId, message: "The reviewed global note was created." };
    } catch (error) {
      await this.write({
        ...receipt,
        state: "unknown",
        message: `Note creation needs inspection; its original identity will not be replayed. ${String(error).slice(0, 500)}`,
      });
      return {
        state: "waiting",
        message:
          "The quick note creation result is unknown. Inspect Notes before issuing another note creation.",
      };
    }
  }
}
