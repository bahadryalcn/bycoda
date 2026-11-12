import { createHash, randomUUID } from "node:crypto";
import type {
  HostModelCatalog,
  HostSession,
  RemoteProvider,
} from "../../src/features/connections/model/protocol";
import {
  localSessionLinkFields,
  type LocalSessionLocator,
} from "../../src/features/sessions/model/localSessionReference";
import type { Session } from "../../src/features/sessions/model/session";
import type { AgentModel } from "../../src/features/sessions/model/models";
import { CLAUDE_SUBAGENT_SETTINGS } from "../../src/features/sessions/model/claudeSubagents";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_LIMITS,
  DELEGATION_PARENT_KEY,
  EFFORT_LEVELS,
  decodeAdvisor,
  decodeDelegationParent,
  decodeSubagents,
  delegateRefKey,
  type DelegateModelRef,
  type DelegationKind,
  type DelegationParent,
} from "../../src/shared/model/host-contracts/delegation";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import {
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
  type SessionRunState,
} from "../sessions/sessionRuns";
import { lastTurnReply } from "../sessions/turn-reply";
import type { HostStore } from "../store";
import { DelegationStore, type DelegationRecord } from "./store";
import { advisorBrief, subagentBrief, replyBrief } from "./prompts";
import { modelEffortSetting } from "../../src/features/sessions/model/models";
import { logWaitMaxTimeoutSeconds } from "../execution/runtime-log-wait";
import { childModelSettings } from "./child-settings";

export type DelegationDependencies = {
  engine: SessionRunEngine & { store: HostStore };
  /** Folder that holds Host feature state. */
  directory: string;
  featureSession: (sessionId: string) => Promise<Pick<HostSession, "projectId" | "session">>;
  models: (projectId: string) => Promise<HostModelCatalog>;
  providers: readonly RemoteProvider[];
  authStatus: (
    provider: RemoteProvider,
    accountId?: string,
  ) => Promise<"signedIn" | "signedOut" | "unknown">;
};

export type AgentsCaller = { sessionId: string; projectId: string };
type Locate = (sessionId: string) => Promise<LocalSessionLocator | undefined>;
type RunStatus = "running" | "needsInput" | "succeeded" | "failed" | "cancelled";

const KIND_LABEL: Record<DelegationKind, string> = { subagent: "Subagent", advisor: "Advisor" };

/**
 * Trust boundary for `agents.*`. Models come from the caller's own settings and
 * the Host catalog; the store, not a model setting, decides recursion and limits.
 */
export class ConversationDelegation {
  readonly store: DelegationStore;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly continuations = new Map<string, Promise<void>>();

  constructor(private readonly deps: DelegationDependencies) {
    this.store = new DelegationStore(deps.directory);
  }

  async call(
    action: string,
    args: Record<string, unknown>,
    caller: AgentsCaller,
    locate: Locate,
  ): Promise<unknown> {
    if (action === "agents.options") return await this.options(caller);
    if (action === "agents.delegate") return await this.start("subagent", args, caller, locate);
    if (action === "agents.consult") return await this.start("advisor", args, caller, locate);
    if (action === "agents.reply") return await this.reply(args, caller, locate);
    if (action === "agents.wait") return await this.wait(args, caller, locate);
    if (action === "agents.cancel") return await this.cancel(args, caller, locate);
    throw new Error("Unsupported agents tool.");
  }

  /** Stops every running child of a parent that was cancelled or deleted. */
  async cancelChildren(parentSessionId: string): Promise<void> {
    const records = (await this.refresh(await this.store.list())).filter(
      (record) => record.parentSessionId === parentSessionId && record.finishedAt === undefined,
    );
    await Promise.all(
      records.map(async (record) => {
        await cancelSessionRun(this.deps.engine, {
          sessionId: record.childSessionId,
          runId: record.childRunId,
        }).catch((error) => console.warn("Subagent cancel failed:", errorMessage(error)));
      }),
    );
  }

  private async caller(caller: AgentsCaller) {
    const own = await this.deps.featureSession(caller.sessionId);
    if (own.projectId !== caller.projectId)
      throw new Error("Conversation belongs to another project.");
    // Children never start children: the store knows them, and the parent key is checked too.
    if (
      (await this.store.isChild(caller.sessionId)) ||
      decodeDelegationParent(own.session.modelSettings[DELEGATION_PARENT_KEY])
    )
      throw new Error("A subagent cannot start agents runs.");
    return own;
  }

