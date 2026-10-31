import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { NativeGuardianChild } from "./provider-guardian";
import { ProviderProcessLifecycle } from "./provider-process-lifecycle";
import { HostChildBackend } from "./child-backend";
import { prepareProviderGuardian } from "./provider-guardian-deployment";
// @ts-expect-error Native packaging helpers are maintained executable JavaScript.
import {
  stageGuardianBundle,
  guardianSourceFingerprint,
} from "../scripts/build/provider-guardian.mjs";

const executable = process.env.BYCODA_TEST_PROVIDER_GUARDIAN;
const native = it.skipIf(!executable || process.platform !== "win32");
const active = new Set<NativeGuardianChild>();
afterEach(async () => {
  await Promise.allSettled([...active].map((child) => child.stop()));
  active.clear();
});

async function fixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-guardian-test-"));
  const script = join(directory, "provider.cjs");
  await writeFile(script, source);
  return { directory, script };
}
function launch(
  directory: string,
  script: string,
  beforeStart?: () => Promise<void>,
  commitStart?: () => void,
) {
  const child = new NativeGuardianChild(
    executable!,
    {
      command: process.execPath,
      args: [script],
      cwd: directory,
      env: { ...process.env },
    },
    beforeStart,
    commitStart,
  );
  active.add(child);
  child.stderr.resume();
  return child;
}
function closed(child: NativeGuardianChild): Promise<void> {
  return new Promise((resolve) => child.once("close", () => resolve()));
}
function collect(child: NativeGuardianChild): { output: () => Buffer; closed: Promise<void> } {
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  return { output: () => Buffer.concat(chunks), closed: closed(child) };
}
function write(child: NativeGuardianChild, value: Buffer): Promise<void> {
  return new Promise((resolve, reject) =>
    child.stdin.write(value, (error) => (error ? reject(error) : resolve())),
  );
}

native(
  "keeps framed control private while forwarding chunked real provider bytes and preserving exit",
  async () => {
    const { directory, script } = await fixture(`
    process.stdout.write('ready\\n');
    process.stdin.on('data', value => process.stdout.write(value));
  `);
    const child = launch(directory, script);
    const received = collect(child);
    await child.started;
    const input = Buffer.from(
      `{"kind":"settled","retirement":"verified"}\\n${"ü🙂".repeat(35_000)}\n`,
    );
    await write(child, input);
    // This waits for actual echoed bytes, independently of the private write ACK.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("provider echo deadline")), 10_000);
      const check = () => {
        if (received.output().includes(input)) {
          clearTimeout(timer);
          child.stdout.off("data", check);
          resolve();
        }
      };
      child.stdout.on("data", check);
      check();
    });
    expect(received.output().includes(input)).toBe(true);
    await child.stop();
    await received.closed;
    await expect(child.retirement).resolves.toBeUndefined();
  },
);

native(
  "preserves known natural stdout, stderr and exit without treating stdout JSON as control",
  async () => {
    const { directory, script } = await fixture(
      `process.stdout.write('{"kind":"settled"}\\n');process.stderr.write('diagnostic\\n');process.exitCode=7;`,
    );
    const child = launch(directory, script);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const received = collect(child);
    await child.started;
    await received.closed;
    expect(child.exitCode).toBe(7);
    expect(received.output().toString()).toBe('{"kind":"settled"}\n');
    expect(stderr).toBe("diagnostic\n");
    await expect(child.retirement).resolves.toBeUndefined();
  },
);

native("stops the original blocked writer while an unrelated owner can still write", async () => {
  const blocked = await fixture(`process.stdout.write('ready\\n');setInterval(()=>{},1000);`);
  const echo = await fixture(`process.stdin.on('data',value=>process.stdout.write(value));`);
  const first = launch(blocked.directory, blocked.script);
  collect(first);
  const second = launch(echo.directory, echo.script);
  const received = collect(second);
  await Promise.all([first.started, second.started]);
  let completed = false;
  const writing = write(first, Buffer.alloc(1024 * 1024, 97)).finally(() => {
    completed = true;
  });
  void writing.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 75));
  expect(completed).toBe(false);
  await first.stop();
  await expect(writing).rejects.toThrow();
  await first.retirement;
  await write(second, Buffer.from("sibling-continues\n"));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sibling echo deadline")), 10_000);
    const check = () => {
      if (received.output().includes(Buffer.from("sibling-continues"))) {
        clearTimeout(timer);
        second.stdout.off("data", check);
        resolve();
      }
    };
    second.stdout.on("data", check);
    check();
  });
  await second.stop();
});

native(
  "retains unknown original ownership after guardian loss and refuses repeated session drains",
  async () => {
    const { directory, script } = await fixture(`setInterval(()=>{},1000);`);
    const child = launch(directory, script);
    collect(child);
    const lifetimes = new ProviderProcessLifecycle();
    lifetimes.register("A", child, child.retirement);
    await child.started;
    const closing = closed(child);
    child.kill();
    await closing;
    await expect(child.retirement).rejects.toThrow();
    await expect(lifetimes.drainSession("A")).rejects.toThrow();
    await expect(lifetimes.drainSession("A")).rejects.toThrow();
    await expect(lifetimes.drainSession("B")).resolves.toBeUndefined();
  },
);

