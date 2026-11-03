import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "./store";
import type {
  AssistantMessage,
  AssistantThread,
  AssistantJob,
} from "../src/shared/model/host-contracts/assistant";
import type { AssistantThreadSummaryProof } from "../src/shared/model/assistantThreadSummary";
import { assistantJobProjectIds } from "../src/shared/model/assistantProjects";
import { RUNTIME_LOG_TOOLS } from "./runtime-log-tools";
import {
  AssistantVoiceDisclosureSourceSchema,
  type AssistantVoiceDisclosureSource,
} from "../src/shared/model/assistantVoiceContext";
import {
  AssistantVoiceContextOpenSchema,
  AssistantVoiceContextInvalidateSchema,
  type AssistantVoiceContext,
  type AssistantVoiceContextOpen,
  type AssistantVoiceContextInvalidate,
  type AssistantVoiceContextReason,
  type AssistantVoiceDisclosure,
} from "../src/shared/model/assistantVoiceContext";

type MessageRef = { id: string; fingerprint: string };
type Context = Omit<AssistantVoiceContext, "status" | "projectIds" | "reason"> & {
  seedMessageIds: string[];
  refs: MessageRef[];
  summaryProofId?: string;
  restrictiveProjectIds: string[];
  ticketIds: string[];
  pendingIds: string[];
  unknown?: AssistantVoiceContextReason;
};
type Generation = {
  headId: string;
  unknown?: AssistantVoiceContextReason;
  seedMessageIds: string[];
  summaryUsed?: boolean;
  summaryProofId?: string;
};
type Ticket = {
  id: string;
  contextId: string;
  requestId: string;
  threadId: string;
  generationKey: string;
  createdAt?: number;
  state: "pending" | "complete" | "unknown";
  projectIds?: string[];
  resultHash?: string;
  source?: Omit<AssistantVoiceToolSource, "result">;
};
export type AssistantVoiceToolSource = {
  threadId?: string;
  projectId: string;
  sessionId?: string;
  family: string;
  action: string;
  result: unknown;
};
export type AssistantVoiceToolTicket = { id: string; contextId: string };
export type AssistantVoiceToolReceipt = {
  voiceContext: AssistantVoiceContext;
  voiceDisclosure: AssistantVoiceDisclosure;
};
export type AssistantVoiceProof = { contextId: string; version: number; projectIds: string[] };
export type AssistantVoiceMessageAction = {
  id: string;
  family: string;
  action: string;
  status: "completed" | "unknown";
  createdAt: number;
};
type Ports = {
  message(id: string): Promise<AssistantMessage | null>;
  thread(id: string): Promise<AssistantThread | null>;
  summary?(threadId: string, id: string): Promise<AssistantThreadSummaryProof | undefined>;
  now?(): number;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (threadId: string, generationKey: string) => hash([threadId, generationKey]);
const supportedConversation = new Set([
  "sessions.list",
  "sessions.read",
  "tasks.list",
  "tasks.get",
  "tasks.session.read",
  "tasks.notes.read",
  "tasks.start",
  "tasks.retry",
  "tasks.stop",
  "tasks.update",
  "tasks.delete",
  "notes.list",
  "notes.read",
  "notes.create",
  "notes.update",
  "notes.delete",
  "automations.list",
  "automations.get",
  "automations.runs",
  "automations.create",
  "automations.update",
  "automations.delete",
  "host.limits.status",
  "shell.profiles",
  "tools.list",
  "tools.search",
  "tools.describe",
  "tools.status",
  "resources.read",
  "devServers.list",
  "devServers.details",
]);
const supportedLogs = new Set<string>(RUNTIME_LOG_TOOLS);
const messageFingerprint = (message: AssistantMessage) =>
  hash({
    id: message.id,
    version: message.version,
    threadId: message.threadId,
    role: message.role,
    via: message.via,
    text: message.text,
    sessionId: message.sessionId,
    jobIds: message.jobIds,
    projectIds: message.projectIds,
    ownerQuestionId: message.ownerQuestionId,
    ownerQuestionRequestId: message.ownerQuestionRequestId,
  });

/** Host-minted data provenance only. No Engine, tool executor or approval port. */
export class HostAssistantVoiceContexts {
  readonly ready: Promise<void>;
  private readonly resolving = new AsyncLocalStorage<Set<string>>();
  constructor(
    private readonly store: HostStore,
    private readonly ports: Ports,
  ) {
    this.ready = store.ready.then(async () => {
      await store.db.exec(
        "CREATE TABLE IF NOT EXISTS assistant_voice_contexts(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assistant_voice_context_versions(context_id TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(context_id,version));CREATE TABLE IF NOT EXISTS assistant_voice_generations(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assistant_voice_context_requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,context_id TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assistant_voice_disclosures(id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,value TEXT NOT NULL);",
      );
      // A restarted process cannot prove whether a prior tool result was disclosed.
      const rows = await store.db
        .prepare(
          "SELECT value FROM assistant_voice_disclosures WHERE json_extract(value,'$.state')='pending'",
        )
        .all();
      await store.transaction(async () => {
        for (const row of rows) {
          const ticket = JSON.parse(row.value) as Ticket;
          await this.failReady(ticket);
        }
      }, "critical");
    });
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private async context(id: string): Promise<Context> {
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_voice_contexts WHERE id=?")
      .get(id);
    if (!row) throw new Error("This voice context is not available on this Host.");
    return JSON.parse(row.value) as Context;
  }
  private async generation(
    context: Pick<Context, "threadId" | "generationKey">,
  ): Promise<Generation> {
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_voice_generations WHERE id=?")
      .get(key(context.threadId, context.generationKey));
    if (!row) throw new Error("The original voice generation is unavailable.");
    return JSON.parse(row.value) as Generation;
  }
  private async save(context: Context) {
    await this.store.db.checkAuthorization();
    await this.store.db
      .prepare(
        "INSERT INTO assistant_voice_contexts(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(context.id, JSON.stringify(context));
    await this.store.db
      .prepare(
        "INSERT INTO assistant_voice_context_versions(context_id,version,value) VALUES(?,?,?)",
      )
      .run(context.id, context.version, JSON.stringify(context));
  }
  private async setGeneration(context: Context, generation: Generation) {
    await this.store.db
      .prepare(
        "INSERT INTO assistant_voice_generations(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(key(context.threadId, context.generationKey), JSON.stringify(generation));
  }
  private async ticket(id: string): Promise<Ticket> {
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_voice_disclosures WHERE id=?")
      .get(id);
    if (!row) throw new Error("The original voice disclosure receipt is unavailable.");
    return JSON.parse(row.value) as Ticket;
  }
  private async writeTicket(ticket: Ticket) {
    await this.store.db
      .prepare("UPDATE assistant_voice_disclosures SET value=? WHERE id=?")
      .run(JSON.stringify(ticket), ticket.id);
  }
  private async scope(context: Context): Promise<string[] | undefined> {
    const resolving = this.resolving.getStore() ?? new Set<string>(),
      resolveKey = `${context.id}:${context.version}`;
    if (
      resolving.has(resolveKey) ||
      resolving.size >= 64 ||
      context.unknown ||
      context.pendingIds.length
    )
      return undefined;
    return this.resolving.run(new Set([...resolving, resolveKey]), async () => {
      const thread = await this.ports.thread(context.threadId);
      if (!thread) return undefined;
      const projects = new Set(context.restrictiveProjectIds);
      if (thread.projectId) projects.add(thread.projectId);
      if (context.summaryProofId) {
        const proof = await this.ports.summary?.(context.threadId, context.summaryProofId);
        if (!proof) return undefined;
        for (const id of proof.projectIds) projects.add(id);
      }
      for (const ref of context.refs) {
        const message = await this.ports.message(ref.id);
        if (
          !message ||
          message.threadId !== context.threadId ||
          !message.projectIds ||
          messageFingerprint(message) !== ref.fingerprint
        )
          return undefined;
        for (const id of message.projectIds) projects.add(id);
      }
      for (const id of context.ticketIds) {
        const ticket = await this.ticket(id);
        if (ticket.state !== "complete" || !ticket.projectIds) return undefined;
        for (const projectId of ticket.projectIds) projects.add(projectId);
      }
      if (projects.size > 1000) return undefined;
      for (const id of projects) {
        try {
          await this.store.project(id);
        } catch {
          return undefined;
        }
      }
      return [...projects].sort();
    });
  }
  private async output(context: Context): Promise<AssistantVoiceContext> {
    const generation = await this.generation(context),
      scope = generation.unknown ? undefined : await this.scope(context),
      status =
        generation.unknown || context.unknown
          ? "unknown"
          : context.pendingIds.length
            ? "pending"
            : scope
              ? "known"
              : "unknown";
    return {
      id: context.id,
      version: context.version,
      environmentId: this.store.environmentId,
      threadId: context.threadId,
      generationKey: context.generationKey,
      ownerMessageId: context.ownerMessageId,
      status,
      ...(status === "known" ? { projectIds: scope! } : {}),
      ...(status !== "known"
        ? {
            reason:
              generation.unknown ??
              context.unknown ??
              (context.pendingIds.length ? "pending-tool" : "source-cleared"),
          }
        : {}),
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
    };
  }
  async get(id: string): Promise<AssistantVoiceContext> {
    await this.ready;
    return this.output(await this.context(id));
  }
  async open(raw: AssistantVoiceContextOpen): Promise<AssistantVoiceContext> {
    const input = AssistantVoiceContextOpenSchema.parse(raw);
    await this.ready;
    return this.store.transaction(async () => {
      const requestKey = hash([input.threadId, input.generationKey, input.requestId]),
        fingerprint = hash(input),
        old = await this.store.db
          .prepare("SELECT fingerprint,context_id FROM assistant_voice_context_requests WHERE id=?")
          .get(requestKey);
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new Error("A voice context retry must preserve its original accepted source.");
        return this.output(await this.context(old.context_id));
      }
      const thread = await this.ports.thread(input.threadId),
        owner = await this.ports.message(input.ownerMessageId);
      if (
        !thread ||
        !owner ||
        owner.threadId !== thread.id ||
        owner.role !== "user" ||
        owner.via !== "voice" ||
        owner.ownerQuestionId
      )
        throw new Error("A voice context requires its exact retained accepted owner speech turn.");
      const row = await this.store.db
          .prepare("SELECT value FROM assistant_voice_generations WHERE id=?")
          .get(key(input.threadId, input.generationKey)),
        generation = row ? (JSON.parse(row.value) as Generation) : undefined,
        parent = generation ? await this.context(generation.headId) : undefined;
      if (
        parent &&
        (input.previousContextId !== parent.id ||
          JSON.stringify(input.seedMessageIds) !== JSON.stringify(generation!.seedMessageIds))
      )
        throw new Error(
          "This provider generation changed. Start a fresh generation instead of replacing its history proof.",
        );
      if (!parent && input.previousContextId)
        throw new Error("The previous voice context belongs to another generation.");
      const refs = new Map((parent?.refs ?? []).map((ref) => [ref.id, ref])),
        projects = new Set([...(parent?.restrictiveProjectIds ?? []), ...input.contextProjectIds]);
      let unknown = generation?.unknown ?? parent?.unknown;
      if (
        parent &&
        (!!generation!.summaryUsed !== input.summaryUsed ||
          generation!.summaryProofId !== input.summaryProofId)
      )
        throw new Error("This provider generation changed its original summary proof.");
      if (input.summaryUsed) {
        const proof = input.summaryProofId
          ? await this.ports.summary?.(thread.id, input.summaryProofId)
          : undefined;
        if (!proof) unknown = "unverified-summary";
        else for (const id of proof.projectIds) projects.add(id);
      }
      for (const id of [...input.seedMessageIds, input.ownerMessageId]) {
        const message = await this.ports.message(id);
        if (!message || message.threadId !== thread.id)
          throw new Error(
            "The captured voice seed was cleared, removed or belongs to another thread.",
          );
        if (!message.projectIds) unknown = "unverified-seed";
        else for (const projectId of message.projectIds) projects.add(projectId);
        refs.set(id, { id, fingerprint: messageFingerprint(message) });
      }
      for (const id of projects) await this.store.project(id);
      if (refs.size > 128 || projects.size > 1000) unknown = "capacity";
      if (parent && !(await this.scope(parent)) && !parent.pendingIds.length)
        unknown ??= "source-cleared";
      const now = this.now(),
        context: Context = {
          id: randomUUID(),
          version: 1,
          environmentId: this.store.environmentId,
          threadId: thread.id,
          generationKey: input.generationKey,
          ownerMessageId: owner.id,
          seedMessageIds: [...input.seedMessageIds],
          ...(input.summaryProofId ? { summaryProofId: input.summaryProofId } : {}),
          refs: [...refs.values()].slice(0, 128),
          restrictiveProjectIds: [...projects].sort().slice(0, 1000),
          ticketIds: parent?.ticketIds ?? [],
          pendingIds: parent?.pendingIds ?? [],
          ...(unknown ? { unknown } : {}),
          createdAt: now,
          updatedAt: now,
        };
      await this.save(context);
      await this.setGeneration(context, {
        headId: context.id,
        seedMessageIds: [...input.seedMessageIds],
        summaryUsed: input.summaryUsed,
        ...(input.summaryProofId ? { summaryProofId: input.summaryProofId } : {}),
        ...(unknown ? { unknown } : {}),
      });
      await this.store.db
        .prepare(
          "INSERT INTO assistant_voice_context_requests(id,fingerprint,context_id) VALUES(?,?,?)",
        )
        .run(requestKey, fingerprint, context.id);
      return this.output(context);
    }, "critical");
  }
  async invalidate(raw: AssistantVoiceContextInvalidate): Promise<AssistantVoiceContext> {
    const input = AssistantVoiceContextInvalidateSchema.parse(raw);
    await this.ready;
    return this.store.transaction(async () => {
      const original = await this.context(input.id),
        generation = await this.generation(original),
        head = await this.context(generation.headId);
      if (!generation.unknown) {
        const next = {
          ...head,
          version: head.version + 1,
          unknown: input.reason,
          updatedAt: this.now(),
        };
        await this.save(next);
        await this.setGeneration(next, { ...generation, unknown: input.reason });
        return this.output(next);
      }
      return this.output(head);
    }, "critical");
  }
  async capture(
    id: string,
    threadId: string,
    ownerMessageId?: string,
  ): Promise<AssistantVoiceProof | null> {
    await this.ready;
    const original = await this.context(id);
    if (original.threadId !== threadId)
      throw new Error("The voice context belongs to another conversation.");
    const generation = await this.generation(original),
      head = await this.context(generation.headId);
    if (ownerMessageId && head.ownerMessageId !== ownerMessageId)
      throw new Error("A newer accepted owner turn replaced this voice proposal.");
    if (head.id !== original.id) return null;
    const output = await this.output(head);
    return output.status === "known"
      ? { contextId: head.id, version: head.version, projectIds: output.projectIds! }
      : null;
  }
  async recordQuestionChoice(
    contextId: string,
    messageId: string,
    questionId: string,
    requestId: string,
  ): Promise<void> {
    await this.ready;
    await this.store.transaction(async () => {
      const original = await this.context(contextId),
        generation = await this.generation(original),
        head = await this.context(generation.headId),
        message = await this.ports.message(messageId);
      if (
        !message ||
        message.threadId !== head.threadId ||
        message.role !== "user" ||
        message.ownerQuestionId !== questionId ||
        message.ownerQuestionRequestId !== requestId
      )
        throw new Error("The confirmed choice does not match its retained Host receipt.");
      const refs = new Map(head.refs.map((ref) => [ref.id, ref]));
      refs.set(message.id, { id: message.id, fingerprint: messageFingerprint(message) });
      const projects = new Set([...head.restrictiveProjectIds, ...(message.projectIds ?? [])]),
        unknown =
          generation.unknown ??
          head.unknown ??
          (!message.projectIds
            ? "source-cleared"
            : refs.size > 128 || projects.size > 1000
              ? "capacity"
              : undefined),
        next: Context = {
          ...head,
          version: head.version + 1,
          refs: [...refs.values()].slice(0, 128),
          restrictiveProjectIds: [...projects].sort().slice(0, 1000),
          ...(unknown ? { unknown } : {}),
          updatedAt: this.now(),
        };
      await this.save(next);
      if (unknown) await this.setGeneration(next, { ...generation, unknown });
    }, "critical");
  }
  async historicalScope(
    id: string,
    version: number,
    threadId: string,
    ownerMessageId?: string,
  ): Promise<string[] | undefined> {
    await this.ready;
    const row = await this.store.db
      .prepare(
        "SELECT value FROM assistant_voice_context_versions WHERE context_id=? AND version=?",
      )
      .get(id, version);
    if (!row) return undefined;
    const context = JSON.parse(row.value) as Context;
    if (
      context.threadId !== threadId ||
      context.environmentId !== this.store.environmentId ||
      (ownerMessageId && context.ownerMessageId !== ownerMessageId)
    )
      return undefined;
    return this.scope(context);
  }
  async actionsForMessage(
    messageId: string,
  ): Promise<{ actions: AssistantVoiceMessageAction[]; projectIds: string[] } | undefined> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_messages WHERE id=? AND deleted_at IS NULL")
      .get(messageId);
    if (!row) return undefined;
    const message = JSON.parse(row.value) as AssistantMessage,
      contexts: Context[] = [];
    if (message.role === "assistant") {
      const proofRow = await this.store.db
        .prepare("SELECT value FROM assistant_runtime WHERE id=? AND deleted_at IS NULL")
        .get(`messageScopeVoice:${messageId}`);
      if (!proofRow) return undefined;
      const proof = (
        JSON.parse(proofRow.value) as {
          value: { contextId: string; version: number; threadId: string };
        }
      ).value;
      if (proof.threadId !== message.threadId) return undefined;
      const version = await this.store.db
        .prepare(
          "SELECT value FROM assistant_voice_context_versions WHERE context_id=? AND version=?",
        )
        .get(proof.contextId, proof.version);
      if (version) contexts.push(JSON.parse(version.value) as Context);
    } else {
      const rows = await this.store.db
        .prepare(
          "SELECT value FROM assistant_voice_contexts WHERE json_extract(value,'$.ownerMessageId')=? ORDER BY json_extract(value,'$.updatedAt') DESC LIMIT 10",
        )
        .all(messageId);
      for (const item of rows) contexts.push(JSON.parse(item.value) as Context);
    }
    const projects = new Set<string>(),
      actions = new Map<string, AssistantVoiceMessageAction>();
    for (const context of contexts) {
      if (context.threadId !== message.threadId) return undefined;
      const scope = await this.scope(context);
      if (!scope) return undefined;
      for (const id of scope) projects.add(id);
      for (const id of context.ticketIds) {
        const ticket = await this.ticket(id),
          sourceContext = await this.context(ticket.contextId);
        if (
          sourceContext.ownerMessageId !== context.ownerMessageId ||
          !ticket.source ||
          ticket.state !== "complete" ||
          !Number.isSafeInteger(ticket.createdAt)
        )
          continue;
        actions.set(id, {
          id,
          family: ticket.source.family.slice(0, 100),
          action: ticket.source.action.slice(0, 100),
          status: "completed",
          createdAt: ticket.createdAt!,
        });
      }
    }
    return actions.size
      ? {
          actions: [...actions.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, 20),
          projectIds: [...projects].sort(),
        }
      : undefined;
  }
  async begin(input: { contextId: string; requestId: string }): Promise<AssistantVoiceToolTicket> {
    if (
      typeof input.contextId !== "string" ||
      !input.contextId ||
      input.contextId.length > 200 ||
      typeof input.requestId !== "string" ||
      !input.requestId ||
      input.requestId.length > 200
    )
      throw new Error("Voice disclosure requires a bounded captured request identity.");
    await this.ready;
    return this.store.transaction(async () => {
      const context = await this.context(input.contextId),
        generation = await this.generation(context),
        head = await this.context(generation.headId),
        requestKey = hash([key(context.threadId, context.generationKey), input.requestId]);
      if (
        await this.store.db
          .prepare("SELECT 1 FROM assistant_voice_disclosures WHERE request_key=?")
          .get(requestKey)
      )
        throw new Error(
          "This voice tool call already has a disclosure receipt. Inspect its outcome instead of replaying it.",
        );
      const ticket: Ticket = {
        id: randomUUID(),
        contextId: context.id,
        requestId: input.requestId,
        threadId: context.threadId,
        generationKey: context.generationKey,
        createdAt: this.now(),
        state: "pending",
      };
      await this.store.db
        .prepare("INSERT INTO assistant_voice_disclosures(id,request_key,value) VALUES(?,?,?)")
        .run(ticket.id, requestKey, JSON.stringify(ticket));
      const unknown =
          generation.unknown ??
          head.unknown ??
          (head.pendingIds.length >= 8 ? "capacity" : undefined),
        next = {
          ...head,
          version: head.version + 1,
          pendingIds: [...head.pendingIds, ticket.id].slice(0, 8),
          ...(unknown ? { unknown } : {}),
          updatedAt: this.now(),
        };
      await this.save(next);
      if (unknown) await this.setGeneration(next, { ...generation, unknown });
      return { id: ticket.id, contextId: ticket.contextId };
    }, "critical");
  }
  private async resolveDisclosure(
    source: AssistantVoiceToolSource,
    threadId: string,
  ): Promise<{ projectIds: string[]; resultHash: string } | undefined> {
    if (
      source.threadId !== threadId ||
      !source.projectId ||
      !(
        (source.family === "conversation" && supportedConversation.has(source.action)) ||
        (source.family === "runtime-logs" && supportedLogs.has(source.action))
      )
    )
      return undefined;
    const projects = new Set<string>([source.projectId]),
      goalIds = new Set<string>(),
      jobIds = new Set<string>();
    let nodes = 0,
      characters = 0;
    const digest = createHash("sha256");
    const scan = (value: unknown, depth = 0): boolean => {
      if (++nodes > 10000 || depth > 8) return false;
      if (typeof value === "string") {
        characters += value.length;
        if (characters > 1000000) return false;
        digest.update(JSON.stringify(["string", value]));
        return true;
      }
      if (value === null || typeof value !== "object") {
        digest.update(JSON.stringify([typeof value, String(value)]));
        return true;
      }
      if (Array.isArray(value)) {
        digest.update(`array:${value.length}:`);
        return value.length <= 1000 && value.every((item) => scan(item, depth + 1));
      }
      digest.update(`object:${Object.keys(value).length}:`);
      for (const [property, item] of Object.entries(value)) {
        digest.update(JSON.stringify(["key", property]));
        if (property === "projectId" && typeof item === "string") projects.add(item);
        if (property === "projectIds" && Array.isArray(item)) {
          if (item.some((id) => typeof id !== "string")) return false;
          for (const id of item) projects.add(id as string);
        }
        if (property === "goalId" && typeof item === "string") goalIds.add(item);
        if (property === "jobId" && typeof item === "string") jobIds.add(item);
        if (property === "jobIds" && Array.isArray(item))
          for (const id of item) if (typeof id === "string") jobIds.add(id);
        if (!scan(item, depth + 1)) return false;
      }
      return true;
    };
    if (!scan(source.result)) return undefined;
    try {
      for (const id of goalIds) {
        const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
        if (!row) return undefined;
        const goal = JSON.parse(row.value) as { projectIds: string[] };
        if (!Array.isArray(goal.projectIds)) return undefined;
        for (const projectId of goal.projectIds) projects.add(projectId);
        if (id.startsWith("assistant-")) {
          const jobRow = await this.store.db
            .prepare("SELECT value FROM assistant_jobs WHERE id=?")
            .get(id.slice("assistant-".length));
          if (!jobRow) return undefined;
          for (const projectId of assistantJobProjectIds(JSON.parse(jobRow.value) as AssistantJob))
            projects.add(projectId);
        }
      }
      for (const id of jobIds) {
        const row = await this.store.db
          .prepare("SELECT value FROM assistant_jobs WHERE id=?")
          .get(id);
        if (!row) return undefined;
        for (const projectId of assistantJobProjectIds(JSON.parse(row.value) as AssistantJob))
          projects.add(projectId);
      }
      if (projects.size > 1000) return undefined;
      for (const id of projects) await this.store.project(id);
    } catch {
      return undefined;
    }
    return { projectIds: [...projects].sort(), resultHash: digest.digest("hex") };
  }
  private async operationSource(
    source: AssistantVoiceToolSource,
    context: Context,
  ): Promise<AssistantVoiceDisclosureSource> {
    if (source.threadId !== context.threadId)
      throw new Error("The voice tool operation belongs to another conversation.");
    const subject = AssistantVoiceDisclosureSourceSchema.parse({
      environmentId: context.environmentId,
      projectId: source.projectId,
      threadId: source.threadId,
      ...(source.sessionId ? { sessionId: source.sessionId } : {}),
      family: source.family,
      action: source.action,
    });
    await this.store.project(subject.projectId);
    const thread = await this.ports.thread(subject.threadId);
    if (!thread || (thread.projectId && thread.projectId !== subject.projectId))
      throw new Error("The voice tool operation belongs to another project.");
    if (
      subject.sessionId &&
      (await this.store.session(subject.sessionId)).projectId !== subject.projectId
    )
      throw new Error("The voice tool operation belongs to another session project.");
    return subject;
  }
  async finish(id: string, source: AssistantVoiceToolSource): Promise<AssistantVoiceToolReceipt> {
    await this.ready;
    return this.store.transaction(async () => {
      const ticket = await this.ticket(id);
      if (ticket.state !== "pending")
        throw new Error(
          "The original voice disclosure is already settled; it will not be replaced.",
        );
      const original = await this.context(ticket.contextId),
        generation = await this.generation(original),
        head = await this.context(generation.headId),
        scope = await this.resolveDisclosure(source, ticket.threadId),
        unknown =
          generation.unknown ??
          head.unknown ??
          (!scope ? "unverified-tool" : head.ticketIds.length >= 64 ? "capacity" : undefined);
      const metadata = {
        threadId: source.threadId,
        projectId: source.projectId,
        sessionId: source.sessionId,
        family: source.family,
        action: source.action,
      };
      const nextTicket: Ticket = {
        ...ticket,
        state: scope ? "complete" : "unknown",
        ...scope,
        source: metadata,
      };
      await this.writeTicket(nextTicket);
      const settled = (context: Context): Context => ({
        ...context,
        version: context.version + 1,
        pendingIds: context.pendingIds.filter((value) => value !== id),
        ticketIds: scope
          ? [...new Set([...context.ticketIds, id])].slice(0, 64)
          : context.ticketIds,
        ...(unknown ? { unknown } : {}),
        updatedAt: this.now(),
      });
      const next = settled(head);
      await this.save(next);
      if (unknown) await this.setGeneration(next, { ...generation, unknown });
      const output = head.id === original.id ? next : settled(original);
      if (head.id !== original.id) await this.save(output);
      const unattributed =
        !scope &&
        !(
          (source.family === "conversation" && supportedConversation.has(source.action)) ||
          (source.family === "runtime-logs" && supportedLogs.has(source.action))
        );
      return {
        voiceContext: await this.output(output),
        voiceDisclosure: {
          id: ticket.id,
          contextId: ticket.contextId,
          requestId: ticket.requestId,
          verified: !!scope,
          ...(scope
            ? { projectIds: scope.projectIds }
            : unattributed
              ? { source: await this.operationSource(source, original) }
              : {}),
        },
      };
    }, "critical");
  }
  private async failReady(ticket: Ticket): Promise<void> {
    if (ticket.state === "unknown") return;
    await this.writeTicket({ ...ticket, state: "unknown" });
    const context = await this.context(ticket.contextId),
      generation = await this.generation(context),
      head = await this.context(generation.headId),
      next = {
        ...head,
        version: head.version + 1,
        pendingIds: head.pendingIds.filter((value) => value !== ticket.id),
        unknown: generation.unknown ?? ("unverified-tool" as const),
        updatedAt: this.now(),
      };
    await this.save(next);
    await this.setGeneration(next, { ...generation, unknown: next.unknown });
  }
  async fail(id: string): Promise<void> {
    await this.ready;
    await this.store.db.runRecoveryBookkeeping(() =>
      this.store.transaction(async () => this.failReady(await this.ticket(id)), "critical"),
    );
  }
}
