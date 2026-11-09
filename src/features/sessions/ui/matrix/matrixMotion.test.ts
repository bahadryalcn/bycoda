import { describe, expect, it } from "vitest";
import type { CrewActivity } from "../crewMotion";
import { restRigPose } from "../characterRig";
import { MATRIX_CREW, MATRIX_IDS, matrixCharacter } from "./matrixCrew";
import { matrixMotionAt } from "./matrixMotion";

const talking: CrewActivity = {
  working: true,
  stand: 1,
  talk: 0.9,
  gesture: 0.8,
  emphasis: 0.5,
  turn: 0.7,
  nod: 0.4,
  thought: 0.3,
};

describe("Matrix crew", () => {
  it("seats Neo as lead, Morpheus as advisor and every subagent as Agent Smith", () => {
    expect(matrixCharacter(2, "lead").id).toBe("neo");
    expect(matrixCharacter(3, "advisor").id).toBe("morpheus");
    expect(matrixCharacter(9, "lead").id).toBe("neo");
    expect(MATRIX_CREW.map((c) => c.name)).toEqual(["Agent Smith", "Neo", "Morpheus"]);
    expect(new Set(MATRIX_CREW.map((c) => c.id)).size).toBe(3);
    for (let seat = 0; seat <= 20; seat++) {
      expect(matrixCharacter(seat, "subagent").id).toBe("agent-smith");
      expect(matrixCharacter(seat).id).toBe("agent-smith");
    }
  });
});

describe("Matrix moves", () => {
  const at = (id: (typeof MATRIX_IDS)[number], seconds: number) =>
    matrixMotionAt(id, 0, seconds * 1000, talking);

  it("Neo dodges with his bullets only during the sweep and bends back", () => {
    expect(at("neo", 3.2).weaponAlpha).toBe(1);
    expect(at("neo", 1).weaponAlpha).toBe(0);
    expect(at("neo", 6).weaponAlpha).toBe(0);
    expect(at("neo", 3).propAngle).toBeLessThan(-30);
    expect(at("neo", 3).bodyAngle).toBeLessThan(-4);
  });

  it("Neo raises his palm with the code glow and ripple after the dodge", () => {
    expect(at("neo", 8).glow).toBeGreaterThan(0.9);
    expect(at("neo", 3).glow).toBe(0);
    expect(at("neo", 8).armAngle).toBeLessThan(-40);
  });

  it("Morpheus offers both pills with the blue glow and beckons", () => {
    expect(at("morpheus", 3).glow).toBeGreaterThan(0.5);
    expect(at("morpheus", 7.5).forearmAngle).not.toBe(at("morpheus", 5).forearmAngle);
  });

  it("Agent Smith punches, dodges with afterimages and takes off his glasses", () => {
    expect(at("agent-smith", 2.5).action).toBeGreaterThan(0.9);
    expect(at("agent-smith", 5.6).action).toBeGreaterThan(0.9);
    expect(at("agent-smith", 9).blink).toBe(1);
    expect(at("agent-smith", 9).glow).toBe(1);
    expect(at("agent-smith", 7.5).glow).toBe(0);
  });

  it("gives different Smiths different timing so they never move in unison", () => {
    const trace = (seat: number) =>
      Array.from(
        { length: 220 },
        (_, index) => matrixMotionAt("agent-smith", seat, 1 + index * 50, talking).propAngle,
      );
    expect(trace(4)).not.toEqual(trace(5));
  });
});

