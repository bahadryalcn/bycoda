import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../../../src/integrations/harness/core/types";
import { HostEngine } from "../../engine";
import { HostStore } from "../../store";
import { createHostServer } from "../../server";
import {
  HOST_SCHEMA_VERSION,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
  WS_LIMITS,
  RPC_ERROR_CODES,
} from "../../../src/shared/model/host-contracts";
import { NATIVE_WORKSPACE_METHODS } from "../../../src/shared/model/host-contracts/native-workspaces";
import { NATIVE_BUFFER_UPLOAD_LIMITS as uploadLimits } from "../../../src/shared/model/host-contracts/native-buffer-upload";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
async function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "native-workspace-wire-"))),
    cwd = join(root, "repo");
  mkdirSync(cwd);
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.name", "Fixture");
  git(cwd, "config", "user.email", "fixture@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
  // This fixture asserts exact bytes after Git restore on every platform.
  git(cwd, "config", "core.autocrlf", "false");
  writeFileSync(join(cwd, "source.txt"), "base\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "baseline");
  const store = new HostStore(join(root, "host.db"));
  const send = vi.fn(async (_input: SendTurnInput) => {});
  const engine = new HostEngine(store, {
    codex: {
      send,
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(cwd);
  const server = await createHostServer(engine, ["codex"]);
  const clients: WebSocket[] = [];
  cleanups.push(async () => {
    for (const client of clients) client.terminate();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (
      !root.startsWith(realpathSync.native(tmpdir()) + "\\native-workspace-wire-") &&
      !root.startsWith(join(realpathSync.native(tmpdir()), "native-workspace-wire-"))
    )
      throw new Error("Unsafe fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const device = await store.issueDevice("Owner fixture");
  const http = async (method: string, params: unknown = {}, token = device.token) => {
    const response = await fetch(`${endpoint}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    const value = (await response.json()) as { result?: any; error?: string };
    return { status: response.status, ...value };
  };
  const httpCall = async (method: string, params: unknown = {}) => {
    const value = await http(method, params);
    expect(value, method).toMatchObject({ status: 200 });
    expect(value.error, method).toBeUndefined();
    return value.result;
  };
  const connect = async (token = device.token) => {
    const socket = new WebSocket(`${endpoint.replace("http:", "ws:")}/ws`, WS_SUBPROTOCOL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    clients.push(socket);
    const pending = new Map<
      string,
      {
        resolve(value: any): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    socket.on("message", (bytes) => {
      const value = JSON.parse(bytes.toString()),
        target = pending.get(String(value.id));
      if (target) {
        pending.delete(String(value.id));
        clearTimeout(target.timer);
        target.resolve(value);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("Socket closed"));
      }
      pending.clear();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const request = (method: string, params: unknown = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = randomUUID(),
          timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`No fixture response: ${method}`));
          }, 30_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    const hello = await request("connection.hello", {
      environmentId: store.environmentId,
      supportedWireVersions: [WS_WIRE_VERSION],
      supportedSchemaVersions: [HOST_SCHEMA_VERSION],
      clientId: "fixture-native",
      clientKind: "desktop",
    });
    expect(hello.result.capabilities).toEqual(
      expect.arrayContaining([
        "native.workspaces.v1",
        "native.buffers.upload.v1",
        "transport.ws.workspaces.cleanup.v1",
      ]),
    );
    const call = async (method: string, params: unknown = {}) => {
      const value = await request(method, params);
      expect(value.error, `${method}: ${JSON.stringify(value.error)}`).toBeUndefined();
      return value.result;
    };
    return { socket, request, call };
  };
  await httpCall("workspaces.exactGitRewind.set", { enabled: true });
  const scope = { projectId: project.id, environmentId: store.environmentId };
  await httpCall("projects.workspacePolicy.update", {
    ...scope,
    expectedRevision: 0,
    idempotencyKey: "fixture-policy",
    policy: {
      defaultMode: "worktree",
      root: join(root, "worktrees"),
      disk: { minimumFreeBytes: 1 },
    },
  });
  const sessionId = randomUUID();
  const { workspace } = await httpCall("workspaces.prepare", {
    ...scope,
    owner: { kind: "session", id: sessionId },
    slug: "native",
    idempotencyKey: "fixture-workspace",
  });
  return {
    root,
    cwd,
    store,
    engine,
    project,
    device,
    http,
    httpCall,
    connect,
    workspace,
    sessionId,
    send,
  };
}

it.each(["http", "ws"])(
  "preserves atomic create first-turn identity precedence and deduplication through %s",
  async (transport) => {
    const f = await fixture(),
      ws = await f.connect();
    const call = async (params: Record<string, unknown>) => {
      if (transport === "http") return f.httpCall("commands.dispatch", params);
      const response = await ws.request("commands.dispatch", params);
      if (response.error?.code === RPC_ERROR_CODES.deadlineExceeded) {
        expect(response.error.data).toMatchObject({
          delivery: "unknown",
          retryable: false,
          commandId: params.commandId,
        });
        // A slow Git preparation may outlive the ordinary12s command wait.
        // Observe real committed-store wakes and query the same receipt; never
        // resend the unknown operation or lengthen its transport deadline.
        for (;;) {
          let wake!: () => void;
          const changed = new Promise<void>((resolve) => {
            wake = resolve;
          });
          const unsubscribe = f.store.subscribeChanges(() => wake());
          try {
            const status = await ws.request("commands.status", { commandId: params.commandId });
            expect(status.error).toBeUndefined();
            if (status.result) return status.result;
            await changed;
          } finally {
            unsubscribe();
          }
        }
      }
      expect(response.error, `atomic ${params.commandId}`).toBeUndefined();
      return response.result;
    };
    const failed = (params: unknown) =>
      transport === "ws"
        ? ws.request("commands.dispatch", params)
        : f.http("commands.dispatch", params);
    const base = {
      type: "create",
      workspaceMode: "current",
      projectId: f.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    };
    const untouched = await call({ ...base, commandId: "untouched-target" });
    const before = JSON.stringify((await f.store.session(untouched.sessionId)).session.blocks);
    let sends = 0;
    for (const type of ["send", "draft"] as const) {
      for (const identity of ["omitted", "matching", "mismatched", "placeholder"]) {
        const requestedId =
          identity === "matching" || identity === "mismatched" ? randomUUID() : undefined;
        const nestedId =
          identity === "matching"
            ? requestedId
            : identity === "mismatched"
              ? untouched.sessionId
              : identity === "placeholder"
                ? ""
                : undefined;
        const firstTurn = {
          type,
          commandId: `first-${type}-${identity}`,
          text: `${type} ${identity}`,
          ...(nestedId === undefined ? {} : { sessionId: nestedId }),
        };
        const command = {
          ...base,
          ...(type === "send" && identity === "omitted" ? { workspaceMode: "worktree" } : {}),
          commandId: `create-${type}-${identity}`,
          ...(requestedId === undefined ? {} : { sessionId: requestedId }),
          firstTurn,
        };
        const receipt = await call(command);
        if (requestedId) expect(receipt.sessionId).toBe(requestedId);
        expect(receipt.sessionId).not.toBe(untouched.sessionId);
        if (type === "send") {
          await f.engine.waitForRun(receipt.sessionId, receipt.runId);
          sends++;
          expect(f.send.mock.calls.at(-1)?.[0].sessionId).toBe(receipt.sessionId);
        }
        const blocks = (await f.store.session(receipt.sessionId)).session.blocks.filter(
          (block) => block.role === "user",
        );
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe(firstTurn.text);
        expect(blocks[0].draft === true).toBe(type === "draft");
        expect(await call(command)).toEqual(receipt);
        // The existing engine deliberately excludes the deprecated nested ID
        // from the atomic signature and resolves only the outer creation ID.
        expect(
          await call({
            ...command,
            firstTurn: { ...firstTurn, sessionId: "different-legacy-placeholder" },
          }),
        ).toEqual(receipt);
        expect(
          (await failed({ ...command, firstTurn: { ...firstTurn, text: "changed intent" } })).error,
        ).toBeDefined();
        expect(f.send).toHaveBeenCalledTimes(sends);
      }
    }
    expect(JSON.stringify((await f.store.session(untouched.sessionId)).session.blocks)).toBe(
      before,
    );
    expect(
      (await failed({ type: "send", commandId: "standalone-no-session", text: "invalid" })).error,
    ).toBeDefined();
    expect(
      (
        await failed({
          ...base,
          commandId: "invalid-nested",
          firstTurn: { type: "send", commandId: "invalid-first", text: "x", arbitrary: true },
        })
      ).error,
    ).toBeDefined();
  },
  180_000,
);

it.each(["http", "ws"])(
  "executes all 20 real Native workspace RPCs through %s with shared durable owners",
  async (transport) => {
    const f = await fixture(),
      ws = await f.connect();
    const seen = new Set<string>();
    const call = async (method: string, params: unknown = {}) => {
      seen.add(method);
      return transport === "ws" ? ws.call(method, params) : f.httpCall(method, params);
    };
    const workspaceId = f.workspace.id,
      turn = {
        workspaceId,
        sessionId: f.sessionId,
        userBlockId: "user-a",
        runId: "run-a",
        conversationRevision: 1,
      };
    expect((await call("native.turn.begin", turn)).before.status).toBe("complete");
    writeFileSync(join(f.workspace.path, "source.txt"), "native change\n");
    expect((await call("native.turn.end", turn)).after.status).toBe("complete");
    const current = await f.httpCall("workspaces.get", { workspaceId });
    const conversation = { revision: 2, userBlockIds: [turn.userBlockId] };
    const plan = await call("native.rewind.plan", {
      request: {
        workspaceId,
        sessionId: f.sessionId,
        expectedRevision: current.revision,
        expectedConversationRevision: 2,
        direction: "rewind",
        userBlockId: turn.userBlockId,
      },
      conversation,
    });
    expect(plan.blockers).toEqual([]);
    const key = { workspaceId, sessionId: f.sessionId, idempotencyKey: "native-preparation" };
    expect(await call("native.rewind.lookup", key)).toBeNull();
    expect(
      (await call("native.rewind.cancelPreparation", { ...key, idempotencyKey: "cancelled-key" }))
        .cancelled,
    ).toBe(true);
    const mutation = {
      ...key,
      expectedRevision: current.revision,
      expectedConversationRevision: 2,
      planToken: plan.token,
    };
    const prepared = await call("native.rewind.prepare", {
      request: mutation,
      direction: "rewind",
      conversation,
    });
    expect(await call("native.rewind.lookup", key)).toEqual(prepared);
    expect(
      (
        await call("native.rewind.apply", {
          operationId: prepared.operationId,
          request: mutation,
          direction: "rewind",
          transcriptRescueId: prepared.operationId,
        })
      ).phase,
    ).toBe("git-restored");
    expect(
      (await call("native.rewind.status", { operationId: prepared.operationId })).restoreRequest
        .sessionId,
    ).toBe(f.sessionId);
    expect(
      (
        await call("native.rewind.ack", {
          operationId: prepared.operationId,
          receipt: { revision: 3 },
        })
      ).finalized,
    ).toBe(true);
    expect(readFileSync(join(f.workspace.path, "source.txt"), "utf8")).toBe("base\n");
    const activity = await call("native.activity.start", {
      activityId: "activity-a",
      cwd: f.workspace.path,
      kind: "provider",
      sessionId: f.sessionId,
    });
    expect(activity.workspaceId).toBe(workspaceId);
    expect(await call("native.activity.end", { activityId: "activity-a" })).toEqual({
      acknowledged: true,
    });
    const report = {
      clientId: "client-a",
      instanceId: "instance-a",
      processId: process.pid,
      owners: [{ ownerId: "window-a", updatedAt: Date.now(), unknown: false, buffers: [] }],
    };
    expect(await call("native.buffers.update", report)).toEqual({ acknowledged: true });
    const page = await call("native.buffers.recovery.list", { limit: 100 });
    expect(page.records).toHaveLength(1);
    const source = page.records[0].source;
    expect((await call("native.buffers.recovery.read", source)).owner.ownerId).toBe("window-a");
    expect((await call("native.buffers.recovery.status", source)).qualified).toBe(false);
    expect(
      await call("native.buffers.retire", {
        clientId: report.clientId,
        instanceId: report.instanceId,
        processId: process.pid,
      }),
    ).toEqual({ acknowledged: true });
    await call("native.buffers.update", { ...report, instanceId: "instance-b" });
    expect(
      await call("native.buffers.reconcile", {
        clientId: report.clientId,
        instanceId: "instance-b",
        predecessors: [{ instanceId: report.instanceId, processId: process.pid }],
      }),
    ).toEqual({ acknowledged: true });
    const after = await f.httpCall("workspaces.get", { workspaceId });
    await f.httpCall("workspaces.finish", {
      workspaceId,
      expectedRevision: after.revision,
      idempotencyKey: "finish-native",
    });
    const finished = await f.httpCall("workspaces.get", { workspaceId });
    const cleanup = await call("workspaces.cleanup.plan", {
      workspaceId,
      expectedRevision: finished.revision,
    });
    expect(cleanup.blockers).toEqual([]);
    expect(
      (await call("workspaces.cleanup.status", { workspaceId })).workspace.directoryState,
    ).toBe("present");
    expect(
      (
        await call("workspaces.cleanup.apply", {
          workspaceId,
          expectedRevision: cleanup.expectedRevision,
          idempotencyKey: "remove-native",
          planToken: cleanup.token,
        })
      ).directoryState,
    ).toBe("removed");
    expect([...seen].sort()).toEqual([...NATIVE_WORKSPACE_METHODS].sort());
  },
  180_000,
);

it("stages a real >1MiB Native report through WS chunks and commits once through the unchanged buffer owner", async () => {
  const f = await fixture(),
    ws = await f.connect(),
    uploadId = randomUUID();
  const path = join(f.workspace.path, "source.txt"),
    longPath = join(f.workspace.path, "x".repeat(180));
  const report = {
    clientId: "large-client",
    instanceId: "large-instance",
    processId: process.pid,
    owners: [
      {
        ownerId: "large-window",
        updatedAt: Date.now(),
        unknown: true,
        buffers: Array.from({ length: 6000 }, (_, i) => ({
          path: i ? `${longPath}${i}` : path,
          dirty: false,
        })),
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(report));
  expect(bytes.length).toBeGreaterThan(WS_LIMITS.maxMessageBytes);
  const input = {
    uploadId,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await ws.call("native.buffers.upload.start", input);
  for (let offset = 0; offset < bytes.length; offset += uploadLimits.chunkBytes) {
    const params = {
      uploadId,
      offset,
      data: bytes.subarray(offset, offset + uploadLimits.chunkBytes).toString("base64"),
    };
    expect(Buffer.byteLength(JSON.stringify(params))).toBeLessThan(WS_LIMITS.maxMessageBytes);
    await ws.call("native.buffers.upload.write", params);
  }
  const committed = await ws.call("native.buffers.upload.commit", { uploadId });
  expect(committed).toMatchObject({ state: "completed", result: { acknowledged: true } });
  expect(await ws.call("native.buffers.upload.commit", { uploadId })).toEqual(committed);
  expect(await f.httpCall("native.buffers.upload.status", { uploadId })).toEqual(committed);
  const page = await f.httpCall("native.buffers.recovery.list", { limit: 100 });
  expect(page.records).toHaveLength(1);
  expect(page.records[0]).toMatchObject({ bufferCount: 6000, unknown: true, qualified: false });
  expect(page.records[0].source.reportVersion).toBe(1);
}, 180_000);

it("rejects malformed and scoped/foreign/revoked requests and reports post-effect conflicts as unknown", async () => {
  const f = await fixture(),
    ws = await f.connect();
  expect((await ws.request("native.buffers.update", { owners: [] })).error.code).toBe(
    RPC_ERROR_CODES.invalidParams,
  );
  expect(
    (
      await ws.request("native.turn.begin", {
        workspaceId: f.workspace.id,
        sessionId: "foreign",
        userBlockId: "user",
        runId: "run",
        conversationRevision: 1,
      })
    ).error.data.delivery,
  ).toBe("unknown");
  const activity = {
    activityId: "owned-activity",
    cwd: f.workspace.path,
    kind: "provider",
    sessionId: f.sessionId,
  };
  await ws.call("native.activity.start", activity);
  const other = await f.store.issueDevice("Other fixture"),
    foreign = await f.connect(other.token);
  expect(
    (await foreign.request("native.activity.end", { activityId: activity.activityId })).error.data,
  ).toMatchObject({ delivery: "unknown", retryable: false });
  expect(
    (await f.http("native.activity.end", { activityId: activity.activityId }, other.token)).status,
  ).toBe(400);
  await ws.call("native.activity.end", { activityId: activity.activityId });
  const created = await f.httpCall("commands.dispatch", {
    type: "create",
    commandId: "scoped-session",
    projectId: f.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const grant = await f.httpCall("conversation.access.issue", { sessionId: created.sessionId });
  expect(
    (
      await f.http(
        "native.buffers.upload.start",
        { uploadId: "scoped", byteLength: 1, sha256: "a".repeat(64) },
        grant.token,
      )
    ).status,
  ).toBe(400);
  expect(
    (await f.http("native.activity.end", { activityId: activity.activityId }, "invalid-token"))
      .status,
  ).toBe(401);
  await f.store.revokeDevice(f.device.id);
  expect(
    (await ws.request("native.buffers.upload.status", { uploadId: "absent" })).error.code,
  ).toBe(RPC_ERROR_CODES.unauthorized);
}, 180_000);
