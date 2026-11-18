import { describe, expect, it } from "vitest";
import {
  DEFAULT_HALAY_CONFIG,
  emptyHalayState,
  halaySnapshot,
  matchGiftRule,
  MAX_TEMPO,
  MIN_TEMPO,
  reduceHalay,
  tickHalay,
  type HalayConfig,
  type HalayState,
} from "./halayGame";
import { normalizeChannel, type LiveEvent, type LiveViewer } from "./liveEvents";

const viewer = (n: number): LiveViewer => ({ id: `u${n}`, handle: `user${n}`, name: `User ${n}` });
let seq = 0;
const comment = (n: number, text: string): LiveEvent => ({ id: `e${seq++}`, at: 0, kind: "comment", viewer: viewer(n), text });
const gift = (n: number, diamonds: number, count = 1, giftName = "Rose"): LiveEvent => ({
  id: `e${seq++}`,
  at: 0,
  kind: "gift",
  viewer: viewer(n),
  giftId: 1,
  giftName,
  diamonds,
  count,
});

function run(events: LiveEvent[], config: HalayConfig = DEFAULT_HALAY_CONFIG, now = 1_000): HalayState {
  return events.reduce((state, event) => reduceHalay(state, event, config, now).state, emptyHalayState(now));
}

describe("halay game", () => {
  it("joins on the keyword in any case and ignores other comments", () => {
    const state = run([comment(1, "HALAY!"), comment(2, "selam"), comment(3, "Halaya gel")]);
    expect(state.dancers.map((d) => d.viewer.id)).toEqual(["u1", "u3"]);
    expect(state.totals.comments).toBe(3);
  });

  it("ignores a repeated event id", () => {
    const event = gift(1, 10);
    const state = run([event, event]);
    expect(state.totals.diamonds).toBe(10);
    expect(state.totals.gifts).toBe(1);
  });

  it("skips blocked handles", () => {
    const state = run([comment(1, "halay")], { ...DEFAULT_HALAY_CONFIG, blocked: ["@USER1"] });
    expect(state.dancers).toHaveLength(0);
  });

  it("evicts the lowest gifter, then the longest idle, when full", () => {
    const config = { ...DEFAULT_HALAY_CONFIG, capacity: 2, giftRules: [{ minDiamonds: 1, actions: ["join" as const] }] };
    let state = emptyHalayState(0);
    state = reduceHalay(state, gift(1, 5), config, 1).state;
    state = reduceHalay(state, comment(2, "halay"), config, 2).state;
    state = reduceHalay(state, comment(3, "halay"), config, 3).state;
    expect(state.dancers.map((d) => d.viewer.id)).toEqual(["u1", "u3"]);
  });

  it("matches gift rules by name first, then the highest threshold reached", () => {
    const rules = [
      { minDiamonds: 1, actions: ["join" as const] },
      { minDiamonds: 30, actions: ["fireworks" as const] },
      { minDiamonds: 0, giftName: "Lion", actions: ["leader" as const] },
    ];
    expect(matchGiftRule(rules, "Rose", 1)?.actions).toEqual(["join"]);
    expect(matchGiftRule(rules, "Rose", 45)?.actions).toEqual(["fireworks"]);
    expect(matchGiftRule(rules, "lion", 1)?.actions).toEqual(["leader"]);
    expect(matchGiftRule(rules.slice(1, 2), "Rose", 1)).toBeUndefined();
  });

  it("counts a gift streak by value times count and makes a big gifter the leader", () => {
    const { state, cues } = reduceHalay(emptyHalayState(0), gift(7, 33, 3), DEFAULT_HALAY_CONFIG, 1_000);
    expect(state.totals.diamonds).toBe(99);
    expect(state.leader?.id).toBe("u7");
    expect(cues.map((c) => c.effect)).toEqual(expect.arrayContaining(["gift", "leader", "money-rain"]));
    expect(halaySnapshot(state, DEFAULT_HALAY_CONFIG, 2_000).dancers[0]).toMatchObject({ id: "u7", role: "leader" });
  });

  it("falls back to the biggest gifter in the circle when the leader hold expires", () => {
    const config = { ...DEFAULT_HALAY_CONFIG, leaderHoldSeconds: 1 };
    let state = emptyHalayState(0);
    state = reduceHalay(state, gift(1, 120), config, 0).state;
    state = reduceHalay(state, gift(2, 500), config, 10).state;
    state = reduceHalay(state, gift(1, 1), config, 20).state;
    const later = halaySnapshot(state, config, 5_000);
    expect(later.dancers[0]).toMatchObject({ id: "u2", role: "leader" });
    expect(later.topGifters.map((g) => g.id)).toEqual(["u2", "u1"]);
  });

  it("raises tempo with likes, caps it and lets it decay", () => {
    let state = emptyHalayState(0);
    state = reduceHalay(state, { id: "l1", at: 0, kind: "like", viewer: viewer(1), count: 10_000 }, DEFAULT_HALAY_CONFIG, 0).state;
    expect(state.tempo).toBe(MAX_TEMPO);
    expect(tickHalay(state, 10_000_000).tempo).toBe(MIN_TEMPO);
  });

  it("shortens names when asked", () => {
    const state = run([comment(1, "halay")]);
    expect(halaySnapshot(state, { ...DEFAULT_HALAY_CONFIG, shortNames: true }, 1_000).dancers[0].name).toBe("Use…");
  });

  it("normalizes channel input", () => {
    expect(normalizeChannel(" @kanal ")).toBe("kanal");
    expect(normalizeChannel("https://www.tiktok.com/@kanal/live")).toBe("kanal");
  });
});
