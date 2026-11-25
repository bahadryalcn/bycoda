import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { HostModelCatalog, HostSession } from "../../src/features/connections/model/protocol";
import { carryModelSettings } from "../../src/features/connections/model/remoteModels";
import type { UsageLimit } from "../../src/features/sessions/model/session";
import {
  LimitedAccounts,
  failoverAccountKey,
  pickAccountFailover,
  type FailoverTarget,
} from "../../src/features/sessions/model/usageLimitFailover";
import { RESUME_PROMPT } from "../../src/features/sessions/model/userPromptText";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { isUserConversation } from "../../src/shared/model/host-contracts/delegation";
import { modelRoutingProjectKey } from "../../src/shared/model/modelRoutingPools";
import { quotaModelMatches } from "../assistant/models/assistant-quota-reader";
import type { ModelRoutingService } from "../domains/model-routing/ports";
import type { HostEngine } from "../engine";
import { providerAccountKind } from "../model-routing/account-kind";
import { isProfileProvider, type HostProviderAccountCatalog } from "../providers/provider-accounts";
import { readHostAgentDefaults } from "../settings-defaults/read-defaults";
import { isQuotaProvider, type QuotaTarget, type UsageLimitsReport } from "../usage/limits-report";

/** The engine drops a settled turn right after its callback; a stuck turn gets no failover. */
const RELEASE_WAIT_MS = 5_000;
const RELEASE_POLL_MS = 25;

export type UsageLimitFailoverPorts = {
  engine: Pick<HostEngine, "store" | "hasActiveRun" | "sessionStoreWrite" | "command">;
  /** Retires desktop writers and refuses when another client holds the conversation. */
  withWriters<T>(id: string, run: () => Promise<T>): Promise<T>;
  /** Tasks, goals, crews, stewards and automation runs: anything naming the session owns it. */
  workRecords(id: string): Promise<unknown[]>;
  accounts(): Promise<HostProviderAccountCatalog>;
  limits(target: QuotaTarget): Promise<UsageLimitsReport>;
  models(): Promise<HostModelCatalog>;
  routing(): ModelRoutingService;
};

/** Only a conversation the owner runs directly moves; work has its own limit handling. */
async function isOrdinaryChat(value: HostSession, ports: UsageLimitFailoverPorts) {
  const { session } = value;
  if (
    value.archived ||
    value.managedBy ||
    session.managedBy ||
    session.orchestrationLeadId ||
    session.inboxAsk ||
    !isUserConversation(session) ||
    // A Native conversation the Host adopted: the desktop app still decides for its copy.
    // Conversations created on the Host carry a zero stamp.
    (!!value.desktop?.updatedAt && value.authorityGeneration === undefined)
  )
    return false;
  const quoted = JSON.stringify(session.id);
  return !(await ports.workRecords(session.id)).some((record) =>
    JSON.stringify(record).includes(quoted),
  );
}

/** An unreadable or spent account is not headroom; a window for another model does not count. */
function accountHasQuota(
  report: UsageLimitsReport | undefined,
  harness: string,
  accountId: string,
  model: string,
): boolean {
  const provider = report?.providers.find((entry) => entry.provider === harness);
  if (provider?.accounts.find((account) => account.id === accountId)?.status !== "ok") return false;
  const modelId = model.slice(model.indexOf(":") + 1);
  return !provider.cards.some(
    (card) =>
      (card.model === null || quotaModelMatches(card.model, modelId)) &&
      card.accounts.some((account) => account.id === accountId && account.reading.leftPercent <= 0),
  );
}

async function accountTarget(
  value: HostSession,
  ports: UsageLimitFailoverPorts,
  accounts: HostProviderAccountCatalog,
  isLimited: (key: string) => boolean,
): Promise<FailoverTarget | undefined> {
  const { harness, model, providerAccountId } = value.session;
  if (!isProfileProvider(harness) || !isQuotaProvider(harness)) return undefined;
  const [state, project] = await Promise.all([
    ports.routing().get(),
    ports.engine.store.project(value.projectId).catch(() => undefined),
  ]);
  const scope = project ? state.projectKinds?.[modelRoutingProjectKey(project.cwd)] : undefined;
  const current = providerAccountId ?? "default";
  return pickAccountFailover({
    harness,
    model,
    accountIds: (accounts[harness] ?? [])
      .map((account) => account.id)
      .filter((id) => {
        const kind = scope ? providerAccountKind(accounts, harness, id) : undefined;
        return id !== current && (!kind || kind === scope);
      }),
    limited: isLimited,
    hasQuota: async (id) =>
      accountHasQuota(
        await ports.limits({ provider: harness, accountId: id }).catch(() => undefined),
        harness,
        id,
        model,
      ),
  });
}

async function orderTarget(
  value: HostSession,
  ports: UsageLimitFailoverPorts,
  isLimited: (key: string) => boolean,
): Promise<FailoverTarget | undefined> {
  const routing = ports.routing();
  const [state, statuses, project] = await Promise.all([
    routing.get(),
    routing.status(),
    ports.engine.store.project(value.projectId).catch(() => undefined),
  ]);
  const targetKey = (target: FailoverTarget) =>
    `${failoverAccountKey(target.harness, target.providerAccountId)}\n${target.model}`;
  const spentIds = new Set(
    statuses.filter((status) => status.leftPercent === 0).map((status) => status.entryId),
  );
  const spent = new Set(state.entries.filter((e) => spentIds.has(e.id)).map(targetKey));
  const resolved = await routing.resolve({
    // An explicit order choice reads no role.
    role: "task.worker",
    choice: { kind: "order" },
    ...(project ? { cwd: project.cwd } : {}),
    eligible: (target) =>
      !isLimited(failoverAccountKey(target.harness, target.providerAccountId)) &&
      !spent.has(targetKey(target)),
  });
  if (!resolved.ok) return undefined;
  const { harness, model, providerAccountId } = resolved.target;
  return { harness, model, ...(providerAccountId ? { providerAccountId } : {}) };
}

