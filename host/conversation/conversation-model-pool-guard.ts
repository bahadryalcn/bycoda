import type {
  AssistantModelPoolRole,
  AssistantModelPoolRow,
} from "../../src/shared/model/assistantModelPool";
import { selectPoolRow } from "../assistant/models/assistant-model-selector";

/** Reads the owner's current model pool (saved, or derived from the profile). */
export type ModelPoolSource = () => Promise<{ rows: AssistantModelPoolRow[] }>;

/** A model-supplied execution: either a pool row id or explicit fields to validate. */
export type RequestedExecution = {
  poolRowId?: string;
  harness?: string;
  model?: string;
  providerAccountId?: string | null;
  modelSettings?: Record<string, string>;
  runtimeMode?: string;
};

export type PoolExecution = {
  poolRowId: string;
  harness: AssistantModelPoolRow["harness"];
  model: string;
  providerAccountId?: string;
  modelSettings: Record<string, string>;
  runtimeMode: AssistantModelPoolRow["runtimeMode"];
  maxRunMinutes: number;
};

const account = (value: string | null | undefined) => value ?? "default";

function refusal(rows: AssistantModelPoolRow[]) {
  const names = [...new Set(rows.map((row) => row.model))].join(", ");
  return new Error(
    `This model is not in the assistant's model pool. Choose one of: ${names || "(the pool is empty)"}.`,
  );
}

function canonical(row: AssistantModelPoolRow): PoolExecution {
  return {
    poolRowId: row.id,
    harness: row.harness,
    model: row.model,
    ...(row.providerAccountId && row.providerAccountId !== "default"
      ? { providerAccountId: row.providerAccountId }
      : {}),
    modelSettings: { ...row.modelSettings },
    runtimeMode: row.runtimeMode,
    maxRunMinutes: row.maxRunMinutes,
  };
}

/** Pool membership is (harness, model, account). Settings come from the matching row, never the caller. */
export function assertPoolExecution(
  execution: RequestedExecution | undefined,
  pool: { rows: AssistantModelPoolRow[] },
  role: AssistantModelPoolRole = "worker",
): PoolExecution {
  const rows = pool.rows.filter((row) => row.roles.includes(role));
  if (execution?.poolRowId !== undefined) {
    const row = rows.find((entry) => entry.id === execution.poolRowId);
    if (!row) throw refusal(rows);
    return canonical(row);
  }
  if (execution?.model === undefined && execution?.harness === undefined) {
    // Unknown quota stub: pool order decides; quota-based skipping belongs to the Assistant's own jobs.
    const picked = selectPoolRow(role, { rows }, () => ({
      unknown: true,
      reason: "unchecked",
    }));
    if (!picked.row) throw refusal(rows);
    return canonical(picked.row);
  }
  const row = rows.find(
    (entry) =>
      entry.model === execution.model &&
      entry.harness === execution.harness &&
      account(entry.providerAccountId) === account(execution.providerAccountId),
  );
  if (!row) throw refusal(rows);
  return canonical(row);
}

/** True when this (harness, model) is served by some pool row for the role; crew candidates carry no account. */
export function assertPoolModel(
  candidate: { harness?: unknown; model?: unknown },
  pool: { rows: AssistantModelPoolRow[] },
  role: AssistantModelPoolRole = "worker",
) {
  const rows = pool.rows.filter((row) => row.roles.includes(role));
  if (!rows.some((row) => row.harness === candidate.harness && row.model === candidate.model))
    throw refusal(rows);
}

/** Model-facing listing for `models.pool.list`. */
export function listModelPool(pool: { rows: AssistantModelPoolRow[] }) {
  return {
    rows: pool.rows.map((row) => ({
      id: row.id,
      harness: row.harness,
      model: row.model,
      effort: row.modelSettings.effort ?? row.modelSettings.reasoningEffort ?? null,
      modelSettings: row.modelSettings,
      account: row.providerAccountId ?? "default",
      roles: row.roles,
    })),
  };
}
