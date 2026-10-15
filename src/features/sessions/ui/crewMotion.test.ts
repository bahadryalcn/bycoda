import { expect, it } from "vitest";
import {
  crewMotionAt,
  converseWithNeighbours,
  applySmokingBreak,
  applyConversationMood,
  applyIdleLife,
  type CrewActivity,
} from "./crewMotion";

it("alternates calm conversation, laughter and thought without simultaneous shouting", () => {
  const at = (id: number, time: number, animate = true) => {
    const state: CrewActivity = { stand: 1, talk: 1, gesture: 1, kick: 1, jump: 1 };
    applyConversationMood(state, id, time, animate);
    return state;
  };
  expect(at(0, 2000)).toMatchObject({ laugh: 0, thought: 0, emphasis: 0, kick: 0, jump: 0 });
  expect(at(0, 13000)).toMatchObject({ laugh: 1, thought: 0 });
  expect(at(0, 25000)).toMatchObject({ emphasis: 1, kick: 1, listening: false });
  expect(at(0, 25330).impact).toBe(1);
  expect(at(0, 19000)).toMatchObject({ thought: 1, talk: 0, gesture: 0 });
  expect(at(1, 13000).laugh).toBe(0);
  expect(at(0, 13000, false).laugh).toBeUndefined();
  const smoking: CrewActivity = { stand: 0, talk: 1, laugh: 1, thought: 1 };
  applySmokingBreak(smoking, 1, 21750, true);
  expect(smoking).toMatchObject({ laugh: 0, thought: 0, talk: 0 });
});

it("lets every seated idle uncle smoke on a staggered clock, never while working or standing", () => {
  const at = (id: number, time: number, animate = true, stand = 0, working = false) => {
    const state: CrewActivity = { stand, talk: 1, kick: 1, jump: 1, working };
    applySmokingBreak(state, id, time, animate);
    return state;
  };
  expect(at(1, 21750).smokeLift).toBe(1);
  expect(at(1, 21750).exhale).toBe(0);
  expect(at(1, 23800)).toMatchObject({
    smoking: true,
    smokeLift: 0,
    exhale: 1,
    talk: 0,
    kick: 0,
    jump: 0,
  });
  expect(at(4, 40300).exhale).toBe(1);
  expect(at(1, 20000).smoking).toBeUndefined();
  expect(at(1, 28000).smoking).toBeUndefined();
  expect(at(1, 23800, false).smoking).toBeUndefined();
  expect(at(1, 23800, true, 0.5).smoking).toBeUndefined();
  expect(at(1, 23800, true, 1).smoking).toBeUndefined();
  expect(at(1, 23800, true, 0, true).smoking).toBeUndefined();
  const first = (id: number) => {
    for (let t = 0; t < 200000; t += 100) if (at(id, t).smoking) return t;
    return -1;
  };
  expect(new Set([0, 1, 2, 3, 4, 5].map(first)).size).toBe(6);
});

it("neighbours face one another and take turns listening", () => {
  const make = () =>
    Array.from({ length: 2 }, () => ({ stand: 1, talk: 1, gesture: 1, kick: 1, jump: 1 }));
  const places = [
    { id: 0, x: 100, y: 300 },
    { id: 1, x: 220, y: 300 },
  ];
  const first = make();
  converseWithNeighbours(first, places, 1200);
  expect(first[0].talk).toBe(1);
  expect(first[1].talk).toBe(0);
  expect(first[1].kick).toBe(0);
  const reply = make();
  converseWithNeighbours(reply, places, 4200);
  expect(reply[0].talk).toBe(0);
  expect(reply[1].talk).toBe(1);
  expect((reply[0] as { turn?: number }).turn).toBeGreaterThan(0);
  expect((reply[1] as { turn?: number }).turn).toBeLessThan(0);
});
it("uses different gesture timing for each personality", () => {
  const rhythms = Array.from({ length: 6 }, (_, id) =>
    [400, 900, 1500, 2100].map((t) => crewMotionAt(id, t, 1, true).gesture).join("/"),
  );
  expect(new Set(rhythms).size).toBe(6);
});

it("keeps reduced-motion and rising figures still", () => {
  for (const animate of [true, false]) {
    const pose = crewMotionAt(0, 8150, animate ? 0.5 : 1, animate);
    expect([pose.talk, pose.gesture, pose.kick, pose.jump, pose.impact]).toEqual([0, 0, 0, 0, 0]);
  }
});
it("anticipates a knee lift, holds it, stamps down and recovers", () => {
  expect(crewMotionAt(0, 7600, 1, true).kick).toBe(0);
  expect(crewMotionAt(0, 8150, 1, true).kick).toBe(1);
  expect(crewMotionAt(0, 8340, 1, true).kick).toBe(1);
  expect(crewMotionAt(0, 8530, 1, true).kick).toBe(0);
  expect(crewMotionAt(0, 8530, 1, true).impact).toBe(1);
  expect(crewMotionAt(0, 9000, 1, true).impact).toBe(0);
});
it("staggers accents and gives a different uncle an anticipated hop", () => {
  expect(crewMotionAt(1, 7930 - 2300, 1, true).jump).toBeLessThan(0);
  expect(crewMotionAt(1, 8170 - 2300, 1, true).jump).toBe(1);
  expect(crewMotionAt(1, 8170 - 2300, 1, true).kick).toBe(0);
  expect(crewMotionAt(2, 8150, 1, true).kick).toBe(0);
  expect(crewMotionAt(0, 2500, 1, true).talk).toBe(0);
});
it("staggers blinks, keeps breathing coarse and leaves reduced motion untouched", () => {
  const life = (id: number, time: number, animate = true, extra: Partial<CrewActivity> = {}) => {
    const state: CrewActivity = { stand: 0, talk: 0, ...extra };
    applyIdleLife(state, id, time, animate);
    return state;
  };
  const blinking = (id: number) =>
    Array.from({ length: 200 }, (_, step) => life(id, step * 60).blink).join("");
  expect(blinking(0)).toContain("1");
  expect(blinking(0)).not.toBe(blinking(1));
  expect(life(0, 0, false)).toEqual({ stand: 0, talk: 0 });
  // Laughter already squeezes the eyes shut; it never adds a blink on top.
  for (let time = 0; time < 12000; time += 60)
    expect(life(2, time, true, { laugh: 1 }).blink).toBe(0);
  // Quarter steps keep a still crowd from repainting on every frame.
  for (let time = 0; time < 6000; time += 37) expect((life(3, time).breath! * 4) % 1).toBe(0);
  expect(life(4, 1000, true, { stand: 1 }).sway).toBe(0);
});
