import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  HostRunHttpTargets,
  type HostHttpRunSource,
  type HostHttpResponse,
} from "./run-http-targets";
import type { HostRunHandle } from "../src/integrations/harness/core/hostRun";

// Registry protocol fixtures: real private registry and canonical filesystem,
// synthetic SDK replies. They do not establish a daemon/kernel or SDK ACK.
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture(sessionCapacity = 8) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-http-target-")));
  directories.push(directory);
  const baseUrl = "http://127.0.0.1:34817",
    registry = new HostRunHttpTargets(8, sessionCapacity);
  const run = Object.freeze({}) as HostRunHandle;
  const scope: HostHttpRunSource = Object.freeze({
    sessionId: "logical",
    cwd: directory,
    auxiliary: false,
    identity: Object.freeze({}),
  });
  const hint = { baseUrl, directory };
  let current = true;
  const slot = registry.reserveOrigin();
  registry.publishChild(slot, baseUrl, {
    owner: {},
    constructionId: randomUUID(),
    scope,
    assertCurrent: () => {
      if (!current) throw new Error("original child retired");
    },
  });
  const request = (method: string, path: string, body?: unknown) => ({
    method,
    url: `${baseUrl}${path}?directory=${encodeURIComponent(directory)}`,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const proof = (id: string, actualDirectory = directory): HostHttpResponse => ({
    status: 200,
    body: JSON.stringify({ id, directory: actualDirectory }),
  });
  const uncertain: unknown[] = [];
  const prepare = async (
    binding: Awaited<ReturnType<typeof registry.bind>>,
    method: string,
    path: string,
    body?: unknown,
    pinned?: string,
  ) =>
    registry.prepare(
      binding,
      run,
      scope,
      { ...hint, providerSessionId: pinned },
      request(method, path, body),
      async (url) => proof(decodeURIComponent(new URL(url).pathname.split("/").at(-1)!)),
      () => {},
      (error) => uncertain.push(error),
    );
  const bind = (pinned?: string) =>
    registry.bind(registry.capture(baseUrl), run, scope, { ...hint, providerSessionId: pinned });
  const create = async () => {
    const binding = await bind();
    const work = await prepare(binding, "POST", "/session");
    await work.complete(proof("session_1"));
    return binding;
  };
  return {
    directory,
    baseUrl,
    registry,
    run,
    scope,
    hint,
    request,
    proof,
    uncertain,
    prepare,
    bind,
    create,
    retire: () => {
      current = false;
    },
  };
}

it("requires an actual private origin and refuses a recycled same-port target captured by an old view", async () => {
  const f = fixture(),
    binding = await f.create();
  expect(() => f.registry.capture("http://127.0.0.1:34818")).toThrow(/no original backend source/);
  f.retire();
  const slot = f.registry.reserveOrigin(),
    nextScope = { ...f.scope, identity: Object.freeze({}) };
  f.registry.publishChild(slot, f.baseUrl, {
    owner: {},
    constructionId: randomUUID(),
    scope: nextScope,
    assertCurrent: () => {},
  });
  await expect(f.prepare(binding, "POST", "/session/session_1/prompt_async")).rejects.toThrow(
    /original child retired/,
  );
  const nextRun = Object.freeze({}) as HostRunHandle;
  const fresh = await f.registry.bind(f.registry.capture(f.baseUrl), nextRun, nextScope, f.hint);
  const positive = await f.registry.prepare(
    fresh,
    nextRun,
    nextScope,
    f.hint,
    f.request("POST", "/session"),
    async () => {
      throw new Error("unexpected read");
    },
    () => {},
    () => {},
  );
  await positive.complete(f.proof("session_fresh"));
});

it("reserves unknown creation capacity before another effect and keeps actual rejection distinct", async () => {
  const f = fixture(1),
    binding = await f.bind();
  const unknown = await f.prepare(binding, "POST", "/session");
  unknown.fail(new Error("actual connection outcome lost"));
  await expect(f.prepare(binding, "POST", "/session")).rejects.toThrow(/capacity is full/);
  const g = fixture(1),
    original = await g.create();
  const work = await g.prepare(original, "POST", "/session/session_1/abort");
  await work.complete({ status: 204, body: "" });
  expect(original).toBeDefined();
  expect(g.uncertain).toEqual([]);
});

it("uses actual GET directory proof and preserves only the creator's fork/move workflow", async () => {
  const f = fixture(),
    oldDirectory = join(f.directory, "old");
  mkdirSync(oldDirectory);
  const binding = await f.bind();
  const read = await f.registry.prepare(
    binding,
    f.run,
    f.scope,
    f.hint,
    f.request("GET", "/api/session/old"),
    async () => {
      throw new Error("unexpected verification");
    },
    () => {},
    () => {},
  );
  await read.complete({
    status: 200,
    body: JSON.stringify({ data: { id: "old", location: { directory: oldDirectory } } }),
  });
  await expect(f.prepare(binding, "POST", "/api/session/old/prompt")).rejects.toThrow(
    /directory proof/,
  );
  const fork = await f.prepare(binding, "POST", "/api/session/old/fork");
  await fork.complete(f.proof("forked", oldDirectory));
  const moved = await f.registry.prepare(
    binding,
    f.run,
    f.scope,
    f.hint,
    f.request("POST", "/api/session/forked/move", { directory: f.directory }),
    async () => f.proof("forked"),
    () => {},
    () => {},
  );
  await moved.complete({ status: 204, body: "" });
  const pinned = await f.bind("forked"),
    prompt = await f.prepare(pinned, "POST", "/api/session/forked/prompt", undefined, "forked");
  await prompt.complete({ status: 204, body: "" });
});

it("allows only known original cleanup and never lets A regain a session claimed by B", async () => {
  const f = fixture();
  await f.create();
  const control = Object.freeze({}) as HostRunHandle,
    controlScope = { ...f.scope, control: true };
  const hint = { ...f.hint, providerSessionId: "session_1" };
  const cleanup = await f.registry.bind(f.registry.capture(f.baseUrl), control, controlScope, hint);
  await expect(
    f.registry.prepare(
      cleanup,
      control,
      controlScope,
      hint,
      f.request("POST", "/session/session_1/prompt_async"),
      async () => {
        throw new Error("no verification");
      },
      () => {},
      () => {},
    ),
  ).rejects.toThrow(/Cleanup may only/);
  const abort = await f.registry.prepare(
    cleanup,
    control,
    controlScope,
    hint,
    f.request("POST", "/session/session_1/abort"),
    async () => {
      throw new Error("no verification");
    },
    () => {},
    () => {},
  );
  await abort.complete({ status: 204, body: "" });
  const b = Object.freeze({}) as HostRunHandle,
    bScope = { ...f.scope, identity: Object.freeze({}) };
  const next = await f.registry.bind(f.registry.capture(f.baseUrl), b, bScope, hint);
  await expect(
    f.registry.prepare(
      cleanup,
      control,
      controlScope,
      hint,
      f.request("DELETE", "/session/session_1"),
      async () => {
        throw new Error("no verification");
      },
      () => {},
      () => {},
    ),
  ).rejects.toThrow(/Cleanup may only/);
  const positive = await f.registry.prepare(
    next,
    b,
    bScope,
    hint,
    f.request("POST", "/session/session_1/prompt_async"),
    async () => {
      throw new Error("no verification");
    },
    () => {},
    () => {},
  );
  await positive.complete({ status: 204, body: "" });
});

it("revalidates the captured external service CLI source without claiming physical daemon ownership", async () => {
  const f = fixture(),
    registry = new HostRunHttpTargets();
  let valid = true,
    checks = 0;
  registry.publishService(registry.reserveOrigin(), f.baseUrl, {
    owner: {},
    key: "actual-validated-cli",
    validate: async () => {
      checks++;
      if (!valid) throw new Error("captured service changed");
    },
  });
  const binding = await registry.bind(registry.capture(f.baseUrl), f.run, f.scope, f.hint);
  const request = await registry.prepare(
    binding,
    f.run,
    f.scope,
    f.hint,
    f.request("POST", "/session"),
    async () => {
      throw new Error("no read");
    },
    () => {},
    () => {},
  );
  await request.complete(f.proof("external_1"));
  valid = false;
  await expect(
    registry.prepare(
      binding,
      f.run,
      f.scope,
      f.hint,
      f.request("GET", "/session/external_1"),
      async () => f.proof("external_1"),
      () => {},
      () => {},
    ),
  ).rejects.toThrow(/captured service changed/);
  expect(checks).toBe(2);
});
