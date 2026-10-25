export const TASK_PREFLIGHT_CAPABILITY = "tasks.preflight";

export type TaskPreflightRequirement = {
  kind: "source" | "skill" | "connection" | "tool";
  id: string;
  required?: boolean;
};

export type TaskPreflightObservation = {
  state: "ready" | "missing" | "disabled" | "unknown";
  origin: "runtime" | "inventory" | "configuration";
  checkedAt?: number;
  detail?: string;
};

export type TaskPreflightFacts = {
  host?: TaskPreflightObservation;
  project?: TaskPreflightObservation;
  provider?: TaskPreflightObservation;
  model?: TaskPreflightObservation;
  resources?: Record<string, TaskPreflightObservation | undefined>;
};

export type TaskPreflightItem = {
  key: string;
  label: string;
  state: "ready" | "blocked" | "unknown";
  required: boolean;
  detail?: string;
  checkedAt?: number;
};

export type TaskPreflightReport = {
  checkedAt: number;
  state: "ready" | "blocked" | "unknown";
  items: TaskPreflightItem[];
};

export const taskPreflightResourceKey = (
  requirement: Pick<TaskPreflightRequirement, "kind" | "id">,
) => JSON.stringify([requirement.kind, requirement.id]);

/** These are resource references, never connection credentials or permission grants. */
export function parseTaskPreflightRequirements(raw: unknown): TaskPreflightRequirement[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 40) throw new Error("Invalid preparation requirements.");
  const keys = new Set<string>();
  return raw.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid preparation requirement.");
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => !["kind", "id", "required"].includes(key)) ||
      !["source", "skill", "connection", "tool"].includes(String(row.kind)) ||
      typeof row.id !== "string" ||
      !row.id.trim() ||
      row.id.length > 2000 ||
      row.id.includes("\0") ||
      (row.required !== undefined && typeof row.required !== "boolean") ||
      /[?&](?:access_token|refresh_token|token|api_key|secret|signature)=/i.test(row.id)
    )
      throw new Error("Invalid preparation requirement.");
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(row.id)) {
      try {
        const url = new URL(row.id);
        if (url.username || url.password)
          throw new Error("Credentials are not resource references.");
      } catch {
        throw new Error("Invalid resource reference.");
      }
    }
    const result: TaskPreflightRequirement = {
      kind: row.kind as TaskPreflightRequirement["kind"],
      id: row.id.trim(),
      ...(row.required === undefined ? {} : { required: row.required }),
    };
    const key = taskPreflightResourceKey(result);
    if (keys.has(key)) throw new Error("Duplicate preparation requirement.");
    keys.add(key);
    return result;
  });
}

/** Inventory is discovery, not proof of an authenticated or permitted runtime. */
export function evaluateTaskPreflight(
  requirements: readonly TaskPreflightRequirement[],
  facts: TaskPreflightFacts,
  now: number,
  maxAgeMs = 5 * 60_000,
): TaskPreflightReport {
  const item = (
    key: string,
    label: string,
    observation: TaskPreflightObservation | undefined,
    required = true,
  ): TaskPreflightItem => {
    const current =
      observation?.checkedAt !== undefined &&
      Number.isFinite(observation.checkedAt) &&
      observation.checkedAt <= now &&
      now - observation.checkedAt <= maxAgeMs;
    const state =
      !observation || !current
        ? "unknown"
        : observation.state === "disabled" || observation.state === "missing"
          ? "blocked"
          : observation.state === "ready" && observation.origin === "runtime"
            ? "ready"
            : "unknown";
    return {
      key,
      label,
      required,
      state,
      ...(observation?.detail ? { detail: observation.detail.slice(0, 2000) } : {}),
      ...(current ? { checkedAt: observation!.checkedAt } : {}),
    };
  };
  const items = [
    item("host", "Host", facts.host),
    item("project", "Project", facts.project),
    item("provider", "Agent", facts.provider),
    item("model", "Model", facts.model),
    ...requirements.map((requirement) =>
      item(
        taskPreflightResourceKey(requirement),
        requirement.id,
        facts.resources?.[taskPreflightResourceKey(requirement)],
        requirement.required !== false,
      ),
    ),
  ];
  const required = items.filter((entry) => entry.required);
  return {
    checkedAt: now,
    items,
    state: required.some((entry) => entry.state === "blocked")
      ? "blocked"
      : required.some((entry) => entry.state === "unknown")
        ? "unknown"
        : "ready",
  };
}
