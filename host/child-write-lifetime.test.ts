import { expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ProviderChild } from "./provider-child";
import { HostChildBackend } from "./child-backend";
import {
  acquireHarnessBridge,
  configureChildBackend,
  createChildProcessHandle,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../src/integrations/harness/core/child";
import { JsonRpcClient } from "../src/integrations/harness/core/jsonRpc";

const guardModes = [
  { label: "legacy guard", bundle: undefined as string | undefined },
  ...(process.env.BYCODA_TEST_PROVIDER_GUARDIAN_BUNDLE
    ? [{ label: "native guardian", bundle: process.env.BYCODA_TEST_PROVIDER_GUARDIAN_BUNDLE }]
    : []),
];

it.each(guardModes)(
  "$label keeps real Host callback and close work after the actual RPC waiter times out",
  async ({ bundle }) => {
    // Actual child/core/RPC/Host composition; the held Writable callback is the
    // explicit fault boundary. This does not attest the provider's descendants.
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "bycoda-write-lifetime-")));
    const provider = join(directory, "provider.cjs");
    writeFileSync(
      provider,
      `console.log('ready');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>console.log(JSON.stringify({seen:line})));
setInterval(()=>{},1000);`,
    );
    const backend = new HostChildBackend({}, undefined, bundle);
    configureChildBackend(backend);
    const release = await acquireHarnessBridge();
    const process = createChildProcessHandle("actual-host-write-lifetime");
    const rpc = new JsonRpcClient(process, {}, { label: "bound-host-lifetime" });
    const unrelated = createChildProcessHandle("unrelated-to-held-write");
    const otherRpc = new JsonRpcClient(unrelated, {});
    const otherLines: string[] = [];
    const lines: string[] = [];
    watchChild(
      process,
      (line) => {
        lines.push(line);
        rpc.pushLine(line);
      },
      () => rpc.close(),
    );
    watchChild(
      unrelated,
      (line) => otherLines.push(line),
      () => otherRpc.close(),
    );
    let finishWrite: ((error?: Error | null) => void) | undefined;
    let callbackWrite: Promise<void> | undefined;
    let writeOutcome: Promise<unknown> | undefined;
    let closing: Promise<void> | undefined;
    let restoreWrite: (() => void) | undefined;
    try {
      await spawnChild(process, provider, [], directory);
      await vi.waitFor(() => expect(lines).toContain("ready"), { timeout: 5000 });
      await rpc.notify("fixture/ping", { value: 1 });
      await vi.waitFor(
        () => expect(lines.some((line) => line.includes("fixture/ping"))).toBe(true),
        {
          timeout: 5000,
        },
      );
      const child = (backend as unknown as { children: Map<string, ProviderChild> }).children.get(
        process.sessionId,
      )!;
      const guardClosed = new Promise<void>((done) => child.once("close", () => done()));
      let physicalDeadline: (() => void) | undefined;
      let callerDeadline: (() => void) | undefined;
      const originalSetTimeout = globalThis.setTimeout;
      const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => {
        // Host physical stdin deadline (PROVIDER_WRITE_TIMEOUT_MS) and JsonRpc caller deadline.
        if (delay === 90_000) physicalDeadline = () => callback(...args);
        if (delay === 15_000) callerDeadline = () => callback(...args);
        return originalSetTimeout(callback, delay, ...args);
      }) as typeof setTimeout);
      const write = vi.spyOn(child.stdin, "write").mockImplementation(((
        _line: unknown,
        callback: (error?: Error | null) => void,
      ) => {
        finishWrite = callback;
        return true;
      }) as typeof child.stdin.write);
      restoreWrite = () => write.mockRestore();
      let actualSettled = false;
      let closeSettled = false;
      let waiter: Promise<unknown>;
      try {
        waiter = rpc
          .respond(17, { approved: true }, (actual) => {
            callbackWrite = actual;
            writeOutcome = actual.then(
              () => {
                actualSettled = true;
                return undefined;
              },
              (error: unknown) => {
                actualSettled = true;
                return error;
              },
            );
          })
          .catch((error: unknown) => error);
      } finally {
        timer.mockRestore();
      }
      expect(callbackWrite).toBeDefined();
      expect(physicalDeadline).toBeTypeOf("function");
      expect(callerDeadline).toBeTypeOf("function");
      expect(finishWrite).toBeTypeOf("function");
      physicalDeadline!();
      callerDeadline!();
      expect(await waiter!).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("write timed out"),
        }),
      );
      // A held original does not serialize execution on an unrelated route.
      await spawnChild(unrelated, provider, [], directory);
      await otherRpc.notify("fixture/unrelated", { value: 2 });
      await vi.waitFor(
        () => expect(otherLines.some((line) => line.includes("fixture/unrelated"))).toBe(true),
        { timeout: 5000 },
      );
      closing = backend.close().then(() => {
        closeSettled = true;
      });
      await guardClosed;
      // Even actual leader/stdio close cannot invent a missing accepted callback.
      expect(actualSettled).toBe(false);
      expect(closeSettled).toBe(false);
      expect(write).toHaveBeenCalledOnce();
      expect(String(write.mock.calls[0][0])).toContain('"id":17');
      finishWrite!();
      expect(await writeOutcome).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("stdin write timed out"),
        }),
      );
      await closing;
      expect(closeSettled).toBe(true);
      expect(write).toHaveBeenCalledOnce();
    } finally {
      finishWrite?.();
      await writeOutcome;
      restoreWrite?.();
      rpc.close();
      otherRpc.close();
      unwatchChild(process);
      unwatchChild(unrelated);
      release();
      await (closing ?? backend.close());
      // Release schedules the real zero-delay bridge teardown. Let that owner
      // finish before the next parameterized backend is installed.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const target = resolve(directory);
      expect(
        dirname(target) === realpathSync(tmpdir()) &&
          basename(target).startsWith("bycoda-write-lifetime-"),
        "Unexpected write lifetime fixture directory",
      ).toBe(true);
      rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
