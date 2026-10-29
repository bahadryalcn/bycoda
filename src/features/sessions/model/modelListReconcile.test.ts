import { expect, it } from "vitest";
import {
  modelKeyIndex,
  modelRowKey,
  resolveActiveModelKey,
  stepActiveModelKey,
} from "./modelListReconcile";
import type { AgentModel } from "./models";

const m = (harness: AgentModel["harness"], id: string): AgentModel => ({
  harness,
  id,
  name: id,
});
const a = m("claude", "a");
const b = m("claude", "b");
const c = m("claude", "c");

it("keeps the active identity when the list is reordered or grows", () => {
  const activeKey = modelRowKey(b);
  expect(resolveActiveModelKey({ models: [c, b, a], activeKey, selected: a })).toBe(activeKey);
  expect(modelKeyIndex([c, a, b], activeKey)).toBe(2);
});

it("falls back to the selected model, then the first eligible row", () => {
  const gone = modelRowKey(m("claude", "gone"));
  expect(resolveActiveModelKey({ models: [a, b, c], activeKey: gone, selected: c })).toBe(
    modelRowKey(c),
  );
  expect(resolveActiveModelKey({ models: [a, b, c], activeKey: gone, selected: null })).toBe(
    modelRowKey(a),
  );
  expect(resolveActiveModelKey({ models: [], activeKey: gone, selected: c })).toBeNull();
});

it("treats an ineligible active identity as gone and never picks ineligible rows", () => {
  const isEligible = (model: AgentModel) => model.id !== "b";
  expect(
    resolveActiveModelKey({ models: [a, b, c], activeKey: modelRowKey(b), selected: b, isEligible }),
  ).toBe(modelRowKey(a));
  expect(
    resolveActiveModelKey({ models: [b], activeKey: null, selected: null, isEligible }),
  ).toBeNull();
});

it("separates identical ids across providers", () => {
  const other = m("grok", "a");
  expect(
    resolveActiveModelKey({ models: [other], activeKey: modelRowKey(a), selected: null }),
  ).toBe(modelRowKey(other));
});

it("steps through eligible rows with wrap-around", () => {
  const isEligible = (model: AgentModel) => model.id !== "b";
  const models = [a, b, c];
  expect(stepActiveModelKey({ models, activeKey: modelRowKey(a), delta: 1, isEligible })).toBe(
    modelRowKey(c),
  );
  expect(stepActiveModelKey({ models, activeKey: modelRowKey(a), delta: -1, isEligible })).toBe(
    modelRowKey(c),
  );
  expect(stepActiveModelKey({ models, activeKey: null, delta: -1, isEligible })).toBe(
    modelRowKey(c),
  );
  expect(stepActiveModelKey({ models: [b], activeKey: null, delta: 1, isEligible })).toBeNull();
});
