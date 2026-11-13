import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingDraft,
} from "../../src/shared/model/host-contracts/model-routing";
import {
  getHostRpcMethod,
  parseHostRpcParams,
} from "../../src/shared/model/host-contracts/methods";
import { createModelRoutingDomainService } from "../domains/model-routing/service";
import { HostStore } from "../store";
import { createModelRoutingService, resolveModelChoice } from "./service";
import { readModelRouting } from "./storage";
import { createHostModelRoutingService } from "./runtime";
import { handleModelRoutingRpc } from "../server/rpc-model-routing";
import type { OwnerRpcRequest } from "../server/owner-rpc-context";

let root: string;
let store: HostStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "model-routing-"));
  store = new HostStore(join(root, "host.db"));
  await store.ready;
});
afterEach(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true });
});
const draft = (): ModelRoutingDraft => ({
  ...structuredClone(EMPTY_MODEL_ROUTING),
  entries: [{ id: "a", harness: "codex", model: "x", modelSettings: {}, unknownLimit: "use" }],
});
function setup() {
  const signals = vi.fn(async () => ({
    available: () => true,
    signedIn: () => true,
    quota: () => ({ unknown: true as const }),
  }));
  const service = createModelRoutingService({
    store,
    accounts: async () => ({}),
    catalog: async () => ({ models: { codex: [{ id: "x" }] } }),
    signals,
    now: () => 123,
  });
  return { service, signals, domain: createModelRoutingDomainService(service) };
}
it("returns empty version zero without saving; persists document and version across reopen", async () => {
  const { service } = setup();
  expect(await service.get()).toEqual({ ...EMPTY_MODEL_ROUTING, version: 0, updatedAt: 0 });
  const saved = await service.save(0, draft());
  expect(saved).toEqual({ ...draft(), version: 1, updatedAt: 123 });
  const row = await store.db
    .prepare("SELECT value FROM host_settings WHERE key=?")
    .get("modelRouting");
  expect(JSON.parse(String(row!.value))).toEqual(saved);
  await store.close();
  store = new HostStore(join(root, "host.db"));
  expect(await readModelRouting(store)).toEqual(saved);
});
it("serializes competing optimistic saves; exactly one wins", async () => {
  const { service } = setup();
  const results = await Promise.allSettled([service.save(0, draft()), service.save(0, draft())]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: new Error("Model routing changed; reload before saving."),
  });
  expect((await service.get()).version).toBe(1);
});
it("validation or revoked authority never writes", async () => {
  const { service } = setup();
  const invalid = draft();
  invalid.entries[0]!.modelSettings.crossAdvisor = "x";
  await expect(service.save(0, invalid)).rejects.toThrow("Delegation keys belong");
  await expect(
    service.save(0, draft(), async () => {
      throw new Error("revoked");
    }),
  ).rejects.toThrow("revoked");
  expect((await service.get()).version).toBe(0);
});
it("does not reinterpret corrupt storage as unconfigured", async () => {
  const { service } = setup();
  await service.get();
  await store.db.prepare("INSERT INTO host_settings VALUES (?, ?)").run("modelRouting", "invalid");
  await expect(service.get()).rejects.toThrow();
});
it("exposes status and typed in-process run-start resolution", async () => {
  const { service } = setup();
  await service.save(0, draft());
  expect(await service.status()).toEqual([{ entryId: "a" }]);
  expect(await resolveModelChoice(service, { role: "task.worker" })).toMatchObject({
    ok: true,
    source: { kind: "order", entryId: "a" },
  });
});
it("fixed run-start resolution does not read real signals", async () => {
  const { service, signals } = setup();
  const fixed = { harness: "codex" as const, model: "old", modelSettings: {} };
  expect(
    await service.resolve({ role: "task.worker", choice: { kind: "fixed" }, fixed }),
  ).toMatchObject({ ok: true, target: fixed });
  expect(signals).not.toHaveBeenCalled();
  expect(await resolveModelChoice(service, { role: "task.worker", fixed })).toMatchObject({
    ok: true,
    target: fixed,
    source: { kind: "fixed" },
  });
  expect(signals).not.toHaveBeenCalled();
  expect(
    await resolveModelChoice(service, { role: "task.worker", choice: { kind: "default" }, fixed }),
  ).toMatchObject({ ok: false, reason: "notConfigured" });
});
it("domain authorizes reads, rejects unauthorized save, and rechecks before persistence", async () => {
  const { domain } = setup();
  const owner = { principalId: "paired-owner-device", authorized: async () => true };
  expect(await domain.get({}, owner)).toHaveProperty("state.version", 0);
  expect(await domain.status({}, owner)).toEqual({ entries: [] });
  expect(await domain.resolve({ role: "task.worker" }, owner)).toHaveProperty(
    "resolution.reason",
    "notConfigured",
  );
  const revoked = { authorized: async () => false };
  for (const operation of [
    () => domain.get({}, revoked),
    () => domain.status({}, revoked),
    () => domain.resolve({ role: "task.worker" }, revoked),
    () => domain.save({ expectedVersion: 0, draft: draft() }, revoked),
  ])
    await expect(operation()).rejects.toThrow("authorization was revoked");
  let checks = 0;
  await expect(
    domain.save({ expectedVersion: 0, draft: draft() }, { authorized: async () => ++checks === 1 }),
  ).rejects.toThrow("authorization was revoked");
  expect((await domain.get({}, owner)).state.version).toBe(0);
  expect(await domain.save({ expectedVersion: 0, draft: draft() }, owner)).toHaveProperty(
    "state.version",
    1,
  );
});
it("registers exact four schemas, capability and read/control semantics", async () => {
  const { domain } = setup();
  for (const operation of ["get", "save", "status", "resolve"] as const) {
    const method = `modelRouting.${operation}`;
    const definition = getHostRpcMethod(method);
    expect(definition).toMatchObject({
      requiredCapability: "models.routing.v1",
      kind: operation === "save" ? "control" : "query",
    });
    const params =
      operation === "save"
        ? { expectedVersion: 0, draft: draft() }
        : operation === "resolve"
          ? { role: "task.worker" }
          : {};
    const parsed = parseHostRpcParams(method, params);
    const result = await domain[operation](parsed, { authorized: async () => true });
    expect(definition!.resultSchema.parse(result)).toEqual(result);
  }
});