function targetLabel(
  target: FailoverTarget,
  accounts: HostProviderAccountCatalog,
  catalog: HostModelCatalog | undefined,
): string {
  const model =
    catalog?.models[target.harness as keyof HostModelCatalog["models"]]?.find(
      (entry) => entry.id === target.model,
    )?.name ?? target.model;
  if (!isProfileProvider(target.harness)) return model;
  const id = target.providerAccountId ?? "default";
  const account = accounts[target.harness]?.find((entry) => entry.id === id)?.label ?? id;
  return `${account} · ${model}`;
}

/** The chat keeps its own effort and options where the target model offers them. */
function targetSettings(
  target: FailoverTarget,
  value: HostSession,
  catalog: HostModelCatalog | undefined,
): Record<string, string> | undefined {
  const current = value.session.modelSettings ?? {};
  if (target.harness === value.session.harness && target.model === value.session.model)
    return current;
  const model = catalog?.models[target.harness as keyof HostModelCatalog["models"]]?.find(
    (entry) => entry.id === target.model,
  );
  return model ? carryModelSettings(model.settings ?? [], current) : undefined;
}

/**
 * When the owner turned on usage-limit failover, an ordinary Host chat stopped at a limit moves
 * to another account or the next entry of the model order and continues there. Only limits a
 * turn reports while this Host runs count, so a restart never resends an old conversation.
 */
export function createUsageLimitFailover(ports: UsageLimitFailoverPorts) {
  const { engine } = ports;
  const { store } = engine;
  const limited = new LimitedAccounts();

  const released = async (id: string) => {
    const started = monotonicNow();
    while (engine.hasActiveRun(id)) {
      if (elapsedSince(started) >= RELEASE_WAIT_MS) return false;
      await delay(RELEASE_POLL_MS);
    }
    return true;
  };

  /** Applies only while the same limit still stands: the owner's own answer wins. */
  const whileLimited = (
    id: string,
    limit: UsageLimit,
    work: (current: HostSession) => Promise<void>,
  ) =>
    engine.sessionStoreWrite(id, () =>
      store.transaction(async () => {
        const current = await store.session(id);
        if (
          current.status === "running" ||
          JSON.stringify(current.session.usageLimit) !== JSON.stringify(limit)
        )
          return;
        await work(current);
      }, "critical"),
    );

  const note = (current: HostSession, text: string) =>
    store.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        session: {
          ...current.session,
          blocks: [
            ...current.session.blocks,
            { id: randomUUID(), role: "system", notice: "info", text, streaming: false },
          ],
        },
      },
      { type: "usageLimit.failover" },
    );

  const run = async (id: string) => {
    const value = await store.session(id);
    const limit = value.session.usageLimit;
    if (!limit || limit.recoveryFrom) return;
    const origin = failoverAccountKey(value.session.harness, value.session.providerAccountId);
    limited.hold(origin, Date.now(), limit.resetsAt);
    const defaults = await readHostAgentDefaults(store);
    const mode = defaults.version > 0 ? defaults.usageLimitFailover : "off";
    if (mode === "off" || !(await isOrdinaryChat(value, ports)) || !(await released(id))) return;
    const isLimited = (key: string) => limited.has(key, Date.now());
    const [accounts, catalog] = await Promise.all([
      ports.accounts(),
      ports.models().catch(() => undefined),
    ]);
    const target =
      mode === "account"
        ? await accountTarget(value, ports, accounts, isLimited)
        : await orderTarget(value, ports, isLimited);
    const modelSettings = target && targetSettings(target, value, catalog);
    if (!target || !modelSettings) {
      await whileLimited(id, limit, async (current) => {
        await note(
          current,
          mode === "account"
            ? "No other account has quota left. Waiting for the usage limit to reset."
            : "No model in the model order has quota left. Waiting for the usage limit to reset.",
        );
      });
      return;
    }
    const commandId = `usage-limit-failover:${id}:${randomUUID()}`;
    await ports.withWriters(id, () =>
      whileLimited(id, limit, async (current) => {
        await note(
          current,
          `Usage limit reached. Continuing on ${targetLabel(target, accounts, catalog)}.`,
        );
        await engine.command({
          type: "configure",
          commandId: `${commandId}:configure`,
          sessionId: id,
          harness: target.harness,
          model: target.model,
          modelSettings,
          runtimeMode: current.session.runtimeMode,
          providerAccountId:
            !target.providerAccountId || target.providerAccountId === "default"
              ? null
              : target.providerAccountId,
        });
        const moved = (await store.session(id)).session;
        // Throwing rolls the note and the switch back: never resend on the limited account.
        if (failoverAccountKey(moved.harness, moved.providerAccountId) === origin)
          throw new Error("The usage limit failover did not change the account.");
        await engine.command({ type: "send", commandId, sessionId: id, text: RESUME_PROMPT });
      }),
    );
  };

  return {
    /** Call without awaiting from the turn's settle callback: it waits for the turn to end. */
    async settled(id: string, outcome: { cancelled?: boolean; interrupted?: boolean }) {
      if (outcome.cancelled || outcome.interrupted) return;
      await run(id);
    },
  };
}
