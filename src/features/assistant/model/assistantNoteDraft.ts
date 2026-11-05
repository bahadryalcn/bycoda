import type {
  AssistantNote,
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";

type Intent = {
  id: string;
  title: string;
  body: string;
  expectedUpdatedAt: number;
  environmentId?: string;
};
type Draft = Intent & { version: 1; intent?: Intent };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Request = (
  input: AssistantRequest,
  expectedEnvironmentId?: string,
) => Promise<AssistantResponse>;
const isIntent = (value: unknown): value is Intent => {
  const item = value as Intent | undefined;
  return Boolean(
    item &&
    typeof item.id === "string" &&
    /^[A-Za-z0-9_-]{1,200}$/.test(item.id) &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    Number.isSafeInteger(item.expectedUpdatedAt) &&
    item.expectedUpdatedAt >= 0,
  );
};
const matches = (note: AssistantNote, intent: Intent) =>
  note.id === intent.id &&
  note.title === (Array.from(intent.title.trim()).slice(0, 200).join("").trim() || "Untitled") &&
  note.body === intent.body.replace(/\r\n?/g, "\n");

/** Persist the exact native note identity before its independent database commit. */
export class AssistantNoteDraft {
  private draft: Draft;
  private pending?: Promise<AssistantNote>;
  readonly key: string;
  constructor(
    original: AssistantNote | null,
    private storage: Storage,
    createId: () => string,
    environmentId?: string,
  ) {
    this.key = `bycoda.assistant.note-draft:${original?.id ?? "new"}`;
    let saved: unknown;
    try {
      saved = JSON.parse(storage.getItem(`${this.key}:record`) ?? "null");
    } catch {
      /* Preserve legacy text below. */
    }
    const record = saved as Draft | null;
    if (
      record?.version === 1 &&
      isIntent(record) &&
      (!original || record.id === original.id) &&
      (!record.intent || (isIntent(record.intent) && record.intent.id === record.id))
    ) {
      this.draft = {
        ...record,
        ...(record.intent ? { ...record.intent, intent: { ...record.intent } } : {}),
      };
    } else {
      let title = original?.title ?? "",
        body = original?.body ?? "";
      try {
        title = storage.getItem(`${this.key}:title`) || title;
        body = storage.getItem(`${this.key}:body`) || body;
      } catch {
        /* The editable draft remains in memory. */
      }
      this.draft = {
        version: 1,
        id: original?.id ?? createId(),
        title,
        body,
        expectedUpdatedAt: original?.updatedAt ?? 0,
        environmentId,
      };
    }
    try {
      this.persist();
    } catch {
      /* Save refuses to dispatch without durable intent. */
    }
  }
  get value(): Readonly<Draft> {
    return this.draft;
  }
  update(patch: Pick<Partial<Intent>, "title" | "body">): void {
    if (this.draft.intent) return;
    this.draft = { ...this.draft, ...patch };
    try {
      this.persist();
    } catch {
      /* Keep editing; explicit Save reports the storage failure. */
    }
  }
  private persist(): void {
    try {
      this.storage.setItem(`${this.key}:record`, JSON.stringify(this.draft));
    } catch {
      throw new Error(
        "The note draft could not be saved on this device. Keep this editor open and retry.",
      );
    }
  }
  save(request: Request): Promise<AssistantNote> {
    if (this.pending) return this.pending;
    if (
      typeof this.draft.environmentId !== "string" ||
      !this.draft.environmentId ||
      (this.draft.intent &&
        (typeof this.draft.intent.environmentId !== "string" || !this.draft.intent.environmentId))
    )
      return Promise.reject(
        new Error(
          "The original Host could not be verified. Keep this draft and reconnect its original computer.",
        ),
      );
    const retry = Boolean(this.draft.intent);
    if (!this.draft.intent) {
      const { id, title, body, expectedUpdatedAt, environmentId } = this.draft;
      this.draft = { ...this.draft, intent: { id, title, body, expectedUpdatedAt, environmentId } };
    }
    try {
      this.persist();
    } catch (error) {
      if (!retry) {
        const { intent: _intent, ...editable } = this.draft;
        this.draft = editable;
      }
      return Promise.reject(error);
    }
    const intent = { ...this.draft.intent! };
    this.pending = (async () => {
      if (retry) {
        const inspected = await request({ op: "notes.get", id: intent.id }, intent.environmentId);
        if (!("note" in inspected))
          throw new Error(
            "The note save could not be verified. Keep the original draft and retry.",
          );
        const prior = inspected.note;
        // Null also covers an owner deleting a committed note after its reply was
        // lost. Native Notes has no creation tombstone receipt; never resurrect it.
        if (!prior)
          throw new Error(
            "The note save is uncertain and the note is no longer available. Keep this draft and review Notes before continuing.",
          );
        if (prior) {
          if (matches(prior, intent)) return prior;
          if (prior.updatedAt !== intent.expectedUpdatedAt || intent.expectedUpdatedAt === 0)
            throw new Error("This note changed on the computer. Refresh it before saving.");
        }
      }
      // The exact native create0 / optimistic edit version is rechecked at commit.
      const { environmentId, ...payload } = intent;
      const result = await request({ op: "notes.save", ...payload }, environmentId);
      if (!result.note || !matches(result.note, intent))
        throw new Error("The note save could not be verified. Keep the original draft and retry.");
      return result.note;
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  clear(): void {
    for (const suffix of [":record", ":title", ":body"]) {
      try {
        this.storage.removeItem(`${this.key}${suffix}`);
      } catch {
        /* A retained successful identity is safely resolved before another write. */
      }
    }
  }
}
