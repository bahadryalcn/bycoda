import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecretValueStore } from "../secrets/secret-store";
import { DecisionModelsService } from "../decision-models/decision-service";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { handleDecisionModelsRpc } from "./rpc-decision-models";

let directory: string;
let stored: Map<string, string>;
let dependencies: Pick<ServerBindings, "decisionModels">;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "rpc-decision-models-"));
  stored = new Map();
  const secrets: SecretValueStore = {
    async get(ref) {
      return stored.get(ref);
    },
    async set(ref, value) {
      stored.set(ref, value);
    },
    async delete(ref) {
      stored.delete(ref);
    },
  };
  dependencies = { decisionModels: new DecisionModelsService({ directory, secrets }) };
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

type Caller = { address: string; origin?: string };

/** Only the fields the handler reads; the cast keeps the fixture free of transport details. */
function rpc(
  method: string,
  params: Record<string, unknown>,
  caller: Caller = { address: "127.0.0.1" },
): OwnerRpcRequest {
  return {
    input: { method },
    params,
    result: undefined,
    request: {
      headers: caller.origin ? { origin: caller.origin } : {},
      socket: { remoteAddress: caller.address },
    },
  } as unknown as OwnerRpcRequest;
}

const source = {
  name: "Clef",
  kind: "local",
  adapter: "systemone",
  local: { modelPath: "C:/models/clef.gguf" },
};

describe("decision model owner RPC", () => {
  it("handles cancellation when no scan is active", async () => {
    const request = rpc("decisionModels.discovery.cancel", {});
    await handleDecisionModelsRpc(dependencies, request);
    expect(request.result).toEqual({ cancelled: false });
  });
  it("accepts an API key only from this computer", async () => {
    const remote: Caller = { address: "192.168.1.20" };
    const browser: Caller = { address: "127.0.0.1", origin: "https://example.test" };

    await expect(
      handleDecisionModelsRpc(
        dependencies,
        rpc("decisionModels.sources.add", { source, apiKey: "sk-remote" }, remote),
      ),
    ).rejects.toThrow("available only on this computer");

    await expect(
      handleDecisionModelsRpc(
        dependencies,
        rpc("decisionModels.sources.add", { source, apiKey: "sk-browser" }, browser),
      ),
    ).rejects.toThrow("available only on this computer");

    expect(stored.size).toBe(0);
  });

  it("adds a source without a key from any caller and returns it", async () => {
    const request = rpc("decisionModels.sources.add", { source }, { address: "192.168.1.20" });

    await handleDecisionModelsRpc(dependencies, request);

    expect(request.result).toMatchObject({ name: "Clef", kind: "local", status: "unknown" });
  });

  it("stores a key sent from this computer", async () => {
    const request = rpc("decisionModels.sources.add", { source, apiKey: "sk-local" });

    await handleDecisionModelsRpc(dependencies, request);

    expect([...stored.values()]).toEqual(["sk-local"]);
  });

  it("rejects malformed params before they reach the service", async () => {
    await expect(
      handleDecisionModelsRpc(
        dependencies,
        rpc("decisionModels.sources.add", { source: { name: "" } }),
      ),
    ).rejects.toThrow();
    await expect(
      handleDecisionModelsRpc(
        dependencies,
        rpc("decisionModels.local.install", { modelId: "clef", confirm: false }),
      ),
    ).rejects.toThrow();
  });

  it("returns a per-question unavailable answer for decide", async () => {
    const request = rpc("decisionModels.decide", {
      taskType: "screen_state",
      personalData: false,
      state: { page: "login" },
      questions: {
        isLogin: {
          type: "noul",
          instructions: "Is this a login form?",
          criteria: { true: "login", false: "other" },
        },
      },
    });

    await handleDecisionModelsRpc(dependencies, request);

    expect(request.result).toEqual({
      answers: { isLogin: { error: "unavailable" } },
      sourceChain: [],
      durationMs: expect.any(Number),
    });
  });

  it("accepts only the exact install confirmation before the catalog gate", async () => {
    await expect(
      handleDecisionModelsRpc(
        dependencies,
        rpc("decisionModels.local.install", { modelId: "clef-flash-9b", confirm: true }),
      ),
    ).rejects.toThrow();

    await expect(
      handleDecisionModelsRpc(
        dependencies,
        rpc("decisionModels.local.install", {
          modelId: "clef-flash-9b",
          confirm: "INSTALL_DECISION_MODEL",
        }),
      ),
    ).rejects.toThrow("unverified model");
  });

  it("plans a local install without downloading anything", async () => {
    const request = rpc("decisionModels.local.plan", { modelId: "clef-flash-9b" });

    await handleDecisionModelsRpc(dependencies, request);

    expect(request.result).toMatchObject({ modelId: "clef-flash-9b", installable: false });
  });

  it("lists catalog providers that have a contract adapter", async () => {
    const request = rpc("decisionModels.catalog.get", {});

    await handleDecisionModelsRpc(dependencies, request);

    const entries = (request.result as { entries: { id: string }[] }).entries;
    expect(entries.map((entry) => entry.id)).toContain("clef-local");
    expect(entries.map((entry) => entry.id)).not.toContain("aimlapi");
  });

  it("stores scan settings and the first-run decision through the owner RPC", async () => {
    const folder = join(directory, "models");

    await handleDecisionModelsRpc(
      dependencies,
      rpc("decisionModels.discovery.settings.set", { extraPorts: [9000], extraFolders: [folder] }),
    );
    await handleDecisionModelsRpc(
      dependencies,
      rpc("decisionModels.firstRun.set", { dismissed: true }),
    );

    const settings = rpc("decisionModels.discovery.settings.get", {});
    const firstRun = rpc("decisionModels.firstRun.get", {});
    await handleDecisionModelsRpc(dependencies, settings);
    await handleDecisionModelsRpc(dependencies, firstRun);

    expect(settings.result).toEqual({ extraPorts: [9000], extraFolders: [folder] });
    expect(firstRun.result).toEqual({ dismissed: true });
  });

  it("rejects a manual endpoint that carries credentials", async () => {
    await expect(
      handleDecisionModelsRpc(
        dependencies,
        rpc("decisionModels.manual.verify", {
          kind: "endpoint",
          url: "https://user:secret@example.test/v1/systemone",
        }),
      ),
    ).rejects.toThrow("without credentials");
  });
});
