/**
 * Commands and skills a CLI reports about its own session (Claude's `init`
 * message, Codex's `skills/list`). Adapters write here; the composer reads.
 */
export type ReportedCommand = {
  name: string;
  kind: "command" | "skill";
  description?: string;
  /** Where the skill lives, when the CLI says so (Codex needs it to invoke). */
  path?: string;
  enabled?: boolean;
  disabledBy?: "bycoda" | "provider";
};

const reported = new Map<string, ReportedCommand[]>();
const listeners = new Map<string, Set<() => void>>();

export function reportSessionCommands(sessionId: string, commands: ReportedCommand[]): void {
  reported.set(sessionId, commands);
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

export function getReportedCommands(sessionId: string | undefined) {
  return (sessionId && reported.get(sessionId)) || EMPTY;
}

const EMPTY: ReportedCommand[] = [];

/** Native path disables must not disable another copy the provider explicitly allows. */
export function reportedSkillRestrictions(commands: readonly ReportedCommand[]) {
  const disabled = commands.filter(
    (entry) => entry.kind === "skill" && entry.enabled === false && entry.disabledBy !== "bycoda",
  );
  return {
    disabledNames: [
      ...new Set(
        disabled
          .filter(
            (entry) =>
              !commands.some(
                (other) =>
                  other.kind === "skill" && other.name === entry.name && other.enabled === true,
              ),
          )
          .map((entry) => entry.name),
      ),
    ],
    disabledPaths: disabled.flatMap((entry) => (entry.path ? [entry.path] : [])),
  };
}

export function subscribeReportedCommands(
  sessionId: string | undefined,
  listener: () => void,
): () => void {
  if (!sessionId) return () => undefined;
  let set = listeners.get(sessionId);
  if (!set) listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
  };
}
