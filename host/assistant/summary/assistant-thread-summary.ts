import type { NativeLibraryProof } from "../native/assistant-native-library-proof";
import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "../../store";
import type {
  AssistantMessage,
  AssistantThread,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import type {
  AssistantThreadSummaryProof,
  AssistantThreadSummaryState,
} from "../../../src/shared/model/assistantThreadSummary";
import { assistantPolicy } from "../../../src/shared/model/assistantPolicy";
type Admission = { profile: AssistantProfile; day: string; tokenCap: number; capacityKey: string };
type State = {
  cursor: number;
  artifactId?: string;
  epoch: number;
  pending?: boolean;
  manual?: boolean;
  public?: AssistantThreadSummaryState;
  blocked?: "unknown" | "privacy" | "source" | "capacity" | "budget";
  capacityKey?: string;
  retryAfter?: number;
  requests?: string[];
};
type Artifact = {
  proof: AssistantThreadSummaryProof;
  threadId: string;
  text: string;
  textHash: string;
  throughSequence: number;
  sourceHashes: string[];
  previousArtifactId?: string;
  projectProofs?: { projectId: string; cwd: string }[];
  accountProofs?: { accountId: string; version: string }[];
  nativeProofs?: NativeLibraryProof[];
};
type Intent = {
  id: string;
  threadId: string;
  epoch: number;
  status: "running" | "complete" | "unknown" | "refused";
  day: string;
  tokenCap: number;
  capacityKey: string;
  previousArtifactId?: string;
  sourceIds: string[];
  sourceHashes: string[];
  throughSequence: number;
  requestKeys: string[];
};
export interface AssistantThreadSummaryPorts {
  ready: Promise<unknown>;
  profile(): Promise<AssistantProfile>;
  message(id: string): Promise<AssistantMessage | null>;
  admission(): Promise<Admission | null>;
  visible(projectId: string): Promise<boolean>;
  sourceProofs?(
    messages: AssistantMessage[],
    projectIds: string[],
    previous?: {
      projectProofs: { projectId: string; cwd: string }[];
      accountProofs: { accountId: string; version: string }[];
      nativeProofs?: NativeLibraryProof[];
    },
  ): Promise<{
    projectProofs: { projectId: string; cwd: string }[];
    accountProofs: { accountId: string; version: string }[];
    nativeProofs?: NativeLibraryProof[];
  }>;
  validateSourceProofs?(
    threadId: string,
    proofs: {
      projectProofs: { projectId: string; cwd: string }[];
      accountProofs: { accountId: string; version: string }[];
      nativeProofs?: NativeLibraryProof[];
    },
  ): Promise<boolean>;
  withDisclosure?<T>(
    threadId: string,
    proofs: {
      projectProofs: { projectId: string; cwd: string }[];
      accountProofs: { accountId: string; version: string }[];
      nativeProofs?: NativeLibraryProof[];
    },
    effect: (valid: () => boolean) => Promise<T>,
  ): Promise<T>;
  reserve(id: string, admission: Admission): Promise<void>;
  settle(
    id: string,
    day: string,
    reserved: number,
    tokens: number,
    estimated: boolean,
  ): Promise<void>;
  generate(input: {
    profile: AssistantProfile;
    thread: AssistantThread;
    messages: AssistantMessage[];
    instructions: string;
    tokenCap: number;
    operationId: string;
    signal: AbortSignal;
  }): Promise<{ text: string; tokens?: number }>;
  instructions(): Promise<string>;
  safeOutput(text: string): Promise<string>;
  event(kind: string, tokens?: number): Promise<void>;
  now?(): number;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceHash = (message: AssistantMessage) =>
  hash({
    id: message.id,
    version: message.version,
    threadId: message.threadId,
    role: message.role,
    via: message.via,
    text: message.text,
    projectIds: message.projectIds,
  });
const bounded = (text: string, bytes: number) => {
  if (Buffer.byteLength(text, "utf8") <= bytes) return text;
  let result = "",
    length = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (length + size > bytes) break;
    result += character;
    length += size;
  }
  return result;
};

/** Rolling text artifacts, never a tool/approval/owner-rule execution grant. */
export class HostAssistantThreadSummaries {
  readonly ready: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private controller?: AbortController;
  private activeThread?: string;
  private closed = false;
  constructor(
    private readonly store: HostStore,
    private readonly ports: AssistantThreadSummaryPorts,
  ) {
    this.ready = Promise.all([store.ready, ports.ready]).then(async () => {
      await store.db.exec(
        "CREATE TABLE IF NOT EXISTS assistant_summary_queue(sequence INTEGER PRIMARY KEY AUTOINCREMENT,message_id TEXT NOT NULL UNIQUE,thread_id TEXT NOT NULL);CREATE INDEX IF NOT EXISTS assistant_summary_thread_queue ON assistant_summary_queue(thread_id,sequence);CREATE TABLE IF NOT EXISTS assistant_summary_states(thread_id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assistant_summary_artifacts(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assistant_summary_intents(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assistant_summary_requests(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,operation_id TEXT);",
      );
      await store.db
        .prepare(
          "INSERT OR IGNORE INTO assistant_summary_queue(message_id,thread_id) SELECT id,json_extract(value,'$.threadId') FROM assistant_messages WHERE deleted_at IS NULL ORDER BY rowid",
        )
        .run();
      const interval = assistantPolicy(await ports.profile()).summaryRefreshMessages;
      await store.db
        .prepare(
          "INSERT OR IGNORE INTO assistant_summary_states(thread_id,value) SELECT thread_id,json_object('cursor',0,'epoch',0,'pending',json('true')) FROM assistant_summary_queue GROUP BY thread_id HAVING count(*)>=?",
        )
        .run(interval);
      const interrupted = await store.db
        .prepare(
          "SELECT value FROM assistant_summary_intents WHERE json_extract(value,'$.status')='running'",
        )
        .all();
      await store.transaction(async () => {
        for (const row of interrupted) {
          const intent = JSON.parse(row.value) as Intent;
          await this.writeIntent({ ...intent, status: "unknown" });
          const state = await this.state(intent.threadId);
          if (state.epoch === intent.epoch)
            await this.writeState(intent.threadId, {
              ...state,
              pending: false,
              blocked: "unknown",
              public: this.status(
                "blocked",
                "A previous summary result is uncertain. Refresh explicitly to request a new attempt.",
              ),
            });
        }
      }, "critical");
    });
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private status(
    status: AssistantThreadSummaryState["status"],
    message?: string,
  ): AssistantThreadSummaryState {
    return { status, ...(message ? { message } : {}), updatedAt: this.now() };
  }
  private async state(threadId: string): Promise<State> {
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_summary_states WHERE thread_id=?")
      .get(threadId);
    return row ? (JSON.parse(row.value) as State) : { cursor: 0, epoch: 0 };
  }
  private async writeState(id: string, state: State) {
    if (state.public) {
      const previous = await this.state(id);
      state = {
        ...state,
        public: {
          ...state.public,
          updatedAt: Math.max(state.public.updatedAt, (previous.public?.updatedAt ?? -1) + 1),
        },
      };
    }
    await this.store.db
      .prepare(
        "INSERT INTO assistant_summary_states(thread_id,value) VALUES(?,?) ON CONFLICT(thread_id) DO UPDATE SET value=excluded.value",
      )
      .run(id, JSON.stringify(state));
  }
  private async writeIntent(intent: Intent) {
    await this.store.db
      .prepare(
        "INSERT INTO assistant_summary_intents(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(intent.id, JSON.stringify(intent));
  }
  private async artifact(id: string | undefined): Promise<Artifact | undefined> {
    if (!id) return;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_summary_artifacts WHERE id=?")
      .get(id);
    return row ? (JSON.parse(row.value) as Artifact) : undefined;
  }
  private async rows(threadId: string, cursor: number, limit: number) {
    return this.store.db
      .prepare(
        "SELECT q.sequence,q.message_id FROM assistant_summary_queue q WHERE q.thread_id=? AND q.sequence>? ORDER BY q.sequence LIMIT ?",
      )
      .all(threadId, cursor, limit);
  }
  start() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      void this.drain().catch(() => undefined);
    }, 1000);
    this.timer.unref?.();
  }
  abort() {
    this.controller?.abort();
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.abort();
    await this.active;
  }
  async record(messageId: string): Promise<void> {
    await this.ready;
    await this.store.transaction(async () => {
      const row = await this.store.db
        .prepare("SELECT value FROM assistant_messages WHERE id=? AND deleted_at IS NULL")
        .get(messageId);
      if (!row) return;
      const message = JSON.parse(row.value) as AssistantMessage,
        added = await this.store.db
          .prepare(
            "INSERT OR IGNORE INTO assistant_summary_queue(message_id,thread_id) VALUES(?,?)",
          )
          .run(message.id, message.threadId);
      if (!Number(added.changes)) return;
      const state = await this.state(message.threadId),
        interval = assistantPolicy(await this.ports.profile()).summaryRefreshMessages;
      if (state.blocked === "unknown") return;
      if ((await this.rows(message.threadId, state.cursor, interval)).length >= interval)
        await this.writeState(message.threadId, {
          ...state,
          pending: true,
          public: state.public?.status === "working" ? state.public : this.status("pending"),
        });
    }, "critical");
  }
  async refresh(threadId: string, requestId: string): Promise<void> {
    await this.ready;
    await this.store.transaction(async () => {
      const requestKey = hash([threadId, requestId]);
      if (
        await this.store.db
          .prepare("SELECT 1 FROM assistant_summary_requests WHERE id=?")
          .get(requestKey)
      )
        return;
      if (
        !(await this.store.db
          .prepare("SELECT 1 FROM assistant_threads WHERE id=? AND deleted_at IS NULL")
          .get(threadId))
      )
        throw new Error("The conversation is unavailable.");
      await this.store.db
        .prepare("INSERT INTO assistant_summary_requests(id,thread_id) VALUES(?,?)")
        .run(requestKey, threadId);
      const state = await this.state(threadId);
      await this.writeState(threadId, {
        ...state,
        pending: true,
        manual: true,
        blocked: undefined,
        retryAfter: undefined,
        requests: [...new Set([...(state.requests ?? []), requestKey])].slice(0, 20),
        public: this.status("pending"),
      });
    }, "critical");
  }
  async clear(threadId: string): Promise<void> {
    await this.ready;
    if (this.activeThread === threadId) this.abort();
    await this.store.transaction(async () => {
      const state = await this.state(threadId),
        row = await this.store.db
          .prepare(
            "SELECT max(sequence) AS sequence FROM assistant_summary_queue WHERE thread_id=?",
          )
          .get(threadId);
      await this.writeState(threadId, {
        ...state,
        epoch: state.epoch + 1,
        cursor: Number(row?.sequence ?? state.cursor),
        pending: false,
        manual: false,
        blocked: undefined,
        requests: [],
        public: this.status("ready"),
      });
    }, "critical");
  }
  async proof(
    threadId: string,
    text: string,
    id?: string,
  ): Promise<AssistantThreadSummaryProof | undefined> {
    await this.ready;
    const artifact = await this.artifact(id ?? (await this.state(threadId)).artifactId);
    if (
      !artifact ||
      artifact.threadId !== threadId ||
      artifact.textHash !== hash(artifact.text) ||
      (!id && artifact.textHash !== hash(text))
    )
      return;
    for (const projectId of artifact.proof.projectIds) {
      try {
        await this.store.project(projectId);
      } catch {
        return;
      }
    }
    return { ...artifact.proof, projectIds: [...artifact.proof.projectIds] };
  }
  async sourceProofs(
    threadId: string,
    id: string,
  ): Promise<
    | {
        projectProofs: { projectId: string; cwd: string }[];
        accountProofs: { accountId: string; version: string }[];
        nativeProofs?: NativeLibraryProof[];
      }
    | undefined
  > {
    const artifact = await this.artifact(id);
    if (
      !artifact ||
      artifact.threadId !== threadId ||
      artifact.textHash !== hash(artifact.text) ||
      !artifact.projectProofs ||
      !artifact.accountProofs ||
      artifact.proof.projectIds.some(
        (projectId) => !artifact.projectProofs!.some((proof) => proof.projectId === projectId),
      )
    )
      return undefined;
    return {
      projectProofs: artifact.projectProofs,
      accountProofs: artifact.accountProofs,
      ...(artifact.nativeProofs?.length ? { nativeProofs: artifact.nativeProofs } : {}),
    };
  }
  async projection(thread: AssistantThread): Promise<AssistantThread> {
    const { summaryProof: _, summaryState: __, ...raw } = thread;
    const state = await this.state(thread.id),
      proof = await this.proof(thread.id, thread.summary);
    if (thread.summary && this.ports.validateSourceProofs) {
      const sources = proof ? await this.sourceProofs(thread.id, proof.id) : undefined;
      if (!sources || !(await this.ports.validateSourceProofs(thread.id, sources)))
        return {
          ...raw,
          summary: "",
          summaryState: this.status(
            "blocked",
            "Summary source access changed or needs a verified rebuild.",
          ),
        };
    }
    return {
      ...raw,
      ...(proof ? { summaryProof: proof } : {}),
      ...(state.public ? { summaryState: state.public } : {}),
    };
  }
  async drain(): Promise<void> {
    await this.ready;
    if (this.closed) return;
    if (this.active) return this.active;
    const run = this.run();
    this.active = run;
    try {
      await run;
    } finally {
      if (this.active === run) this.active = undefined;
    }
  }
  private async block(
    threadId: string,
    state: State,
    kind: State["blocked"],
    message: string,
    capacityKey?: string,
  ) {
    await this.writeState(threadId, {
      ...state,
      pending: false,
      blocked: kind,
      capacityKey,
      retryAfter: this.now() + 60000,
      public: this.status("blocked", message),
    });
  }
  private async run(): Promise<void> {
    const candidates = await this.store.db
      .prepare(
        "SELECT s.thread_id AS id FROM assistant_summary_states s JOIN assistant_threads t ON t.id=s.thread_id AND t.deleted_at IS NULL WHERE (json_extract(s.value,'$.pending')=1 OR json_extract(s.value,'$.manual')=1 OR json_extract(s.value,'$.blocked') IN ('privacy','source','budget','capacity')) AND coalesce(json_extract(s.value,'$.retryAfter'),0)<=? ORDER BY CASE WHEN json_extract(s.value,'$.pending')=1 OR json_extract(s.value,'$.manual')=1 THEN 0 ELSE 1 END,t.updated_at LIMIT 20",
      )
      .all(this.now());
    if (!candidates.length) return;
    const profile = await this.ports.profile(),
      interval = assistantPolicy(profile).summaryRefreshMessages;
    for (const candidate of candidates) {
      if (this.closed) return;
      const threadId = String(candidate.id),
        state = await this.state(threadId);
      if (
        state.blocked === "unknown" ||
        state.public?.status === "working" ||
        (state.retryAfter && state.retryAfter > this.now())
      )
        continue;
      const rows = await this.rows(threadId, state.cursor, interval);
      if (!state.manual && rows.length < interval) continue;
      const admission = await this.ports.admission();
      if (!admission) {
        await this.block(
          threadId,
          state,
          "budget",
          "Summary generation is waiting for enabled settings, working hours, a configured reply model or token capacity.",
        );
        return;
      }
      if (
        state.blocked === "capacity" &&
        state.capacityKey === admission.capacityKey &&
        !state.manual
      ) {
        await this.writeState(threadId, { ...state, retryAfter: this.now() + 60000 });
        continue;
      }
      const threadRow = await this.store.db
        .prepare("SELECT value FROM assistant_threads WHERE id=? AND deleted_at IS NULL")
        .get(threadId);
      if (!threadRow) continue;
      const thread = JSON.parse(threadRow.value) as AssistantThread,
        previous = await this.artifact(state.artifactId),
        messages: AssistantMessage[] = [],
        projects = new Set(previous?.proof.projectIds ?? []);
      if (thread.projectId) projects.add(thread.projectId);
      if (
        previous &&
        (previous.textHash !== hash(previous.text) || previous.textHash !== hash(thread.summary))
      ) {
        await this.block(
          threadId,
          state,
          "source",
          "The verified summary no longer matches this conversation.",
        );
        return;
      }
      if (thread.summary && !previous) {
        await this.block(
          threadId,
          state,
          "source",
          "The existing summary has no verified source artifact. Clear or replace it explicitly before refreshing.",
        );
        return;
      }
      for (const row of rows) {
        const message = await this.ports.message(String(row.message_id));
        if (!message || message.threadId !== threadId || !message.projectIds) {
          await this.block(
            threadId,
            state,
            "source",
            "Some conversation sources cannot be verified. Restore or clear their source before updating the summary.",
          );
          return;
        }
        messages.push(message);
        for (const id of message.projectIds) projects.add(id);
      }
      if (!messages.length && !previous) {
        await this.writeState(threadId, {
          ...state,
          pending: false,
          manual: false,
          requests: [],
          public: this.status("ready"),
        });
        return;
      }
      const allowed = async () => {
        for (const id of projects) {
          try {
            await this.store.project(id);
          } catch {
            return false;
          }
          if (!(await this.ports.visible(id))) return false;
        }
        return true;
      };
      if (projects.size > 1000 || !(await allowed())) {
        await this.block(
          threadId,
          state,
          "privacy",
          "A conversation source is hidden, locked or has no fresh owner privacy signal.",
        );
        return;
      }
      const priorProofs = previous
        ? await this.sourceProofs(threadId, previous.proof.id)
        : undefined;
      if (previous && this.ports.sourceProofs && !priorProofs) {
        await this.block(
          threadId,
          state,
          "source",
          "The existing summary has no complete source identity proof. Clear or rebuild it explicitly.",
        );
        return;
      }
      let sourceProofs:
        | {
            projectProofs: { projectId: string; cwd: string }[];
            accountProofs: { accountId: string; version: string }[];
            nativeProofs?: NativeLibraryProof[];
          }
        | undefined;
      try {
        sourceProofs = await this.ports.sourceProofs?.(messages, [...projects], priorProofs);
      } catch {
        await this.block(threadId, state, "privacy", "Conversation source access is unavailable.");
        return;
      }
      const instructions = await this.ports.instructions(),
        previousText = previous?.text ?? "",
        available = Math.max(
          40,
          Math.floor(
            (admission.tokenCap * 4 * 0.6 -
              Buffer.byteLength(previousText, "utf8") -
              Buffer.byteLength(instructions, "utf8") -
              1000) /
              Math.max(1, messages.length),
          ),
        ),
        perMessage = Math.min(1000, available),
        input = messages.map((message) => ({
          ...message,
          text: bounded(message.text, perMessage),
        })),
        truncated = input.some((message, index) => message.text !== messages[index].text),
        id = randomUUID(),
        intent: Intent = {
          id,
          threadId,
          epoch: state.epoch,
          status: "running",
          day: admission.day,
          tokenCap: admission.tokenCap,
          capacityKey: admission.capacityKey,
          previousArtifactId: state.artifactId,
          sourceIds: messages.map((message) => message.id),
          sourceHashes: messages.map(sourceHash),
          throughSequence: Number(rows.at(-1)?.sequence ?? state.cursor),
          requestKeys: state.requests ?? [],
        };
      await this.store.transaction(async () => {
        const current = await this.state(threadId);
        if (current.epoch !== state.epoch || current.cursor !== state.cursor)
          throw new Error("Summary source changed before admission.");
        await this.ports.reserve(id, admission);
        await this.writeIntent(intent);
        for (const requestKey of intent.requestKeys)
          await this.store.db
            .prepare(
              "UPDATE assistant_summary_requests SET operation_id=? WHERE id=? AND operation_id IS NULL",
            )
            .run(id, requestKey);
        await this.writeState(threadId, {
          ...current,
          pending: false,
          manual: false,
          requests: [],
          public: this.status("working"),
        });
      }, "critical");
      const controller = new AbortController();
      this.controller = controller;
      this.activeThread = threadId;
      let invoked = false,
        observedTokens: number | undefined;
      try {
        await this.store.db.checkAuthorization();
        for (let index = 0; index < messages.length; index++) {
          const source = await this.ports.message(messages[index].id);
          if (!source || sourceHash(source) !== intent.sourceHashes[index])
            throw new Error("Summary source changed before the model read.");
        }
        if (!(await allowed()) || this.closed)
          throw new Error("Summary privacy changed before the model read.");
        controller.signal.throwIfAborted();
        const generate = async (valid: () => boolean) => {
          if (!valid()) throw new Error("Summary source access changed.");
          invoked = true;
          return this.ports.generate({
            profile: admission.profile,
            thread: { ...thread, summary: previousText },
            messages: input,
            instructions,
            tokenCap: admission.tokenCap,
            operationId: id,
            signal: controller.signal,
          });
        };
        const result =
          sourceProofs && this.ports.withDisclosure
            ? await this.ports.withDisclosure(threadId, sourceProofs, generate)
            : await generate(() => true);
        observedTokens =
          result.tokens !== undefined && Number.isFinite(result.tokens)
            ? Math.max(0, Math.ceil(result.tokens))
            : undefined;
        controller.signal.throwIfAborted();
        const tokens = observedTokens ?? admission.tokenCap;
        const text = bounded(await this.ports.safeOutput(result.text), 6000);
        if (!text.trim()) throw new Error("No conversation summary was returned.");
        if (!(await allowed())) throw new Error("Summary privacy changed before commit.");
        for (let index = 0; index < messages.length; index++) {
          const current = await this.ports.message(messages[index].id);
          if (!current || sourceHash(current) !== intent.sourceHashes[index])
            throw new Error("Summary source changed before commit.");
        }
        const commit = async (valid: () => boolean) =>
          this.store.transaction(async () => {
            if (!valid()) throw new Error("Summary source access changed.");
            controller.signal.throwIfAborted();
            for (let index = 0; index < messages.length; index++) {
              const source = await this.ports.message(messages[index].id);
              if (!source || sourceHash(source) !== intent.sourceHashes[index])
                throw new Error("Summary source changed at commit.");
            }
            const current = await this.state(threadId),
              currentThreadRow = await this.store.db
                .prepare(
                  "SELECT value,version FROM assistant_threads WHERE id=? AND deleted_at IS NULL",
                )
                .get(threadId);
            if (
              current.epoch !== intent.epoch ||
              current.cursor !== state.cursor ||
              current.artifactId !== state.artifactId ||
              !currentThreadRow
            )
              throw new Error("Summary source changed before commit.");
            const currentThread = JSON.parse(currentThreadRow.value) as AssistantThread;
            if (
              currentThread.projectId !== thread.projectId ||
              currentThread.summary !== thread.summary
            )
              throw new Error("The current summary changed before commit.");
            const proof: AssistantThreadSummaryProof = {
                id,
                version: (previous?.proof.version ?? 0) + 1,
                projectIds: [...projects].sort(),
                throughMessageId: messages.at(-1)?.id ?? previous!.proof.throughMessageId,
                messageCount: (previous?.proof.messageCount ?? 0) + messages.length,
                createdAt: this.now(),
                inputTruncated: !!previous?.proof.inputTruncated || truncated,
                omittedMessages: previous?.proof.omittedMessages ?? 0,
              },
              artifact: Artifact = {
                proof,
                threadId,
                text,
                textHash: hash(text),
                throughSequence: intent.throughSequence,
                sourceHashes: messages.map((message) =>
                  hash([hash(message.id), sourceHash(message)]),
                ),
                ...(sourceProofs
                  ? {
                      projectProofs: sourceProofs.projectProofs,
                      accountProofs: sourceProofs.accountProofs,
                      nativeProofs: sourceProofs.nativeProofs ?? [],
                    }
                  : {}),
                ...(previous ? { previousArtifactId: previous.proof.id } : {}),
              };
            await this.store.db
              .prepare("INSERT INTO assistant_summary_artifacts(id,value) VALUES(?,?)")
              .run(id, JSON.stringify(artifact));
            const updated = { ...currentThread, summary: text, version: currentThread.version + 1 };
            delete updated.summaryProof;
            delete updated.summaryState;
            const saved = await this.store.db
              .prepare(
                "UPDATE assistant_threads SET value=?,version=? WHERE id=? AND version=? AND deleted_at IS NULL",
              )
              .run(JSON.stringify(updated), updated.version, threadId, currentThreadRow.version);
            if (Number(saved.changes) !== 1)
              throw new Error("The conversation changed before summary commit.");
            const pending =
              current.pending ||
              (await this.rows(threadId, intent.throughSequence, interval)).length >= interval;
            await this.writeState(threadId, {
              ...current,
              cursor: intent.throughSequence,
              artifactId: id,
              blocked: undefined,
              retryAfter: undefined,
              pending,
              public: pending ? this.status("pending") : this.status("ready"),
            });
            await this.writeIntent({ ...intent, status: "complete" });
            await this.ports.settle(
              id,
              intent.day,
              intent.tokenCap,
              tokens,
              result.tokens === undefined,
            );
            await this.ports.event("conversation.summaryUpdated", tokens);
            if (!valid()) throw new Error("Summary source access changed.");
          }, "critical");
        if (sourceProofs && this.ports.withDisclosure)
          await this.ports.withDisclosure(threadId, sourceProofs, commit);
        else await commit(() => true);
      } catch (error) {
        const preflight = !!(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ASSISTANT_TEXT_PREFLIGHT_TOO_LARGE"
          ),
          zero = !invoked || preflight;
        await this.store.db.runRecoveryBookkeeping(() =>
          this.store.transaction(async () => {
            await this.writeIntent({ ...intent, status: zero ? "refused" : "unknown" });
            await this.ports.settle(
              id,
              intent.day,
              intent.tokenCap,
              zero ? 0 : (observedTokens ?? intent.tokenCap),
              !zero && observedTokens === undefined,
            );
            const current = await this.state(threadId);
            if (current.epoch === intent.epoch)
              await this.block(
                threadId,
                current,
                zero ? (preflight ? "capacity" : "privacy") : "unknown",
                zero
                  ? preflight
                    ? "The summary did not fit its current capacity. Change settings or refresh explicitly."
                    : "No model was called. Summary generation is waiting for current source access or enabled settings."
                  : "The summary attempt could not be confirmed. Refresh explicitly to request a new attempt.",
                admission.capacityKey,
              );
            await this.ports.event(
              zero ? "conversation.summaryDeferred" : "conversation.summaryUnknown",
              zero ? 0 : (observedTokens ?? intent.tokenCap),
            );
          }, "critical"),
        );
      } finally {
        if (this.controller === controller) {
          this.controller = undefined;
          this.activeThread = undefined;
        }
      }
      return;
    }
  }
}
