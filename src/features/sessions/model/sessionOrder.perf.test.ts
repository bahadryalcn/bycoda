// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionOrder, saveSessionOrder } from "./sessionOrder";

const PROJECTS = 25;
const project = (index: number) => `/work/project-${index}`;

beforeEach(() => {
  localStorage.clear();
  for (let index = 0; index < PROJECTS; index++)
    saveSessionOrder(project(index), { loose: [`a${index}`, `b${index}`], pinned: [`p${index}`] });
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("session order storage reads", () => {
  // perf P3: loadSessionOrder must cache the parsed store by raw string.
  it("does not re-parse an unchanged stored blob for every project it loads", () => {
    loadSessionOrder(project(0));
    const parse = vi.spyOn(JSON, "parse");
    for (let round = 0; round < 4; round++)
      for (let index = 0; index < PROJECTS; index++) loadSessionOrder(project(index));
    expect(parse.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("returns the project's order and reflects a later save", () => {
    expect(loadSessionOrder(project(2))).toEqual({ loose: ["a2", "b2"], pinned: ["p2"] });
    saveSessionOrder(project(2), { loose: ["b2", "a2"] });
    expect(loadSessionOrder(project(2))).toEqual({ loose: ["b2", "a2"] });
    expect(loadSessionOrder(project(3))).toEqual({ loose: ["a3", "b3"], pinned: ["p3"] });
  });
});
