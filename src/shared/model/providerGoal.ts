/** Provider-authored goal state; never inferred from a user's slash command. */
export type SessionGoal = {
  provider: "codex";
  providerSessionId: string;
  objective: string;
  status: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
};

/** Validate open remote JSON before using provider-authored text or status. */
export function isSessionGoal(value: unknown): value is SessionGoal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (
    !("provider" in value) ||
    value.provider !== "codex" ||
    !("providerSessionId" in value) ||
    typeof value.providerSessionId !== "string" ||
    !value.providerSessionId.trim() ||
    !("objective" in value) ||
    typeof value.objective !== "string" ||
    !value.objective.trim() ||
    !("status" in value)
  )
    return false;
  switch (value.status) {
    case "active":
    case "paused":
    case "blocked":
    case "usageLimited":
    case "budgetLimited":
    case "complete":
      return true;
    default:
      return false;
  }
}
