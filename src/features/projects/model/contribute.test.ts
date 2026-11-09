import { describe, expect, it } from "vitest";
import {
  CONTRIBUTE_KEY,
  answerContributeLater,
  answerContributeNever,
  markContributeDone,
  readContributeState,
  recordContributeUse,
  shouldPromptContribute,
} from "./contribute";

const DAY = 86_400_000;
const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
};
const at = (day: number) => new Date(2026, 0, 1 + day, 12);

describe("contribute use tracking", () => {
  it("counts each local day once and keeps the first-seen time", () => {
    const store = memory();
    recordContributeUse(at(0), store);
    recordContributeUse(new Date(2026, 0, 1, 20), store);
    const state = recordContributeUse(at(2), store);
    expect(state.activeDays).toBe(2);
    expect(state.firstSeen).toBe(at(0).getTime());
  });

  it("survives unreadable or blocked storage", () => {
    const store = memory();
    store.setItem(CONTRIBUTE_KEY, "{broken");
    expect(readContributeState(store).activeDays).toBe(0);
    expect(() => recordContributeUse(at(0), null)).not.toThrow();
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => recordContributeUse(at(0), blocked)).not.toThrow();
  });
});

describe("shouldPromptContribute", () => {
  const seed = (days: number[]) => {
    const store = memory();
    for (const day of days) recordContributeUse(at(day), store);
    return store;
  };

  it("needs seven days since first use and five distinct days of use", () => {
    const store = seed([0, 1, 2, 3, 4]);
    expect(shouldPromptContribute(readContributeState(store), at(6).getTime())).toBe(false);
    expect(shouldPromptContribute(readContributeState(store), at(7).getTime())).toBe(true);
    const few = seed([0, 1, 2, 3]);
    expect(shouldPromptContribute(readContributeState(few), at(20).getTime())).toBe(false);
  });

  it("never prompts before any use is recorded", () => {
    expect(shouldPromptContribute(readContributeState(memory()), Date.now())).toBe(false);
  });

  it("asks again after 30 days, at most twice more, then stops", () => {
    const store = seed([0, 1, 2, 3, 4]);
    const start = at(10).getTime();
    answerContributeLater(start, store);
    expect(shouldPromptContribute(readContributeState(store), start + 29 * DAY)).toBe(false);
    expect(shouldPromptContribute(readContributeState(store), start + 30 * DAY)).toBe(true);
    answerContributeLater(start + 30 * DAY, store);
    expect(shouldPromptContribute(readContributeState(store), start + 60 * DAY)).toBe(true);
    const last = answerContributeLater(start + 60 * DAY, store);
    expect(last.closed).toBe("never");
    expect(shouldPromptContribute(readContributeState(store), start + 400 * DAY)).toBe(false);
  });

  it("stops for good after No thanks or a finished clone", () => {
    const a = seed([0, 1, 2, 3, 4]);
    answerContributeNever(a);
    expect(shouldPromptContribute(readContributeState(a), at(100).getTime())).toBe(false);
    const b = seed([0, 1, 2, 3, 4]);
    markContributeDone(b);
    expect(shouldPromptContribute(readContributeState(b), at(100).getTime())).toBe(false);
  });
});
