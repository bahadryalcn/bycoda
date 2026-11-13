import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationSecretTools, type SecretDesktopPort } from "./conversation-secret-tools";
import { SecretStore, type SecretValueStore } from "./secret-store";
import type { RuntimeLogPrincipal } from "../execution/runtime-log-tools";

const VALUE = "synthetic-owner-typed-value-9c2e";
const dirs: string[] = [];
const stores: SecretStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

const principal = (sessionId = "s1"): RuntimeLogPrincipal => ({
  kind: "session",
  projectId: "p1",
  sessionId,
  provider: "test",
});

type Answer = { cancelled: true } | { value: string } | unknown;

function desktopFixture(answers: Answer[] = [{ value: VALUE }]) {
  const calls: { input: Record<string, unknown>; cwd: string; sessionId: string }[] = [];
  const queue = [...answers];
  const desktop: SecretDesktopPort = {
    async call(_action, input, cwd, actor, authorized) {
      calls.push({ input, cwd, sessionId: actor.sessionId });
      await authorized();
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { desktop, calls };
}

function fixture(answers?: Answer[]) {
  const cwd = mkdtempSync(join(tmpdir(), "secret-tools-cwd-"));
  dirs.push(cwd);
  const directory = mkdtempSync(join(tmpdir(), "secret-tools-test-"));
  dirs.push(directory);
  const map = new Map<string, string>();
  const values: SecretValueStore = {
    async get(ref) {
      return map.get(ref);
    },
    async set(ref, value) {
      map.set(ref, value);
    },
    async delete(ref) {
      map.delete(ref);
    },
  };
  const secrets = new SecretStore({
    directory,
    values,
    now: () => 1_000_000,
    restrict: async () => {},
    restrictDirectory: async () => {},
  });
  stores.push(secrets);
  const { desktop, calls } = desktopFixture(answers);
  const store = {
    async project(id: string) {
      return { id, cwd: id === "p1" ? cwd : "C:/work/project" } as never;
    },
    async session(id: string) {
      return { id, projectId: id === "other" ? "p2" : "p1", session: {} } as never;
    },
  };
  const tools = new ConversationSecretTools(store as never, desktop, secrets);
  const allowed = () => true;
  const request = (overrides: Record<string, unknown> = {}, actor = principal()) =>
    tools.call(
      "secrets.request",
      { requestId: "req-1", name: "NPM_TOKEN", purpose: "publish", ...overrides },
      actor,
      allowed,
    );
  return { tools, secrets, map, calls, directory, request, allowed, cwd };
}

describe("ConversationSecretTools", () => {
  it("uses the session resolver for desktop-only conversations", async () => {
    const f = fixture();
    const hostSession = vi.fn(async () => {
      throw new Error("Session not found on this machine");
    });
    const session = vi.fn(async (id: string) => ({ id, projectId: "p1" }) as never);
    const tools = new ConversationSecretTools(
      { project: async () => ({ id: "p1", cwd: f.cwd }) as never, session: hostSession },
      desktopFixture().desktop,
      f.secrets,
      session,
    );
    const actor = principal("native-only");
    const result = (await tools.call(
      "secrets.request",
      { requestId: "native-request", name: "GIT_TOKEN", purpose: "Git access" },
      actor,
      f.allowed,
    )) as { secretRef: string };
    expect(result.secretRef).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain(VALUE);
    await expect(tools.call("secrets.list", {}, actor, f.allowed)).resolves.toEqual({
      secrets: [expect.objectContaining({ secretRef: result.secretRef })],
    });
    await expect(
      tools.call("secrets.materialize", { secretRef: result.secretRef }, actor, f.allowed),
    ).resolves.toMatchObject({ path: expect.any(String) });
    await expect(
      tools.call("secrets.revoke", { secretRef: result.secretRef }, actor, f.allowed),
    ).resolves.toMatchObject({ revoked: true });
    expect(session).toHaveBeenCalledWith("native-only");
    expect(hostSession).not.toHaveBeenCalled();
  });

  it("rejects foreign or missing resolved sessions before prompting or reading secrets", async () => {
    const f = fixture();
    const { desktop, calls } = desktopFixture();
    const session = vi.fn(async () => ({ projectId: "p2" }) as never);
    const tools = new ConversationSecretTools(
      { project: async () => ({ id: "p1", cwd: f.cwd }) as never, session },
      desktop,
      f.secrets,
      session,
    );
    await expect(
      tools.call(
        "secrets.request",
        { requestId: "r", name: "GIT_TOKEN", purpose: "Git" },
        principal(),
        f.allowed,
      ),
    ).rejects.toThrow("Session belongs to another project.");
    session.mockRejectedValueOnce(new Error("Session not found on this machine"));
    await expect(tools.call("secrets.list", {}, principal(), f.allowed)).rejects.toThrow(
      "Session not found on this machine",
    );
    expect(calls).toHaveLength(0);
    expect(f.map.size).toBe(0);
  });

  it("returns only a ref, name and expiry, and never the value", async () => {
    const { request, map, calls } = fixture();
    const result = (await request()) as { secretRef: string; name: string; expiresAt: number };
    expect(Object.keys(result).sort()).toEqual(["expiresAt", "name", "secretRef"]);
    expect(result.name).toBe("NPM_TOKEN");
    expect(result.expiresAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain(VALUE);
    expect(map.get(result.secretRef)).toBe(VALUE);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ sessionId: "s1" });
    expect(calls[0]?.input).toEqual({ name: "NPM_TOKEN", purpose: "publish" });
  });

  it("replays the earlier result for the same requestId without prompting again", async () => {
    const { request, calls } = fixture();
    const first = await request();
    const second = await request();
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("shares one prompt between concurrent duplicates", async () => {
    const { request, calls } = fixture();
    const [a, b] = await Promise.all([request(), request()]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });

  it("rejects a reused requestId for a different request", async () => {
    const { request, calls } = fixture();
    await request();
    await expect(request({ name: "OTHER" })).rejects.toThrow("already used");
    expect(calls).toHaveLength(1);
  });

  it("records a cancellation and replays it without prompting", async () => {
    const { request, calls, map } = fixture([{ cancelled: true }]);
    expect(await request()).toEqual({ cancelled: true });
    expect(await request()).toEqual({ cancelled: true });
    expect(calls).toHaveLength(1);
    expect(map.size).toBe(0);
  });

  it("reuses a live secret by name across sessions without prompting", async () => {
    const { request, calls } = fixture([{ value: VALUE }, { value: "second-value" }]);
    const first = (await request({}, principal("s1"))) as { secretRef: string };
    const again = await request({ requestId: "req-2", name: " npm_token " }, principal("s2"));
    expect(again).toEqual({
      secretRef: first.secretRef,
      name: "NPM_TOKEN",
      expiresAt: null,
      reused: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("replace prompts again, swaps the secret on save and keeps the old one on cancel", async () => {
    const { request, calls, map, tools } = fixture([
      { value: VALUE },
      { cancelled: true },
      { value: "second-value" },
    ]);
    const first = (await request()) as { secretRef: string };
    expect(await request({ requestId: "req-2", replace: true })).toEqual({ cancelled: true });
    expect(map.has(first.secretRef)).toBe(true);
    const swapped = (await request({ requestId: "req-3", replace: true })) as {
      secretRef: string;
      reused?: boolean;
    };
    expect(calls).toHaveLength(3);
    expect(swapped.reused).toBeUndefined();
    expect(swapped.secretRef).not.toBe(first.secretRef);
    expect(map.has(first.secretRef)).toBe(false);
    expect(map.get(swapped.secretRef)).toBe("second-value");
    const listed = (await tools.call("secrets.list", {}, principal(), () => true)) as {
      secrets: unknown[];
    };
    expect(listed.secrets).toHaveLength(1);
  });

  it("honours an explicit ttlMinutes", async () => {
    const { request } = fixture();
    const result = (await request({ ttlMinutes: 5 })) as { expiresAt: number };
    expect(result.expiresAt).toBe(1_000_000 + 5 * 60_000);
  });

  it("shares refs across sessions of a project and refuses other projects", async () => {
    const { request, tools } = fixture();
    const mine = (await request({}, principal("s1"))) as { secretRef: string };
    const allowed = () => true;
    await expect(
      tools.call("secrets.materialize", { secretRef: mine.secretRef }, principal("s2"), allowed),
    ).resolves.toMatchObject({ path: expect.any(String) });
    expect(await tools.call("secrets.list", {}, principal("s2"), allowed)).toEqual({
      secrets: [expect.objectContaining({ secretRef: mine.secretRef })],
    });
    const foreign: RuntimeLogPrincipal = { ...principal("other"), projectId: "p2" };
    const forbidden = new ConversationSecretTools(
      {
        project: async (id: string) => ({ id, cwd: "C:/x" }) as never,
        session: async (id: string) => ({ id, projectId: "p2", session: {} }) as never,
      } as never,
      desktopFixture().desktop,
      (tools as unknown as { secrets: SecretStore }).secrets,
    );
    await expect(
      forbidden.call("secrets.materialize", { secretRef: mine.secretRef }, foreign, allowed),
    ).rejects.toThrow("not available in this project");
    await expect(
      forbidden.call("secrets.revoke", { secretRef: mine.secretRef }, foreign, allowed),
    ).rejects.toThrow("not available in this project");
    await expect(
      forbidden.call(
        "secrets.run",
        { command: "echo hi", env: { TOKEN: mine.secretRef } },
        foreign,
        allowed,
      ),
    ).rejects.toThrow("not available in this project");
  });

  it("refuses a session that belongs to another project", async () => {
    const { request } = fixture();
    await expect(request({}, principal("other"))).rejects.toThrow("another project");
  });

  it("materializes the value into a file path and revoke deletes both", async () => {
    const { request, tools, map } = fixture();
    const { secretRef } = (await request()) as { secretRef: string };
    const allowed = () => true;
    const materialized = (await tools.call(
      "secrets.materialize",
      { secretRef },
      principal(),
      allowed,
    )) as { path: string; expiresAt: number };
    expect(readFileSync(materialized.path, "utf8")).toBe(VALUE);
    expect(materialized).not.toHaveProperty("value");
    expect(await tools.call("secrets.revoke", { secretRef }, principal(), allowed)).toEqual({
      revoked: true,
      secretRef,
    });
    expect(map.has(secretRef)).toBe(false);
    expect(() => readFileSync(materialized.path, "utf8")).toThrow();
  });

  it("stores nothing when authority is revoked while the owner is answering", async () => {
    const { tools, map, calls } = fixture([{ value: VALUE }]);
    let active = true;
    const revoking: SecretDesktopPort = {
      async call(_action, input, cwd, actor) {
        calls.push({ input, cwd, sessionId: actor.sessionId });
        active = false;
        return { value: VALUE };
      },
    };
    const guarded = new ConversationSecretTools(
      {
        project: async () => ({ id: "p1", cwd: "C:/work" }) as never,
        session: async () => ({ id: "s1", projectId: "p1", session: {} }) as never,
      } as never,
      revoking,
      (tools as unknown as { secrets: SecretStore }).secrets,
    );
    await expect(
      guarded.call(
        "secrets.request",
        { requestId: "req-9", name: "A", purpose: "b" },
        principal(),
        () => active,
      ),
    ).rejects.toThrow("revoked");
    expect(map.size).toBe(0);
  });

  it("refuses malformed owner answers without echoing them", async () => {
    for (const answer of [
      { value: VALUE, extra: true },
      { value: "" },
      { value: 42 },
      { value: VALUE.repeat(1000) },
      ["not", "an", "object", VALUE],
      { cancelled: false, value: VALUE },
    ]) {
      const { request, map } = fixture([answer]);
      const error = await request().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).not.toContain(VALUE);
      expect(map.size).toBe(0);
    }
  });

  it("keeps the value out of relay failures", async () => {
    const { request, map } = fixture([new Error(`relay said ${VALUE}`)]);
    const error = await request().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(map.size).toBe(0);
  });

  it("rejects invalid inputs at the trust boundary", async () => {
    const { tools, allowed } = fixture();
    await expect(
      tools.call(
        "secrets.request",
        { requestId: "bad id", name: "A", purpose: "b" },
        principal(),
        allowed,
      ),
    ).rejects.toThrow("Invalid requestId");
    await expect(
      tools.call(
        "secrets.request",
        { requestId: "ok", name: "x\u0000y", purpose: "b" },
        principal(),
        allowed,
      ),
    ).rejects.toThrow("Invalid name");
    await expect(
      tools.call(
        "secrets.request",
        { requestId: "ok", name: "A", purpose: "b", ttlMinutes: 9999 },
        principal(),
        allowed,
      ),
    ).rejects.toThrow("Invalid ttlMinutes");
    await expect(
      tools.call("secrets.materialize", { secretRef: "../escape" }, principal(), allowed),
    ).rejects.toThrow("Invalid secretRef");
  });

  describe("secrets.run", () => {
    const node = (script: string) => `node -e "${script}"`;

    async function ready(answers?: Answer[]) {
      const f = fixture(answers);
      const { secretRef } = (await f.request()) as { secretRef: string };
      const run = (input: Record<string, unknown>) =>
        f.tools.call("secrets.run", input, principal("s2"), f.allowed) as Promise<{
          exitCode: number | null;
          signal?: string;
          timedOut: boolean;
          stdout: string;
          stderr: string;
          truncated: boolean;
        }>;
      return { ...f, secretRef, run };
    }

    it("injects the value into the command env and redacts it from the output", async () => {
      const { run, secretRef } = await ready();
      const result = await run({
        command: node(
          "process.stdout.write('t=' + process.env.TOKEN); process.stderr.write(process.env.TOKEN)",
        ),
        env: { TOKEN: secretRef },
      });
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, truncated: false });
      expect(result.stdout).toBe("t=[secret:NPM_TOKEN]");
      expect(result.stderr).toBe("[secret:NPM_TOKEN]");
      expect(JSON.stringify(result)).not.toContain(VALUE);
    });

    it("runs in the project directory and reports the exit code", async () => {
      const { run, secretRef, cwd } = await ready();
      const result = await run({
        command: node("process.stdout.write(process.cwd()); process.exit(3)"),
        env: { TOKEN: secretRef },
      });
      expect(result.exitCode).toBe(3);
      expect(realpathSync.native(result.stdout)).toBe(realpathSync.native(cwd));
    });

    it("redacts other live secrets of the project too", async () => {
      const f = fixture([{ value: VALUE }, { value: "second-secret-xyz" }]);
      const a = (await f.request()) as { secretRef: string };
      await f.request({ requestId: "req-2", name: "OTHER" });
      const result = (await f.tools.call(
        "secrets.run",
        {
          command: node("process.stdout.write('second-secret-xyz')"),
          env: { TOKEN: a.secretRef },
        },
        principal(),
        f.allowed,
      )) as { stdout: string };
      expect(result.stdout).toBe("[secret:OTHER]");
    });

    it("kills the command at the deadline", async () => {
      const { run, secretRef } = await ready();
      const result = await run({
        command: node("setInterval(() => {}, 1000)"),
        env: { TOKEN: secretRef },
        timeoutSeconds: 1,
      });
      expect(result.timedOut).toBe(true);
    }, 15_000);

    it("bounds output and flags truncation", async () => {
      const { run, secretRef } = await ready();
      const result = await run({
        command: node("process.stdout.write('a'.repeat(300000))"),
        env: { TOKEN: secretRef },
      });
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64 * 1024);
    });

    it("rejects invalid env names, unknown refs and bad input without running", async () => {
      const { run, secretRef, tools, allowed } = await ready();
      await expect(run({ command: "echo hi", env: { "bad-name": secretRef } })).rejects.toThrow(
        "Invalid env name",
      );
      await expect(run({ command: "echo hi", env: { lower: secretRef } })).rejects.toThrow(
        "Invalid env name",
      );
      await expect(run({ command: "echo hi", env: { TOKEN: "sec_unknown" } })).rejects.toThrow(
        "not available in this project",
      );
      await expect(run({ command: "echo hi", env: {} })).rejects.toThrow("Invalid env");
      await expect(run({ command: "", env: { TOKEN: secretRef } })).rejects.toThrow(
        "Invalid command",
      );
      await expect(run({ command: "a\u0000b", env: { TOKEN: secretRef } })).rejects.toThrow(
        "Invalid command",
      );
      await expect(
        run({ command: "echo hi", env: { TOKEN: secretRef }, timeoutSeconds: 101 }),
      ).rejects.toThrow("Invalid timeoutSeconds");
      const tooMany = Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`V${index}`, secretRef]),
      );
      await expect(run({ command: "echo hi", env: tooMany })).rejects.toThrow("Invalid env");
      await expect(
        tools.call(
          "secrets.run",
          { command: "echo hi", env: { TOKEN: secretRef } },
          principal(),
          () => false,
        ),
      ).rejects.toThrow("revoked");
      void allowed;
    });
  });

  it("redacts live project secrets from any value and leaves other projects alone", async () => {
    const { request, tools } = fixture();
    await request();
    expect(await tools.redact("p1", { text: `x ${VALUE} y`, n: 1 })).toEqual({
      text: "x [secret:NPM_TOKEN] y",
      n: 1,
    });
    const untouched = { text: VALUE };
    expect(await tools.redact("p2", untouched)).toBe(untouched);
  });

  it("returns the value as is when the vault cannot be read for redaction", async () => {
    const { request, tools, secrets } = fixture();
    await request();
    secrets.liveValues = async () => {
      throw new Error("vault down");
    };
    expect(await tools.redact("p1", "plain")).toBe("plain");
  });

  it("lists and revokes for the owner without a session", async () => {
    const { request, tools, map } = fixture();
    const { secretRef } = (await request()) as { secretRef: string };
    const all = await tools.ownerList();
    expect(all).toEqual([expect.objectContaining({ secretRef, projectId: "p1", expiresAt: null })]);
    expect(JSON.stringify(all)).not.toContain(VALUE);
    await tools.ownerRevoke(secretRef);
    expect(map.has(secretRef)).toBe(false);
  });
});
