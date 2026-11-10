import { describe, expect, it } from "vitest";
import type { CrewRole } from "./crew";
import {
  activeMemberIds,
  crewTableState,
  seatCrewTable,
  TABLE_MAX_SEATS,
  TABLE_SCENE,
} from "./crewTableLayout";
import type { CrewRunView } from "./crewClient";

function roster(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: (index === 0
      ? "coordinator"
      : index === 1
        ? "reviewer"
        : index % 2
          ? "advisor"
          : "specialist") as CrewRole,
  }));
}

describe("seatCrewTable", () => {
  it.each([1, 3, 6, 9, 12, 20])("seats %i members without overlap inside the scene", (count) => {
    const { seats, hidden } = seatCrewTable(roster(count));
    expect(seats).toHaveLength(Math.min(count, TABLE_MAX_SEATS));
    expect(hidden).toBe(Math.max(0, count - TABLE_MAX_SEATS));
    expect(new Set(seats.map((seat) => seat.id)).size).toBe(seats.length);
    for (const row of ["front", "back"] as const) {
      const sorted = seats.filter((seat) => seat.row === row).sort((a, b) => a.x - b.x);
      sorted.forEach((seat, index) => {
        expect(seat.x).toBeGreaterThanOrEqual(0);
        expect(seat.x + seat.size).toBeLessThanOrEqual(TABLE_SCENE.width);
        if (index)
          expect(seat.x).toBeGreaterThanOrEqual(sorted[index - 1]!.x + sorted[index - 1]!.size);
      });
    }
  });

  it("puts the coordinator in the middle and the reviewer at an edge", () => {
    for (const count of [3, 4, 6, 20]) {
      const { seats } = seatCrewTable(roster(count));
      const front = seats.filter((seat) => seat.row === "front").sort((a, b) => a.x - b.x);
      const coordinator = front.findIndex((seat) => seat.role === "coordinator");
      const reviewer = front.findIndex((seat) => seat.role === "reviewer");
      expect(Math.abs(coordinator - (front.length - 1) / 2)).toBeLessThanOrEqual(0.5);
      expect([0, front.length - 1]).toContain(reviewer);
    }
  });

  it("keeps the coordinator and reviewer seated however the roster is ordered", () => {
    const { seats } = seatCrewTable([...roster(12)].reverse());
    expect(seats.map((seat) => seat.role)).toEqual(
      expect.arrayContaining(["coordinator", "reviewer"]),
    );
  });

  it("is deterministic and seats the smaller back row behind", () => {
    const first = seatCrewTable(roster(9));
    expect(seatCrewTable(roster(9))).toEqual(first);
    const back = first.seats.filter((seat) => seat.row === "back");
    expect(back).toHaveLength(2);
    expect(back.every((seat) => seat.size < 40 && seat.z === 1)).toBe(true);
  });
});

describe("crewTableState", () => {
  it("ranks a decision over a blocker over work", () => {
    expect(crewTableState("decision", "working")).toBe("decision");
    expect(crewTableState("review", undefined)).toBe("decision");
    expect(crewTableState("blocked", "working")).toBe("blocked");
    expect(crewTableState(undefined, "working")).toBe("working");
    expect(crewTableState(undefined, "paused")).toBe("idle");
  });
});

describe("activeMemberIds", () => {
  it("collects owners of running tasks and the running coordinator", () => {
    const members = roster(3);
    const run = {
      coordinatorStatus: "running",
      assignments: [
        { memberId: "m2", taskId: "t1" },
        { memberId: "m1", taskId: "t2" },
      ],
      tasks: [
        { id: "t1", status: "running" },
        { id: "t2", status: "done" },
      ],
    } as unknown as CrewRunView;
    expect([...activeMemberIds([run], members)].sort()).toEqual(["m0", "m2"]);
  });
});
