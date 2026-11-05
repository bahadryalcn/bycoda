import { expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostChildBackend } from "./child-backend";
import { HostEngine } from "./engine";
import { HostRunWriters } from "./execution/run-writers";
import { HostStore } from "./store";
import type { HostProvider } from "./providers/providers";
import {
  acquireHarnessBridge,
  configureChildBackend,
  createChildProcessHandle,
  killChild,
  spawnChild,
  watchChild,
  type ChildBackend,
  type ChildProcessHandle,
} from "../src/integrations/harness/core/child";
import type { HostRunBinding } from "../src/integrations/harness/core/hostRun";
import type {
  HarnessOperationContext,
  SendTurnInput,
} from "../src/integrations/harness/core/types";
import { JsonRpcClient } from "../src/integrations/harness/core/jsonRpc";
import {
  captureRpcTurnWriter,
  finishProviderOperation,
  observeProviderProcess,
  rpcTurnWriter,
} from "../src/integrations/harness/providers/turnWriter";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("connects Engine source capabilities to a real warm child and revokes admission independently of physical cleanup", async () => {
  const base = realpathSync.native(tmpdir());
  const directory = realpathSync.native(mkdtempSync(join(base, "bycoda-engine-run-wire-")));
  const script = join(directory, "provider.cjs");
  writeFileSync(
    script,
    `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const request=JSON.parse(line); if(request.id!==undefined)console.log(JSON.stringify({id:request.id,result:{sequence:request.params.sequence}}));
});`,
  );
  const writers = new HostRunWriters();
  const backend = new HostChildBackend(
    { codex: process.execPath },
    directory,
    process.env.BYCODA_TEST_PROVIDER_GUARDIAN_BUNDLE,
    writers,
  );
  const bindings: Array<{ args: Record<string, unknown>; binding: HostRunBinding }> = [];
  const proxy: ChildBackend = {
    invoke: async <T>(command: string, args?: Record<string, unknown>) => {
      const result = await backend.invoke<T>(command, args);
      if (command === "harness_bind_host_run")
        bindings.push({ args: { ...args }, binding: result as HostRunBinding });
      return result;
    },
    listen: backend.listen.bind(backend),
  };
  configureChildBackend(proxy);
  const releaseBridge = await acquireHarnessBridge();
  const store = new HostStore(join(directory, "host.db"));
  const processes = new Map<string, { handle: ChildProcessHandle; rpc: JsonRpcClient }>();
  const submitted: SendTurnInput[] = [];
  const failedStop = new Error("deliberately held original cleanup failure");
  const failureObserved = gate();
  const shutdownStopEntered = gate(),
    releaseShutdownStop = gate(),
    releaseMain = gate();
  let failingId: string | undefined;
  let heldId: string | undefined;
  let sequence = 0;
  const provider: HostProvider = {
    send: async (input) => {
      submitted.push(input);
      let live = processes.get(input.sessionId);
      if (!live) {
        const handle = createChildProcessHandle(input.sessionId);
        observeProviderProcess(input, handle, "starting");
        const rpc = new JsonRpcClient(handle);
        watchChild(
          handle,
          (line) => rpc.pushLine(line),
          () => rpc.close(),
        );
        live = { handle, rpc };
        processes.set(input.sessionId, live);
        await spawnChild(handle, process.execPath, [script], input.cwd, undefined, "codex");
      } else observeProviderProcess(input, live.handle);
      try {
        const rpc = await captureRpcTurnWriter(
          live.handle,
          live.rpc,
          undefined,
          input.operationContext,
        )();
        const current = ++sequence;
        expect(await rpc.request("echo", { sequence: current })).toEqual({ sequence: current });
        input.onAccepted?.();
        input.onEvent({ type: "message.delta", text: `Actual child reply ${current}` });
        if (input.sessionId === failingId)
          throw new Error("original provider failed after its actual write");
        if (input.sessionId === heldId) await releaseMain.promise;
        input.onEvent({ type: "message.completed" });
      } finally {
        finishProviderOperation(input.operationContext);
      }
    },
    stop: async (id, context?: HarnessOperationContext) => {
      if (id === failingId) {
        failureObserved.resolve();
        throw failedStop;
      }
      if (id === heldId) {
        shutdownStopEntered.resolve();
        await releaseShutdownStop.promise;
      }
      const live = processes.get(id);
      if (live) {
        if (id === heldId) {
          const control = await rpcTurnWriter(live.handle, live.rpc, undefined, context, "control");
          expect(await control.request("turn/interrupt", { sequence: 300 })).toEqual({
            sequence: 300,
          });
        }
        await killChild(live.handle);
        live.rpc.close();
        processes.delete(id);
      }
    },
    cancel: async () => {},
    bind: () => {},
    approve: () => {},
    answer: () => {},
  };
  const engine = new HostEngine(store, { codex: provider }, undefined, undefined, writers);
  let close: Promise<void> | undefined;
  try {
    const project = await store.addProject(directory, "Actual run wire");
    const create = async (commandId: string) =>
      (
        await engine.command({
          type: "create",
          commandId,
          projectId: project.id,
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
        })
      ).sessionId;
    const send = async (id: string, commandId: string) =>
      engine.command({
        type: "send",
        commandId,
        sessionId: id,
        text: "A controlled test request",
      });
    const id = await create("wire-create");
    for (const commandId of ["wire-A", "wire-B"]) {
      const settled = gate();
      engine.onSettled = (sessionId) => {
        if (sessionId === id) settled.resolve();
      };
      await send(id, commandId);
      await settled.promise;
    }
    expect(processes.size).toBe(1);
    expect(submitted[0].operationContext?.hostRun).toBeDefined();
    expect(submitted[1].operationContext?.hostRun).not.toBe(submitted[0].operationContext?.hostRun);
    expect(bindings).toHaveLength(2);
    expect(bindings[0].args.constructionId).toBe(bindings[1].args.constructionId);
    const late = (entry: (typeof bindings)[number]) =>
      backend.invoke("harness_write_host_run", {
        sessionId: entry.args.sessionId,
        constructionId: entry.args.constructionId,
        binding: entry.binding,
        line: JSON.stringify({ id: 999, method: "echo", params: { sequence: 999 } }),
      });
    await expect(late(bindings[0])).rejects.toThrow();
    expect(sequence).toBe(2);

    failingId = await create("wire-failure-create");
    await send(failingId, "wire-failure-send");
    await failureObserved.promise;
    expect(bindings).toHaveLength(3);
    await expect(late(bindings[2])).rejects.toThrow();
    expect(processes.has(failingId)).toBe(true);

    heldId = await create("wire-held-create");
    await send(heldId, "wire-held-send");
    await vi.waitFor(() => expect(bindings).toHaveLength(4), { timeout: 10_000 });
    close = engine.close();
    void close.catch(() => {});
    await shutdownStopEntered.promise;
    await expect(late(bindings[3])).rejects.toThrow();
    expect(processes.has(heldId)).toBe(true);
    releaseMain.resolve();
    releaseShutdownStop.resolve();
    await expect(close).rejects.toThrow();
  } finally {
    releaseMain.resolve();
    releaseShutdownStop.resolve();
    await (close ?? engine.close()).catch(() => {});
    await backend.close();
    releaseBridge();
    await store.close();
    expect(
      directory.startsWith(base) && directory.includes("bycoda-engine-run-wire-"),
      "Unsafe test cleanup",
    ).toBe(true);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
