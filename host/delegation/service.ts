import {
  resolveSubagents,
  subagentTier,
  subagentCatalogModels,
  automaticSubagentEmptyReason,
} from "../../src/shared/model/automaticSubagents";
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
import type { Session, SessionMessageAuthor } from "../../src/features/sessions/model/session";
import { isSessionNotFound } from "../sessions/session-authority";
import { executionUserIndex } from "../../src/features/sessions/model/executionTurn";
import type { AgentModel } from "../../src/features/sessions/model/models";
import { CLAUDE_SUBAGENT_SETTINGS } from "../../src/features/sessions/model/claudeSubagents";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  AUTOMATIC_SUBAGENTS,
  DELEGATION_LIMITS,
  DELEGATION_CHAT_ONLY_KEY,
  DELEGATION_PARENT_KEY,
  EFFORT_LEVELS,
  decodeAdvisor,
  decodeDelegationParent,
  nativeAdvisor,
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
import { chatOnlyAvailable } from "./child-native";
import { delegationBudgetScope, delegationWorkRoot } from "./work-root";
import { cancelSessionWorkOccurrence } from "../work/session-adapter";
import { refuseSingleSlotChild } from "./capacity";
import type { AgentRole } from "./tools";
import { AgentCommunication } from "./communication";
import { agentMessageDelivery, inspectAgentSession } from "./message-delivery";

export type DelegationDependencies = {
  engine: SessionRunEngine & { store: HostStore };
  /** Folder that holds Host feature state. */
  directory: string;
  featureSession: (
    sessionId: string,
  ) => Promise<Pick<HostSession, "projectId" | "session" | "runId">>;
  models: (projectId: string) => Promise<HostModelCatalog>;
  providers: readonly RemoteProvider[];
  defaultAccounts?: () => Promise<Partial<Record<RemoteProvider, string>>>;
  authStatus: (
    provider: RemoteProvider,
    accountId?: string,
  ) => Promise<"signedIn" | "signedOut" | "unknown">;
  enqueueParent?: (
    sessionId: string,
    id: string,
    text: string,
    author?: SessionMessageAuthor,
  ) => Promise<void>;
};

export type AgentsCaller = { sessionId: string; projectId: string };
type Locate = (sessionId: string) => Promise<LocalSessionLocator | undefined>;
type RunStatus = "queued" | "running" | "needsInput" | "succeeded" | "failed" | "cancelled";

/**
 * The child's parent link for its next turn: the round advances and the previous
 * round's outcome fields are cleared. An unreadable link is kept as it was.
 */
function nextRoundParent(link: string, round: number): string {
  const parent = decodeDelegationParent(link);
  if (!parent) return link;
  const next: DelegationParent = { ...parent, round };
  delete next.childRunId;
  delete next.status;
  delete next.error;
  delete next.finishedAt;
  return JSON.stringify(next);
}

const KIND_LABEL: Record<DelegationKind, string> = { subagent: "Subagent", advisor: "Advisor" };
/** A committed store change re-reads waiting children at most this often. */
const WAIT_CHANGE_RECHECK_MS = 1000;
/** Re-reads children this often even without a change signal (missed-wakeup safety net). */
const WAIT_SAFETY_RECHECK_MS = 5000;

/** Subagents one caller may run at once: fewer for a subagent's own (grandchildren). */
const subagentLimit = (depth: 0 | 1) =>
  depth === 1 ? DELEGATION_LIMITS.runningNestedSubagents : DELEGATION_LIMITS.runningSubagents;

/**
 * Trust boundary for `agents.*`. Models come from the caller's own settings and
 * the Host catalog; the store, not a model setting, decides recursion and limits.
 */
export class ConversationDelegation {
  readonly store: DelegationStore;
  readonly communication: AgentCommunication;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly continuations = new Map<string, Promise<void>>();

