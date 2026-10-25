import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { AttachmentOwnership as HostOwnership, ATTACHMENT_GRACE_MS } from "./attachment-ownership";
import { attachmentPath } from "./attachments";
import { AttachmentOwnership } from "../src/features/connections/model/attachmentOwnership";
import { uploadRemoteAttachments } from "../src/features/connections/model/remoteAttachments";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/features/connections/model/connections", () => ({
  remoteRequest: async (_machine: string, method: string, params: Record<string, unknown>) =>
    await transport.request(method, params),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  transport.request.mockReset();
});
it("uploads with desktop ownership over real authenticated RPC and collects after durable release retry", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const prefix = join(tmpdir(), "attachment-gc-integration-");
  const directory = mkdtempSync(prefix);
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  const server = await createHostServer(engine, []);
  const collector = new HostOwnership(store, () => now);
  cleanups.push(async () => {
    await collector.close();
    await engine.close();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(async (done) => await server.close(() => done()));
    await store.close();
    if (!resolve(directory).startsWith(resolve(prefix))) throw new Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const device = await store.issueDevice("Synthetic desktop");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const calls: Array<{
    method: string;
    params: Record<string, unknown>;
  }> = [];
  let offline = false;
  const request = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (offline) throw new Error("Synthetic offline release");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    const value = (await response.json()) as {
      result?: unknown;
      error?: string;
    };
    if (value.error) throw new Error(value.error);
    return value.result;
  };
  transport.request.mockImplementation(request);
  const rows = new Map<string, string>();
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
  const owner = new AttachmentOwnership(
    "desktop:integration",
    store.environmentId,
    request,
    storage,
  );
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const text = "Private synthetic attachment";
  const refs = await uploadRemoteAttachments(
    "fixture-machine",
    [
      {
        id,
        name: "note.txt",
        kind: "file",
        mimeType: "text/plain",
        size: Buffer.byteLength(text),
        data: Buffer.from(text).toString("base64"),
      },
    ],
    {
      environmentId: store.environmentId,
      resumable: true,
      ownership: owner,
      ownershipSource: "draft",
    },
  );
  expect(refs[0]).toMatchObject({ id, name: "note.txt" });
  for (const { method, params } of calls.filter((call) => call.method.startsWith("attachments."))) {
    expect(params.ownerId, method).toBe(owner.ownerId);
    expect(params.claimId, method).toBeTypeOf("string");
  }
  now += ATTACHMENT_GRACE_MS * 2;
  expect(await collector.collect()).toEqual([]);
  offline = true;
  await expect(owner.replaceDurable("draft", [])).rejects.toThrow("offline");
  expect(existsSync(attachmentPath(store, id))).toBe(true);
  offline = false;
  const restarted = new AttachmentOwnership(owner.ownerId, store.environmentId, request, storage);
  await restarted.retry();
  expect(await collector.collect()).toEqual([]);
  // A queue reply can establish a claim before its response or the local
  // ledger write is lost. An authoritative empty inventory must recover it.
  const recovered = new AttachmentOwnership(
    "desktop:lost-reply",
    store.environmentId,
    request,
    storage,
  );
  await request("attachments.claim", {
    ownerId: recovered.ownerId,
    claimId: "lost-reply",
    ids: [id],
  });
  now += ATTACHMENT_GRACE_MS + 1000;
  expect(await collector.collect()).toEqual([]);
  await recovered.reconcileDurable({});
  expect(calls.some((call) => call.method === "attachments.claims")).toBe(true);
  now += ATTACHMENT_GRACE_MS + 1000;
  expect(await collector.collect()).toEqual([id]);
  expect(existsSync(attachmentPath(store, id))).toBe(false);
});
