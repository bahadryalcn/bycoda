import { expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, renameSync } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostChildBackend } from "./child-backend";
import { ProviderConstructions } from "./provider-constructions";
import { ProviderProcessLifecycle } from "./provider-process-lifecycle";
import { HostRunWriters } from "./run-writers";
import type { HostRunHandle, HostRunBinding } from "../src/integrations/harness/core/hostRun";
import { REMOTE_PROVIDERS } from "../src/features/connections/model/protocol";
import type { SocialService } from "./social/social";
import { PROVIDER_STDERR_LINE_BYTES } from "./provider-lines";
import {
  requireHarnessProcessReceipt,
  type HarnessProcessReceipt,
} from "../src/shared/model/harnessProcess";

function startupGate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function constructionFixture(runWriters?: HostRunWriters) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-child-construction-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(
    file,
    `const label=process.argv[2];
console.log(JSON.stringify({ready:label}));
console.error(JSON.stringify({ready:label}));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>console.log(JSON.stringify({label,line})));
setInterval(()=>{},1000);`,
  );
  const backend = new HostChildBackend({}, undefined, undefined, runWriters);
  const sessionId = "same-physical-slot";
  const output: Array<{
    stream: "stdout" | "stderr";
    sessionId: string;
    constructionId: string;
    line: string;
  }> = [];
  const exits: Array<{ sessionId: string; constructionId: string; pid: number }> = [];
  const stateWaiters = new Set<() => void>();
  const changed = () => {
    for (const check of Array.from(stateWaiters)) check();
  };
  const waitForState = (ready: () => boolean) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (!ready()) return;
        stateWaiters.delete(check);
        resolve();
      };
      stateWaiters.add(check);
      check();
    });
  const unlisten = await Promise.all([
    ...(["stdout", "stderr"] as const).map((stream) =>
      backend.listen<{ sessionId: string; constructionId: string; line: string }>(
        `harness-${stream}`,
        ({ payload }) => {
          output.push({ stream, ...payload });
          changed();
        },
      ),
    ),
    backend.listen<{ sessionId: string; constructionId: string; pid: number }>(
      "harness-exit",
      ({ payload }) => {
        exits.push(payload);
        changed();
      },
    ),
  ]);
  const internal = backend as unknown as {
    children: Map<string, ChildProcessWithoutNullStreams>;
  };
  const launch = async (label: string, hostRun?: HostRunHandle, physicalId = sessionId) => {
    const receipt = requireHarnessProcessReceipt(
      await backend.invoke<unknown>("harness_spawn", {
        sessionId: physicalId,
        command: file,
        args: [label],
        cwd: directory,
        ...(hostRun ? { hostRun } : {}),
      }),
      physicalId,
      "host",
    );
    await waitForState(() =>
      ["stdout", "stderr"].every((stream) =>
        output.some(
          (event) =>
            event.stream === stream &&
            event.sessionId === physicalId &&
            event.constructionId === receipt.constructionId &&
            event.line === JSON.stringify({ ready: label }),
        ),
      ),
    );
    return receipt;
  };
  const echo = async (receipt: HarnessProcessReceipt, label: string) => {
    const line = `accepted-${label}`;
    await backend.invoke("harness_write", {
      sessionId,
      constructionId: receipt.constructionId,
      line,
    });
    await waitForState(() =>
      output.some(
        (event) =>
          event.stream === "stdout" &&
          event.sessionId === sessionId &&
          event.constructionId === receipt.constructionId &&
          event.line === JSON.stringify({ label, line }),
      ),
    );
  };
  return {
    backend,
    directory,
    file,
    sessionId,
    internal,
    output,
    exits,
    launch,
    echo,
    waitForState,
    async close() {
      for (const release of unlisten) release();
      await backend.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

async function hostRunScope(
  writers: HostRunWriters,
  cwd: string,
  logicalSessionId = "logical-main",
  validateAuthority?: () => Promise<void>,
) {
  const run = writers.reserve({
    owner: {},
    sessionId: logicalSessionId,
    runId: `actual-${logicalSessionId}`,
    isCurrent: () => true,
    validateAuthority,
  });
  await writers.setExecutionCwd(run, cwd);
  return run;
}

it("binds actual Host runs to one warm physical child and refuses old, copied and wrong construction scopes", async () => {
  const writers = new HostRunWriters(),
    f = await constructionFixture(writers);
  try {
    const a = await hostRunScope(writers, f.directory),
      process = await f.launch("P", a);
    const original = f.internal.children.get(f.sessionId)!;
    const args = { sessionId: f.sessionId, constructionId: process.constructionId };
    const aBinding = await f.backend.invoke<HostRunBinding>("harness_bind_host_run", {
      ...args,
      hostRun: a,
    });
    await f.backend.invoke("harness_write_host_run", {
      ...args,
      binding: aBinding,
      line: "actual-A",
    });
    await writers.finish(a);
    const b = await hostRunScope(writers, f.directory);
    const bBinding = await f.backend.invoke<HostRunBinding>("harness_bind_host_run", {
      ...args,
      hostRun: b,
    });
    await expect(
      f.backend.invoke("harness_write_host_run", { ...args, binding: aBinding, line: "late-A" }),
    ).rejects.toThrow(/closed/);
    await expect(
      f.backend.invoke("harness_write_host_run", {
        ...args,
        binding: Object.freeze({}),
        line: "copied",
      }),
    ).rejects.toThrow(/original Host run binding/);
    await expect(
      f.backend.invoke("harness_write_host_run", {
        ...args,
        constructionId: "00000000-0000-4000-8000-000000000000",
        binding: bBinding,
        line: "wrong-construction",
      }),
    ).rejects.toThrow(/receipt|identity/);
    await f.backend.invoke("harness_write_host_run", {
      ...args,
      binding: bBinding,
      line: "actual-B",
    });
    await f.waitForState(() =>
      f.output.some((event) => event.line === JSON.stringify({ label: "P", line: "actual-B" })),
    );
    expect(f.internal.children.get(f.sessionId)).toBe(original);
    expect(f.output.some((event) => /late-A|copied|wrong-construction/.test(event.line))).toBe(
      false,
    );
    await writers.finish(b);
  } finally {
    await f.close();
  }
});

it.each([false, true])(
  "retains actual Host stdin callback across warm B binding and finish; failure=%s",
  async (fail) => {
    const writers = new HostRunWriters(),
      f = await constructionFixture(writers);
    const entered = startupGate<void>(),
      bValidated = startupGate<void>();
    let finishWrite: ((error?: Error | null) => void) | undefined;
    let writing: Promise<unknown> | undefined,
      endingA: Promise<unknown> | undefined,
      bindingB: Promise<unknown> | undefined;
    const failure = new Error("original real child callback failed");
    try {
      const a = await hostRunScope(writers, f.directory),
        process = await f.launch("P", a);
      const original = f.internal.children.get(f.sessionId)!;
      const args = { sessionId: f.sessionId, constructionId: process.constructionId };
      const aBinding = await f.backend.invoke<HostRunBinding>("harness_bind_host_run", {
        ...args,
        hostRun: a,
      });
      const hold = vi.spyOn(original.stdin, "write").mockImplementation(((
        _line: unknown,
        callback: (error?: Error | null) => void,
      ) => {
        finishWrite = callback;
        entered.resolve();
        return true;
      }) as typeof original.stdin.write);
      try {
        writing = f.backend
          .invoke("harness_write_host_run", { ...args, binding: aBinding, line: "held-A" })
          .catch((error: unknown) => error);
        await entered.promise;
      } finally {
        hold.mockRestore();
      }
      let aEnded = false,
        bBound = false;
      endingA = writers.finish(a).then(
        () => {
          aEnded = true;
        },
        (error: unknown) => {
          aEnded = true;
          return error;
        },
      );
      const b = await hostRunScope(writers, f.directory, "logical-main", async () => {
        bValidated.resolve();
      });
      bindingB = f.backend
        .invoke<HostRunBinding>("harness_bind_host_run", { ...args, hostRun: b })
        .then(
          (binding) => {
            bBound = true;
            return binding;
          },
          (error: unknown) => error,
        );
      await bValidated.promise;
      // A genuinely unrelated strict child can write and produce output while the
      // actual original callback keeps both A finish and warm B admission held.
      const sibling = await hostRunScope(writers, f.directory, "logical-sibling");
      const q = await f.launch("S", sibling, "independent-physical-slot");
      const qArgs = { sessionId: q.sessionId, constructionId: q.constructionId };
      const qBinding = await f.backend.invoke<HostRunBinding>("harness_bind_host_run", {
        ...qArgs,
        hostRun: sibling,
      });
      await f.backend.invoke("harness_write_host_run", {
        ...qArgs,
        binding: qBinding,
        line: "sibling-positive",
      });
      await f.waitForState(() =>
        f.output.some(
          (event) =>
            event.sessionId === q.sessionId &&
            event.line === JSON.stringify({ label: "S", line: "sibling-positive" }),
        ),
      );
      expect(aEnded).toBe(false);
      expect(bBound).toBe(false);
      finishWrite!(fail ? failure : undefined);
      if (fail) {
        expect(await writing).toBe(failure);
        expect(await endingA).toBeInstanceOf(AggregateError);
        expect(await bindingB).toBeInstanceOf(AggregateError);
        await expect(writers.finish(b)).resolves.toBeUndefined();
      } else {
        await writing;
        await endingA;
        const binding = await bindingB;
        await f.backend.invoke("harness_write_host_run", {
          ...args,
          binding,
          line: "B-after-real-callback",
        });
        await f.waitForState(() =>
          f.output.some(
            (event) => event.line === JSON.stringify({ label: "P", line: "B-after-real-callback" }),
          ),
        );
        await writers.finish(b);
      }
      await writers.finish(sibling);
      expect(f.internal.children.get(f.sessionId)).toBe(original);
    } finally {
      finishWrite?.();
      await Promise.allSettled([writing, endingA, bindingB]);
      await f.close();
    }
  },
);

it("refuses a foreign or mismatched-cwd Host spawn before retiring the real running original", async () => {
  const writers = new HostRunWriters(),
    f = await constructionFixture(writers);
  try {
    const a = await hostRunScope(writers, f.directory),
      process = await f.launch("A", a);
    const original = f.internal.children.get(f.sessionId)!;
    await expect(f.launch("forged", Object.freeze({}) as HostRunHandle)).rejects.toThrow(
      /original Host run handle/,
    );
    const other = join(f.directory, "different-cwd");
    mkdirSync(other);
    const b = await hostRunScope(writers, other);
    await expect(f.launch("wrong-cwd", b)).rejects.toThrow(/execution directory/);
    expect(f.internal.children.get(f.sessionId)).toBe(original);
    expect(f.exits).toHaveLength(0);
    const binding = await f.backend.invoke<HostRunBinding>("harness_bind_host_run", {
      sessionId: f.sessionId,
      constructionId: process.constructionId,
      hostRun: a,
    });
    await f.backend.invoke("harness_write_host_run", {
      sessionId: f.sessionId,
      constructionId: process.constructionId,
      binding,
      line: "A-preserved",
    });
    await f.waitForState(() =>
      f.output.some((event) => event.line === JSON.stringify({ label: "A", line: "A-preserved" })),
    );
    await writers.finish(a);
    await expect(writers.finish(b)).resolves.toBeUndefined();
  } finally {
    await f.close();
  }
});

it("reserves Host process capacity before touching A and never upgrades an uncontrolled birth", async () => {
  const writers = new HostRunWriters({ maxBindingsPerRun: 1 }),
    f = await constructionFixture(writers);
  try {
    const a = await hostRunScope(writers, f.directory),
      process = await f.launch("A", a);
    const original = f.internal.children.get(f.sessionId)!;
    await expect(f.launch("over-capacity", a)).rejects.toThrow(/reservation capacity/);
    expect(f.internal.children.get(f.sessionId)).toBe(original);
    expect(f.exits).toEqual([]);
    const binding = await f.backend.invoke<HostRunBinding>("harness_bind_host_run", {
      sessionId: f.sessionId,
      constructionId: process.constructionId,
      hostRun: a,
    });
    await f.backend.invoke("harness_write_host_run", {
      sessionId: f.sessionId,
      constructionId: process.constructionId,
      binding,
      line: "A-after-capacity-refusal",
    });
    await f.waitForState(() =>
      f.output.some(
        (event) => event.line === JSON.stringify({ label: "A", line: "A-after-capacity-refusal" }),
      ),
    );
    await writers.finish(a);
    const raw = await f.launch("raw", undefined, "helper-physical-slot");
    const b = await hostRunScope(writers, f.directory);
    await expect(
      f.backend.invoke("harness_bind_host_run", {
        sessionId: raw.sessionId,
        constructionId: raw.constructionId,
        hostRun: b,
      }),
    ).rejects.toThrow(/does not match/);
    await f.backend.invoke("harness_write", {
      sessionId: raw.sessionId,
      constructionId: raw.constructionId,
      line: "explicit-unqualified-helper",
    });
    await f.waitForState(() =>
      f.output.some(
        (event) =>
          event.sessionId === raw.sessionId &&
          event.line === JSON.stringify({ label: "raw", line: "explicit-unqualified-helper" }),
      ),
    );
    await writers.finish(b);
  } finally {
    await f.close();
  }
});

it("invalidates an original Host launch while its authority preflight is held and admits a later fresh source", async () => {
  const writers = new HostRunWriters(),
    f = await constructionFixture(writers);
  const entered = startupGate<void>(),
    release = startupGate<void>();
  const a = await hostRunScope(writers, f.directory, "logical-main", async () => {
    entered.resolve();
    await release.promise;
  });
  const launch = f.launch("cancelled-before-start", a);
  const outcome = launch.catch((error: unknown) => error);
  try {
    await entered.promise;
    await f.backend.kill(f.sessionId);
    release.resolve();
    expect(String(await outcome)).toContain("startup cancelled");
    expect(f.output).toEqual([]);
    expect(f.internal.children.has(f.sessionId)).toBe(false);
    await expect(writers.finish(a)).resolves.toBeUndefined();
    const b = await hostRunScope(writers, f.directory),
      process = await f.launch("fresh", b);
    const binding = await f.backend.invoke<HostRunBinding>("harness_bind_host_run", {
      sessionId: f.sessionId,
      constructionId: process.constructionId,
      hostRun: b,
    });
    await f.backend.invoke("harness_write_host_run", {
      sessionId: f.sessionId,
      constructionId: process.constructionId,
      binding,
      line: "fresh-positive",
    });
    await f.waitForState(() =>
      f.output.some(
        (event) => event.line === JSON.stringify({ label: "fresh", line: "fresh-positive" }),
      ),
    );
    await writers.finish(b);
  } finally {
    release.resolve();
    await outcome;
    await f.close();
  }
});

it("charges actual scoped HTTP body completion and keeps original abort/delete available after normal close", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-scoped-http-")),
    file = join(directory, "opencode.cjs");
  writeFileSync(
    file,
    `const http=require('node:http');let held;const server=http.createServer((req,res)=>{
const path=new URL(req.url,'http://localhost').pathname;console.log(JSON.stringify({method:req.method,path}));
if(req.method==='POST'&&path==='/session'){res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'actual_session',directory:process.cwd()}));return;}
if(path==='/session/actual_session/prompt_async'){res.writeHead(200,{'content-type':'application/json'});res.write('{"accepted":');held=res;console.log('actual-body-held');return;}
if(path==='/session/actual_session/abort'){if(held){held.end('true}');held=undefined;}res.writeHead(204);res.end();return;}
if(req.method==='DELETE'){res.writeHead(204);res.end();return;}
res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'actual_session',directory:process.cwd()}));
});server.listen(0,'127.0.0.1',()=>console.log('opencode server listening on http://127.0.0.1:'+server.address().port));`,
  );
  const writers = new HostRunWriters(),
    backend = new HostChildBackend({}, undefined, undefined, writers);
  const ready = startupGate<string>(),
    bodyHeld = startupGate<void>();
  const lines: string[] = [];
  const unlisten = await backend.listen<{ line: string }>("harness-stdout", ({ payload }) => {
    lines.push(payload.line);
    const match = /listening on (http:\/\/[^\s]+)/.exec(payload.line);
    if (match) ready.resolve(match[1]);
    if (payload.line === "actual-body-held") bodyHeld.resolve();
  });
  let pending: Promise<unknown> | undefined;
  try {
    const run = await hostRunScope(writers, directory),
      control = writers.controlRun(run);
    await backend.invoke("harness_spawn", {
      sessionId: "actual-http-process",
      command: file,
      args: [],
      cwd: directory,
      binaryProvider: "opencode",
      hostRun: run,
    });
    const baseUrl = await ready.promise,
      hint = { baseUrl, directory };
    const bootstrap = await backend.invoke<HostRunBinding>("harness_bind_http_host_run", {
      hostRun: run,
      httpSource: hint,
    });
    const url = (path: string) => `${baseUrl}${path}?directory=${encodeURIComponent(directory)}`;
    await backend.invoke("harness_http_host_run", {
      hostRun: run,
      binding: bootstrap,
      httpSource: hint,
      url: url("/session"),
      method: "POST",
      body: "{}",
    });
    const pinned = { ...hint, providerSessionId: "actual_session" };
    const normal = await backend.invoke<HostRunBinding>("harness_bind_http_host_run", {
      hostRun: run,
      httpSource: pinned,
    });
    let settled = false;
    pending = backend
      .invoke("harness_http_host_run", {
        hostRun: run,
        binding: normal,
        httpSource: pinned,
        url: url("/session/actual_session/prompt_async"),
        method: "POST",
        body: "{}",
      })
      .then((response) => {
        settled = true;
        return response;
      });
    await bodyHeld.promise;
    expect(settled).toBe(false);
    writers.closeAdmission(run);
    await expect(
      backend.invoke("harness_http_host_run", {
        hostRun: run,
        binding: normal,
        httpSource: pinned,
        url: url("/session/actual_session/prompt_async"),
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow(/closed/);
    const cleanup = await backend.invoke<HostRunBinding>("harness_bind_http_host_run", {
      hostRun: control,
      httpSource: pinned,
    });
    await backend.invoke("harness_http_host_run", {
      hostRun: control,
      binding: cleanup,
      httpSource: pinned,
      url: url("/session/actual_session/abort"),
      method: "POST",
    });
    expect(await pending).toEqual({ status: 200, body: '{"accepted":true}' });
    await backend.invoke("harness_http_host_run", {
      hostRun: control,
      binding: cleanup,
      httpSource: pinned,
      url: url("/session/actual_session"),
      method: "DELETE",
    });
    expect(
      lines.filter(
        (line) =>
          line === JSON.stringify({ method: "POST", path: "/session/actual_session/prompt_async" }),
      ),
    ).toHaveLength(1);
    await writers.finish(run);
  } finally {
    unlisten();
    await backend.close();
    await Promise.allSettled([pending]);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("refuses process receipt exhaustion before retiring the still-running original", async () => {
  const f = await constructionFixture();
  const lifecycle = (f.backend as unknown as { processLifecycles: ProviderProcessLifecycle })
    .processLifecycles;
  Object.defineProperty(f.backend, "constructions", {
    value: new ProviderConstructions((child) => lifecycle.completion(child), 1),
  });
  try {
    const a = await f.launch("A");
    await expect(f.launch("B")).rejects.toThrow("receipts are full");
    expect(f.internal.children.get(f.sessionId)?.pid).toBe(a.pid);
    await f.echo(a, "A");
    expect(f.exits).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it("requires original write identity and drains a historical real child without signaling its replacement", async () => {
  const f = await constructionFixture();
  try {
    const original = await f.launch("A");
    const replacement = await f.launch("B");
    expect(Object.keys(replacement).sort()).toEqual([
      "backend",
      "constructionId",
      "pid",
      "sessionId",
      "version",
    ]);
    expect(Object.isFrozen(replacement)).toBe(true);
    expect(replacement.constructionId).not.toBe(original.constructionId);
    const current = f.internal.children.get(f.sessionId)!;
    const writes = vi.spyOn(current.stdin, "write");
    const line = { toString: vi.fn(() => "must-not-be-rewritten-or-written") };
    const stale = [
      { sessionId: f.sessionId },
      { sessionId: f.sessionId, constructionId: replacement.pid },
      { sessionId: f.sessionId, constructionId: `${replacement.constructionId}\n` },
      { sessionId: "another-session", constructionId: replacement.constructionId },
      { sessionId: f.sessionId, constructionId: "11111111-1111-4111-8111-111111111111" },
    ];
    for (const args of stale) {
      await expect(f.backend.invoke("harness_write", { ...args, line })).rejects.toThrow(
        /identity/,
      );
      await expect(f.backend.invoke("harness_kill", args)).rejects.toThrow(/identity/);
    }
    await expect(
      f.backend.invoke("harness_write", {
        sessionId: f.sessionId,
        constructionId: original.constructionId,
        line,
      }),
    ).rejects.toThrow(/identity/);
    await expect(
      f.backend.invoke("harness_kill", {
        sessionId: f.sessionId,
        constructionId: original.constructionId,
      }),
    ).resolves.toBeUndefined();
    expect(line.toString).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(f.internal.children.get(f.sessionId)).toBe(current);
    expect(() => process.kill(replacement.pid, 0)).not.toThrow();
    writes.mockRestore();
    await f.echo(replacement, "B");
    await f.backend.invoke("harness_kill", {
      sessionId: f.sessionId,
      constructionId: replacement.constructionId,
    });
    await f.waitForState(() =>
      [original, replacement].every((receipt) =>
        f.exits.some(
          (event) =>
            event.sessionId === f.sessionId &&
            event.constructionId === receipt.constructionId &&
            event.pid === receipt.pid,
        ),
      ),
    );
    expect(f.internal.children.has(f.sessionId)).toBe(false);
  } finally {
    await f.close();
  }
});

it("does not let an old child's delayed overflow retire the replacement", async () => {
  const f = await constructionFixture();
  try {
    await f.launch("A");
    const oldChild = f.internal.children.get(f.sessionId)!;
    const replacement = await f.launch("B");
    const current = f.internal.children.get(f.sessionId)!;
    const adminKill = vi.spyOn(f.backend, "kill");
    // Exercise the installed callback on the actual old ChildProcess stream.
    oldChild.stderr.emit("data", "x".repeat(PROVIDER_STDERR_LINE_BYTES + 1));
    expect(adminKill).not.toHaveBeenCalled();
    expect(f.internal.children.get(f.sessionId)).toBe(current);
    await f.echo(replacement, "B");
    adminKill.mockRestore();
  } finally {
    await f.close();
  }
});

it.each(["callback", "close"] as const)(
  "keeps a timed-out original write and replacement pending until its %s and other physical obligation drain",
  async (first) => {
    const f = await constructionFixture();
    let finishWrite: ((error?: Error | null) => void) | undefined;
    let writeResult: Promise<{ error?: unknown }> | undefined;
    let replacementWork: Promise<HarnessProcessReceipt> | undefined;
    let releaseClose: (() => void) | undefined;
    let restoreClose = () => {};
    const lateFailure = new Error("fixture callback failed after close");
    try {
      const original = await f.launch("A");
      const oldChild = f.internal.children.get(f.sessionId)!;
      const emitted = oldChild.emit.bind(oldChild);
      const closeReady = startupGate<void>();
      let closeReleased = false;
      const close = vi.spyOn(oldChild, "emit").mockImplementation(((
        event: string | symbol,
        ...args: unknown[]
      ) => {
        if (event !== "close") return emitted(event, ...args);
        // Hold only the actual Node close emission, after the real fixture child
        // has finished. Exit/error flags alone must not discharge this obligation.
        releaseClose = () => {
          if (closeReleased) return;
          closeReleased = true;
          emitted(event, ...args);
        };
        closeReady.resolve();
        return true;
      }) as typeof oldChild.emit);
      restoreClose = () => close.mockRestore();
      let fireTimeout: (() => void) | undefined;
      const originalSetTimeout = globalThis.setTimeout;
      const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (delay === 90_000) fireTimeout = () => callback(...args);
        return originalSetTimeout(callback, delay, ...args);
      }) as typeof setTimeout);
      const write = vi.spyOn(oldChild.stdin, "write").mockImplementation(((
        _line: unknown,
        callback: (error?: Error | null) => void,
      ) => {
        finishWrite = callback;
        return true;
      }) as typeof oldChild.stdin.write);
      let settled = false;
      try {
        writeResult = f.backend
          .invoke("harness_write", {
            sessionId: f.sessionId,
            constructionId: original.constructionId,
            line: "held-original-write",
          })
          .then(
            () => {
              settled = true;
              return {};
            },
            (error: unknown) => {
              settled = true;
              return { error };
            },
          );
      } finally {
        timer.mockRestore();
        write.mockRestore();
      }
      expect(finishWrite).toBeTypeOf("function");
      expect(fireTimeout).toBeTypeOf("function");
      expect(settled).toBe(false);
      fireTimeout!();
      await closeReady.promise;
      expect(oldChild.exitCode !== null || oldChild.signalCode !== null).toBe(true);
      expect(f.internal.children.has(f.sessionId)).toBe(true);
      let replacementStarted = false;
      replacementWork = f.launch("B").then((receipt) => {
        replacementStarted = true;
        return receipt;
      });
      void replacementWork.catch(() => {});
      if (first === "callback") finishWrite!();
      else releaseClose!();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(replacementStarted).toBe(false);
      expect(f.internal.children.has(f.sessionId)).toBe(first === "callback");
      if (first === "callback") releaseClose!();
      else finishWrite!(lateFailure);
      restoreClose();
      const result = await writeResult;
      expect(result.error).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("stdin write timed out"),
        }),
      );
      if (first === "close") {
        expect(result.error).toBeInstanceOf(AggregateError);
        expect((result.error as AggregateError).errors).toContain(lateFailure);
      }
      const replacement = await replacementWork;
      expect(replacement.constructionId).not.toBe(original.constructionId);
      const current = f.internal.children.get(f.sessionId)!;
      expect(current.pid).toBe(replacement.pid);
      await f.echo(replacement, "B");
    } finally {
      finishWrite?.();
      releaseClose?.();
      restoreClose();
      await writeResult;
      await replacementWork?.catch(() => {});
      await f.close();
    }
  },
);

it("drains a removed original child's accepted callback during shared backend close", async () => {
  const f = await constructionFixture();
  let finishWrite: ((error?: Error | null) => void) | undefined;
  let writing: Promise<unknown> | undefined;
  let killing: Promise<unknown> | undefined;
  let closing: Promise<void> | undefined;
  try {
    const original = await f.launch("A");
    const child = f.internal.children.get(f.sessionId)!;
    const write = vi.spyOn(child.stdin, "write").mockImplementation(((
      _line: unknown,
      callback: (error?: Error | null) => void,
    ) => {
      finishWrite = callback;
      return true;
    }) as typeof child.stdin.write);
    let written = false;
    try {
      writing = f.backend
        .invoke("harness_write", {
          sessionId: f.sessionId,
          constructionId: original.constructionId,
          line: "accepted-before-retirement",
        })
        .then(() => {
          written = true;
        });
    } finally {
      write.mockRestore();
    }
    killing = f.backend.invoke("harness_kill", {
      sessionId: f.sessionId,
      constructionId: original.constructionId,
    });
    void killing.catch(() => {});
    await f.waitForState(() =>
      f.exits.some((event) => event.constructionId === original.constructionId),
    );
    expect(f.internal.children.has(f.sessionId)).toBe(false);
    expect(written).toBe(false);
    let closed = false;
    closing = f.backend.close();
    expect(f.backend.close()).toBe(closing);
    void closing.then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(written).toBe(false);
    finishWrite!();
    await writing;
    await killing;
    await closing;
    expect(written).toBe(true);
    expect(closed).toBe(true);
  } finally {
    finishWrite?.();
    await writing?.catch(() => {});
    await killing?.catch(() => {});
    await closing?.catch(() => {});
    await f.close();
  }
});

it.each(["callback error", "synchronous throw"] as const)(
  "reports an actual stdin %s and leaves a later explicit receipt write usable",
  async (kind) => {
    const f = await constructionFixture();
    const failure = new Error(`fixture ${kind}`);
    let finishWrite: ((error?: Error | null) => void) | undefined;
    let writing: Promise<unknown> | undefined;
    try {
      const original = await f.launch("A");
      const child = f.internal.children.get(f.sessionId)!;
      const write = vi.spyOn(child.stdin, "write").mockImplementation(((
        _line: unknown,
        callback: (error?: Error | null) => void,
      ) => {
        if (kind === "synchronous throw") throw failure;
        finishWrite = callback;
        return true;
      }) as typeof child.stdin.write);
      try {
        writing = f.backend.invoke("harness_write", {
          sessionId: f.sessionId,
          constructionId: original.constructionId,
          line: "failing-write",
        });
        const rejected = expect(writing).rejects.toBe(failure);
        if (kind === "callback error") {
          let settled = false;
          void writing.then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            },
          );
          child.stdin.emit("error", failure);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(settled).toBe(false);
          finishWrite!(failure);
        }
        await rejected;
      } finally {
        write.mockRestore();
      }
      expect(f.internal.children.get(f.sessionId)).toBe(child);
      await f.echo(original, "A");
    } finally {
      finishWrite?.(failure);
      await writing?.catch(() => {});
      await f.close();
    }
  },
);

it("invalidates a pending launch on per-ID kill and drains accepted preparation during close", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-cancel-start-"));
  const file = join(directory, "provider.cjs");
  const marker = join(directory, "started");
  writeFileSync(
    file,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started'); setInterval(()=>{},1000)`,
  );
  const entered = startupGate<void>(),
    release = startupGate<undefined>();
  const backend = new HostChildBackend();
  const issueSessionGrant = vi.fn(async () => ({ token: "fixture-local-token" }));
  backend.setSocialAccess(
    {
      store: { environmentId: "fixture" },
      issueSessionGrant,
      remoteAccess: async () => {
        entered.resolve();
        return release.promise;
      },
    } as unknown as SocialService,
    "http://127.0.0.1:1",
  );
  const laterGrant = vi.fn(async () => ({ token: "never-issued" }));
  backend.setConversationAccess({ issueSessionGrant: laterGrant } as never, "http://127.0.0.1:1");
  const launch = backend.invoke("harness_spawn", {
    sessionId: "pending",
    command: file,
    args: [],
    cwd: directory,
  });
  const rejected = expect(launch).rejects.toThrow(/startup cancelled|Host is stopping/);
  await entered.promise;
  await backend.kill("pending");
  let closed = false;
  const close = backend.close().then(() => {
    closed = true;
  });
  try {
    await expect(
      backend.invoke("harness_spawn", {
        sessionId: "later",
        command: file,
        args: [],
        cwd: directory,
      }),
    ).rejects.toThrow("Host is stopping");
    expect(closed).toBe(false);
    expect(existsSync(marker)).toBe(false);
  } finally {
    release.resolve(undefined);
    await rejected;
    await close;
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
  expect(issueSessionGrant).not.toHaveBeenCalled();
  expect(laterGrant).not.toHaveBeenCalled();
  expect(closed).toBe(true);
});

it("refuses a second start while the first grant preparation is held, then the first start completes once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-replace-start-"));
  const file = join(directory, "provider.cjs");
  const marker = join(directory, "started");
  writeFileSync(
    file,
    `require('node:fs').appendFileSync(${JSON.stringify(marker)},'started\\n'); console.log('ready'); setInterval(()=>{},1000)`,
  );
  const entered = startupGate<void>(),
    release = startupGate<{ token: string; endpoint: string; environmentId: string }>();
  const backend = new HostChildBackend();
  const current = {
    token: "fixture-new-token",
    endpoint: "http://127.0.0.1:1",
    environmentId: "fixture",
  };
  const remoteAccess = vi
    .fn()
    .mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    })
    .mockResolvedValue(current);
  backend.setSocialAccess({ remoteAccess } as unknown as SocialService, current.endpoint);
  const old = backend.invoke<HarnessProcessReceipt>("harness_spawn", {
    sessionId: "same",
    command: file,
    args: [],
    cwd: directory,
  });
  try {
    await entered.promise;
    await expect(
      backend.invoke<HarnessProcessReceipt>("harness_spawn", {
        sessionId: "same",
        command: file,
        args: [],
        cwd: directory,
      }),
    ).rejects.toThrow(/already starting/);
    release.resolve({ ...current, token: "fixture-old-token" });
    const receipt = await old;
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 5000 });
    expect(readFileSync(marker, "utf8")).toBe("started\n");
    const state = backend as unknown as {
      children: Map<string, { pid?: number }>;
    };
    expect(state.children.get("same")?.pid).toBe(receipt.pid);
    expect(() => process.kill(receipt.pid, 0)).not.toThrow();
  } finally {
    release.resolve({ ...current, token: "fixture-old-token" });
    await old.catch(() => undefined);
    await backend.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("shares close and joins accepted preparation before reporting a child-kill failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-close-start-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, "setInterval(()=>{},1000)");
  const entered = startupGate<void>(),
    release = startupGate<undefined>();
  const backend = new HostChildBackend();
  const remoteAccess = vi
    .fn()
    .mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    })
    .mockResolvedValue({
      token: "fixture-token",
      endpoint: "http://127.0.0.1:1",
      environmentId: "fixture",
    });
  backend.setSocialAccess({ remoteAccess } as unknown as SocialService, "http://127.0.0.1:1");
  const launch = backend.invoke("harness_spawn", {
    sessionId: "preparing",
    command: file,
    args: [],
    cwd: directory,
  });
  const rejected = expect(launch).rejects.toThrow("Host is stopping");
  await entered.promise;
  await backend.invoke("harness_spawn", {
    sessionId: "running",
    command: file,
    args: [],
    cwd: directory,
  });
  const failure = new Error("fixture child kill failed");
  const kill = vi.spyOn(backend, "kill").mockRejectedValueOnce(failure);
  const close = backend.close();
  const failed = expect(close).rejects.toMatchObject({ errors: [failure] });
  let finished = false;
  void close.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  try {
    expect(backend.close()).toBe(close);
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith("running"));
    expect(finished).toBe(false);
    release.resolve(undefined);
    await rejected;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    // A rejected stop request does not prove the still-live child was drained.
    // Explicitly finish the real original before close may report that failure.
    kill.mockRestore();
    await backend.kill("running");
    await failed;
    expect(finished).toBe(true);
  } finally {
    release.resolve(undefined);
    await rejected;
    kill.mockRestore();
    await backend.kill("running");
    await close.catch(() => undefined);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("discovers Social MCP for a resolved desktop session and numeric child suffix", async () => {
  const backend = new HostChildBackend();
  const issueSessionGrant = vi.fn(async (id: string) => {
    if (id !== "desktop-session") throw new Error("Unknown session");
    return {
      token: "private-social",
      expiresAt: Date.now() + 1000,
      scope: {
        sessionId: id,
        projectId: "project",
        provider: "codex",
        environmentId: "environment",
      },
    };
  });
  backend.setSocialAccess(
    { issueSessionGrant } as unknown as SocialService,
    "http://127.0.0.1:1234",
  );
  try {
    const bridge = await backend.invoke<{ mcpUrl: string }>("harness_social_bridge", {
      sessionId: "desktop-session#2",
    });
    expect(new URL(bridge.mcpUrl).hostname).toBe("127.0.0.1");
    expect(new URL(bridge.mcpUrl).pathname).toBe("/mcp/social");
    expect(new URL(bridge.mcpUrl).port).not.toBe("1234");
    expect(issueSessionGrant).toHaveBeenCalledWith("desktop-session");
    expect(await backend.invoke("harness_social_bridge", { sessionId: "unknown" })).toBeNull();
  } finally {
    await backend.close();
  }
});

it("reads bounded task output tails and rejects mismatched task paths", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-output-test-"));
  const tasks = join(directory, "tasks");
  mkdirSync(tasks);
  const path = join(tasks, "b1.output");
  writeFileSync(path, "x".repeat(40000) + "\nlast line\n");
  const backend = new HostChildBackend();
  try {
    const output = await backend.invoke<{ text: string; truncated: boolean }>(
      "harness_read_task_output",
      { path, taskId: "b1" },
    );
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(output.text)).toBe(32768);
    expect(output.text.endsWith("last line\n")).toBe(true);
    await expect(
      backend.invoke("harness_read_task_output", { path, taskId: "b2" }),
    ).rejects.toThrow("Invalid task output path");
    await expect(
      backend.invoke("harness_read_task_output", {
        path: join(directory, "b1.output"),
        taskId: "b1",
      }),
    ).rejects.toThrow("Invalid task output path");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("prepares a unique text-only workspace without project files", async () => {
  const backend = new HostChildBackend();
  const profile = "---\nname: bycoda-text\nexcludeDefaultComponents: true\n---\nReturn text.";
  const workspace = await backend.invoke<{ cwd: string; logPath: string }>(
    "harness_prepare_text_workspace",
    { content: profile },
  );
  try {
    expect(workspace.cwd.startsWith(join(tmpdir(), "bycoda-antigravity-text-"))).toBe(true);
    expect(readFileSync(join(workspace.cwd, ".agents", "agents", "bycoda-text.md"), "utf8")).toBe(
      profile,
    );
    expect(workspace.logPath).toBe(join(workspace.cwd, "agent.log"));
    await expect(
      backend.invoke("harness_prepare_text_workspace", { content: "x".repeat(20_001) }),
    ).rejects.toThrow("Invalid text agent");
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true });
  }
});