  constructor(private readonly deps: DelegationDependencies) {
    this.store = new DelegationStore(deps.directory);
    this.communication = new AgentCommunication({
      directory: deps.directory,
      records: this.store,
      inspect: (id) => inspectAgentSession(deps, id),
      result: (record) => this.describe(record, async () => undefined),
      deliver: agentMessageDelivery(deps, async (message) => {
        const target = message.target!;
        const result = await this.reply(
          { requestId: message.commandId, runId: target.runId, message: message.text },
          {
            sessionId: target.parentSessionId,
            projectId: (await deps.featureSession(target.parentSessionId)).projectId,
          },
          async () => undefined,
          message.text,
        );
        return "waiting" in result ? "waiting" : "started";
      }),
    });
  }

  async call(
    action: string,
    args: Record<string, unknown>,
    caller: AgentsCaller,
    locate: Locate,
  ): Promise<unknown> {
    if (action === "agents.list") return this.communication.list(caller);
    if (action === "agents.send") return this.communication.send(args, caller);
    if (action === "agents.options") return await this.options(caller);
    if (action === "agents.delegate") return await this.start("subagent", args, caller, locate);
    if (action === "agents.consult") return await this.start("advisor", args, caller, locate);
    if (action === "agents.reply") return await this.reply(args, caller, locate);
    if (action === "agents.wait") return await this.wait(args, caller, locate);
    if (action === "agents.cancel") return await this.cancel(args, caller, locate);
    throw new Error("Unsupported agents tool.");
  }

  async resumePending(): Promise<void> {
    for (const record of await this.store.list())
      if (
        record.notifyOnCompletion &&
        record.pending &&
        !record.childSessionId &&
        !record.communicationClosed &&
        record.finishedAt === undefined
      )
        await this.start(
          record.kind,
          record.pending.args,
          {
            sessionId: record.parentSessionId,
            projectId: (await this.deps.featureSession(record.parentSessionId)).projectId,
          },
          async () => undefined,
        );
  }

  /** Internal task recovery entry. A model-facing agents call cannot invoke this path. */
  async consultTaskRepair(
    taskId: string,
    args: Record<string, unknown>,
    caller: AgentsCaller,
    locate: Locate,
  ): Promise<unknown> {
    const row = await this.deps.engine.store.db
      .prepare("SELECT value FROM tasks WHERE id=?")
      .get(taskId);
    const task = row ? JSON.parse(String(row.value)) : undefined;
    if (
      !task ||
      task.projectId !== caller.projectId ||
      task.repairAdvisor?.sessionId !== caller.sessionId ||
      task.repairAdvisor?.requestId !== args.requestId ||
      !(task.status === "queued" || (task.status === "review" && task.conflictRecovery))
    )
      throw new Error("Task repair advisor identity is no longer current.");
    return this.start("advisor", args, caller, locate, true);
  }

  /**
   * Stops every running child of a parent that was cancelled or deleted. With
   * `keepNotifying`, children that report back to the parent (`notifyOnCompletion`)
   * are background work and keep running, as the agents tool promises.
   */
  async cancelChildren(
    parentSessionId: string,
    options: { keepNotifying?: boolean } = {},
  ): Promise<void> {
    const stopped = (record: DelegationRecord) =>
      record.parentSessionId === parentSessionId &&
      !(options.keepNotifying && record.notifyOnCompletion);
    for (const record of await this.store.list())
      if (stopped(record)) await this.store.patch(record.runId, { communicationClosed: true });
    const records = (await this.refresh((await this.store.list()).filter(stopped))).filter(
      (record) => record.finishedAt === undefined,
    );
    await Promise.all(
      records.map(async (record) => {
        if (!record.childSessionId) {
          await this.cancelPending(record);
          return;
        }
        await cancelSessionRun(this.deps.engine, {
          sessionId: record.childSessionId,
          runId: record.childRunId,
        }).catch((error) => console.warn("Subagent cancel failed:", errorMessage(error)));
      }),
    );
  }

  /** Shared discovery and execution boundary for Host delegation children. */
  async isChild(sessionId: string, session?: Session): Promise<boolean> {
    return (
      (await this.store.isChild(sessionId)) ||
      !!decodeDelegationParent(
        (session ?? (await this.deps.featureSession(sessionId)).session).modelSettings[
          DELEGATION_PARENT_KEY
        ],
      )
    );
  }

