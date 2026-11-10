import {
  ASSISTANT_MODEL_POOL_MAX_ROWS,
  ASSISTANT_MODEL_POOL_ROLES,
  type AssistantModelPoolRole,
  type AssistantModelPoolRow,
} from "../../../shared/model/assistantModelPool";

export const POOL_ROLE_LABELS: Record<AssistantModelPoolRole, string> = {
  worker: "Worker",
  planning: "Planning",
  chief: "Chief",
  reply: "Reply",
};

export type PoolIssues = {
  /** Pool-level problems, for example no Worker row. */
  pool: string[];
  /** Per-row problems keyed by row id. */
  rows: Record<string, string[]>;
};

/** English keys; the UI translates them. */
export function validatePool(rows: readonly AssistantModelPoolRow[]): PoolIssues {
  const issues: PoolIssues = { pool: [], rows: {} };
  if (!rows.some((row) => row.roles.includes("worker")))
    issues.pool.push("Keep at least one Worker model.");
  if (rows.length > ASSISTANT_MODEL_POOL_MAX_ROWS)
    issues.pool.push("A model list holds at most 20 models.");
  for (const row of rows) {
    const problems: string[] = [];
    if (!row.model.trim()) problems.push("Choose a model.");
    if (row.roles.length === 0) problems.push("Choose at least one role.");
    if (problems.length) issues.rows[row.id] = problems;
  }
  return issues;
}

export const poolIsValid = (issues: PoolIssues) =>
  issues.pool.length === 0 && Object.keys(issues.rows).length === 0;

/** Roles other than Worker that no row serves; the Host falls back to the Worker rows for them. */
export function uncoveredRoles(rows: readonly AssistantModelPoolRow[]): AssistantModelPoolRole[] {
  return ASSISTANT_MODEL_POOL_ROLES.filter(
    (role) => role !== "worker" && !rows.some((row) => row.roles.includes(role)),
  );
}

export function newPoolRowId(): string {
  return `pool-${globalThis.crypto.randomUUID()}`;
}

/** Roles keep the canonical order so a toggle never reorders the saved row. */
export function toggleRole(
  roles: readonly AssistantModelPoolRole[],
  role: AssistantModelPoolRole,
  on: boolean,
): AssistantModelPoolRole[] {
  return ASSISTANT_MODEL_POOL_ROLES.filter((candidate) =>
    candidate === role ? on : roles.includes(candidate),
  );
}

type Window = { usedPercent: number; resetsAt: number | null };

/** The tightest window decides; percentages are never summed. Null means no window is known. */
export function tightestRemaining(
  windows: readonly (Window | null | undefined)[],
): { percent: number; resetsAt: number | null } | null {
  let tight: { percent: number; resetsAt: number | null } | null = null;
  for (const window of windows) {
    if (!window || !Number.isFinite(window.usedPercent)) continue;
    const percent = Math.round(100 - Math.min(100, Math.max(0, window.usedPercent)));
    if (!tight || percent < tight.percent) tight = { percent, resetsAt: window.resetsAt };
  }
  return tight;
}

/** Empty clears the threshold (0); anything else is an integer within 0-100. */
export function parseThreshold(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Math.round(Number(text));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
}
