import type { UserQuestionPrompt } from "./userQuestion";
import type { QuestionDraftAttachment } from "./questionAttachments";
import { registerParentInput, canPublishParentInput } from "../data/parentInputClosure";
import { copyNativeCaptureData } from "../../../shared/lib/native-capture-json";

export type QuestionDraft = {
  step: number;
  answers: Record<string, string[]>;
  custom: Record<string, string>;
  notes?: Record<string, string>;
  attachments?: Record<string, QuestionDraftAttachment[]>;
  /** A void decision callback is not proof that the provider consumed it. */
  delivery?: "sending" | "unknown";
  pendingAction?: "answer" | "dismiss";
};
export const QUESTION_DRAFT_LIMITS = Object.freeze({
  lineages: 64,
  bytes: 4 * 1024 * 1024,
  lineageBytes: 1024 * 1024,
});
export type QuestionDraftFailure =
  | "capacity"
  | "size"
  | "closed"
  | "invalid"
  | "pending"
  | "retired";
export type QuestionDraftResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: QuestionDraftFailure };
export type QuestionDraftReservation = {
  read(): QuestionDraft | undefined;
  current(): boolean;
  write(draft: QuestionDraft, external?: boolean): QuestionDraftResult<QuestionDraft>;
  refresh(prompt: UserQuestionPrompt): QuestionDraftResult;
  release(): void;
};
type Entry = {
  mapKey: string | symbol;
  scope?: string;
  key: string;
  prompt: UserQuestionPrompt;
  draft: QuestionDraft;
  stored: boolean;
  bytes: number;
  mounts: number;
  associations: number;
  sessionId?: string;
  originalSessionId?: string;
  profile: boolean;
  ambiguous: boolean;
  retired: boolean;
  privateOwner?: object;
  binding?: ReturnType<typeof registerParentInput>;
};
type State = {
  entries: Map<string | symbol, Entry>;
  bytes: number;
  version: number;
  listeners: Set<() => void>;
  privateOwners: WeakMap<object, Entry>;
};
const STATE = Symbol.for("bycoda.question-drafts.bounded.v1");
const keeper = globalThis as unknown as Record<symbol, State | undefined>;
const state = (keeper[STATE] ??= {
  entries: new Map(),
  bytes: 0,
  version: 0,
  listeners: new Set(),
  privateOwners: new WeakMap(),
});
state.privateOwners ??= new WeakMap();
const empty = (): QuestionDraft => ({ step: 0, answers: {}, custom: {} });
const refused = (reason: QuestionDraftFailure): QuestionDraftResult<never> => ({
  ok: false,
  reason,
});
function changed() {
  state.version = state.version === Number.MAX_SAFE_INTEGER ? 0 : state.version + 1;
  // Freeze this notification turn: listeners may add/remove listeners re-entrantly.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      /* Observers cannot discard an already retained answer. */
    }
  }
}
export const getQuestionDraftCapacitySnapshot = () => state.version;
export function subscribeQuestionDraftCapacity(listener: () => void) {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
/** Semantic identity excludes dynamic transport feedback and deadlines. */
export function questionDraftKey(scope: string | undefined, prompt: UserQuestionPrompt): string {
  return JSON.stringify([
    scope ?? null,
    prompt.providerTurnId ?? null,
    prompt.callId ?? null,
    prompt.requestId,
    prompt.title ?? null,
    prompt.behavior ?? null,
    prompt.dismissAction ?? null,
    prompt.questions.map((question) => [
      question.id,
      question.header ?? null,
      question.prompt,
      question.multiSelect,
      question.allowCustom,
      question.preserveCustomWhitespace ?? false,
      question.options.map((option) => [
        option.id,
        option.label,
        option.description ?? null,
        option.literal ?? false,
      ]),
    ]),
  ]);
}
function sourceKey(prompt: UserQuestionPrompt) {
  return JSON.stringify([prompt.providerTurnId ?? null, prompt.callId ?? null, prompt.requestId]);
}
function pending(entry: Entry) {
  return (
    !!entry.draft.delivery ||
    entry.prompt.delivery === "sending" ||
    entry.prompt.delivery === "unknown" ||
    entry.prompt.delivery === "queued"
  );
}
function nonempty(entry: Entry) {
  return (
    pending(entry) ||
    Object.values(entry.draft.attachments ?? {}).some((files) => files.length > 0) ||
    entry.draft.step > 0 ||
    Object.values(entry.draft.answers).some((value) => value.length > 0) ||
    Object.values(entry.draft.notes ?? {}).some((value) => value.length > 0) ||
    Object.values(entry.draft.custom).some((value) => value.length > 0)
  );
}
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = Object.keys(left),
    b = Object.keys(right);
  return (
    a.length === b.length &&
    a.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}
/** Logical retained-data accounting, not physical JS heap/RSS. */
function measured(value: unknown): number {
  let bytes = 256,
    nodes = 0;
  const visiting = new Set<object>();
  const add = (amount: number) => {
    bytes += amount;
    if (bytes > QUESTION_DRAFT_LIMITS.lineageBytes) throw new Error("size");
  };
  const string = (text: string) => {
    if (text.length > QUESTION_DRAFT_LIMITS.lineageBytes) throw new Error("size");
    add(new TextEncoder().encode(JSON.stringify(text)).byteLength);
  };
  const walk = (input: unknown, depth: number) => {
    if (++nodes > 65_536 || depth > 16) throw new Error("size");
    if (typeof input === "string") {
      string(input);
      return;
    }
    if (input === undefined) {
      add(16);
      return;
    }
    if (input === null || typeof input === "boolean") {
      add(5);
      return;
    }
    if (typeof input === "number" && Number.isFinite(input) && !Object.is(input, -0)) {
      add(24);
      return;
    }
    if (!input || typeof input !== "object" || visiting.has(input)) throw new Error("invalid");
    const array = Array.isArray(input);
    if (
      Object.getPrototypeOf(input) !== (array ? Array.prototype : Object.prototype) &&
      Object.getPrototypeOf(input) !== null
    )
      throw new Error("invalid");
    visiting.add(input);
    const keys = Reflect.ownKeys(input).filter((key) => !(array && key === "length"));
    if (array && keys.length !== input.length) throw new Error("invalid");
    add(2);
    for (const key of keys) {
      if (typeof key !== "string") throw new Error("invalid");
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !("value" in field)) throw new Error("invalid");
      string(key);
      add(2);
      walk(field.value, depth + 1);
    }
    visiting.delete(input);
  };
  walk(value, 0);
  return bytes;
}
function packet(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
  draft: QuestionDraft,
  sessionId?: string,
) {
  try {
    measured({ scope, prompt, draft, sessionId });
    if (
      !Number.isSafeInteger(draft.step) ||
      draft.step < 0 ||
      !draft.answers ||
      !draft.custom ||
      Object.values(draft.answers).some(
        (answer) => !Array.isArray(answer) || answer.some((text) => typeof text !== "string"),
      ) ||
      Object.values(draft.custom).some((text) => typeof text !== "string") ||
      (draft.notes !== undefined &&
        (typeof draft.notes !== "object" ||
          draft.notes === null ||
          Array.isArray(draft.notes) ||
          Object.values(draft.notes).some((text) => typeof text !== "string"))) ||
      (draft.delivery !== undefined &&
        draft.delivery !== "sending" &&
        draft.delivery !== "unknown") ||
      (draft.pendingAction !== undefined &&
        draft.pendingAction !== "answer" &&
        draft.pendingAction !== "dismiss")
    )
      return refused("invalid");
    const key = questionDraftKey(scope, prompt);
    const bytes = measured({ scope, key, prompt, draft, sessionId });
    const copied = copyNativeCaptureData({ prompt, draft });
    return { ok: true as const, value: { key, bytes, ...copied } };
  } catch (error) {
    return refused(
      error instanceof Error &&
        (error.message === "size" || ("code" in error && error.code === "capacity"))
        ? "size"
        : "invalid",
    );
  }
}
function live(entry: Entry) {
  return !entry.retired && state.entries.get(entry.mapKey) === entry;
}
function registerRetained(entry: Entry) {
  if (entry.binding || (!entry.stored && !pending(entry))) return;
  entry.binding = registerParentInput({
    kind: "question-draft",
    ...(entry.profile ? { scope: "profile" as const } : {}),
    sessionId: entry.sessionId,
    snapshot: () => ({
      source: "retained-question-draft",
      draftScope: entry.scope,
      questionKey: entry.key,
      prompt: entry.prompt,
      draft: entry.draft,
    }),
    missingCoverage: ["decision-conservation"],
  });
}
function remove(entry: Entry) {
  if (!live(entry)) return;
  state.entries.delete(entry.mapKey);
  state.bytes -= entry.bytes;
  entry.retired = true;
  if (entry.privateOwner) state.privateOwners.delete(entry.privateOwner);
  entry.binding?.release();
  entry.binding = undefined;
  changed();
}
function releaseEmpty(entry: Entry) {
  if (
    !entry.mounts &&
    !entry.associations &&
    (entry.scope ? !entry.stored && !pending(entry) : !nonempty(entry))
  )
    remove(entry);
}
function establish(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
  mapKey?: string | symbol,
): QuestionDraftResult<Entry> {
  const checked = packet(scope, prompt, empty());
  if (!checked.ok) return checked;
  const key = mapKey ?? checked.value.key;
  const existing = state.entries.get(key);
  if (existing) return { ok: true, value: existing };
  if (
    scope &&
    [...state.entries.values()].some(
      (entry) =>
        entry.scope === scope && pending(entry) && sourceKey(entry.prompt) === sourceKey(prompt),
    )
  )
    return refused("pending");
  if (
    state.entries.size >= QUESTION_DRAFT_LIMITS.lineages ||
    state.bytes + checked.value.bytes > QUESTION_DRAFT_LIMITS.bytes
  )
    return refused("capacity");
  const entry: Entry = {
    mapKey: key,
    scope,
    ...checked.value,
    stored: false,
    mounts: 0,
    associations: 0,
    profile: false,
    ambiguous: false,
    retired: false,
  };
  state.entries.set(key, entry);
  state.bytes += entry.bytes;
  changed();
  return { ok: true, value: entry };
}
function replace(
  entry: Entry,
  prompt: UserQuestionPrompt,
  draft: QuestionDraft,
  external: boolean,
): QuestionDraftResult<QuestionDraft> {
  if (!live(entry)) return refused("retired");
  if (
    !external &&
    !canPublishParentInput(
      entry.originalSessionId ?? entry.sessionId,
      entry.profile ? "profile" : undefined,
    )
  )
    return refused("closed");
  if (entry.ambiguous && !external) return refused("invalid");
  if (!external && entry.stored && pending(entry)) {
    const originalBody = { ...entry.draft, delivery: undefined };
    const nextBody = { ...draft, delivery: undefined };
    if (
      !same(originalBody, nextBody) ||
      (draft.delivery !== entry.draft.delivery &&
        !(entry.draft.delivery === "sending" && draft.delivery === "unknown"))
    )
      return refused("pending");
  }
  const checked = packet(entry.scope, prompt, draft, entry.sessionId);
  if (!checked.ok) return checked;
  if (checked.value.key !== entry.key) return refused("retired");
  if (state.bytes - entry.bytes + checked.value.bytes > QUESTION_DRAFT_LIMITS.bytes)
    return refused("capacity");
  state.bytes += checked.value.bytes - entry.bytes;
  Object.assign(entry, checked.value, { stored: true });
  registerRetained(entry);
  entry.binding?.changed();
  changed();
  return { ok: true, value: entry.draft };
}
function associate(
  entry: Entry,
  sessionId: string | undefined,
  profile = false,
): QuestionDraftResult {
  if (!live(entry)) return refused("retired");
  if (entry.ambiguous) return refused("invalid");
  if ((entry.sessionId && entry.sessionId !== sessionId) || (entry.profile && !profile)) {
    entry.binding?.release();
    entry.binding = undefined;
    entry.sessionId = undefined;
    entry.profile = false;
    entry.ambiguous = true;
    registerRetained(entry);
    changed();
    return refused("invalid");
  }
  const checked = packet(entry.scope, entry.prompt, entry.draft, sessionId);
  if (!checked.ok) return checked;
  if (state.bytes - entry.bytes + checked.value.bytes > QUESTION_DRAFT_LIMITS.bytes)
    return refused("capacity");
  if (entry.sessionId !== sessionId || entry.profile !== profile) {
    state.bytes += checked.value.bytes - entry.bytes;
    entry.bytes = checked.value.bytes;
    entry.binding?.release();
    entry.binding = undefined;
    entry.sessionId = sessionId;
    entry.originalSessionId ??= sessionId;
    entry.profile = profile;
    registerRetained(entry);
    changed();
  }
  return { ok: true, value: undefined };
}
/** Layout-only reservation: aborted renders must not allocate cache owners. */
export function reserveQuestionDraft(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
  sessionId?: string,
  privateMountOwner?: object,
): QuestionDraftResult<QuestionDraftReservation> {
  const previous =
    !scope && privateMountOwner ? state.privateOwners.get(privateMountOwner) : undefined;
  const found =
    previous && live(previous)
      ? { ok: true as const, value: previous }
      : establish(scope, prompt, scope ? undefined : Symbol("private-question-mount"));
  if (!found.ok) return found;
  const entry = found.value;
  if (!scope && privateMountOwner) {
    entry.privateOwner = privateMountOwner;
    state.privateOwners.set(privateMountOwner, entry);
  }
  const associated = associate(entry, sessionId, !sessionId);
  if (!associated.ok) {
    releaseEmpty(entry);
    return associated;
  }
  const refreshed = packet(scope, prompt, entry.draft, entry.sessionId);
  if (!refreshed.ok) {
    releaseEmpty(entry);
    return refreshed;
  }
  if (!same(entry.prompt, refreshed.value.prompt)) {
    const result = replace(entry, prompt, entry.draft, true);
    if (!result.ok) {
      releaseEmpty(entry);
      return result;
    }
  }
  entry.mounts++;
  let released = false;
  return {
    ok: true,
    value: {
      read: () => (live(entry) ? entry.draft : undefined),
      current: () => !released && live(entry) && !entry.ambiguous,
      write: (draft, external = false) => {
        const originalUnknown =
          released &&
          live(entry) &&
          entry.draft.delivery === "sending" &&
          draft.delivery === "unknown";
        if (released && !originalUnknown) return refused("retired");
        return replace(entry, entry.prompt, draft, external);
      },
      refresh: (next) => {
        if (released || !live(entry)) return refused("retired");
        if (same(entry.prompt, next)) return { ok: true, value: undefined };
        const result = replace(entry, next, entry.draft, true);
        return result.ok ? { ok: true, value: undefined } : result;
      },
      release: () => {
        if (released) return;
        released = true;
        entry.mounts--;
        releaseEmpty(entry);
      },
    },
  };
}
/** Cache namespaces never become logical session authority. */
export function associateQuestionDraft(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
  sessionId: string | undefined,
): (() => void) | undefined {
  if (!scope || !sessionId) return;
  const found = establish(scope, prompt);
  if (!found.ok) return;
  const entry = found.value;
  const result = associate(entry, sessionId);
  if (!result.ok) {
    releaseEmpty(entry);
    return;
  }
  entry.associations++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.associations--;
    releaseEmpty(entry);
  };
}
export function readQuestionDraft(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
): QuestionDraft | undefined {
  if (!scope) return;
  try {
    const entry = state.entries.get(questionDraftKey(scope, prompt));
    return entry?.stored ? entry.draft : undefined;
  } catch {
    return;
  }
}
export function writeQuestionDraft(
  scope: string | undefined,
  prompt: UserQuestionPrompt,
  draft: QuestionDraft,
  external = false,
): QuestionDraftResult<QuestionDraft> {
  if (!scope) return { ok: true, value: draft };
  const found = establish(scope, prompt);
  if (!found.ok) return found;
  const result = replace(found.value, prompt, draft, external);
  if (!result.ok) releaseEmpty(found.value);
  return result;
}
export function discardQuestionDraft(
  scope: string,
  prompt: UserQuestionPrompt,
): QuestionDraftResult {
  try {
    const entry = state.entries.get(questionDraftKey(scope, prompt));
    if (entry && pending(entry)) return refused("pending");
    if (entry) remove(entry);
    return { ok: true, value: undefined };
  } catch {
    return refused("invalid");
  }
}
/** Only authoritative provider-resolution callers retire pending lineages. */
export function resolveQuestionDraft(scope: string, prompt: UserQuestionPrompt): void {
  const identity = sourceKey(prompt);
  // Resolve only the current source cut; notifications can create new entries.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const entry of [...state.entries.values()])
    if (entry.scope === scope && sourceKey(entry.prompt) === identity) remove(entry);
}