  /** Which agents tools a session is offered: an owner conversation, a subagent that may start
   * subagents, or a leaf (an advisor or a grandchild) that may only message its group. */
  async agentRole(sessionId: string): Promise<AgentRole> {
    const link = await this.link(sessionId);
    if (!link) return "owner";
    return link.kind === "advisor" || (await this.link(link.parentSessionId)) ? "leaf" : "subagent";
  }

  /** The run that started a session, from the store or else its parent link; none for an owner conversation. */
  private async link(
    sessionId: string,
    session?: Session,
  ): Promise<{ parentSessionId: string; kind: DelegationKind } | undefined> {
    const record = (await this.store.list()).find((entry) => entry.childSessionId === sessionId);
    if (record) return { parentSessionId: record.parentSessionId, kind: record.kind };
    const own =
      session ?? (await this.deps.featureSession(sessionId).catch(() => undefined))?.session;
    const parent = decodeDelegationParent(own?.modelSettings[DELEGATION_PARENT_KEY]);
    return parent ? { parentSessionId: parent.parentSessionId, kind: parent.kind } : undefined;
  }

  /**
   * Depth 0 is the owner's conversation, 1 its subagent. Owner decision 2026-11-17: a subagent may
   * start subagents, a grandchild is the deepest level, and advisors never start runs.
   */
  private async caller(caller: AgentsCaller, taskRepair = false) {
    const own = await this.deps.featureSession(caller.sessionId);
    if (own.projectId !== caller.projectId)
      throw new Error("Conversation belongs to another project.");
    const link = taskRepair ? undefined : await this.link(caller.sessionId, own.session);
    if (!link) return { ...own, depth: 0 as const };
    if (await this.link(link.parentSessionId))
      throw new Error("A subagent's subagent cannot start agents runs.");
    if (link.kind === "advisor") throw new Error("An advisor cannot start agents runs.");
    return { ...own, depth: 1 as const };
  }