it("reclaims a finished text sandbox on later admission while retaining a live one", async () => {
  const writers = new HostRunWriters();
  const backend = new HostChildBackend({}, undefined, undefined, writers);
  const runs = [];
  const paths: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const run = writers.reserve({
        owner: {},
        sessionId: `text-${i}`,
        runId: `run-${i}`,
        isCurrent: () => true,
        auxiliary: true,
      });
      runs.push(run);
      await writers.setExecutionCwd(run, tmpdir());
      const workspace = await backend.invoke<{ cwd: string }>("harness_prepare_text_workspace", {
        content: "text",
        hostRun: run,
      });
      paths.push(workspace.cwd);
      if (i === 0) await writers.finish(run);
    }
    expect(existsSync(paths[0])).toBe(false);
    expect(existsSync(paths[1])).toBe(true);
  } finally {
    for (const path of paths) rmSync(path, { recursive: true, force: true });
  }
});

it("admits more than 512 sequential retired text sandboxes", async () => {
  const writers = new HostRunWriters();
  const backend = new HostChildBackend({}, undefined, undefined, writers);
  let last: string | undefined;
  try {
    for (let i = 0; i < 513; i++) {
      const run = writers.reserve({
        owner: {},
        sessionId: `text-capacity-${i}`,
        runId: `run-${i}`,
        isCurrent: () => true,
        auxiliary: true,
      });
      await writers.setExecutionCwd(run, tmpdir());
      const workspace = await backend.invoke<{ cwd: string }>("harness_prepare_text_workspace", {
        content: "text",
        hostRun: run,
      });
      if (last) expect(existsSync(last)).toBe(false);
      last = workspace.cwd;
      await writers.finish(run);
    }
  } finally {
    if (last) rmSync(last, { recursive: true, force: true });
  }
}, 60000);