it("routes all four owner RPC methods to the initialized store service", async () => {
  createHostModelRoutingService({
    store,
    catalog: async () => ({ models: {} }),
    readLimits: vi.fn(),
    command: vi.fn(),
  });
  for (const method of [
    "modelRouting.get",
    "modelRouting.save",
    "modelRouting.status",
    "modelRouting.resolve",
  ]) {
    const params = method.endsWith("save")
      ? { expectedVersion: 0, draft: EMPTY_MODEL_ROUTING }
      : method.endsWith("resolve")
        ? { role: "task.worker" }
        : {};
    const request = {
      input: { method },
      params,
      domainContext: { authorized: async () => true },
    } as unknown as OwnerRpcRequest;
    await handleModelRoutingRpc({ engine: { store } } as never, request);
    expect(getHostRpcMethod(method)!.resultSchema.safeParse(request.result).success).toBe(true);
  }
});

it("persists calendar caps and rejects invalid values without changing the document", async () => {
  const { service } = setup();
  const input = draft();
  input.workCaps = {
    total: { daily: { tokens: 100, costUsd: 1.25 } },
    providers: { codex: { monthly: { tokens: 0, costUsd: 10 } } },
  };
  await service.save(0, input);
  await store.close();
  store = new HostStore(join(root, "host.db"));
  expect((await readModelRouting(store)).workCaps).toEqual(input.workCaps);
  const invalid = structuredClone(input);
  invalid.workCaps!.total!.daily!.tokens = Number.MAX_SAFE_INTEGER + 1;
  await expect(setup().service.save(1, invalid)).rejects.toThrow();
  invalid.workCaps!.total!.daily!.tokens = 1;
  invalid.workCaps!.total!.daily!.costUsd = Infinity;
  await expect(setup().service.save(1, invalid)).rejects.toThrow();
  expect((await readModelRouting(store)).version).toBe(1);
});
