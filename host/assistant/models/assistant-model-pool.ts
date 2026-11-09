import {
  AssistantModelPoolRowSchema,
  ASSISTANT_MODEL_POOL_MAX_ROWS,
  type AssistantModelPoolResponse,
  type AssistantModelPoolRole,
  type AssistantModelPoolRow,
} from "../../../src/shared/model/assistantModelPool";
import { assistantRoleExecution } from "../../../src/shared/model/assistantRoles";
import type {
  AssistantExecution,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import { hostProviderAccounts } from "../../providers/provider-accounts";
import type { HostProviderAccountCatalog } from "../../providers/provider-accounts";
import type { AssistantRepository } from "../repository";

const POOL_RECORD = "model-pool";
type StoredPool = {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  value: { rows: unknown };
};

export type AssistantModelPoolPorts = {
  /** Known provider accounts; defaults to the Host inventory. */
  accounts: () => Promise<HostProviderAccountCatalog>;
  /** Model ids the Host knows per harness; undefined or an unlisted harness skips the model check. */
  catalog?: () => Promise<{ models: Partial<Record<string, { id: string }[]>> } | undefined>;
};
let ports: AssistantModelPoolPorts = { accounts: () => hostProviderAccounts() };
/** Host wiring hook (shortcut: module-level, set once at server start; move into service ports if a second owner appears). */
export function setAssistantModelPoolPorts(next: Partial<AssistantModelPoolPorts>) {
  ports = { ...ports, ...next };
}

type PoolDeps = {
  repository: Pick<AssistantRepository, "get" | "put">;
  profile: () => Promise<
    Pick<AssistantProfile, "execution" | "chiefExecution" | "replyExecution" | "planningExecution">
  >;
  now: () => number;
};

const settingsKey = (e: AssistantExecution) =>
  JSON.stringify([
    e.harness,
    e.model,
    Object.entries(e.modelSettings).sort(([a], [b]) => a.localeCompare(b)),
    e.runtimeMode,
    e.maxRunMinutes,
  ]);

/** One row per distinct execution of the profile's four role fields, so setups that never saved a pool keep their behavior. */
export function deriveAssistantModelPool(
  profile: Pick<
    AssistantProfile,
    "execution" | "chiefExecution" | "replyExecution" | "planningExecution"
  >,
): AssistantModelPoolRow[] {
  const groups = new Map<
    string,
    { execution: AssistantExecution; roles: AssistantModelPoolRole[] }
  >();
  const add = (role: AssistantModelPoolRole, execution: AssistantExecution | null) => {
    if (!execution) return;
    const key = settingsKey(execution);
    const group = groups.get(key) ?? { execution, roles: [] };
    group.roles.push(role);
    groups.set(key, group);
  };
  add("worker", profile.execution ?? null);
  add("planning", assistantRoleExecution(profile, "planning"));
  add("chief", assistantRoleExecution(profile, "chief"));
  add("reply", assistantRoleExecution(profile, "reply"));
  return [...groups.values()].map(({ execution, roles }, index) => ({
    id: `derived-${index + 1}`,
    harness: execution.harness,
    providerAccountId: "default",
    model: execution.model,
    modelSettings: { ...execution.modelSettings },
    runtimeMode: execution.runtimeMode,
    maxRunMinutes: execution.maxRunMinutes,
    roles,
    minRemainingPercent: 0,
    unknownLimit: "use",
  }));
}

async function validateRows(rows: AssistantModelPoolRow[]) {
  if (rows.length > ASSISTANT_MODEL_POOL_MAX_ROWS)
    throw new Error(`A model pool holds at most ${ASSISTANT_MODEL_POOL_MAX_ROWS} rows.`);
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("Model pool row ids must be unique.");
  if (rows.length && !rows.some((row) => row.roles.includes("worker")))
    throw new Error("At least one model pool row must serve the worker role.");
  const accounts = await ports.accounts();
  const catalog = await ports.catalog?.().catch(() => undefined);
  for (const row of rows) {
    if (new Set(row.roles).size !== row.roles.length)
      throw new Error(`Model pool row ${row.id} repeats a role.`);
    if (row.harness === "codex" || row.harness === "claude") {
      const account = row.providerAccountId ?? "default";
      const known = accounts[row.harness] ?? [];
      // "default" is always valid even when the catalog read came back empty.
      if (account !== "default" && !known.some((entry) => entry.id === account))
        throw new Error(`Unknown ${row.harness} account "${account}" in model pool row ${row.id}.`);
    } else if (row.providerAccountId !== undefined)
      throw new Error(`${row.harness} has no provider accounts (row ${row.id}).`);
    const models = catalog?.models[row.harness];
    if (models?.length && !models.some((entry) => entry.id === row.model))
      throw new Error(`Model "${row.model}" is not available for ${row.harness} (row ${row.id}).`);
  }
}

async function stored(deps: PoolDeps): Promise<StoredPool | undefined> {
  return deps.repository.get<StoredPool>("runtime", POOL_RECORD);
}

export async function getAssistantModelPool(deps: PoolDeps): Promise<AssistantModelPoolResponse> {
  const row = await stored(deps);
  const parsed = AssistantModelPoolRowSchema.array().safeParse(row?.value.rows);
  const version = row?.version ?? 0;
  const updatedAt = row?.updatedAt ?? 0;
  if (parsed.success && parsed.data.length)
    return { rows: parsed.data, version, updatedAt, derived: false };
  return {
    rows: deriveAssistantModelPool(await deps.profile()),
    version,
    updatedAt,
    derived: true,
  };
}

export async function setAssistantModelPool(
  deps: PoolDeps,
  expectedVersion: number,
  rows: AssistantModelPoolRow[],
): Promise<AssistantModelPoolResponse> {
  await validateRows(rows);
  const old = await stored(deps);
  if ((old?.version ?? 0) !== expectedVersion)
    throw new Error("Model pool changed; reload before saving.");
  const now = deps.now();
  await deps.repository.put(
    "runtime",
    {
      id: POOL_RECORD,
      version: old?.version ?? 0,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      value: { rows },
    },
    expectedVersion,
  );
  return getAssistantModelPool(deps);
}

/** Single entry for the Assistant service's `models.pool.*` operations. */
export async function assistantModelPoolOp(
  input:
    | { op: "models.pool.get" }
    | { op: "models.pool.set"; expectedVersion: number; rows: AssistantModelPoolRow[] },
  principal: string,
  deps: PoolDeps,
): Promise<{ modelPool: AssistantModelPoolResponse }> {
  if (input.op === "models.pool.get") return { modelPool: await getAssistantModelPool(deps) };
  if (principal !== "owner") throw new Error("This action requires the owner's direct authority.");
  return { modelPool: await setAssistantModelPool(deps, input.expectedVersion, input.rows) };
}