it("retains a replaced sandbox path and retries after the original identity returns", async () => {
  const writers = new HostRunWriters();
  const backend = new HostChildBackend({}, undefined, undefined, writers);
  const paths: string[] = [];
  const create = async (index: number) => {
    const run = writers.reserve({
      owner: {},
      sessionId: `replace-${index}`,
      runId: `run-${index}`,
      isCurrent: () => true,
      auxiliary: true,
    });
    await writers.setExecutionCwd(run, tmpdir());
    const workspace = await backend.invoke<{ cwd: string }>("harness_prepare_text_workspace", {
      content: "text",
      hostRun: run,
    });
    paths.push(workspace.cwd);
    await writers.finish(run);
    return workspace.cwd;
  };
  let moved: string | undefined;
  try {
    const original = await create(0);
    moved = `${original}-moved`;
    renameSync(original, moved);
    mkdirSync(original);
    await create(1);
    expect(existsSync(original)).toBe(true);
    rmSync(original, { recursive: true });
    renameSync(moved, original);
    moved = undefined;
    await create(2);
    expect(existsSync(original)).toBe(false);
  } finally {
    for (const path of paths) rmSync(path, { recursive: true, force: true });
    if (moved) rmSync(moved, { recursive: true, force: true });
  }
});

it("retains a quarantined sandbox and revoked grant after deletion failure, then retries", async () => {
  const writers = new HostRunWriters();
  let fail = true;
  const remove = vi.fn(async (path: string) => {
    if (fail) throw new Error("injected removal failure");
    await import("node:fs/promises").then(({ rm }) => rm(path, { recursive: true }));
  });
  const backend = new HostChildBackend({}, undefined, undefined, writers, remove);
  const paths: string[] = [];
  const create = async (index: number) => {
    const run = writers.reserve({
      owner: {},
      sessionId: `retry-${index}`,
      runId: `run-${index}`,
      isCurrent: () => true,
      auxiliary: true,
    });
    await writers.setExecutionCwd(run, tmpdir());
    const workspace = await backend.invoke<{ cwd: string }>("harness_prepare_text_workspace", {
      content: "text",
      hostRun: run,
    });
    paths.push(workspace.cwd);
    await writers.finish(run);
    return workspace.cwd;
  };
  try {
    const first = await create(0);
    await create(1);
    const quarantined = remove.mock.calls[0][0];
    expect(existsSync(first)).toBe(false);
    expect(existsSync(quarantined)).toBe(true);
    const state = backend as unknown as {
      textWorkspaceSlots: Set<unknown>;
      textWorkspaces: Map<string, unknown>;
    };
    expect(state.textWorkspaceSlots.size).toBe(2);
    expect(state.textWorkspaces.size).toBe(2);
    const grant = state.textWorkspaces.values().next().value as object;
    const ledger = writers as unknown as { cwdGrants: WeakMap<object, { revoked: boolean }> };
    expect(ledger.cwdGrants.get(grant)?.revoked).toBe(true);
    fail = false;
    await create(2);
    expect(existsSync(quarantined)).toBe(false);
    expect(state.textWorkspaceSlots.size).toBe(1);
    expect(state.textWorkspaces.size).toBe(1);
  } finally {
    for (const path of paths) rmSync(path, { recursive: true, force: true });
    for (const [path] of remove.mock.calls) rmSync(path, { recursive: true, force: true });
  }
});

