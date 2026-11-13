import { expect, it } from "vitest";
import {
  moveSource,
  parseThreshold,
  resetRoute,
  testedSources,
  sourceOptions,
  mergeRoutingDraft,
} from "./routingEditor";

it("keeps edited routes while adopting incoming changes to untouched routes", () => {
  const route = { sourceIds: ["old"], threshold: 0.7 };
  const local = { sourceIds: ["local"], threshold: 0.9 };
  const remote = { sourceIds: ["remote"], threshold: 0.8 };
  expect(
    mergeRoutingDraft(
      { generic: route },
      { generic: local },
      { generic: remote, screen_state: remote },
    ),
  ).toEqual({ generic: local, screen_state: remote });
  expect(mergeRoutingDraft({ generic: route }, {}, { generic: remote })).toEqual({});
  expect(mergeRoutingDraft({ generic: route }, { generic: route }, { generic: remote })).toEqual({
    generic: remote,
  });
});

it("moves selections without mutating input or losing fallback sources", () => {
  const ids = ["a", "b", "c"];
  expect(moveSource(ids, "b", -1)).toEqual(["b", "a", "c"]);
  expect(moveSource(ids, "b", 1)).toEqual(["a", "c", "b"]);
  expect(moveSource(ids, "a", -1)).toEqual(ids);
  expect(moveSource(ids, "c", 1)).toEqual(ids);
  expect(moveSource(ids, "missing", 1)).toEqual(ids);
  expect(ids).toEqual(["a", "b", "c"]);
});
it("resets only requested task including its threshold", () => {
  const route = { sourceIds: ["a"], threshold: 0.7 };
  const routing = { screen_state: route, generic: route };
  expect(resetRoute(routing, "screen_state")).toEqual({ generic: route });
  expect(routing.screen_state).toBe(route);
});
it("validates decimal drafts without accepting empty or out of range values", () => {
  for (const text of ["", " ", "NaN", "1.01", "-0.1"]) expect(parseThreshold(text)).toBeNull();
  expect(parseThreshold("0,75")).toBe(0.75);
  expect(parseThreshold("0")).toBe(0);
  expect(parseThreshold("1")).toBe(1);
});

it("uses explicit test results in counts even when the list RPC has older status", () => {
  const source = {
    id: "s",
    name: "Local",
    kind: "local",
    adapter: "systemone",
    status: "unknown",
  } as const;
  expect(
    testedSources([source], { s: { source, result: { sourceId: "s", ok: true } } })?.[0].status,
  ).toBe("ready");
  expect(
    testedSources([source], { s: { source, result: { sourceId: "s", ok: false } } })?.[0].status,
  ).toBe("error");
  expect(testedSources([source], {})?.[0]).toBe(source);
  expect(testedSources(null, {})).toBeNull();
});

it("searches source names without changing selected fallback order", () => {
  const source = { kind: "local", adapter: "systemone", status: "unknown" } as const;
  const sources = [
    { ...source, id: "a", name: "Alpha" },
    { ...source, id: "b", name: "Beta" },
  ];
  expect(sourceOptions(["b", "a"], sources, "")).toEqual(["b", "a"]);
  expect(sourceOptions(["b"], sources, " ALP ")).toEqual(["a"]);
  expect(sourceOptions(["b"], sources, "missing")).toEqual([]);
});

it("keeps a test only for its source configuration and lifecycle snapshot", () => {
  const source = {
    id: "s",
    name: "Local",
    kind: "local",
    adapter: "systemone",
    endpoint: "http://localhost:1",
    status: "ready",
  } as const;
  const results = { s: { result: { sourceId: "s", ok: true }, source } };
  expect(testedSources([{ ...source }], results)?.[0].status).toBe("ready");
  expect(testedSources([{ ...source, status: "unknown" }], results)?.[0].status).toBe("unknown");
  expect(
    testedSources([{ ...source, endpoint: "http://localhost:2", status: "unknown" }], results)?.[0]
      .status,
  ).toBe("unknown");
  expect(
    testedSources([source], { s: { source, result: { sourceId: "s", ok: false } } })?.[0].status,
  ).toBe("error");
});