  private async selected(session: Session, catalog: HostModelCatalog) {
    const signedOutAccounts = new Set<string>();
    const defaultAccounts =
      session.modelSettings[CROSS_SUBAGENTS_KEY] === AUTOMATIC_SUBAGENTS
        ? ((await this.deps.defaultAccounts?.()) ?? {})
        : {};
    if (session.modelSettings[CROSS_SUBAGENTS_KEY] === AUTOMATIC_SUBAGENTS) {
      await Promise.all(
        this.deps.providers.map(async (provider) => {
          const account =
            provider === session.harness
              ? (session.providerAccountId ?? "default")
              : (defaultAccounts[provider] ?? "default");
          if ((await this.deps.authStatus(provider, account)) === "signedOut")
            signedOutAccounts.add(`${provider}:${account}`);
        }),
      );
    }
    const input = {
      harness: session.harness,
      providerAccountId: session.providerAccountId,
      models: subagentCatalogModels(catalog.models),
      providers: this.deps.providers,
      signedOutAccounts,
      defaultAccounts,
    };
    const subagents = resolveSubagents(session.modelSettings[CROSS_SUBAGENTS_KEY], input);
    return {
      subagents,
      ...(session.modelSettings[CROSS_SUBAGENTS_KEY] === AUTOMATIC_SUBAGENTS && !subagents.length
        ? { automatic: { reason: automaticSubagentEmptyReason(input) } }
        : {}),
      // Claude Code's own advisor answers a Claude conversation's Claude pick inside its turn.
      advisor: nativeAdvisor(session.harness, session.modelSettings)
        ? undefined
        : decodeAdvisor(session.modelSettings[CROSS_ADVISOR_KEY]),
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
    const { subagents, advisor, automatic } = await this.selected(own.session, catalog);
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
        filesFalse: {
          available: model !== undefined && chatOnlyAvailable({ ...ref, model: model.id }),
          repositoryReadIsolation: false,
        },
        effortLevels: effort?.options.map((option) => option.value) ?? [],
        ...(effort ? { defaultEffort: effort.value } : {}),
      };
    };
    return {
      subagents: subagents.map((ref) => ({ ...describe(ref), tier: subagentTier(ref.model) })),
      ...(automatic ? { automatic } : {}),
      ...(own.session.modelSettings[CROSS_SUBAGENT_MAX_EFFORT_KEY]
        ? { maxEffort: own.session.modelSettings[CROSS_SUBAGENT_MAX_EFFORT_KEY] }
        : {}),
      ...(advisor ? { advisor: describe(advisor) } : {}),
      running: { subagents: running.subagent, advisors: running.advisor },
      notifyOnCompletionAvailable: !(await delegationWorkRoot(
        this.deps.engine.store,
        caller.sessionId,
        own.runId,
      )),
      limits: {
        runningSubagents: subagentLimit(own.depth),
        runningAdvisors: DELEGATION_LIMITS.runningAdvisors,
      },
    };
  }

  private async start(
    kind: DelegationKind,
    args: Record<string, unknown>,
    caller: AgentsCaller,
    locate: Locate,
    taskRepair = false,
  ) {
    const own = await this.caller(caller, taskRepair);
    if (own.depth === 1 && kind === "advisor")
      throw new Error("A subagent cannot consult an advisor.");
    if (kind === "advisor" && nativeAdvisor(own.session.harness, own.session.modelSettings))
      throw new Error(
        "This conversation's advisor is Claude Code's built-in advisor tool; ask it inside your own turn. agents.consult is not used.",
      );
    if (args.notifyOnCompletion !== undefined && typeof args.notifyOnCompletion !== "boolean")
      throw new Error("notifyOnCompletion must be a boolean.");
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
          ...(args.notifyOnCompletion === undefined ? [] : [args.notifyOnCompletion]),
          ...(args.files === undefined ? [] : [{ files: args.files }]),
        ]),
      )
      .digest("hex");
    return await this.serial(async () => {
      const existing = await this.store.findByRequestKey(requestKey);
      if (existing) {
        if (existing.requestKey !== requestKey || existing.payloadHash !== payloadHash)
          throw new Error("requestId was already used with a different payload.");
        if (existing.childSessionId || existing.finishedAt !== undefined)
          return await this.describe(existing, locate);
      }
      const callerFingerprint = JSON.stringify([
        own.runId ?? own.session.blocks[executionUserIndex(own.session.blocks)]?.id,
        own.session.cwd,
        own.session.harness,
        own.session.model,
        own.session.providerAccountId,
        own.session.runtimeMode,
        own.session.worktreeCwd,
        own.session.modelSettings,
      ]);
      if (existing?.pending && existing.pending.callerFingerprint !== callerFingerprint) {
        await this.cancelPending(existing);
        throw new Error("Queued delegation caller configuration changed. Submit a new request.");
      }
      const catalog = await this.deps.models(caller.projectId);
      const { subagents, advisor } = await this.selected(own.session, catalog);
      const candidates = kind === "advisor" ? (advisor ? [advisor] : []) : subagents;
      if (!candidates.length)
        throw new Error(`No ${kind} model is selected for this conversation.`);
      let ref = existing?.pending ? existing.model : candidates[0]!;
      if (
        existing?.pending &&
        !candidates.some((candidate) => delegateRefKey(candidate) === delegateRefKey(ref))
      ) {
        await this.cancelPending(existing);
        throw new Error("Queued delegation model selection changed. Submit a new request.");
      }
      if (kind === "subagent" && (candidates.length > 1 || args.model !== undefined)) {
        const choices = `Use one of: ${candidates.map(delegateRefKey).join(", ")}.`;
        if (typeof args.model !== "string")
          throw new Error(
            `Field model is required when more than one subagent model is selected. ${choices}`,
          );
        const match = candidates.find((candidate) => delegateRefKey(candidate) === args.model);
        if (!match)
          throw new Error(`Field model is not one of the selected subagent models. ${choices}`);
        ref = match;
      }
      const model = this.resolve(ref, catalog);
      if (!model) throw new Error("The selected model is unavailable. Choose another model.");
      await this.verifySignIn(ref);
      if (args.files !== undefined && typeof args.files !== "boolean")
        throw new Error("Field files must be a boolean.");
      const chatOnly = args.files === false;
      if (chatOnly && !chatOnlyAvailable({ ...ref, model: model.id }))
        throw new Error(
          "files:false is unavailable for this model; check agents.options before choosing a model.",
        );
      const runId = existing?.runId ?? randomUUID();
      const rootWorkId =
        existing?.rootWorkId ??
        (await delegationWorkRoot(this.deps.engine.store, caller.sessionId, own.runId));
      if (rootWorkId && args.notifyOnCompletion === true)
        throw new Error(
          "Unattended Work parents must wait for child results; background completion is for interactive conversations.",
        );
      if (
        existing?.pending &&
        existing.rootWorkId !==
          (await delegationWorkRoot(this.deps.engine.store, caller.sessionId, own.runId))
      ) {
        await this.cancelPending(existing);
        throw new Error("Queued delegation caller work root changed. Submit a new request.");
      }
      const budgetScope =
        existing?.budgetScope ??
        (await delegationBudgetScope(this.deps.engine.store, caller.sessionId, own.runId));
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
        startedAt: existing?.startedAt ?? Date.now(),
        round: 1,
      };
      const baseSettings =
        existing?.modelSettings ??
        childModelSettings(
          model,
          kind === "advisor" ? own.session.modelSettings : {},
          args.effort as string | undefined,
          kind === "subagent"
            ? own.session.modelSettings[CROSS_SUBAGENT_MAX_EFFORT_KEY]
            : undefined,
        );
      // A subagent inherits the owner's selection and ceiling, so its own runs and its native
      // subagents stay inside them. A grandchild gets explicit Off: nothing runs below it.
      const lineage: Record<string, string> =
        kind !== "subagent"
          ? {}
          : own.depth === 1
            ? { [CROSS_SUBAGENTS_KEY]: "[]" }
            : Object.fromEntries(
                [CROSS_SUBAGENTS_KEY, CROSS_SUBAGENT_MAX_EFFORT_KEY].flatMap((key) =>
                  own.session.modelSettings[key] ? [[key, own.session.modelSettings[key]!]] : [],
                ),
              );
      const modelSettings = existing?.modelSettings ?? {
        ...baseSettings,
        ...lineage,
        ...(chatOnly ? { [DELEGATION_CHAT_ONLY_KEY]: "on" } : {}),
      };
      if (!existing)
        await this.store.add({
          runId,
          kind,
          parentSessionId: caller.sessionId,
          childSessionId: "",
          groupId: own.runId ?? own.session.blocks[executionUserIndex(own.session.blocks)]?.id,
          model: ref,
          title,
          requestKey,
          payloadHash,
          modelSettings,
          pending: { args: structuredClone(args), callerFingerprint },
          startedAt: parent.startedAt,
          ...(args.notifyOnCompletion === true ? { notifyOnCompletion: true } : {}),
          ...(chatOnly ? { chatOnly: true as const } : {}),
          ...(rootWorkId ? { rootWorkId } : {}),
          ...(budgetScope ? { budgetScope } : {}),
        });
      const pending = (await this.store.find(runId))!;
      if (await refuseSingleSlotChild(this.deps.engine.store, pending)) {
        await this.store.patch(runId, {
          finishedAt: Date.now(),
          status: "failed",
          error:
            "Delegation cannot run while this turn holds the only Work slot. Complete the work in this turn without delegation, or increase Work concurrency.",
        });
        return await this.describe((await this.store.find(runId))!, locate);
      }
      const running = await this.runningCounts(caller.sessionId, runId);
      if (
        (kind === "subagent" && running.subagent >= subagentLimit(own.depth)) ||
        (kind === "advisor" && running.advisor >= DELEGATION_LIMITS.runningAdvisors)
      )
        return await this.describe(pending, locate);
      const started = await launchSessionRun(this.deps.engine.store, this.deps.engine, {
        ...(rootWorkId
          ? {
              work: { kind: `delegation.${kind}` as const, id: runId, occurrence: requestKey },
              workRootWorkId: rootWorkId,
              workBudgetScope: { ...budgetScope, role: kind === "advisor" ? "advisor" : "worker" },
            }
          : {}),
        requestId: `agents_${createHash("sha256").update(requestKey).digest("hex").slice(0, 40)}`,
        projectId: caller.projectId,
        harness: ref.harness,
        ...(ref.providerAccountId ? { providerAccountId: ref.providerAccountId } : {}),
        model: model.id,
        modelSettings: { ...modelSettings, [DELEGATION_PARENT_KEY]: JSON.stringify(parent) },
        runtimeMode: chatOnly ? "supervised" : own.session.runtimeMode,
        ...(chatOnly ? { scratchCwd: await this.store.scratchDir(runId) } : {}),
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
      if (started.deferred) return await this.describe(pending, locate);
      if (!started.sessionId)
        throw new Error(started.error ?? `The ${kind} could not start. Try again later.`);
      const record: DelegationRecord = {
        runId,
        kind,
        parentSessionId: caller.sessionId,
        childSessionId: started.sessionId,
        ...(chatOnly ? { chatOnly: true as const } : {}),
        ...(rootWorkId ? { rootWorkId } : {}),
        ...(budgetScope ? { budgetScope } : {}),
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
      await this.store.patch(runId, record);
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
    }
  }

  private async reply(
    args: Record<string, unknown>,
    caller: AgentsCaller,
    locate: Locate,
    brief?: string,
  ) {
    if (args.runIds === undefined) {
      if (args.runId === undefined) throw new Error("Pass exactly one of runId or runIds.");
      return await this.replyOne(args, caller, locate, brief);
    }
    if (args.runId !== undefined) throw new Error("Pass exactly one of runId or runIds.");
    const ids = args.runIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 20 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || id.length < 1 || id.length > 200)
    )
      throw new Error("runIds must be 1 to 20 unique run IDs.");
    if (typeof args.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(args.requestId))
      throw new Error("Invalid requestId.");
    const replies: unknown[] = [];
    // One failing child must not hide the others' results; each keeps its own idempotency key.
    for (const runId of ids as string[]) {
      try {
        replies.push(
          await this.replyOne({ ...args, runId, runIds: undefined }, caller, locate, brief, [
            args.requestId,
            runId,
          ]),
        );
      } catch (error) {
        replies.push({ runId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { replies };
  }

  private async replyOne(
    args: Record<string, unknown>,
    caller: AgentsCaller,
    locate: Locate,
    brief?: string,
    keyParts?: [string, string],
  ) {
    const own = await this.caller(caller);
    if (typeof args.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(args.requestId))
      throw new Error("Invalid requestId.");
    if (
      typeof args.message !== "string" ||
      args.message.length < 1 ||
      args.message.length > (brief ? 20_000 : DELEGATION_LIMITS.promptChars)
    )
      throw new Error("Invalid message length.");
    if (typeof args.runId !== "string" || args.runId.length < 1 || args.runId.length > 200)
      throw new Error("Invalid runId.");
    const requestKey = `agents:${caller.sessionId}:${keyParts ? keyParts.join(":") : args.requestId}`;
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
      if (brief && (status.status === "running" || status.status === "needsInput"))
        return { waiting: true };
      if (status.status === "running") throw new Error("Run is running. Wait or cancel it first.");
      if (status.status === "needsInput")
        throw new Error("Answer the approval in the child's own session first.");
      await this.verifySignIn(record.model);
      const running = await this.runningCounts(caller.sessionId);
      const limit =
        record.kind === "subagent" ? subagentLimit(own.depth) : DELEGATION_LIMITS.runningAdvisors;
      if (brief && running[record.kind] >= limit) return { waiting: true };
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
        if (
          (record.chatOnly || record.modelSettings?.[DELEGATION_CHAT_ONLY_KEY] === "on") &&
          child.session.cwd !== (await this.store.scratchDir(record.runId))
        )
          throw new Error(
            "Chat-only child no longer uses its scratch folder; cannot resume safely.",
          );
        const catalog = await this.deps.models(caller.projectId);
        const model = this.resolve(record.model, catalog);
        const previousSettings = record.modelSettings ?? child.session.modelSettings;
        const ceiling = own.session.modelSettings[CROSS_SUBAGENT_MAX_EFFORT_KEY];
        if (record.kind === "subagent" && ceiling && !model)
          throw new Error("Cannot enforce the subagent ceiling while the model is unavailable.");
        const effort = model && modelEffortSetting(model);
        const clamped =
          record.kind === "subagent" && model && ceiling
            ? childModelSettings(model, previousSettings, undefined, ceiling)
            : undefined;
        const restoredSettings =
          clamped && effort
            ? { ...previousSettings, [effort.id]: clamped[effort.id]! }
            : previousSettings;
        // Restore the recorded model/account if the owner changed this child's settings.
        // The child's parent link moves to its next round.
        const parentLink = nextRoundParent(
          child.session.modelSettings[DELEGATION_PARENT_KEY]!,
          (record.replies?.length ?? 0) + 2,
        );
        const configure = (revision: number | undefined) =>
          this.deps.engine.command({
            type: "configure",
            commandId: `agents_${createHash("sha256").update(requestKey).digest("hex")}:configure`,
            sessionId: record.childSessionId,
            expectedRevision: revision,
            harness: record.model.harness,
            model: record.model.model,
            providerAccountId: record.model.providerAccountId ?? null,
            modelSettings: { ...restoredSettings, [DELEGATION_PARENT_KEY]: parentLink },
            runtimeMode: child.session.runtimeMode,
          });
        try {
          try {
            await configure(child.revision);
          } catch (error) {
            // The child changed under us (owner edit, finishing turn): retry once on the fresh revision.
            if (!(error instanceof Error) || !/conversation changed/i.test(error.message))
              throw error;
            await configure((await this.deps.engine.store.session(record.childSessionId)).revision);
          }
        } catch (error) {
          // Nothing reached the child yet, so the message is undelivered, not "unknown".
          if (error instanceof Error) Object.assign(error, { notOffered: true });
          throw error;
        }
        const rootWorkId =
          record.rootWorkId ??
          (await delegationWorkRoot(this.deps.engine.store, caller.sessionId, own.runId));
        if (rootWorkId) {
          const started = await launchSessionRun(this.deps.engine.store, this.deps.engine, {
            work: {
              kind: `delegation.${record.kind}` as const,
              id: record.runId,
              occurrence: requestKey,
            },
            workRootWorkId: rootWorkId,
            workBudgetScope: {
              ...record.budgetScope,
              role: record.kind === "advisor" ? "advisor" : "worker",
            },
            resumeSessionId: record.childSessionId,
            projectId: caller.projectId,
            harness: record.model.harness,
            model: record.model.model,
            ...(record.model.providerAccountId
              ? { providerAccountId: record.model.providerAccountId }
              : {}),
            modelSettings: { ...restoredSettings, [DELEGATION_PARENT_KEY]: parentLink },
            runtimeMode: child.session.runtimeMode,
            title: record.title,
            prompt: brief ?? replyBrief(args.message as string),
            ...(record.kind === "advisor" ? { intent: "plan" as const } : {}),
          });
          if (brief && started.deferred) return { waiting: true };
          if (started.deferred || !started.runId)
            throw new Error(
              started.error ??
                "Delegation reply is waiting for Work admission. Retry with the same requestId.",
            );
        } else {
          await this.deps.engine.command({
            type: "send",
            commandId: `agents_${createHash("sha256").update(requestKey).digest("hex")}:send`,
            sessionId: record.childSessionId,
            text: brief ?? replyBrief(args.message as string),
            ...(record.kind === "advisor" ? { intent: "plan" as const } : {}),
          });
        }
        const latest = await this.deps.engine.store.session(record.childSessionId);
        await this.store.patch(record.runId, {
          childRunId: latest.runId,
          finishedAt: undefined,
          status: undefined,
          error: undefined,
          ownerFollowUp: undefined,
          communicationClosed: undefined,
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
    for (const record of records) {
      if (!record.childSessionId && record.finishedAt === undefined && record.pending) {
        // Reenter through current caller validation; never retain an old async callback.
        await this.start(record.kind, record.pending.args, caller, locate);
      }
    }
    records = await Promise.all(ids.map((id) => this.owned(id, caller)));
    const started = monotonicNow();
    // Children report progress through committed session writes, so the store's change
    // signal wakes this wait. Reads run only after a change (throttled) or on a slow safety tick.
    const changes = this.deps.engine.store.changes;
    let readVersion = changes.version;
    let readAt: number | undefined;
    let statuses: { status: RunStatus }[] = [];
    for (;;) {
      const changed = changes.version !== readVersion;
      const age = readAt === undefined ? Infinity : elapsedSince(readAt);
      if (
        readAt === undefined ||
        (changed && age >= WAIT_CHANGE_RECHECK_MS) ||
        age >= WAIT_SAFETY_RECHECK_MS
      ) {
        readVersion = changes.version;
        readAt = monotonicNow();
        records = await Promise.all(records.map((record) => this.follow(record)));
        statuses = await Promise.all(records.map((record) => this.statusOf(record)));
      }
      const remaining = seconds * 1000 - elapsedSince(started);
      if (statuses.every((status) => status.status !== "running") || remaining <= 0) break;
      await changes.wait(Date.now() + remaining, () => false, changes.version);
    }
    const runs = await Promise.all(records.map((record) => this.describe(record, locate)));
    return args.runIds === undefined ? runs[0] : { runs };
  }

  private async cancel(args: Record<string, unknown>, caller: AgentsCaller, locate: Locate) {
    const record = await this.follow(await this.owned(args.runId, caller));
    if (!record.childSessionId) {
      await this.cancelPending(record);
      return await this.describe((await this.store.find(record.runId))!, locate);
    }
    const status = await this.statusOf(record);
    if (status.status === "running" || status.status === "needsInput") {
      await cancelSessionRun(this.deps.engine, {
        sessionId: record.childSessionId,
        runId: record.childRunId,
      });
    }
    return await this.describe(await this.owned(args.runId, caller), locate);
  }

  private async cancelPending(record: DelegationRecord) {
    if (record.rootWorkId)
      await cancelSessionWorkOccurrence(this.deps.engine.store, {
        kind: `delegation.${record.kind}` as const,
        id: record.runId,
        occurrence: record.requestKey,
      });
    await this.store.patch(record.runId, { finishedAt: Date.now(), status: "cancelled" });
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
    // A queued launch has no child session yet; there is nothing to follow.
    if (!record.childSessionId) return record;
    let childRunId: string | undefined;
    try {
      // Only the turn id is compared, so read it from the state row, not the transcript.
      childRunId = await this.deps.engine.store.sessionRunId(record.childSessionId);
    } catch (error) {
      // A transient read error must not be mistaken for a vanished child: look again later.
      if (!isSessionNotFound(error)) throw error;
      return record;
    }
    if (!childRunId || childRunId === record.childRunId) return record;
    await this.store.patch(record.runId, {
      childRunId,
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

  private async runningCounts(parentSessionId: string, exceptRunId?: string) {
    // Only this parent's rows are refreshed; other conversations' records stay untouched.
    const own = (await this.store.list()).filter(
      (record) => record.parentSessionId === parentSessionId,
    );
    const records = (await this.refresh(own)).filter(
      (record) =>
        !!record.childSessionId && record.runId !== exceptRunId && record.finishedAt === undefined,
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
    if (!record.childSessionId) return { status: "queued" };
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