native("rechecks authority after readiness before any provider execution", async () => {
  const { directory, script } = await fixture(
    `require('node:fs').writeFileSync('effect','executed');`,
  );
  const child = launch(directory, script, async () => {
    throw new Error("original authority revoked");
  });
  const closing = closed(child);
  child.stdout.resume();
  await expect(child.started).rejects.toThrow("original authority revoked");
  await closing;
  await expect(readFile(join(directory, "effect"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(child.retirement).resolves.toBeUndefined();
});

native("refuses a superseded attempt in the microtask after async preparation", async () => {
  const { directory, script } = await fixture(
    `require('node:fs').writeFileSync('effect','obsolete-start');`,
  );
  let current = true;
  const child = launch(
    directory,
    script,
    async () => {
      queueMicrotask(() => {
        current = false;
      });
    },
    () => {
      if (!current) throw new Error("attempt superseded before commit");
    },
  );
  child.stdout.resume();
  const closing = closed(child);
  await expect(child.started).rejects.toThrow("attempt superseded before commit");
  await closing;
  await expect(readFile(join(directory, "effect"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(child.retirement).resolves.toBeUndefined();
});

native(
  "uses a validated immutable bundle through the actual Host backend and preserves construction gates",
  async () => {
    const { directory, script } = await fixture(
      `process.stdin.on('data',value=>process.stdout.write(value));`,
    );
    const bundle = join(directory, "bundle");
    await stageGuardianBundle(
      bundle,
      `${process.platform}-${process.arch}`,
      await readFile(executable!),
      await guardianSourceFingerprint(),
      null,
    );
    const backend = new HostChildBackend({}, join(directory, "attachments"), bundle);
    const lines: string[] = [];
    const unlisten = await backend.listen<{ line: string }>("harness-stdout", ({ payload }) =>
      lines.push(payload.line),
    );
    try {
      const receipt = await backend.invoke<{ constructionId: string }>("harness_spawn", {
        sessionId: "real",
        provider: "codex",
        command: process.execPath,
        args: [script],
        cwd: directory,
      });
      await expect(
        backend.invoke("harness_write", {
          sessionId: "real",
          constructionId: "00000000-0000-4000-8000-000000000000",
          line: "stale",
        }),
      ).rejects.toThrow();
      await backend.invoke("harness_write", {
        sessionId: "real",
        constructionId: receipt.constructionId,
        line: '{"valid":true}',
      });
      await vi.waitFor(() => expect(lines).toContain('{"valid":true}'), { timeout: 10_000 });
      await backend.invoke("harness_kill", {
        sessionId: "real",
        constructionId: receipt.constructionId,
      });
      const fresh = await backend.invoke<{ constructionId: string }>("harness_spawn", {
        sessionId: "real",
        provider: "codex",
        command: process.execPath,
        args: [script],
        cwd: directory,
      });
      expect(fresh.constructionId).not.toBe(receipt.constructionId);
      await expect(
        backend.invoke("harness_kill", {
          sessionId: "real",
          constructionId: receipt.constructionId,
        }),
      ).resolves.toBeUndefined();
      await backend.invoke("harness_write", {
        sessionId: "real",
        constructionId: fresh.constructionId,
        line: "replacement-still-live",
      });
    } finally {
      unlisten();
      await backend.close();
    }
  },
);

native(
  "keeps a lost guardian's original session blocked while another Host session still runs",
  async () => {
    const { directory, script } = await fixture(
      `process.stdin.on('data',value=>process.stdout.write(value));`,
    );
    const bundle = join(directory, "bundle");
    await stageGuardianBundle(
      bundle,
      `${process.platform}-${process.arch}`,
      await readFile(executable!),
      await guardianSourceFingerprint(),
      null,
    );
    const backend = new HostChildBackend({}, join(directory, "attachments"), bundle);
    const args = { provider: "codex", command: process.execPath, args: [script], cwd: directory };
    let released = false;
    try {
      await backend.invoke("harness_spawn", { sessionId: "lost", ...args });
      const owned = (
        backend as unknown as { children: Map<string, NativeGuardianChild> }
      ).children.get("lost")!;
      const closing = closed(owned);
      owned.kill();
      await closing;
      await expect(backend.invoke("harness_spawn", { sessionId: "lost", ...args })).rejects.toThrow(
        "did not complete successfully",
      );
      await expect(backend.invoke("harness_spawn", { sessionId: "lost", ...args })).rejects.toThrow(
        "did not complete successfully",
      );
      const sibling = await backend.invoke<{ constructionId: string }>("harness_spawn", {
        sessionId: "sibling",
        ...args,
      });
      await backend.invoke("harness_write", {
        sessionId: "sibling",
        constructionId: sibling.constructionId,
        line: "sibling-valid",
      });
      await backend.invoke("harness_kill", {
        sessionId: "sibling",
        constructionId: sibling.constructionId,
      });
      const shutdown = backend.close();
      released = true;
      await expect(shutdown).rejects.toThrow("could not drain every operation");
    } finally {
      if (!released) await backend.close().catch(() => {});
    }
  },
);

native("rejects changed declared metadata at the final synchronous spawn check", async () => {
  const { directory, script } = await fixture(
    `require('node:fs').writeFileSync('effect','should-not-run');`,
  );
  const bundle = join(directory, "bundle");
  await stageGuardianBundle(
    bundle,
    `${process.platform}-${process.arch}`,
    await readFile(executable!),
    await guardianSourceFingerprint(),
    null,
  );
  const prepared = await prepareProviderGuardian(bundle);
  expect(prepared).toBeDefined();
  try {
    await writeFile(join(bundle, "provider-guardian.json"), "{}\n");
    expect(() =>
      prepared!.spawn({
        command: process.execPath,
        args: [script],
        cwd: directory,
        env: { ...process.env },
      }),
    ).toThrow("installation is unavailable");
    await expect(readFile(join(directory, "effect"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await prepared?.dispose();
  }
});

it("warns and falls back to the plain guard for a declared invalid guardian, like a missing optional bundle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-guardian-invalid-"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(prepareProviderGuardian(directory)).resolves.toBeUndefined();
  await writeFile(join(directory, "provider-guardian.json"), "{}\n");
  await expect(prepareProviderGuardian(directory)).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
