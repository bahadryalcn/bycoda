import { describe, expect, it } from "vitest";
import type { CrewActivity } from "./crewMotion";
import { STAR_WARS_ARTWORK } from "./starWarsCrew";
import { starWarsMotionAt } from "./starWarsMotion";

const identities = STAR_WARS_ARTWORK.map(({ id }) => id);
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

describe("Star Wars character motion", () => {
  it.each(identities)("seeks %s deterministically without mutating activity", (id) => {
    const activity = Object.freeze({ ...talking });
    const first = starWarsMotionAt(id, 3, 3721, activity);
    starWarsMotionAt(id, 3, 18900, activity);
    expect(starWarsMotionAt(id, 3, 3721, activity)).toEqual(first);
    expect(activity).toEqual(talking);
  });

  it.each(identities)("rests every %s joint when animation is disabled", (id) => {
    const rest = starWarsMotionAt(id, 0, 0);
    for (const time of [1, 3200, 17000, Infinity, NaN]) {
      for (const activity of [undefined, talking, { ...talking, listening: true }]) {
        expect(starWarsMotionAt(id, 6, time, activity, false)).toEqual(rest);
      }
    }
    expect(starWarsMotionAt(id, 0, NaN, talking)).toEqual(rest);
    expect(starWarsMotionAt(id, 0, Infinity, talking)).toEqual(rest);
    expect(starWarsMotionAt(id, 0, -1, talking)).toEqual(rest);
    expect(rest).toEqual({
      bodyAngle: 0,
      bodyX: 0,
      bodyY: 0,
      headAngle: 0,
      headX: 0,
      headScaleX: 1,
      armAngle: 0,
      armY: 0,
      weaponAngle: 0,
      forceAngle: 0,
      jedi: 0,
      recoil: 0,
      action: 0,
      blink: 0,
      mouth: 0,
      panel: 0,
    });
  });

  it.each(["obi-wan", "luke", "leia", "yoda"] as const)(
    "%s speaks while working and closes its mouth when listening or idle",
    (id) => {
      const speaking = starWarsMotionAt(id, 0, 3000, talking);
      const listening = starWarsMotionAt(id, 0, 3000, { ...talking, listening: true });
      const idle = starWarsMotionAt(id, 0, 3000, { ...talking, working: false });
      expect(speaking.mouth).toBeGreaterThan(0);
      expect(listening.mouth).toBe(0);
      expect(idle.mouth).toBe(0);
      expect(speaking.armAngle).not.toBe(listening.armAngle);
      expect(speaking.armAngle).not.toBe(idle.armAngle);
    },
  );

  it("keeps helmets and droids expressionless, while their own lights and joints move", () => {
    for (const id of ["darth-vader", "r2-d2"] as const) {
      const motion = starWarsMotionAt(id, 0, 3000, { ...talking, blink: 1 });
      expect(motion.blink).toBe(0);
      expect(motion.mouth).toBe(0);
      expect(motion.panel).toBeGreaterThan(0);
      expect(motion.headX).not.toBe(0);
    }
    expect(starWarsMotionAt("chewbacca", 0, 7200, talking).mouth).toBeGreaterThan(0);
  });

  it("gives the seven characters distinct performances beyond whole-body bobbing", () => {
    const performances = identities.map((id) =>
      [1800, 3000, 7200, 9600].map((time) => {
        const { headAngle, headX, armAngle, armY, mouth, panel } = starWarsMotionAt(
          id,
          0,
          time,
          talking,
        );
        return { headAngle, headX, armAngle, armY, mouth, panel };
      }),
    );
    expect(new Set(performances.map((performance) => JSON.stringify(performance))).size).toBe(7);
    for (const performance of performances) {
      expect(new Set(performance.map((pose) => JSON.stringify(pose))).size).toBeGreaterThan(1);
    }
    expect(starWarsMotionAt("r2-d2", 0, 3000, talking).armAngle).toBe(0);
  });

  it.each(["obi-wan", "luke", "darth-vader", "yoda"] as const)(
    "%s swings its saber through a substantial arc and recovers to its guard",
    (id) => {
      const poses = Array.from({ length: 240 }, (_, index) =>
        starWarsMotionAt(id, 0, 1 + index * 50, talking),
      );
      const span = (values: number[]) => Math.max(...values) - Math.min(...values);
      expect(span(poses.map(({ weaponAngle }) => weaponAngle))).toBeGreaterThanOrEqual(100);
      expect(span(poses.map(({ armAngle }) => armAngle))).toBeGreaterThanOrEqual(20);
      expect(poses.some(({ action }) => action > 0.9)).toBe(true);
      expect(starWarsMotionAt(id, 0, 8000, talking).weaponAngle).toBe(0);
    },
  );

  it.each([
    ["leia", 2550],
    ["chewbacca", 2900],
  ] as const)(
    "%s aims before firing, recoils through the arm and weapon, then settles",
    (id, firingTime) => {
      const before = starWarsMotionAt(id, 0, firingTime - 1, talking);
      const shot = starWarsMotionAt(id, 0, firingTime, talking);
      const recovery = starWarsMotionAt(id, 0, firingTime + 300, talking);
      const lowered = starWarsMotionAt(id, 0, 7000, talking);
      expect(before.action).toBeGreaterThan(0.9);
      expect(Math.abs(before.armAngle)).toBeGreaterThan(10);
      expect(before.recoil).toBe(0);
      expect(shot.recoil).toBe(1);
      expect(Math.abs(shot.armAngle - before.armAngle)).toBeGreaterThan(3);
      expect(Math.abs(shot.weaponAngle - before.weaponAngle)).toBeGreaterThan(2);
      expect(Math.abs(shot.bodyX - before.bodyX)).toBeGreaterThan(1);
      expect(recovery.recoil).toBe(0);
      expect(lowered.action).toBe(0);
      expect(lowered.weaponAngle).toBe(0);
    },
  );

  it("Yoda changes from his cane to Force gestures, a green-saber performance and a leap", () => {
    const poses = Array.from({ length: 118 }, (_, index) =>
      starWarsMotionAt("yoda", 0, 1 + index * 100, talking),
    );
    expect(poses.some(({ jedi, forceAngle }) => jedi === 1 && forceAngle >= 30)).toBe(true);
    expect(
      poses.some(({ jedi, weaponAngle, bodyY }) => jedi === 1 && weaponAngle < -80 && bodyY < -20),
    ).toBe(true);
    expect(poses.some(({ bodyY }) => bodyY < -25)).toBe(true);
    const settled = starWarsMotionAt("yoda", 0, 7000, talking);
    expect([settled.jedi, settled.forceAngle, settled.weaponAngle, settled.action]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(starWarsMotionAt("yoda", 0, 2800, talking, false).jedi).toBe(0);
  });

  it("stays finite and restrained across full cycles, seats and invalid activity readings", () => {
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
    for (const id of identities) {
      for (const seat of [0, 3, 11]) {
        for (let time = 1; time < 60_000; time += 137) {
          for (const activity of [talking, unusual]) {
            const pose = starWarsMotionAt(id, seat, time, activity);
            for (const value of Object.values(pose)) expect(Number.isFinite(value)).toBe(true);
            expect(Math.abs(pose.bodyAngle)).toBeLessThan(40);
            expect(Math.abs(pose.bodyX)).toBeLessThan(20);
            expect(Math.abs(pose.bodyY)).toBeLessThan(id === "yoda" ? 30 : 12);
            expect(Math.abs(pose.headAngle)).toBeLessThan(35);
            expect(Math.abs(pose.headX)).toBeLessThan(12);
            expect(pose.headScaleX).toBeGreaterThan(0.75);
            expect(pose.headScaleX).toBeLessThanOrEqual(1);
            expect(Math.abs(pose.armAngle)).toBeLessThan(100);
            expect(Math.abs(pose.weaponAngle)).toBeLessThanOrEqual(180);
            expect(Math.abs(pose.forceAngle)).toBeLessThan(100);
            expect(Math.abs(pose.armY)).toBeLessThan(15);
            for (const amount of [
              pose.blink,
              pose.mouth,
              pose.panel,
              pose.jedi,
              pose.recoil,
              pose.action,
            ]) {
              expect(amount).toBeGreaterThanOrEqual(0);
              expect(amount).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  }, 30_000);
});
