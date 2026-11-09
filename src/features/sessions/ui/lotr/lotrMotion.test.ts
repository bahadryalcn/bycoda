import { describe, expect, it } from "vitest";
import type { CrewActivity } from "../crewMotion";
import { restRigPose } from "../characterRig";
import { LOTR_CREW, LOTR_IDS, lotrCharacter } from "./lotrCrew";
import { lotrMotionAt } from "./lotrMotion";

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

describe("Lord of the Rings crew", () => {
  it("seats Gandalf as lead and Sauron as advisor, repeating only subagent kinds", () => {
    expect(lotrCharacter(2, "lead").id).toBe("gandalf");
    expect(lotrCharacter(3, "advisor").id).toBe("sauron");
    expect(lotrCharacter(9, "lead").id).toBe("gandalf");
    expect(new Set(LOTR_CREW.map((c) => c.id)).size).toBe(6);
    expect(LOTR_CREW.map((c) => c.id)).not.toContain("orc");
    for (let id = 6; id < 30; id++) {
      expect(["gandalf", "sauron"]).not.toContain(lotrCharacter(id, "subagent").id);
    }
  });

  it("sends orcs only for the seventh subagent onwards", () => {
    // Subagents #1-#4 sit at seats 0, 1, 4 and 5; #5 and #6 at seats 6 and 7.
    for (const seat of [0, 1, 4, 5, 6, 7]) {
      expect(lotrCharacter(seat, "subagent").id).not.toBe("orc");
    }
    expect(lotrCharacter(1, "subagent").id).toBe("elf");
    for (let seat = 8; seat < 20; seat++) expect(lotrCharacter(seat, "subagent").id).toBe("orc");
  });
});

describe.each(LOTR_IDS)("%s motion", (id) => {
  it("seeks deterministically without mutating activity", () => {
    const activity = Object.freeze({ ...talking });
    const first = lotrMotionAt(id, 3, 3721, activity);
    lotrMotionAt(id, 3, 18900, activity);
    expect(lotrMotionAt(id, 3, 3721, activity)).toEqual(first);
    expect(activity).toEqual(talking);
  });

  it("rests every joint when animation is disabled or time is invalid", () => {
    const rest = { ...restRigPose(), action: 0 };
    for (const time of [1, 3200, 17000, Infinity, NaN]) {
      expect(lotrMotionAt(id, 6, time, talking, false)).toEqual(rest);
    }
    expect(lotrMotionAt(id, 0, NaN, talking)).toEqual(rest);
    expect(lotrMotionAt(id, 0, -1, talking)).toEqual(rest);
  });

  it("performs a full action and leaves a quiet interval in every cycle", () => {
    const poses = Array.from({ length: 300 }, (_, index) =>
      lotrMotionAt(id, 0, 1 + index * 50, talking),
    );
    expect(poses.some(({ action }) => action > 0.9)).toBe(true);
    expect(poses.filter(({ action }) => action === 0).length).toBeGreaterThan(60);
    const span = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(span(poses.map(({ armAngle }) => armAngle))).toBeGreaterThanOrEqual(20);
  });

  it("only breathes, blinks and glances while idle", () => {
    const idle = { ...talking, working: false, stand: 0 };
    for (let time = 1; time < 24_000; time += 97) {
      const pose = lotrMotionAt(id, 1, time, idle);
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
      (time) => lotrMotionAt(id, 0, time, talking).action > 0.9,
    )!;
    const full = lotrMotionAt(id, 0, peak, talking).action;
    const half = lotrMotionAt(id, 0, peak, { ...talking, stand: 0.5 }).action;
    expect(half).toBeCloseTo(full / 2, 5);
  });

  it("closes its mouth when listening or idle", () => {
    for (const time of [1500, 3000, 7200]) {
      expect(lotrMotionAt(id, 0, time, { ...talking, listening: true }).mouth).toBe(0);
      expect(lotrMotionAt(id, 0, time, { ...talking, working: false }).mouth).toBe(0);
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
          const pose = lotrMotionAt(id, seat, time, activity);
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