describe.each(MATRIX_IDS)("%s motion", (id) => {
  it("seeks deterministically without mutating activity", () => {
    const activity = Object.freeze({ ...talking });
    const first = matrixMotionAt(id, 3, 3721, activity);
    matrixMotionAt(id, 3, 18900, activity);
    expect(matrixMotionAt(id, 3, 3721, activity)).toEqual(first);
    expect(activity).toEqual(talking);
  });

  it("rests every joint when animation is disabled or time is invalid", () => {
    const rest = { ...restRigPose(), action: 0 };
    for (const time of [1, 3200, 17000, Infinity, NaN]) {
      expect(matrixMotionAt(id, 6, time, talking, false)).toEqual(rest);
    }
    expect(matrixMotionAt(id, 0, NaN, talking)).toEqual(rest);
    expect(matrixMotionAt(id, 0, -1, talking)).toEqual(rest);
  });

  it("performs a full action and leaves a quiet interval in every cycle", () => {
    const poses = Array.from({ length: 300 }, (_, index) =>
      matrixMotionAt(id, 0, 1 + index * 50, talking),
    );
    expect(poses.some(({ action }) => action > 0.9)).toBe(true);
    expect(poses.filter(({ action }) => action === 0).length).toBeGreaterThan(60);
    const span = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(span(poses.map(({ armAngle }) => armAngle))).toBeGreaterThanOrEqual(20);
  });

  it("keeps Agent Smith's eyes open while idle and never blinks at random", () => {
    if (id !== "agent-smith") return;
    for (let time = 1; time < 30_000; time += 53) {
      expect(matrixMotionAt(id, 4, time, { ...talking, working: false, stand: 0 }).blink).toBe(0);
    }
  });

  it("only breathes, blinks and glances while idle", () => {
    const idle = { ...talking, working: false, stand: 0 };
    for (let time = 1; time < 24_000; time += 97) {
      const pose = matrixMotionAt(id, 1, time, idle);
      expect(pose.action).toBe(0);
      expect(pose.glow).toBe(0);
      expect(pose.mouth).toBe(0);
      for (const angle of [
        pose.armAngle,
        pose.forearmAngle,
        pose.weaponAngle,
        pose.offArmAngle,
        pose.offForearmAngle,
        pose.propAngle,
        pose.capeAngle,
      ]) {
        expect(angle).toBe(0);
      }
      expect(pose.squash).toBe(0);
      expect(pose.bodyX).toBe(0);
      expect(Math.abs(pose.bodyAngle)).toBeLessThanOrEqual(0.65);
      expect(Math.abs(pose.bodyY)).toBeLessThanOrEqual(0.45);
    }
  });

  it("eases into its performance as the seat stands", () => {
    const peak = Array.from({ length: 220 }, (_, index) => 1 + index * 50).find(
      (time) => matrixMotionAt(id, 0, time, talking).action > 0.9,
    )!;
    const full = matrixMotionAt(id, 0, peak, talking).action;
    const half = matrixMotionAt(id, 0, peak, { ...talking, stand: 0.5 }).action;
    expect(half).toBeCloseTo(full / 2, 5);
  });

  it("closes its mouth when listening or idle", () => {
    for (const time of [1500, 3000, 7200]) {
      expect(matrixMotionAt(id, 0, time, { ...talking, listening: true }).mouth).toBe(0);
      expect(matrixMotionAt(id, 0, time, { ...talking, working: false }).mouth).toBe(0);
    }
  });

  it("stays finite and restrained across full cycles, seats and invalid readings", () => {
    const unusual: CrewActivity = {
      ...talking,
      stand: Infinity,
      gesture: NaN,
      talk: Infinity,
      emphasis: -9,
      turn: 900,
      nod: -900,
      thought: NaN,
      laugh: Infinity,
      blink: 999,
    };
    for (const seat of [0, 3, 11]) {
      for (let time = 1; time < 40_000; time += 137) {
        for (const activity of [talking, unusual, { ...talking, working: false }]) {
          const pose = matrixMotionAt(id, seat, time, activity);
          for (const value of Object.values(pose)) expect(Number.isFinite(value)).toBe(true);
          expect(Math.abs(pose.bodyAngle)).toBeLessThan(40);
          expect(Math.abs(pose.bodyX)).toBeLessThan(20);
          expect(Math.abs(pose.bodyY)).toBeLessThan(32);
          expect(Math.abs(pose.squash)).toBeLessThanOrEqual(0.3);
          expect(Math.abs(pose.headAngle)).toBeLessThan(35);
          expect(Math.abs(pose.headX)).toBeLessThan(12);
          expect(pose.headScaleX).toBeGreaterThan(0.75);
          expect(pose.headScaleX).toBeLessThanOrEqual(1);
          expect(Math.abs(pose.armY)).toBeLessThan(15);
          for (const angle of [pose.armAngle, pose.offArmAngle]) {
            expect(Math.abs(angle)).toBeLessThanOrEqual(180);
          }
          for (const angle of [pose.forearmAngle, pose.offForearmAngle]) {
            expect(Math.abs(angle)).toBeLessThan(160);
          }
          for (const angle of [pose.weaponAngle, pose.propAngle]) {
            expect(Math.abs(angle)).toBeLessThanOrEqual(180);
          }
          expect(Math.abs(pose.capeAngle)).toBeLessThan(45);
          for (const amount of [pose.glow, pose.blink, pose.mouth, pose.action]) {
            expect(amount).toBeGreaterThanOrEqual(0);
            expect(amount).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  }, 30_000);
});

describe("Matrix code rain", () => {
  it("falls only while someone works and fades instead of snapping", async () => {
    const { rainTarget, easeRain } = await import("./matrixPainter");
    expect(rainTarget([])).toBe(0);
    expect(rainTarget([{ working: false }, {}])).toBe(0);
    expect(rainTarget([{ working: false }, { working: true }])).toBe(1);
    const mid = easeRain(0, 1, 50);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(easeRain(0.5, 1, 0)).toBe(0.5);
    let level = 1;
    for (let i = 0; i < 100; i++) level = easeRain(level, 0, 50);
    expect(level).toBe(0);
  });
});
