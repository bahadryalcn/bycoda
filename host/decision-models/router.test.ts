import { describe, expect, it } from "vitest";
import { defaultDecisionConfig } from "./decision-config";
import type { DecisionSource } from "./decision-types";
import { DEFAULT_THRESHOLD } from "./decision-types";
import { isLocalSource, planRoute } from "./router";

const source = (id: string, kind: DecisionSource["kind"], endpoint?: string): DecisionSource => ({
  id,
  name: id,
  kind,
  adapter: "systemone",
  endpoint,
  status: "ready",
});

const localClef = source("local-clef", "local", "http://127.0.0.1:8767/v1/systemone");
const localNoEndpoint = source("local-pending", "local");
const localButRemote = source("local-remote", "local", "https://remote.example.test/v1/systemone");
const api = source("api", "api", "https://api.example.test/v1/systemone");
const gateway = source("gateway", "gateway", "https://gw.example.test/v1/systemone");
const llm = source("llm", "llm");

const allSources = [api, llm, localButRemote, gateway, localClef, localNoEndpoint];

describe("isLocalSource", () => {
  it("accepts local sources on loopback or without an endpoint yet", () => {
    expect(isLocalSource(localClef)).toBe(true);
    expect(isLocalSource(localNoEndpoint)).toBe(true);
  });

  it("refuses a local-labeled source that points at a remote host, and any non-local kind", () => {
    expect(isLocalSource(localButRemote)).toBe(false);
    expect(isLocalSource(api)).toBe(false);
    expect(isLocalSource(llm)).toBe(false);
  });
});

describe("planRoute", () => {
  it("orders sources without a route as local, API, gateway, LLM", () => {
    const config = { ...defaultDecisionConfig(), sources: allSources };
    const ids = planRoute(config, "generic", false).map((entry) => entry.source.id);
    expect(ids).toEqual(["local-remote", "local-clef", "local-pending", "api", "gateway", "llm"]);
    expect(
      planRoute(config, "generic", false).every((entry) => entry.threshold === DEFAULT_THRESHOLD),
    ).toBe(true);
  });

  it("follows a task route in its order, skips unknown ids and removes duplicates", () => {
    const config = {
      ...defaultDecisionConfig(),
      sources: allSources,
      routing: {
        screen_state: { sourceIds: ["api", "local-clef", "missing", "api"], threshold: 0.9 },
      },
    };
    const plan = planRoute(config, "screen_state", false);
    expect(plan.map((entry) => entry.source.id)).toEqual(["api", "local-clef"]);
    expect(plan.every((entry) => entry.threshold === 0.9)).toBe(true);
  });

  it("falls back to the default threshold when the route threshold is out of range", () => {
    const config = {
      ...defaultDecisionConfig(),
      sources: allSources,
      routing: { optout: { sourceIds: ["api"], threshold: 0 } },
    };
    expect(planRoute(config, "optout", false)[0].threshold).toBe(DEFAULT_THRESHOLD);
  });

  it("keeps only local, loopback sources for personal data when local-only is on", () => {
    const config = { ...defaultDecisionConfig(), sources: allSources, localOnlyPersonalData: true };
    const ids = planRoute(config, "generic", true).map((entry) => entry.source.id);
    expect(ids).toEqual(["local-clef", "local-pending"]);
  });

  it("returns nothing for personal data when only remote sources are routed, so nothing is sent remotely", () => {
    const config = {
      ...defaultDecisionConfig(),
      sources: allSources,
      localOnlyPersonalData: true,
      routing: { inbox_priority: { sourceIds: ["api", "gateway"], threshold: DEFAULT_THRESHOLD } },
    };
    expect(planRoute(config, "inbox_priority", true)).toEqual([]);
  });

  it("does not filter personal data when the local-only setting is off", () => {
    const config = {
      ...defaultDecisionConfig(),
      sources: allSources,
      localOnlyPersonalData: false,
    };
    expect(planRoute(config, "generic", true)).toHaveLength(allSources.length);
  });
});