  private selected(session: Session) {
    return {
      subagents: decodeSubagents(session.modelSettings[CROSS_SUBAGENTS_KEY]),
      advisor: decodeAdvisor(session.modelSettings[CROSS_ADVISOR_KEY]),
    };
  }

  private resolve(ref: DelegateModelRef, catalog: HostModelCatalog): AgentModel | undefined {
    if (!this.deps.providers.includes(ref.harness)) return undefined;
    const model = catalog.models[ref.harness]?.find((candidate) => candidate.id === ref.model);
    if (model) return model;
    // Native Claude family aliases are selectable settings, even when the catalog
    // lists only versioned models. Preserve their provider-defined moving target.
    if (ref.harness === "claude") {
      const option = CLAUDE_SUBAGENT_SETTINGS.find(
        (setting) => setting.id === "subagentModel",
      )?.options.find(
        (candidate) => candidate.value === ref.model && candidate.value !== "default",
      );
      if (option) return { id: option.value, harness: "claude", name: option.label };
    }
    return undefined;
  }

  private async options(caller: AgentsCaller) {
    const own = await this.caller(caller);
    const catalog = await this.deps.models(caller.projectId);
    const { subagents, advisor } = this.selected(own.session);
    const running = await this.runningCounts(caller.sessionId);
    const describe = (ref: DelegateModelRef) => {
      const model = this.resolve(ref, catalog);
      const effort = model && modelEffortSetting(model);
      return {
        ref: delegateRefKey(ref),
        harness: ref.harness,
        model: ref.model,
        label: model?.name ?? ref.model,
        available: model !== undefined,
        effortLevels: effort?.options.map((option) => option.value) ?? [],
        ...(effort ? { defaultEffort: effort.value } : {}),
      };
    };
    return {
      subagents: subagents.map(describe),
      ...(advisor ? { advisor: describe(advisor) } : {}),
      running: { subagents: running.subagent, advisors: running.advisor },
      limits: {
        runningSubagents: DELEGATION_LIMITS.runningSubagents,
        runningAdvisors: DELEGATION_LIMITS.runningAdvisors,
      },
    };
  }

