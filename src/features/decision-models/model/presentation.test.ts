import { describe, expect, it } from "vitest";
import { automaticSources, connectedCandidate, routingChanges, sameSource } from "./presentation";
import type { DecisionSource } from "./decisionTypes";
const source = (id: string, patch: Partial<DecisionSource> = {}): DecisionSource => ({
  id,
  name: id,
  kind: "local",
  adapter: "systemone",
  status: "unknown",
  ...patch,
});
describe("decision settings presentation", () => {
  it("matches Host automatic kind order and preserves order within each kind", () => {
    expect(
      automaticSources([
        source("api", { kind: "api" }),
        source("local"),
        source("local2"),
        source("gateway", { kind: "gateway" }),
      ]).map((s) => s.id),
    ).toEqual(["local", "local2", "api", "gateway"]);
  });
  it("matches exact Windows files but never similar names or distinct endpoint models", () => {
    expect(
      sameSource(
        source("a", { local: { modelPath: "C:/Models/Clef.gguf" } }),
        source("b", { local: { modelPath: "c:/models/clef.gguf" } }),
      ),
    ).toBe(true);
    expect(sameSource(source("a"), source("b"))).toBe(false);
    expect(
      sameSource(
        source("a", { endpoint: "http://localhost:8", model: "one" }),
        source("b", { endpoint: "http://localhost:8", model: "two" }),
      ),
    ).toBe(false);
    expect(
      sameSource(
        source("a", { endpoint: "http://localhost:8" }),
        source("b", { endpoint: "http://localhost:8/" }),
      ),
    ).toBe(true);
  });
  it("marks discovery files already connected without changing paths", () => {
    const a = source("a", { local: { modelPath: "C:/models/clef.gguf" } });
    expect(
      connectedCandidate({ id: "model:C:/models/clef.gguf", kind: "model_file", label: "Clef" }, [
        a,
      ]),
    ).toBe(a);
    expect(connectedCandidate({ id: "x", kind: "api_key", label: "key" }, [a])).toBeUndefined();
  });
  it("diffs thresholds and source order while ignoring empty automatic routes", () => {
    const route = { sourceIds: ["a", "b"], threshold: 0.85 };
    expect(routingChanges({ screen_state: route }, { screen_state: { ...route } })).toBe(0);
    expect(routingChanges({ generic: { sourceIds: [], threshold: 0.9 } }, {})).toBe(0);
    expect(
      routingChanges(
        { screen_state: { ...route, sourceIds: ["b", "a"] }, generic: route },
        { screen_state: route },
      ),
    ).toBe(2);
    expect(
      routingChanges({ screen_state: { ...route, threshold: 0.9 } }, { screen_state: route }),
    ).toBe(1);
  });
});