it.each([
  [process.platform === "win32" ? "agy.exe" : "agy", "stream-json"],
  ["agy_acp_server.par", "acp"],
])("detects Antigravity transport for %s", async (name, transport) => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-agy-transport-"));
  const binary = join(directory, name);
  writeFileSync(binary, "fixture");
  try {
    const backend = new HostChildBackend({ antigravity: binary });
    expect(await backend.invoke("harness_resolve_antigravity")).toMatchObject({ transport });
    expect(
      await new HostChildBackend().invoke("harness_resolve_configured", {
        provider: "antigravity",
        binaryPath: binary,
      }),
    ).toMatchObject({ path: binary, transport });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("validates configured binaries and reports a missing working directory by name", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-configured-binary-"));
  const wrong = join(directory, "not-codex.exe");
  writeFileSync(wrong, "fixture");
  const backend = new HostChildBackend({ codex: join(directory, "missing-codex") });
  try {
    await expect(backend.invoke("harness_resolve_codex")).rejects.toThrow(
      "Configured codex binary was not found",
    );
    await expect(
      backend.invoke("harness_resolve_configured", { provider: "codex", binaryPath: "codex" }),
    ).rejects.toThrow("must be an absolute path");
    await expect(
      backend.invoke("harness_resolve_configured", { provider: "codex", binaryPath: wrong }),
    ).rejects.toThrow("must be named codex");
    await expect(
      backend.invoke("harness_resolve_configured", { provider: "gemini", binaryPath: wrong }),
    ).rejects.toThrow("Unsupported provider: gemini");
    const missing = join(directory, "gone");
    await expect(
      backend.invoke("harness_spawn", {
        sessionId: "missing-cwd",
        command: process.execPath,
        args: ["-e", ""],
        cwd: missing,
      }),
    ).rejects.toThrow(`Working directory does not exist on this host: ${missing}`);
  } finally {
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each(["stdout", "stderr"])(
  "bridges large %s output with explicit overflow diagnostics",
  async (stream) => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-large-frame-"));
    const file = join(directory, "provider.cjs");
    writeFileSync(
      file,
      `
const output = process.${stream};
const frame = JSON.stringify({ id: 2, result: 'a'.repeat(9 * 1024 * 1024) }) + '\\n';
output.write(frame);
setInterval(() => {}, 1000);
`,
    );
    const backend = new HostChildBackend();
    const lines: string[] = [];
    const exits: Array<{ code: number | null; reason?: string }> = [];
    const unlisten = await backend.listen<{ line: string }>(`harness-${stream}`, ({ payload }) =>
      lines.push(payload.line),
    );
    const unlistenExit = await backend.listen<{
      code: number | null;
      reason?: string;
    }>("harness-exit", ({ payload }) => exits.push(payload));
    try {
      await backend.invoke("harness_spawn", {
        sessionId: "large",
        command: file,
        args: [],
        cwd: process.cwd(),
      });
      if (stream === "stdout") {
        await vi.waitFor(() => expect(lines).toHaveLength(1), {
          timeout: 5000,
        });
        expect(JSON.parse(lines[0]).result.length).toBe(9 * 1024 * 1024);
        expect(exits).toEqual([]);
        await backend.kill("large");
        await vi.waitFor(() => expect(exits).toHaveLength(1), {
          timeout: 5000,
        });
        expect(exits[0].reason).toBeUndefined();
      } else {
        await vi.waitFor(() => expect(exits).toHaveLength(1), {
          timeout: 5000,
        });
        expect(lines).toEqual([]);
        expect(exits[0].reason).toBe(
          "Provider stderr message exceeded the 8 MiB limit; bycoda host stopped the process.",
        );
      }
    } finally {
      unlisten();
      unlistenExit();
      await backend.close();
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);

it("resolves every provider and runs only allowed catalog commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-catalog-test-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, "console.log(JSON.stringify(process.argv.slice(2)))");
  const backend = new HostChildBackend(
    Object.fromEntries(REMOTE_PROVIDERS.map((provider) => [provider, file])),
  );
  try {
    for (const provider of REMOTE_PROVIDERS) {
      const resolved = await backend.invoke<{ path: string; args?: string[] }>(
        `harness_resolve_${provider}`,
      );
      expect(resolved.path).toBe(file);
      if (provider === "antigravity")
        expect(resolved.args).toEqual(process.platform === "linux" ? ["--uid="] : []);
    }
    const output = await backend.invoke<string>("harness_exec", {
      command: file,
      args: ["models", "--json"],
      binaryProvider: "fx",
      cwd: directory,
    });
    expect(JSON.parse(output)).toEqual(["models", "--json"]);
    const cleanupArgs = [
      "--no-auto-update",
      "sessions",
      "delete",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    const cleanupOutput = await backend.invoke<string>("harness_exec", {
      command: file,
      args: cleanupArgs,
      binaryProvider: "grok",
      cwd: directory,
    });
    expect(JSON.parse(cleanupOutput)).toEqual(cleanupArgs);
    await expect(
      backend.invoke("harness_exec", {
        command: file,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "fx",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
    for (const args of [
      ["service", "status"],
      ["service", "start"],
      ["service", "get", "password"],
    ]) {
      const serviceOutput = await backend.invoke<string>("harness_exec", {
        command: file,
        args,
        binaryProvider: "opencode",
        cwd: directory,
      });
      expect(JSON.parse(serviceOutput)).toEqual(args);
    }
    for (const [provider, args] of [
      ["fx", ["service", "start"]],
      ["opencode", ["service", "stop"]],
      ["opencode", ["service get", "password"]],
      ["opencode", ["service", "get", "password", "--json"]],
      ["opencode", ["models --json"]],
      ["cursor", cleanupArgs],
      ["grok", ["--no-auto-update", "sessions", "delete", "--all"]],
      ["grok", ["--no-auto-update", "sessions", "delete", "../sessions"]],
      ["grok", [...cleanupArgs, "--all"]],
    ] as const) {
      await expect(
        backend.invoke("harness_exec", {
          command: file,
          args,
          binaryProvider: provider,
        }),
      ).rejects.toThrow("Unsupported headless catalog command");
    }
    writeFileSync(join(directory, "note.txt"), "host-owned transcript");
    expect(
      await backend.invoke("harness_read_text_file", {
        path: join(directory, "note.txt"),
      }),
    ).toBe("host-owned transcript");
    const transcript = "x".repeat(1024 * 1024 + 1);
    writeFileSync(join(directory, "large-transcript.txt"), transcript);
    expect(
      await backend.invoke("harness_read_text_file", {
        path: join(directory, "large-transcript.txt"),
      }),
    ).toBe(transcript);
  } finally {
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("bridges OpenCode HTTP and event streams on loopback", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/event") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"type":"ready"}\n\n');
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  const backend = new HostChildBackend();
  const events: string[] = [];
  const unlisten = await backend.listen<{ data: string }>("harness-sse", ({ payload }) =>
    events.push(payload.data),
  );
  try {
    const base = `http://127.0.0.1:${address.port}`;
    expect(await backend.invoke("harness_http", { url: base, method: "GET" })).toEqual({
      status: 200,
      body: '{"ok":true}',
    });
    await backend.invoke("harness_sse_open", {
      sessionId: "fixture",
      url: `${base}/event`,
    });
    await vi.waitFor(() => expect(events).toEqual(['{"type":"ready"}']));
    await backend.invoke("harness_sse_close", { sessionId: "fixture" });
    await expect(
      backend.invoke("harness_http", {
        url: "https://example.com/",
        method: "GET",
      }),
    ).rejects.toThrow("localhost");
  } finally {
    unlisten();
    await backend.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("runs the resolved Claude version fallback in headless mode", async () => {
  const backend = new HostChildBackend({ claude: process.execPath });
  try {
    const version = await backend.invoke<string>("harness_exec", {
      command: process.execPath,
      args: ["--version"],
      binaryProvider: "claude",
      cwd: process.cwd(),
    });
    expect(version.trim()).toBe(process.version);
    await expect(
      backend.invoke("harness_exec", {
        command: process.execPath,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "claude",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
  } finally {
    await backend.close();
  }
});

it.each([false, true])(
  "stops a provider tree (ignores SIGTERM: %s)",
  async (stubborn) => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-provider-tree-"));
    const file = join(directory, "provider.cjs");
    writeFileSync(
      file,
      `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(`${stubborn ? "process.on('SIGTERM', () => {});" : ""} console.log('ready'); setInterval(() => {}, 1000)`)}], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', () => console.log(JSON.stringify({ child: child.pid })));
setInterval(() => {}, 1000);
`,
    );
    const backend = new HostChildBackend();
    let descendant: number | undefined;
    const stopListening = await backend.listen<{ line: string }>(
      "harness-stdout",
      ({ payload }) => {
        descendant = JSON.parse(payload.line).child;
      },
    );
    try {
      await backend.invoke("harness_spawn", {
        sessionId: "tree",
        command: file,
        args: [],
        cwd: directory,
      });
      await vi.waitFor(() => expect(descendant).toBeTruthy(), { timeout: 5000 });
      await backend.kill("tree");
      await vi.waitFor(() => expect(() => process.kill(descendant!, 0)).toThrow(), {
        timeout: 5000,
      });
    } finally {
      stopListening();
      await backend.close();
      if (descendant) {
        try {
          process.kill(descendant, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

it("stops a provider tree when its host pipe closes unexpectedly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-provider-crash-"));
  const treeFile = join(directory, "tree.json");
  const providerFile = join(directory, "provider.cjs");
  writeFileSync(
    providerFile,
    `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(treeFile)}, JSON.stringify({ provider: process.pid, descendant: descendant.pid }));
setInterval(() => {}, 1000);
`,
  );
  const guard = spawn(
    process.execPath,
    [resolve("build/host/provider-guard.mjs"), process.execPath, providerFile],
    {
      cwd: directory,
      stdio: ["pipe", "ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  let guardClosed = false;
  guard.once("close", () => {
    guardClosed = true;
  });
  let tree: { provider: number; descendant: number } | undefined;
  try {
    await vi.waitFor(() => expect(existsSync(treeFile)).toBe(true), { timeout: 5000 });
    tree = JSON.parse(readFileSync(treeFile, "utf8"));
    guard.stdio[3]?.destroy();
    await vi.waitFor(
      () => {
        expect(() => process.kill(tree!.provider, 0)).toThrow();
        expect(() => process.kill(tree!.descendant, 0)).toThrow();
      },
      { timeout: 5_000 },
    );
    // The guard's cwd keeps this directory locked on Windows until it exits.
    await vi.waitFor(() => expect(guardClosed).toBe(true), { timeout: 5_000 });
  } finally {
    guard.stdio[3]?.destroy();
    guard.kill("SIGKILL");
    for (const pid of [tree?.provider, tree?.descendant]) {
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* gone */
        }
    }
    await vi.waitFor(() => expect(guardClosed).toBe(true), { timeout: 5_000 });
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}, 10_000);
