import type { CrewAgent, CrewRole } from "./crew";
import type { CrewRunView } from "./crewClient";
import type { CrewAttention } from "./crewPresentation";
import type { CrewExecution } from "./crewSignal";

/** Logical scene size of the crew table portrait; the portrait draws at this pixel size. */
export const TABLE_SCENE = { width: 240, height: 96, tableTop: 70 } as const;
/** At most this many members are seated; the rest are counted by the "+N" sign. */
export const TABLE_MAX_SEATS = 6;

export type CrewTableState = "idle" | "working" | "decision" | "blocked";

export type CrewTableSeat = {
  id: string;
  role: CrewRole;
  row: "front" | "back";
  /** Left edge and top in scene pixels. */
  x: number;
  y: number;
  size: number;
  /** Higher sits in front. */
  z: number;
};

export type CrewTableSeating = { seats: CrewTableSeat[]; hidden: number };

const rank = (role: CrewRole) => (role === "coordinator" ? 0 : role === "reviewer" ? 1 : 2);

/** Slot indexes of a row of `count`, nearest the middle first (ties go left). */
function centerOut(count: number): number[] {
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b,
  );
}

/**
 * Seats one row: the coordinator takes the slot nearest the middle, the reviewer an end
 * slot, everyone else fills outward from the middle. `members` is already in priority order.
 */
function seatRow<T extends { role: CrewRole }>(members: readonly T[]): T[] {
  const slots: (T | undefined)[] = Array.from({ length: members.length });
  const free = centerOut(members.length);
  const take = (member: T, index: number) => {
    slots[index] = member;
    free.splice(free.indexOf(index), 1);
  };
  const reviewer = members.find((member) => member.role === "reviewer");
  if (reviewer && members.length > 1) take(reviewer, members.length - 1);
  const coordinator = members.find((member) => member.role === "coordinator");
  if (coordinator) take(coordinator, free[0]!);
  for (const member of members) {
    if (member === reviewer && members.length > 1) continue;
    if (member === coordinator) continue;
    take(member, free[0]!);
  }
  return slots as T[];
}

/**
 * Pure seat assignment for the table portrait. Up to six members sit in one row; beyond
 * that four sit in front and two smaller ones behind, and `hidden` counts the rest.
 * Coordinator first, then reviewer, then the others in the given order.
 */
export function seatCrewTable(
  members: readonly Pick<CrewAgent, "id" | "role">[],
): CrewTableSeating {
  const ordered = members
    .map((member, index) => ({ member, index }))
    .sort((a, b) => rank(a.member.role) - rank(b.member.role) || a.index - b.index)
    .map(({ member }) => member);
  const shown = ordered.slice(0, TABLE_MAX_SEATS);
  const hidden = ordered.length - shown.length;
  const { width, tableTop } = TABLE_SCENE;
  const crowded = ordered.length > TABLE_MAX_SEATS;
  const frontMembers = crowded ? shown.slice(0, 4) : shown;
  const backMembers = crowded ? shown.slice(4) : [];
  const frontSize = crowded ? 44 : frontMembers.length > 4 ? 40 : 48;
  const slot = width / Math.max(frontMembers.length, 1);
  const seats: CrewTableSeat[] = seatRow(frontMembers).map((member, index) => ({
    id: member.id,
    role: member.role,
    row: "front",
    x: Math.round(slot * (index + 0.5) - frontSize / 2),
    y: tableTop + 2 - frontSize,
    size: frontSize,
    z: 2,
  }));
  // Back-row members peek through the gaps between the front four.
  const backSize = 32;
  seatRow(backMembers).forEach((member, index) => {
    seats.push({
      id: member.id,
      role: member.role,
      row: "back",
      x: Math.round(width * (index ? 0.75 : 0.25) - backSize / 2),
      y: 10,
      size: backSize,
      z: 1,
    });
  });
  return { seats, hidden };
}

/** Table prop state: a decision or review wins over a blocker, then work, then idle. */
export function crewTableState(
  attention: CrewAttention | undefined,
  execution: CrewExecution | undefined,
): CrewTableState {
  if (attention === "decision" || attention === "review") return "decision";
  if (attention === "blocked") return "blocked";
  return execution === "working" ? "working" : "idle";
}

/** Members doing something now: owners of running tasks, and the coordinator while it runs. */
export function activeMemberIds(
  runs: readonly CrewRunView[],
  members: readonly Pick<CrewAgent, "id" | "role">[],
): Set<string> {
  const ids = new Set<string>();
  for (const run of runs) {
    const running = new Set(
      run.tasks
        .filter((task) => task.status === "running" || task.status === "verifying")
        .map((task) => task.id),
    );
    for (const assignment of run.assignments)
      if (running.has(assignment.taskId)) ids.add(assignment.memberId);
    if (run.coordinatorStatus === "running") {
      const coordinator = members.find((member) => member.role === "coordinator");
      if (coordinator) ids.add(coordinator.id);
    }
  }
  return ids;
}
