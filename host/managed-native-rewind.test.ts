import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyFile } from "node:fs/promises";
import { once } from "node:events";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createManagedWorkspaceRuntime } from "./managed-workspace-runtime";
import { createManagedNativeRewind } from "./managed-native-rewind";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(options: Parameters<typeof createManagedWorkspaceRuntime>[2] = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "managed-runtime-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(root, "source.txt"), "base\n");
  git("add", "source.txt");
  git("commit", "-qm", "base");
  mkdirSync(join(root, "private"));
  const store = new HostStore(join(root, "private", "host.db"));
  const send = vi.fn(async () => {});
  const engine = new HostEngine(store, {
    codex: {
      send,
      bind: () => {},
      stop: async () => {},
      cancel: async () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(root);
  const runtime = createManagedWorkspaceRuntime(store, engine, options);
  cleanups.push(async () => {
    runtime.retention.stop();
    await engine.close();
    await store.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await runtime.withOwner("test-owner", (owner) =>
    runtime.policy.update(
      {
        projectId: project.id,
        environmentId: store.environmentId,
        expectedRevision: 0,
        idempotencyKey: "policy",
        policy: {
          root: join(root, "worktrees"),
          disk: { minimumFreeBytes: 1, budgetBytes: 1024 ** 3, warningRatio: 0.8 },
        },
      },
      owner,
    ),
  );
  const request = {
    projectId: project.id,
    environmentId: store.environmentId,
    owner: { kind: "session" as const, id: "owned-session" },
    slug: "source",
    idempotencyKey: "prepare",
  };
  return { root, git, store, engine, runtime, project, request, send };
}

it("authenticates and durably discovers the same native preparation after losing its response", async () => {
  const f = await fixture({
    afterNativeReceiptSaved: async () => {
      throw new Error("simulated crash after native receipt");
    },
  });
  await f.runtime.recover();
  const { workspace } = await f.runtime.registry.prepare(f.request);
  const turn = {
    workspaceId: workspace.id,
    sessionId: "owned-session",
    userBlockId: "native-user",
    runId: "native-run",
    conversationRevision: 1,
  };
  await f.runtime.withOwner("native-device", async (owner) => {
    await f.runtime.nativeRewind.bindTurn(turn, owner);
    await f.runtime.nativeTurns.begin(turn, owner);
    writeFileSync(join(workspace.path, "source.txt"), "native changed\n");
    await f.runtime.nativeTurns.end(turn, owner);
    const conversation = { revision: 2, userBlockIds: [turn.userBlockId] };
    const plan = await f.runtime.nativeRewind.plan(
      {
        request: {
          workspaceId: workspace.id,
          sessionId: turn.sessionId,
          expectedRevision: workspace.revision,
          expectedConversationRevision: 2,
          direction: "rewind",
          userBlockId: turn.userBlockId,
        },
        conversation,
      },
      owner,
    );
    const request = {
      workspaceId: workspace.id,
      sessionId: turn.sessionId,
      expectedRevision: workspace.revision,
      expectedConversationRevision: 2,
      planToken: plan.token,
      idempotencyKey: "native-crash",
    };
    const lookup = {
      workspaceId: workspace.id,
      sessionId: turn.sessionId,
      idempotencyKey: request.idempotencyKey,
    };
    expect(await f.runtime.nativeRewind.lookup(lookup, owner)).toBeNull();
    const prepared = await f.runtime.nativeRewind.prepare(
      { request, conversation, direction: "rewind" },
      owner,
    );
    await f.runtime.nativeRewind.apply(
      {
        operationId: prepared.operationId,
        request,
        direction: "rewind",
        transcriptRescueId: prepared.operationId,
      },
      owner,
    );
    await expect(
      f.runtime.nativeRewind.ack(
        { operationId: prepared.operationId, receipt: { revision: 3 } },
        owner,
      ),
    ).rejects.toThrow("simulated crash");
    await expect(f.runtime.assertWritable(workspace.id)).rejects.toThrow("recovery");
    const recovered = createManagedNativeRewind({
      ...f.runtime.rewind.options,
      authorize: async (candidate) => candidate === owner,
      isHostSession: async (id) => !!(await f.store.sessionAuthority(id)),
    });
    expect(await recovered.lookup(lookup, owner)).toEqual(prepared);
    await expect(recovered.lookup(lookup, { ...owner, ownerId: "other-device" })).rejects.toThrow(
      "Authenticated native owner",
    );
    await expect(
      recovered.lookup({ ...lookup, sessionId: "other-session" }, owner),
    ).rejects.toThrow("does not own");
    const status = await recovered.status({ operationId: prepared.operationId }, owner);
    expect(status).toMatchObject({
      phase: "complete",
      finalized: true,
      receipt: { conversationRevision: 3 },
    });
    await expect(f.runtime.assertWritable(workspace.id)).resolves.toBeUndefined();
    await expect(
      recovered.ack({ operationId: prepared.operationId, receipt: { revision: 3 } }, owner),
    ).resolves.toMatchObject({ acknowledged: true, finalized: true });
  });
}, 120_000);

it("discovers and completes the real Host preparation after its process is killed before native insertion", async () => {
  const f = await fixture();
  await f.runtime.recover();
  const { workspace } = await f.runtime.registry.prepare(f.request);
  const turn = {
    workspaceId: workspace.id,
    sessionId: "owned-session",
    userBlockId: "killed-user",
    runId: "killed-run",
    conversationRevision: 1,
  };
  const conversation = { revision: 2, userBlockIds: [turn.userBlockId] };
  const plan = await f.runtime.withOwner("native-device", async (owner) => {
    await f.runtime.nativeRewind.bindTurn(turn, owner);
    await f.runtime.nativeTurns.begin(turn, owner);
    writeFileSync(join(workspace.path, "source.txt"), "native source before killed preparation\n");
    await f.runtime.nativeTurns.end(turn, owner);
    return f.runtime.nativeRewind.plan(
      {
        request: {
          workspaceId: workspace.id,
          sessionId: turn.sessionId,
          expectedRevision: workspace.revision,
          expectedConversationRevision: 2,
          direction: "rewind",
          userBlockId: turn.userBlockId,
        },
        conversation,
      },
      owner,
    );
  });
  const request = {
    workspaceId: workspace.id,
    sessionId: turn.sessionId,
    expectedRevision: workspace.revision,
    expectedConversationRevision: 2,
    planToken: plan.token,
    idempotencyKey: "killed-native-preparation",
  };
  f.runtime.retention.stop();
  await f.engine.close();
  await f.store.close();
  const childFile = join(f.root, "prepare-child.mjs");
  await copyFile(resolve("host/store-worker.mjs"), join(f.root, "store-worker.mjs"));
  await build({
    stdin: {
      contents: `import {HostStore} from ${JSON.stringify(resolve("host/store.ts"))};
        import {HostEngine} from ${JSON.stringify(resolve("host/engine.ts"))};
        import {createManagedWorkspaceRuntime} from ${JSON.stringify(resolve("host/managed-workspace-runtime.ts"))};
        const store=new HostStore(${JSON.stringify(join(f.root, "private/host.db"))});
        await store.ready; const engine=new HostEngine(store,{}); await engine.ready;
        const runtime=createManagedWorkspaceRuntime(store,engine); await runtime.recover();
        const prepared=await runtime.withOwner("native-device",owner=>runtime.nativeRewind.prepare({
          request:${JSON.stringify(request)},direction:"rewind",conversation:${JSON.stringify(conversation)}},owner));
        process.send(prepared); setInterval(()=>{},1000);`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    outfile: childFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    loader: { ".ps1": "text", ".md": "text" },
    define: { "import.meta.hot": "undefined" },
  });
  const child = spawn(process.execPath, [childFile], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr!.on("data", (data) => {
    stderr += data.toString();
  });
  try {
    const prepared = await Promise.race([
      once(child, "message").then(([value]) => value as { operationId: string }),
      once(child, "exit").then(([code]) => {
        throw new Error(`Preparation process exited ${code}: ${stderr}`);
      }),
    ]);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const store = new HostStore(join(f.root, "private/host.db"));
    await store.ready;
    const engine = new HostEngine(store, {});
    await engine.ready;
    const runtime = createManagedWorkspaceRuntime(store, engine);
    cleanups.push(async () => {
      runtime.retention.stop();
      await engine.close();
      await store.close();
    });
    await runtime.recover();
    await runtime.withOwner("native-device", async (owner) => {
      expect(
        await runtime.nativeRewind.lookup(
          {
            workspaceId: workspace.id,
            sessionId: turn.sessionId,
            idempotencyKey: request.idempotencyKey,
          },
          owner,
        ),
      ).toMatchObject(prepared);
      expect(
        (await runtime.registry.listOperations(workspace.id)).filter((op) => op.kind === "rewind"),
      ).toHaveLength(1);
      await expect(runtime.assertWritable(workspace.id)).rejects.toThrow("recovery");
      await runtime.nativeRewind.apply(
        {
          operationId: prepared.operationId,
          request,
          direction: "rewind",
          transcriptRescueId: prepared.operationId,
        },
        owner,
      );
      const result = await runtime.nativeRewind.ack(
        { operationId: prepared.operationId, receipt: { revision: 3 } },
        owner,
      );
      expect(result).toMatchObject({ acknowledged: true, finalized: true });
      expect(await runtime.nativeRewind.status(prepared, owner)).toMatchObject({
        phase: "complete",
        finalized: true,
      });
      await expect(runtime.assertWritable(workspace.id)).resolves.toBeUndefined();
    });
  } finally {
    child.kill("SIGKILL");
    if (child.connected) child.disconnect();
  }
}, 180_000);

it.each(["expired", "source-drift", "never-contacted"])(
  "durably cancels a proven absent %s preparation and rejects delayed replay of its key",
  async (scenario) => {
    const f = await fixture();
    await f.runtime.recover();
    const { workspace } = await f.runtime.registry.prepare(f.request);
    const turn = {
      workspaceId: workspace.id,
      sessionId: "owned-session",
      userBlockId: "cancel-user",
      runId: "cancel-run",
      conversationRevision: 1,
    };
    await f.runtime.withOwner("native-device", async (owner) => {
      await f.runtime.nativeRewind.bindTurn(turn, owner);
      await f.runtime.nativeTurns.begin(turn, owner);
      writeFileSync(join(workspace.path, "source.txt"), "after turn\n");
      await f.runtime.nativeTurns.end(turn, owner);
      let clock = Date.now();
      const options = {
        ...f.runtime.rewind.options,
        now: () => clock,
        authorize: async (candidate: typeof owner) => candidate === owner,
        isHostSession: async (id: string) => !!(await f.store.sessionAuthority(id)),
      };
      const native = createManagedNativeRewind(options);
      const conversation = { revision: 2, userBlockIds: [turn.userBlockId] };
      const preview = {
        workspaceId: workspace.id,
        sessionId: turn.sessionId,
        expectedRevision: workspace.revision,
        expectedConversationRevision: 2,
        direction: "rewind" as const,
        userBlockId: turn.userBlockId,
      };
      const plan = await native.plan({ request: preview, conversation }, owner);
      const input = {
        request: {
          workspaceId: workspace.id,
          sessionId: turn.sessionId,
          expectedRevision: workspace.revision,
          expectedConversationRevision: 2,
          planToken: plan.token,
          idempotencyKey: `cancel-${scenario}`,
        },
        conversation,
        direction: "rewind" as const,
      };
      if (scenario === "expired") clock += 600_000;
      if (scenario === "source-drift")
        writeFileSync(join(workspace.path, "source.txt"), "external drift\n");
      const key = {
        workspaceId: workspace.id,
        sessionId: turn.sessionId,
        idempotencyKey: input.request.idempotencyKey,
      };
      let queuedCancellation: ReturnType<typeof native.cancelPreparation> | undefined;
      if (scenario === "expired") {
        let entered!: () => void, release!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const apply = native.service.apply.bind(native.service);
        vi.spyOn(native.service, "apply").mockImplementationOnce(async (request) => {
          entered();
          await gate;
          return apply(request);
        });
        const rejected = native.prepare(input, owner).then(
          () => null,
          (error) => error,
        );
        await started;
        queuedCancellation = native.cancelPreparation(key, owner);
        let cancelledEarly = false;
        void queuedCancellation.then(() => {
          cancelledEarly = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(cancelledEarly).toBe(false);
        release();
        expect(await rejected).toBeInstanceOf(Error);
      } else if (scenario !== "never-contacted") {
        await expect(native.prepare(input, owner)).rejects.toThrow();
      }
      expect(await native.lookup(key, owner)).toBeNull();
      const cancelled = await (queuedCancellation ?? native.cancelPreparation(key, owner));
      expect(cancelled).toEqual({ ...key, cancelled: true });
      const restarted = createManagedNativeRewind(options);
      expect(await restarted.cancelPreparation(key, owner)).toEqual(cancelled);
      await expect(restarted.prepare(input, owner)).rejects.toThrow("cancelled");
      await expect(
        restarted.cancelPreparation(key, { ...owner, ownerId: "other-device" }),
      ).rejects.toThrow("Authenticated");
      expect(
        (await f.runtime.registry.listOperations(workspace.id)).filter(
          (op) => op.kind === "rewind",
        ),
      ).toHaveLength(0);
      const fresh = await restarted.plan({ request: preview, conversation }, owner);
      const prepared = await restarted.prepare(
        {
          ...input,
          request: {
            ...input.request,
            planToken: fresh.token,
            idempotencyKey: `fresh-${scenario}`,
          },
        },
        owner,
      );
      const existing = await restarted.cancelPreparation(
        { ...key, idempotencyKey: `fresh-${scenario}` },
        owner,
      );
      expect(existing).toEqual({
        ...key,
        idempotencyKey: `fresh-${scenario}`,
        cancelled: false,
        operation: prepared,
      });
      expect((await restarted.status(prepared, owner)).phase).toBe("prepared");
    });
  },
  120_000,
);
