import { elapsedSince } from "../../../shared/lib/time/timestamps";
import type { ActiveCrewMemberView } from "./crewActive";

type Attention = NonNullable<ActiveCrewMemberView["attention"]>;
const ATTENTION_RANK: Attention[] = ["decision", "review", "blocked"];

/** Machine and project a member's run belongs to; the key groups and filters rows. */
export const activeProjectKey = (item: Pick<ActiveCrewMemberView, "machineId" | "projectId">) =>
  `${item.machineId}:${item.projectId}`;

/** One row's identity; the same member can hold several tasks or runs. */
export const activeMemberKey = (item: ActiveCrewMemberView) =>
  [item.machineId, item.runId, item.memberId, item.taskId ?? "", item.kind].join(":");

/** Coordinators and workers of running work blink; reviewers and paused runs wait. */
export function activeMemberWorking(item: ActiveCrewMemberView): boolean {
  return item.runStatus === "active" && item.kind !== "review";
}

/** What the member is on: its task, else the run, else the crew. */
export function activeMemberFocus(item: ActiveCrewMemberView): string {
  return item.taskTitle?.trim() || item.runTitle?.trim() || item.definitionName;
}

/** Time since `startedAt` (host wall clock, ms); null when the host did not report it. */
export function activeElapsedMs(startedAt: number | undefined, now: number): number | null {
  return startedAt === undefined ? null : elapsedSince(startedAt, now);
}

export type ActiveProjectGroup = {
  key: string;
  projectId: string;
  machineId: string;
  /** Empty when the host did not name the project; the view supplies the fallback label. */
  name: string;
  items: ActiveCrewMemberView[];
};

function compareRows(a: ActiveCrewMemberView, b: ActiveCrewMemberView): number {
  const rank = (item: ActiveCrewMemberView) =>
    item.attention ? ATTENTION_RANK.indexOf(item.attention) : ATTENTION_RANK.length;
  return (
    rank(a) - rank(b) ||
    (a.startedAt ?? Number.POSITIVE_INFINITY) - (b.startedAt ?? Number.POSITIVE_INFINITY) ||
    a.memberName.localeCompare(b.memberName)
  );
}

/**
 * Rows grouped by project: the current project first, then by name. Inside a group, members
 * that need the owner come first, then the longest running.
 */
export function groupActiveByProject(
  items: readonly ActiveCrewMemberView[],
  currentKey?: string,
): ActiveProjectGroup[] {
  const groups = new Map<string, ActiveProjectGroup>();
  for (const item of items) {
    const key = activeProjectKey(item);
    const group = groups.get(key) ?? {
      key,
      projectId: item.projectId,
      machineId: item.machineId,
      name: item.projectName ?? "",
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort(compareRows) }))
    .sort(
      (a, b) =>
        Number(b.key === currentKey) - Number(a.key === currentKey) ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key),
    );
}

/** The faces for one project's rail strip: at most `max`, plus how many more are working. */
export function railActiveFaces(
  items: readonly ActiveCrewMemberView[],
  projectKey: string,
  max = 5,
): { shown: ActiveCrewMemberView[]; more: number } {
  const own = items.filter((item) => activeProjectKey(item) === projectKey).sort(compareRows);
  return { shown: own.slice(0, max), more: Math.max(0, own.length - max) };
}
