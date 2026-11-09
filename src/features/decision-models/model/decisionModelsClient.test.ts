import { beforeEach, describe, expect, it, vi } from "vitest";

const { remoteRequest } = vi.hoisted(() => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest }));

import { DECISION_MODELS_RPC } from "../../../shared/model/host-contracts/decision-models";
import { decisionModelsClient, type DecisionModelsClient } from "./decisionModelsClient";

type Case = [method: string, call: (client: DecisionModelsClient, params: never) => unknown];

/** Each wrapper must send its own RPC method name and pass the params through unchanged. */
const CASES: Case[] = [
  ["decisionModels.sources.list", (c, p) => c.sources.list(p)],
  ["decisionModels.sources.add", (c, p) => c.sources.add(p)],
  ["decisionModels.sources.update", (c, p) => c.sources.update(p)],
  ["decisionModels.sources.remove", (c, p) => c.sources.remove(p)],
  ["decisionModels.sources.test", (c, p) => c.sources.test(p)],
  ["decisionModels.sources.evaluate", (c, p) => c.sources.evaluate(p)],
  ["decisionModels.discovery.scan", (c, p) => c.discovery.scan(p)],
  ["decisionModels.discovery.results", (c, p) => c.discovery.results(p)],
  ["decisionModels.discovery.settings.get", (c, p) => c.discovery.settings.get(p)],
  ["decisionModels.discovery.settings.set", (c, p) => c.discovery.settings.set(p)],
  ["decisionModels.manual.verify", (c, p) => c.manual.verify(p)],
  ["decisionModels.firstRun.get", (c, p) => c.firstRun.get(p)],
  ["decisionModels.firstRun.set", (c, p) => c.firstRun.set(p)],
  ["decisionModels.local.hardware", (c, p) => c.local.hardware(p)],
  ["decisionModels.local.recommend", (c, p) => c.local.recommend(p)],
  ["decisionModels.local.plan", (c, p) => c.local.plan(p)],
  ["decisionModels.local.install", (c, p) => c.local.install(p)],
  ["decisionModels.local.start", (c, p) => c.local.start(p)],
  ["decisionModels.local.stop", (c, p) => c.local.stop(p)],
  ["decisionModels.local.uninstall", (c, p) => c.local.uninstall(p)],
  ["decisionModels.local.status", (c, p) => c.local.status(p)],
  ["decisionModels.routing.get", (c, p) => c.routing.get(p)],
  ["decisionModels.routing.set", (c, p) => c.routing.set(p)],
  ["decisionModels.catalog.get", (c, p) => c.catalog.get(p)],
  ["decisionModels.decide", (c, p) => c.decide(p)],
];

beforeEach(() => {
  remoteRequest.mockReset();
  remoteRequest.mockResolvedValue(undefined);
});

describe("decisionModelsClient wrappers", () => {
  it.each(CASES)("sends %s to the Host with the caller's params", async (method, call) => {
    const client = decisionModelsClient("m1");
    const params = { probe: method } as never;
    await call(client, params);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    expect(remoteRequest).toHaveBeenCalledWith("m1", method, params);
  });

  it("covers every method in the shared Host contract exactly once", () => {
    expect(CASES.map(([method]) => method).sort()).toEqual(Object.keys(DECISION_MODELS_RPC).sort());
  });
});