  private async start(
    kind: DelegationKind,
    args: Record<string, unknown>,
    caller: AgentsCaller,
    locate: Locate,
  ) {
    const own = await this.caller(caller);
    if (
      args.effort !== undefined &&
      (typeof args.effort !== "string" || !EFFORT_LEVELS.includes(args.effort))
    )
      throw new Error("Unknown effort level.");
    const requestKey = `agents:${caller.sessionId}:${String(args.requestId)}`;
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify([
          kind,
          args.model,
          args.title,
          args.prompt,
          args.question,
          args.context,
          ...(args.effort === undefined ? [] : [args.effort]),
        ]),
      )
      .digest("hex");
    return await this.serial(async () => {
      const existing = await this.store.findByRequestKey(requestKey);
      if (existing) {
        if (existing.requestKey !== requestKey || existing.payloadHash !== payloadHash)
          throw new Error("requestId was already used with a different payload.");
        return await this.describe(existing, locate);
      }
      const { subagents, advisor } = this.selected(own.session);
      const candidates = kind === "advisor" ? (advisor ? [advisor] : []) : subagents;
      if (!candidates.length)
        throw new Error(`No ${kind} model is selected for this conversation.`);
      let ref = candidates[0]!;
      if (kind === "subagent" && (candidates.length > 1 || args.model !== undefined)) {
        if (typeof args.model !== "string")
          throw new Error("Field model is required when more than one subagent model is selected.");
        const match = candidates.find((candidate) => delegateRefKey(candidate) === args.model);
        if (!match) throw new Error("Field model is not one of the selected subagent models.");
        ref = match;
      }
      const catalog = await this.deps.models(caller.projectId);
      const model = this.resolve(ref, catalog);
      if (!model) throw new Error("The selected model is unavailable. Choose another model.");
      await this.verifySignIn(ref);
      const running = await this.runningCounts(caller.sessionId);
      if (kind === "subagent" && running.subagent >= DELEGATION_LIMITS.runningSubagents)
        throw new Error("Running subagent limit reached. Wait for a run to finish or cancel one.");
      if (kind === "advisor" && running.advisor >= DELEGATION_LIMITS.runningAdvisors)
        throw new Error("An advisor is already running. Wait for it to finish or cancel it.");

      const runId = randomUUID();
      const label = `${KIND_LABEL[kind]} · ${model.name}`;
      const title = String(args.title ?? args.question ?? "").slice(
        0,
        DELEGATION_LIMITS.titleChars,
      );
      const parent: DelegationParent = {
        parentSessionId: caller.sessionId,
        runId,
        kind,
        model: model.id,
        startedAt: Date.now(),
      };
      const modelSettings = childModelSettings(
        model,
        kind === "advisor" ? own.session.modelSettings : {},
        args.effort as string | undefined,
      );
      const started = await launchSessionRun(this.deps.engine.store, this.deps.engine, {
        requestId: `agents_${createHash("sha256").update(requestKey).digest("hex").slice(0, 40)}`,
        projectId: caller.projectId,
        harness: ref.harness,
        ...(ref.providerAccountId ? { providerAccountId: ref.providerAccountId } : {}),
        model: model.id,
        modelSettings: {
          ...modelSettings,
          [DELEGATION_PARENT_KEY]: JSON.stringify(parent),
        },
        runtimeMode: own.session.runtimeMode,
        // The model shows beside the row; the task names the run.
        title: title.trim() || label,
        prompt:
          kind === "subagent"
            ? subagentBrief(`${String(args.title)}\n\n${String(args.prompt)}`)
            : advisorBrief(String(args.question), args.context as string | undefined),
        ...(kind === "advisor" ? { intent: "plan" as const } : {}),
        workspaceMode: "current",
        ...(own.session.worktreeCwd ? { worktreeCwd: own.session.worktreeCwd } : {}),
      });
      if (started.deferred || !started.sessionId)
        throw new Error(started.error ?? `The ${kind} could not start. Try again later.`);
      const record: DelegationRecord = {
        runId,
        kind,
        parentSessionId: caller.sessionId,
        childSessionId: started.sessionId,
        ...(started.runId ? { childRunId: started.runId } : {}),
        model: ref,
        title,
        requestKey,
        payloadHash,
        modelSettings,
        startedAt: parent.startedAt,
        ...(started.error
          ? { error: started.error, finishedAt: Date.now(), status: "failed" as const }
          : {}),
      };
      await this.store.add(record);
      return await this.describe(record, locate);
    });
  }

  private async verifySignIn(ref: DelegateModelRef) {
    if (ref.harness === "claude" || ref.harness === "codex") {
      const status = await this.deps.authStatus(ref.harness, ref.providerAccountId);
      if (status === "signedOut")
        throw new Error(
          `The selected ${ref.harness} account (${ref.providerAccountId ?? "default"}) is signed out or its sign-in expired. Sign in again before delegating.`,
        );
      if (status === "unknown")
        throw new Error(
          `Could not verify sign-in for the selected ${ref.harness} account (${ref.providerAccountId ?? "default"}). Check its sign-in and try again.`,
        );
    }
  }

  private async reply(args: Record<string, unknown>, caller: AgentsCaller, locate: Locate) {
    await this.caller(caller);
    if (typeof args.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(args.requestId))
      throw new Error("Invalid requestId.");
    if (
      typeof args.message !== "string" ||
      args.message.length < 1 ||
      args.message.length > DELEGATION_LIMITS.promptChars
    )
      throw new Error("Invalid message length.");
    if (typeof args.runId !== "string" || args.runId.length < 1 || args.runId.length > 200)
      throw new Error("Invalid runId.");
    const requestKey = `agents:${caller.sessionId}:${args.requestId}`;
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(["reply", args.runId, args.message]))
      .digest("hex");
    return await this.serial(async () => {
      let record = await this.follow(await this.owned(args.runId, caller));
      const existing = await this.store.findByRequestKey(requestKey);
      if (existing) {
        const receipt = existing.replies?.find((reply) => reply.requestKey === requestKey);
        if (existing.runId !== record.runId || receipt?.payloadHash !== payloadHash)
          throw new Error("requestId was already used with a different payload.");
        return await this.describe(existing, locate);
      }
      const status = await this.statusOf(record);
      if (status.status === "running") throw new Error("Run is running. Wait or cancel it first.");
      if (status.status === "needsInput")
        throw new Error("Answer the approval in the child's own session first.");
      await this.verifySignIn(record.model);
      const running = await this.runningCounts(caller.sessionId);
      const limit =
        record.kind === "subagent"
          ? DELEGATION_LIMITS.runningSubagents
          : DELEGATION_LIMITS.runningAdvisors;
      if (running[record.kind] >= limit)
        throw new Error("Running " + record.kind + " limit reached. Wait or cancel first.");
      // Concurrent waits must not mistake this assistant's send for an owner follow-up.
      let settled!: () => void;
      this.continuations.set(
        record.runId,
        new Promise<void>((resolve) => {
          settled = resolve;
        }),
      );
      try {
        const child = await this.deps.engine.store.session(record.childSessionId);
        // Restore the recorded model/account if the owner changed this child's settings.
        await this.deps.engine.command({
          type: "configure",
          commandId: `agents_${createHash("sha256").update(requestKey).digest("hex")}:configure`,
          sessionId: record.childSessionId,
          expectedRevision: child.revision,
          harness: record.model.harness,
          model: record.model.model,
          providerAccountId: record.model.providerAccountId ?? null,
          modelSettings: {
            ...(record.modelSettings ?? child.session.modelSettings),
            [DELEGATION_PARENT_KEY]: child.session.modelSettings[DELEGATION_PARENT_KEY]!,
          },
          runtimeMode: child.session.runtimeMode,
        });
        await this.deps.engine.command({
          type: "send",
          commandId: `agents_${createHash("sha256").update(requestKey).digest("hex")}:send`,
          sessionId: record.childSessionId,
          text: replyBrief(args.message as string),
          ...(record.kind === "advisor" ? { intent: "plan" as const } : {}),
        });
        const latest = await this.deps.engine.store.session(record.childSessionId);
        await this.store.patch(record.runId, {
          childRunId: latest.runId,
          finishedAt: undefined,
          status: undefined,
          error: undefined,
          ownerFollowUp: undefined,
          replies: [...(record.replies ?? []), { requestKey, payloadHash }],
        });
      } finally {
        this.continuations.delete(record.runId);
        settled();
      }
      record = (await this.store.find(record.runId))!;
      return await this.describe(record, locate);
    });
  }

  private async wait(args: Record<string, unknown>, caller: AgentsCaller, locate: Locate) {
    const own = await this.deps.featureSession(caller.sessionId);
    if (own.projectId !== caller.projectId)
      throw new Error("Conversation belongs to another project.");
    if ((args.runId !== undefined) === (args.runIds !== undefined))
      throw new Error("Pass exactly one of runId or runIds.");
    const ids = args.runIds === undefined ? [args.runId] : args.runIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 16 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || id.length < 1 || id.length > 200)
    )
      throw new Error("Expected 1 to 16 unique run IDs.");
    const maximum = logWaitMaxTimeoutSeconds(own.session.harness);
    const requested = args.timeoutSeconds ?? maximum;
    if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1)
      throw new Error("timeoutSeconds must be a positive integer.");
    // A value above the caller's provider deadline is shortened, never an error:
    // the published schema allows the longest deadline for every provider.
    const seconds = Math.min(requested, maximum);
    let records = await Promise.all(ids.map((id) => this.owned(id, caller)));
    const started = monotonicNow();
    for (;;) {
      records = await Promise.all(records.map((record) => this.follow(record)));
      const statuses = await Promise.all(records.map((record) => this.statusOf(record)));
      const remaining = seconds * 1000 - elapsedSince(started);
      if (statuses.every((status) => status.status !== "running") || remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining)));
    }
    const runs = await Promise.all(records.map((record) => this.describe(record, locate)));
    return args.runIds === undefined ? runs[0] : { runs };
  }

  private async cancel(args: Record<string, unknown>, caller: AgentsCaller, locate: Locate) {
    const record = await this.follow(await this.owned(args.runId, caller));
    const status = await this.statusOf(record);
    if (status.status === "running" || status.status === "needsInput") {
      await cancelSessionRun(this.deps.engine, {
        sessionId: record.childSessionId,
        runId: record.childRunId,
      });
    }
    return await this.describe(await this.owned(args.runId, caller), locate);
  }

  private async owned(runId: unknown, caller: AgentsCaller): Promise<DelegationRecord> {
    const record = await this.store.find(String(runId));
    if (!record || record.parentSessionId !== caller.sessionId)
      throw new Error("Run not found in this conversation.");
    return record;
  }

  /** An owner follow-up turn moved the child to a new run: wait on that latest run. */
  private async follow(record: DelegationRecord): Promise<DelegationRecord> {
    const continuation = this.continuations.get(record.runId);
    if (continuation) {
      await continuation;
      record = (await this.store.find(record.runId)) ?? record;
    }
    let child: HostSession;
    try {
      child = await this.deps.engine.store.session(record.childSessionId);
    } catch {
      return record;
    }
    if (!child.runId || child.runId === record.childRunId) return record;
    await this.store.patch(record.runId, {
      childRunId: child.runId,
      ownerFollowUp: true,
      finishedAt: undefined,
      status: undefined,
    });
    return (await this.store.find(record.runId)) ?? record;
  }

  /** Checks an unfinished row against its child session and records a finished run once. */
  private async stateOf(record: DelegationRecord): Promise<SessionRunState> {
    // Without a turn id the child has not been seen running yet; it is not finished.
    const state: SessionRunState = record.childRunId
      ? await sessionRunState(
          this.deps.engine.store,
          {
            sessionId: record.childSessionId,
            runId: record.childRunId,
            startedAt: record.startedAt,
          },
          0,
          Date.now(),
        )
      : { state: "running", needsInput: false };
    if (state.state === "finished") {
      const patch = {
        finishedAt: Date.now(),
        status: state.status,
        ...(state.error ? { error: state.error } : {}),
      };
      Object.assign(record, patch);
      await this.store.patch(record.runId, patch);
    }
    return state;
  }

  private async refresh(records: DelegationRecord[]): Promise<DelegationRecord[]> {
    for (let i = 0; i < records.length; i++) {
      const record = (records[i] = await this.follow(records[i]!));
      if (record.finishedAt === undefined) await this.stateOf(record);
    }
    return records;
  }

  private async runningCounts(parentSessionId: string) {
    const records = (await this.refresh(await this.store.list())).filter(
      (record) => record.parentSessionId === parentSessionId && record.finishedAt === undefined,
    );
    return {
      subagent: records.filter((record) => record.kind === "subagent").length,
      advisor: records.filter((record) => record.kind === "advisor").length,
    };
  }

  private async statusOf(record: DelegationRecord): Promise<{ status: RunStatus; error?: string }> {
    if (record.finishedAt !== undefined) {
      const status = record.status ?? (record.error ? "failed" : "succeeded");
      return { status, ...(record.error ? { error: record.error } : {}) };
    }
    const state = await this.stateOf(record);
    if (state.state === "finished")
      return { status: state.status, ...(state.error ? { error: state.error } : {}) };
    return { status: state.state === "running" && state.needsInput ? "needsInput" : "running" };
  }

  private async describe(record: DelegationRecord, locate: Locate) {
    record = await this.follow(record);
    const status = await this.statusOf(record);
    const child = await this.deps.engine.store
      .session(record.childSessionId)
      .catch(() => undefined);
    const reply =
      child && status.status === "succeeded"
        ? lastTurnReply(child.session.blocks, { includePlan: true })
        : "";
    const result = reply ? truncateGraphemes(reply, DELEGATION_LIMITS.resultGraphemes) : undefined;
    const locator = await locate(record.childSessionId).catch(() => undefined);
    return {
      runId: record.runId,
      sessionId: record.childSessionId,
      ...(locator
        ? { markdownReference: localSessionLinkFields(locator, record.title).markdownReference }
        : {}),
      model: { harness: record.model.harness, model: record.model.model },
      status: status.status,
      ...(record.ownerFollowUp ? { ownerFollowUp: true } : {}),
      ...(result === undefined ? {} : { result, truncated: result !== reply }),
      ...(status.error ? { error: truncateGraphemes(status.error, 2000) } : {}),
    };
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
