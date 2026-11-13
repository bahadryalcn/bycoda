import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import {
  HostDesktopControl,
  type DesktopRunner,
  type DesktopControlPorts,
} from "./desktop-control-host";
import { isForbiddenDesktopShortcut } from "../../src/shared/model/host-contracts/desktop-control";
import { readDesktopPresence, WINDOWS_DESKTOP_PRESENCE_SCRIPT } from "./desktop-presence";

const cleanups: (() => Promise<void>)[] = [];
it("uses the pinned CLI namespace without unsupported trace flags or inherited agent routing", async () => {
  vi.stubEnv("AGENT_DESKTOP_HOME", "foreign-state");
  vi.stubEnv("AGENT_DESKTOP_SESSION", "foreign-session");
  vi.stubEnv("AGENT_DESKTOP_AGENT_ID", "foreign-agent");
  vi.stubEnv("AGENT_DESKTOP_INTERNAL_COMMAND_HOST", "1");
  vi.stubEnv("AGENT_DESKTOP_TRACE", "foreign-trace.jsonl");
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  try {
    const f = await setup({
      run: async (_binary, args, options) => {
        calls.push({ args, env: options.env });
        return args[2] === "list-apps"
          ? envelope("list-apps", { apps: [{ name: "Notepad", pid: 123 }] })
          : envelope("snapshot", {
              app: "Notepad",
              window: { id: "w-1" },
              snapshot_id: "s1",
              complete: true,
              tree: { ref_id: "@s1:e1" },
            });
      },
    });
    await f.configure();
    await f.snapshot();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.args[0]).toBe("--session");
      expect(call.args[1]).toMatch(/^bycoda-[a-f0-9-]+$/);
      expect(call.args).not.toContain("--no-trace");
      expect(call.args).not.toContain("--trace");
      expect(call.env.AGENT_DESKTOP_HOME).not.toBe("foreign-state");
      expect(call.env.AGENT_DESKTOP_SESSION).toBe(call.args[1]);
      expect(call.env.AGENT_DESKTOP_AGENT_ID).toBeUndefined();
      expect(call.env.AGENT_DESKTOP_INTERNAL_COMMAND_HOST).toBeUndefined();
      expect(call.env.AGENT_DESKTOP_TRACE).toBeUndefined();
    }
  } finally {
    vi.unstubAllEnvs();
  }
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const owner = { kind: "owner" as const, id: "owner" };
const agent = { kind: "assistant" as const, id: "voice-session" };
it("reads finite owner indicator state without hashing or executing a configured helper", async () => {
  const f = await setup();
  await f.configure();
  writeFileSync(f.binary, "Changed fixture binary; never executed");
  expect(await f.control.indicatorStatus(owner, async () => true)).toEqual({
    enabled: true,
    active: false,
    stopped: false,
  });
  expect(f.calls).toEqual([]);
  expect((await f.request({ op: "status" })).status?.verified).toBe(false);
  await expect(f.control.indicatorStatus(agent, async () => true)).rejects.toThrow();
  await expect(f.control.indicatorStatus(owner, async () => false)).rejects.toThrow("revoked");
});
it("launches only an owner-approved app headlessly and journals before dispatch without replay", async () => {
  let f: Awaited<ReturnType<typeof setup>>;
  let effects = 0;
  f = await setup({
    run: async (_binary, args) => {
      effects++;
      expect(args.slice(2)).toEqual(["launch", "--timeout", "10000", "--", "Notepad"]);
      const receipt = JSON.parse(
        (await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get())!.value,
      );
      expect(receipt.operation.state).toBe("unknown");
      expect(receipt.auditPending).toBe(true);
      return envelope("launch", {
        app: "Notepad",
        pid: 123,
        suggestion: "PRIVATE UNTRUSTED SUGGESTION",
      });
    },
  });
  await f.configure();
  await expect(
    f.request({ op: "launch", requestId: "outside", app: "Other" }, agent),
  ).rejects.toThrow("not approved");
  for (const field of ["args", "env", "cwd", "activate", "cdp", "force", "headed"])
    await expect(
      f.request({ op: "launch", requestId: "strict", app: "Notepad", [field]: true }, agent),
    ).rejects.toThrow();
  const input = { op: "launch", requestId: "launch-once", app: "Notepad" };
  const result = await f.request(input, agent);
  expect(result).toEqual({ operation: expect.objectContaining({ state: "settled", ok: true }) });
  await f.restart();
  expect(await f.request(input, agent)).toEqual(result);
  expect(effects).toBe(1);
  await expect(f.request({ ...input, app: "Other" }, agent)).rejects.toThrow("preserve");
  expect(
    (await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get())!.value,
  ).not.toContain("PRIVATE");
});
it.each(["get", "set", "clear"])(
  "denies clipboard %s even for direct owner or physical consent without exact sensitive approval",
  async (action) => {
    const f = await setup({ physicalGrant: async () => true });
    await f.configure();
    const input = {
      op: "clipboard",
      requestId: action,
      action,
      ...(action === "set" ? { text: "private" } : {}),
    };
    await expect(f.request(input)).rejects.toThrow("exact native owner approval");
    await expect(f.control.request(input, owner, undefined, async () => true)).rejects.toThrow(
      "exact native owner approval",
    );
    expect(f.calls).toHaveLength(0);
    expect(
      await f.store.db.prepare("SELECT count(*) AS count FROM desktop_control_receipts").get(),
    ).toMatchObject({ count: 0 });
  },
);
it("retires observed refs after an attempted launch or attach without granting fresh refs", async () => {
  const f = await setup();
  await f.configure();
  await f.snapshot();
  await f.request({ op: "launch", requestId: "attach", app: "Notepad" }, agent);
  await expect(
    f.request(
      { op: "act", requestId: "old-ref", snapshotId: "s1", ref: "@s1:e1", action: "click" },
      agent,
    ),
  ).rejects.toThrow("stale");
});
it("returns approved bounded text once, retaining only receipts/audit metadata through restart", async () => {
  const secret = 'Ayşe: "clipboard"\n--image=private';
  const audits: unknown[] = [];
  let reads = 0;
  const f = await setup({
    onOperation: async (event) => {
      audits.push(event);
    },
    run: async (_binary, args) => {
      expect(args.slice(2)).toEqual(["clipboard-get", "--format", "text"]);
      reads++;
      return envelope("clipboard-get", { type: "text", text: secret });
    },
  });
  await f.configure();
  const input = { op: "clipboard", requestId: "once", action: "get" };
  const result = await f.control.request(
    input,
    agent,
    async () => true,
    undefined,
    async () => true,
  );
  expect(result.clipboard).toEqual({ found: true, text: secret });
  await f.control.drainOperationAudits();
  const stored = (await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get())!
    .value;
  expect(stored).not.toContain('clipboard\\"');
  expect(stored).not.toContain("--image");
  expect(JSON.stringify(audits)).not.toContain(secret);
  expect(audits).toContainEqual(
    expect.objectContaining({
      app: "Global clipboard",
      action: "clipboard-get",
      operation: expect.objectContaining({ state: "settled" }),
    }),
  );
  await f.restart();
  expect(await f.control.request(input, agent)).toEqual({ operation: result.operation });
  expect(reads).toBe(1);
  await expect(f.control.request({ ...input, requestId: "new" }, agent)).rejects.toThrow(
    "exact native owner approval",
  );
});
it.each(["set", "clear"])(
  "dispatches clipboard %s with exact reviewed plain-text arguments and no persisted content",
  async (action) => {
    const f = await setup();
    await f.configure();
    const input = {
      op: "clipboard",
      requestId: action,
      action,
      ...(action === "set" ? { text: "--image=SECRET FILE\nsecond line" } : {}),
    };
    await f.control.request(
      input,
      agent,
      async () => true,
      undefined,
      async () => true,
    );
    expect(f.calls[0].slice(2)).toEqual(
      action === "set" ? ["clipboard-set", "--", input.text!] : ["clipboard-clear"],
    );
    expect(
      (await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get())!.value,
    ).not.toContain("SECRET FILE");
    expect(await f.request(input, agent)).toMatchObject({ operation: { state: "settled" } });
    expect(f.calls).toHaveLength(1);
  },
);
it("rejects clipboard channels and command/text mismatches before journal or native dispatch", async () => {
  const f = await setup();
  await f.configure();
  for (const input of [
    { action: "get", text: "unexpected" },
    { action: "clear", text: "" },
    { action: "set" },
    { action: "set", text: "NUL\0value" },
    { action: "set", text: "x".repeat(10001) },
    { action: "get", format: "image" },
    { action: "get", out: "secret.png" },
    { action: "set", image: "secret.png" },
    { action: "set", file_url: ["file"] },
    { action: "get", approved: true },
  ])
    await expect(
      f.control.request(
        { op: "clipboard", requestId: "invalid", ...input },
        agent,
        undefined,
        undefined,
        async () => true,
      ),
    ).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
it.each([
  { type: "image", path: "PRIVATE.png" },
  { type: "file_urls", file_urls: ["PRIVATE"] },
  { type: "text", text: "PRIVATE".repeat(2000) },
])(
  "suppresses non-text/oversized clipboard payload %# while preserving completed receipt",
  async (data) => {
    const f = await setup({ run: async () => envelope("clipboard-get", data) });
    await f.configure();
    const result = await f.control.request(
      { op: "clipboard", requestId: "bounded", action: "get" },
      agent,
      undefined,
      undefined,
      async () => true,
    );
    expect(result.clipboard).toBeUndefined();
    expect(result.operation).toMatchObject({ state: "settled", ok: true });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(
      (await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get())!.value,
    ).not.toContain("PRIVATE");
  },
);
it("does not replay an unknown clipboard effect after interruption or restart", async () => {
  let effects = 0;
  const f = await setup({
    run: async () => {
      effects++;
      throw new Error("Lost acknowledgement PRIVATE");
    },
  });
  await f.configure();
  const input = { op: "clipboard", requestId: "unknown", action: "clear" };
  expect(
    (await f.control.request(input, agent, undefined, undefined, async () => true)).operation!
      .state,
  ).toBe("unknown");
  await f.restart();
  expect((await f.request(input, agent)).operation!.state).toBe("unknown");
  expect(effects).toBe(1);
});
it("rechecks exact sensitive authority after its journal and before dispatch", async () => {
  const f = await setup();
  await f.configure();
  let checks = 0;
  const result = await f.control.request(
    { op: "clipboard", requestId: "expired", action: "get" },
    agent,
    undefined,
    undefined,
    async () => ++checks === 1,
  );
  expect(result.operation!.state).toBe("unknown");
  expect(result.clipboard).toBeUndefined();
  expect(f.calls).toHaveLength(0);
});
it("keeps completed clipboard receipts after caller revocation while disclosing no sensitive result", async () => {
  let authorized = true;
  const f = await setup({
    run: async () => {
      authorized = false;
      return envelope("clipboard-get", { type: "text", text: "PRIVATE" });
    },
  });
  await f.configure();
  const input = { op: "clipboard", requestId: "revoked", action: "get" };
  await expect(
    f.control.request(
      input,
      agent,
      async () => authorized,
      undefined,
      async () => authorized,
    ),
  ).rejects.toThrow("revoked");
  authorized = true;
  expect((await f.request(input, agent)).operation).toMatchObject({ state: "settled", ok: true });
  expect(
    (await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get())!.value,
  ).not.toContain("PRIVATE");
});
it("withholds completed clipboard reads when presence locks or exact approval expires before disclosure", async () => {
  let locked = false,
    approved = true;
  const f = await setup({
    presence: async () => ({ supported: true, locked }),
    run: async () => {
      locked = true;
      approved = false;
      return envelope("clipboard-get", { type: "text", text: "PRIVATE" });
    },
  });
  await f.configure();
  const result = await f.control.request(
    { op: "clipboard", requestId: "locked", action: "get" },
    agent,
    undefined,
    undefined,
    async () => approved,
  );
  expect(result.clipboard).toBeUndefined();
  expect(result.operation).toMatchObject({ state: "settled", ok: true });
});
it("emergency Stop fences in-flight clipboard disclosure and queued launch while retaining unknown receipts", async () => {
  const entered = Promise.withResolvers<void>(),
    released = Promise.withResolvers<void>();
  let effects = 0;
  const f = await setup({
    run: async () => {
      effects++;
      entered.resolve();
      await released.promise;
      return envelope("clipboard-get", { type: "text", text: "PRIVATE AFTER STOP" });
    },
  });
  await f.configure();
  const reading = f.control.request(
    { op: "clipboard", requestId: "stop-read", action: "get" },
    agent,
    undefined,
    undefined,
    async () => true,
  );
  await entered.promise;
  const queued = f.request({ op: "launch", requestId: "queued-launch", app: "Notepad" }, agent);
  const stopped = f.request({ op: "stop" });
  released.resolve();
  const result = await reading;
  expect(result.clipboard).toBeUndefined();
  expect(result.operation!.state).toBe("unknown");
  await expect(queued).rejects.toThrow("newer Stop");
  await stopped;
  expect(effects).toBe(1);
  await f.restart();
  expect(
    await f.request({ op: "clipboard", requestId: "stop-read", action: "get" }, agent),
  ).toEqual({ operation: result.operation });
});
it("keeps metadata-only audits pending across sink failure/restart without replaying known input", async () => {
  let offline = true;
  const delivered: unknown[] = [];
  const sink = vi.fn(async (event: unknown) => {
    if (offline) throw new Error("Notebook temporarily unavailable");
    delivered.push(event);
  });
  const f = await setup({ onOperation: sink });
  await f.configure();
  await f.snapshot();
  const input = {
    op: "act",
    requestId: "audited-request",
    snapshotId: "s1",
    ref: "@s1:e1",
    action: "set-value",
    text: "SECRET CONTENT NEVER IN AUDIT",
  };
  const result = await f.request(input, agent);
  expect(result.operation).toMatchObject({ state: "settled", delivery: "delivered_unverified" });
  expect(await f.control.drainOperationAudits()).toBe(true);
  const receipt = await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get();
  expect(receipt?.value).not.toContain("SECRET CONTENT");
  expect(receipt?.value).not.toContain("@s1:e1");
  expect(JSON.parse(receipt!.value)).toMatchObject({
    auditPending: true,
    operation: { state: "settled" },
  });
  const effectCalls = f.calls.filter((args) => args[2] === "set-value").length;
  offline = false;
  await f.restart();
  await f.control.drainOperationAudits();
  expect(delivered).toHaveLength(2);
  expect(JSON.stringify(delivered)).not.toContain("SECRET CONTENT");
  expect(await f.request(input, agent)).toEqual({ operation: result.operation });
  expect(f.calls.filter((args) => args[2] === "set-value")).toHaveLength(effectCalls);
  expect(
    JSON.parse(
      (await f.store.db.prepare("SELECT value FROM desktop_control_receipts").get())!.value,
    ).auditPending,
  ).toBe(false);
});
it("does not emit action audits for status/configuration/snapshot reads", async () => {
  const sink = vi.fn(async () => {});
  const f = await setup({ onOperation: sink });
  await f.request({ op: "status" });
  await f.configure();
  await f.snapshot();
  await f.control.drainOperationAudits();
  expect(sink).not.toHaveBeenCalled();
});
it("journals a known action outcome under trusted bookkeeping after caller revocation but discloses nothing", async () => {
  let active = true;
  let effects = 0;
  const audits: { operation: { state: string; delivery: string } }[] = [];
  const run: DesktopRunner = async (_binary, args) => {
    const command = args[2];
    if (command === "list-apps")
      return envelope(command, { apps: [{ name: "Notepad", pid: 123 }] });
    if (command === "snapshot")
      return envelope(command, {
        app: "Notepad",
        window: { id: "w-1" },
        snapshot_id: "s1",
        complete: true,
        tree: { ref_id: "@s1:e1" },
      });
    effects++;
    active = false;
    return envelope(command, { disposition: { delivery: "delivered_verified", retry: "unsafe" } });
  };
  const f = await setup({
    run,
    onOperation: async (event) => {
      audits.push(event);
    },
  });
  await f.configure();
  await f.snapshot();
  const input = {
    op: "act",
    requestId: "revoked-audit",
    snapshotId: "s1",
    ref: "@s1:e1",
    action: "click",
  };
  await expect(
    f.store.db.withAuthorization(
      async () => active,
      () => f.request(input, agent),
    ),
  ).rejects.toThrow();
  await f.control.drainOperationAudits();
  expect(audits).toContainEqual(
    expect.objectContaining({
      operation: expect.objectContaining({ state: "settled", delivery: "delivered_verified" }),
    }),
  );
  active = true;
  expect((await f.request(input, agent)).operation?.delivery).toBe("delivered_verified");
  expect(effects).toBe(1);
});
it("a newer emergency Stop fences already accepted configure, resume and snapshot requests", async () => {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let hold = false;
  const f = await setup({
    authorize: async () => {
      if (hold) {
        hold = false;
        entered.resolve();
        await released.promise;
      }
      return true;
    },
  });
  await f.configure();
  const configuration = (await f.request({ op: "status" })).configuration!;
  hold = true;
  const { version, ...fields } = configuration;
  const before = f.request({ op: "configure", expectedVersion: version, configuration: fields });
  await entered.promise;
  const resume = f.request({ op: "resume" });
  const snapshot = f.request({ op: "snapshot", app: "Notepad" });
  const stop = f.request({ op: "stop" });
  const results = Promise.allSettled([before, resume, snapshot, stop]);
  released.resolve();
  expect((await results).map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
    "rejected",
    "fulfilled",
  ]);
  const stopped = await f.request({ op: "status" });
  expect(stopped.status?.stopped).toBe(true);
  expect(stopped.configuration?.enabled).toBe(false);
  expect(f.calls).toEqual([["permissions"]]);
  await f.request({ op: "resume" });
  expect((await f.request({ op: "status" })).configuration?.enabled).toBe(true);
});
const envelope = (command: string, data: unknown, ok = true) => ({
  stdout: JSON.stringify({ version: "2.5", ok, command, ...(ok ? { data } : { error: data }) }),
  exitCode: ok ? 0 : 1,
});
it("reports helper permissions while disabled without activating desktop control", async () => {
  const run = vi.fn(async () =>
    envelope("permissions", {
      accessibility: { state: "denied" },
      screen_recording: { state: "not_determined" },
    }),
  );
  const f = await setup({ run });
  const configured = await f.configure();
  const { version, ...configuration } = configured.configuration!;
  await f.request({
    op: "configure",
    expectedVersion: version,
    configuration: { ...configuration, enabled: false },
  });
  const status = (await f.request({ op: "status" })).status!;
  expect(status).toMatchObject({
    enabled: false,
    active: false,
    verified: true,
    permissions: {
      accessibility: "denied",
      screenRecording: "not-determined",
      source: "agent-desktop",
    },
  });
  await f.request({ op: "status" });
  expect(run).toHaveBeenCalledTimes(1);
  writeFileSync(f.binary, "changed");
  expect((await f.request({ op: "status" })).status?.permissions).toMatchObject({
    source: "unavailable",
    accessibility: "unknown",
    screenRecording: "unknown",
  });
});

it("preserves elevated-target error messages and disposition in durable operation receipts", async () => {
  if (process.platform !== "win32") return;
  const f = await setup({
    run: async (_binary, args) =>
      envelope(
        args[2],
        {
          code: "PERM_DENIED",
          platform_detail: "COM HRESULT 0x80070005 (E_ACCESSDENIED: Access is denied)",
          disposition: { delivery: "not_delivered", retry: "safe" },
        },
        false,
      ),
  });
  await f.configure();
  const input = { op: "launch", requestId: "elevated", app: "Notepad" };
  const result = await f.request(input);
  expect(result.operation).toMatchObject({
    errorCode: "target-elevated",
    ok: false,
    delivery: "not_delivered",
    retry: "safe",
    errorMessage:
      "This window runs as administrator. Windows blocks other apps from controlling it unless bycoda also runs as administrator.",
  });
  await f.restart();
  expect(await f.request(input)).toEqual(result);
});

async function setup(options: DesktopControlPorts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-desktop-adapter-"));
  const path = join(dir, "host.db");
  const binary = join(dir, "agent-desktop.exe");
  const bytes = "fixture, never executable";
  writeFileSync(binary, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const calls: string[][] = [];
  const runner: DesktopRunner = async (_binary, args) => {
    calls.push(args);
    const command = args[2] === "--headed" ? args[3] : args[2];
    if (command === "list-apps")
      return envelope(command, { apps: [{ name: "Notepad", pid: 123 }] });
    if (command === "snapshot")
      return envelope(command, {
        app: "Notepad",
        window: { id: "w-1" },
        snapshot_id: "s1",
        complete: true,
        tree: {
          role: "window",
          children: [
            { role: "button", name: "Save", ref_id: "@s1:e1" },
            { role: "list", name: "Files", ref_id: "@s1:e2" },
          ],
        },
      });
    return envelope(command, {
      action: command,
      disposition: { delivery: "delivered_unverified", retry: "unsafe" },
    });
  };
  let store = new HostStore(path);
  await store.ready;
  const ports = {
    presence: async () => ({ supported: true, locked: false }),
    run: runner,
    ...options,
  };
  let control = new HostDesktopControl(store, ports);
  await control.ready;
  const f = {
    binary,
    digest,
    calls,
    get control() {
      return control;
    },
    get store() {
      return store;
    },
    request: (input: unknown, principal = owner) => control.request(input, principal),
    configure: () =>
      control.request(
        {
          op: "configure",
          expectedVersion: 0,
          configuration: {
            enabled: true,
            binaryPath: binary,
            binarySha256: digest,
            allowedApps: ["Notepad"],
            allowPhysicalInput: false,
          },
        },
        owner,
      ),
    snapshot: async () => {
      const result = await control.request({ op: "snapshot", app: "Notepad" }, agent);
      return result.snapshot!;
    },
    restart: async () => {
      await control.close();
      await store.close();
      store = new HostStore(path);
      await store.ready;
      control = new HostDesktopControl(store, ports);
      await control.ready;
    },
  };
  cleanups.push(async () => {
    await control.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return f;
}
it("starts disabled with truthful installation status and owner-only configuration", async () => {
  const f = await setup();
  const status = await f.request({ op: "status" });
  expect(status.status).toMatchObject({ installed: false, verified: false, enabled: false });
  await expect(
    f.control.request(
      {
        op: "configure",
        expectedVersion: 0,
        configuration: {
          enabled: true,
          binaryPath: f.binary,
          binarySha256: f.digest,
          allowedApps: ["Notepad"],
          allowPhysicalInput: false,
        },
      },
      agent,
    ),
  ).rejects.toThrow("owner");
  await f.configure();
  expect((await f.request({ op: "status" })).status!.verified).toBe(true);
  await expect(f.configure()).rejects.toThrow("changed");
});
it("binds exact qualified refs to the caller, app, process and configuration", async () => {
  const f = await setup();
  await f.configure();
  await expect(f.control.request({ op: "snapshot", app: "Browser" }, agent)).rejects.toThrow(
    "not approved",
  );
  const snapshot = await f.snapshot();
  const input = {
    op: "act",
    requestId: "click-1",
    snapshotId: snapshot.snapshotId,
    ref: "@s1:e1",
    action: "click",
  };
  await expect(f.request(input)).rejects.toThrow("caller");
  await expect(f.control.request({ ...input, ref: "@foreign:e1" }, agent)).rejects.toThrow(
    "caller",
  );
  const result = await f.control.request(input, agent);
  expect(result.operation).toMatchObject({
    state: "settled",
    delivery: "delivered_unverified",
    retry: "unsafe",
  });
  // The last call is the read-only post-act refresh; the act precedes the app lookup before it.
  expect(f.calls.at(-1)![2]).toBe("snapshot");
  expect(f.calls.at(-3)).not.toContain("--no-trace");
  expect(f.calls.at(-3)).not.toContain("--headed");
});
it("never repeats an uncertain mutation, including after a Host restart", async () => {
  let mutations = 0;
  const f = await setup({
    run: async (_binary, args) => {
      const command = args[2];
      if (command === "list-apps")
        return envelope(command, { apps: [{ name: "Notepad", pid: 123 }] });
      if (command === "snapshot")
        return envelope(command, {
          app: "Notepad",
          window: { id: "w-1" },
          snapshot_id: "s1",
          complete: false,
          tree: { ref_id: "@s1:e1" },
        });
      mutations++;
      throw new Error("lost after input");
    },
  });
  await f.configure();
  const snapshot = await f.snapshot();
  expect(snapshot.complete).toBe(false);
  const input = {
    op: "act",
    requestId: "unknown",
    snapshotId: "s1",
    ref: "@s1:e1",
    action: "click",
  };
  expect((await f.control.request(input, agent)).operation!.state).toBe("unknown");
  await f.restart();
  expect((await f.control.request(input, agent)).operation!.state).toBe("unknown");
  expect(mutations).toBe(1);
  await expect(f.control.request({ ...input, action: "clear" }, agent)).rejects.toThrow("preserve");
});
it("blocks unknown/locked presence and rejects changed executable bytes", async () => {
  const f = await setup({ presence: async () => ({ supported: false, locked: true }) });
  await f.configure();
  await expect(f.snapshot()).rejects.toThrow("unknown");
  expect(f.calls).toHaveLength(0);
  const changed = await setup();
  await changed.configure();
  writeFileSync(changed.binary, "replaced bytes");
  await expect(changed.snapshot()).rejects.toThrow("checksum");
});
it("never converts headless failure into headed input or treats permission configuration as a per-request grant", async () => {
  const f = await setup();
  await f.configure();
  await f.snapshot();
  await expect(
    f.control.request(
      {
        op: "act",
        requestId: "headed",
        snapshotId: "s1",
        ref: "@s1:e1",
        action: "click",
        headed: true,
      },
      agent,
    ),
  ).rejects.toThrow("grant");
  await expect(
    f.control.request(
      {
        op: "act",
        requestId: "keyboard",
        snapshotId: "s1",
        ref: "@s1:e1",
        action: "press",
        text: "return",
      },
      agent,
    ),
  ).rejects.toThrow("grant");
});
it("puts literal potentially flag-shaped text after the CLI option terminator", async () => {
  const f = await setup();
  await f.configure();
  await f.snapshot();
  await f.control.request(
    {
      op: "act",
      requestId: "text",
      snapshotId: "s1",
      ref: "@s1:e1",
      action: "set-value",
      text: "--headed $(secret)",
    },
    agent,
  );
  expect(f.calls.at(-3)!.slice(-3)).toEqual(["--", "@s1:e1", "--headed $(secret)"]);
});
it("aborts its own pending CLI on Stop and persists disabled state", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  const f = await setup({
    run: async (_binary, args, { signal }) => {
      const command = args[2];
      if (command === "list-apps")
        return envelope(command, { apps: [{ name: "Notepad", pid: 123 }] });
      if (command === "snapshot")
        return envelope(command, {
          app: "Notepad",
          window: { id: "w-1" },
          snapshot_id: "s1",
          complete: true,
          tree: { ref_id: "@s1:e1" },
        });
      entered();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        ),
      );
    },
  });
  await f.configure();
  await f.snapshot();
  const action = f.control.request(
    { op: "act", requestId: "slow", snapshotId: "s1", ref: "@s1:e1", action: "click" },
    agent,
  );
  await started;
  expect((await f.request({ op: "status" })).status!.active).toBe(true);
  await f.request({ op: "stop" });
  expect(aborted).toBe(true);
  expect((await action).operation!.delivery).toBe("unknown");
  await f.restart();
  expect((await f.request({ op: "status" })).configuration!.enabled).toBe(false);
});
it.each(["Alt+F4", " ALT + f4 ", "Win+L", "Windows+L", "Meta+L"])(
  "refuses dangerous shortcut %s even with exact physical consent",
  async (chord) => {
    const f = await setup({ physicalGrant: async () => true });
    await f.configure();
    await f.request({
      op: "configure",
      expectedVersion: 1,
      configuration: {
        enabled: true,
        binaryPath: f.binary,
        binarySha256: f.digest,
        allowedApps: ["Notepad"],
        allowPhysicalInput: true,
      },
    });
    await f.snapshot();
    await expect(
      f.request(
        {
          op: "act",
          requestId: `unsafe-${chord}`,
          snapshotId: "s1",
          ref: "@s1:e1",
          action: "press",
          text: chord,
          headed: true,
        },
        agent,
      ),
    ).rejects.toThrow("Invalid scoped keyboard shortcut");
    expect(f.calls.some((args) => args.includes("press"))).toBe(false);
  },
);
it.each(["Ctrl+Win+Left", "Win+Shift+S", "Ctrl+S", "Alt+Tab", "Ctrl+F4", "Win+Left"])(
  "does not treat %s as a dangerous shortcut",
  (chord) => expect(isForbiddenDesktopShortcut(chord)).toBe(false),
);
it.each(["Alt+F4", " ALT + f4 ", "Win+L", "Windows+L", "Meta+L", "Ctrl+Super+L", "l+win", "win-l"])(
  "forbids %s",
  (chord) => expect(isForbiddenDesktopShortcut(chord)).toBe(true),
);
async function physicalSetup() {
  const grants: string[] = [];
  const f = await setup({
    physicalGrant: async (_principal, op) => {
      grants.push(op.action);
      return true;
    },
  });
  await f.configure();
  await f.request({
    op: "configure",
    expectedVersion: 1,
    configuration: {
      enabled: true,
      binaryPath: f.binary,
      binarySha256: f.digest,
      allowedApps: ["Notepad"],
      allowPhysicalInput: true,
    },
  });
  return { f, grants };
}
const act = (extra: Record<string, unknown>) => ({
  op: "act",
  requestId: `r-${JSON.stringify(extra)}`,
  snapshotId: "s1",
  ref: "@s1:e1",
  ...extra,
});
it("scrolls headless by direction and amount without a physical grant", async () => {
  const f = await setup();
  await f.configure();
  await f.snapshot();
  const response = await f.control.request(
    act({ action: "scroll", direction: "down", amount: 5 }),
    agent,
  );
  expect(response.operation!.ok).toBe(true);
  const call = f.calls.find((args) => args[2] === "scroll")!;
  expect(call).not.toContain("--headed");
  expect(call.slice(-6)).toEqual(["--direction", "down", "--amount", "5", "--", "@s1:e1"]);
});
it.each([
  ["hover", {}],
  ["drag", { toRef: "@s1:e2" }],
  ["focus-window", {}],
] as const)("%s needs the physical-input grant and never runs headless", async (action, extra) => {
  const f = await setup();
  await f.configure();
  await f.snapshot();
  await expect(f.control.request(act({ action, ...extra }), agent)).rejects.toThrow("physical");
  await expect(f.control.request(act({ action, ...extra, headed: true }), agent)).rejects.toThrow(
    "Physical input is not granted",
  );
  expect(f.calls.some((args) => args.includes(action))).toBe(false);
});
it("delivers hover, drag and focus-window headed through the same grant", async () => {
  const { f, grants } = await physicalSetup();
  await f.snapshot();
  await f.control.request(act({ action: "hover", headed: true }), agent);
  await f.snapshot();
  await f.control.request(act({ action: "drag", toRef: "@s1:e2", headed: true }), agent);
  await f.snapshot();
  await f.control.request(act({ action: "focus-window", headed: true }), agent);
  expect(grants).toEqual(["hover", "drag", "focus-window"]);
  const find = (name: string) =>
    f.calls.find((args) => args[2] === "--headed" && args[3] === name)!.slice(3);
  expect(find("hover")).toEqual(["hover", "--timeout-ms", "5000", "--", "@s1:e1"]);
  expect(find("drag")).toEqual([
    "drag",
    "--timeout-ms",
    "5000",
    "--from",
    "@s1:e1",
    "--to",
    "@s1:e2",
  ]);
  expect(find("focus-window")).toEqual(["focus-window", "--app", "Notepad", "--window-id", "w-1"]);
});
it("rejects mismatched drag, scroll and destination parameters before any journal or command", async () => {
  const { f } = await physicalSetup();
  await f.snapshot();
  const effects = () => f.calls.filter((args) => args[2] !== "list-apps").length;
  const before = effects();
  for (const bad of [
    { action: "drag", headed: true },
    { action: "drag", toRef: "@s1:e99", headed: true },
    { action: "click", toRef: "@s1:e2" },
    { action: "scroll" },
    { action: "click", direction: "up" },
    { action: "click", amount: 2 },
  ])
    await expect(f.control.request(act(bad), agent)).rejects.toThrow();
  expect(effects()).toBe(before);
});
it("stores the owner-only permission mode, defaults old configs to ask and covers every app only in full access", async () => {
  const f = await setup();
  expect((await f.configure()).configuration).toMatchObject({
    permissionMode: "ask",
    allowAllApps: false,
  });
  expect(await f.control.permission()).toEqual({ mode: "ask" });
  const base = {
    enabled: true,
    binaryPath: f.binary,
    binarySha256: f.digest,
    allowedApps: ["Notepad"],
    allowPhysicalInput: false,
  };
  const auto = await f.request({
    op: "configure",
    expectedVersion: 1,
    configuration: { ...base, permissionMode: "auto", allowAllApps: true },
  });
  expect(auto.configuration).toMatchObject({ permissionMode: "auto", allowAllApps: false });
  const full = await f.request({
    op: "configure",
    expectedVersion: 2,
    configuration: { ...base, permissionMode: "full" },
  });
  expect(full.configuration).toMatchObject({ permissionMode: "full", allowAllApps: true });
  expect(await f.control.permission()).toEqual({ mode: "full" });
  expect(await f.control.appAllowed("Anything")).toBe(true);
  await expect(
    f.control.request(
      {
        op: "configure",
        expectedVersion: 3,
        configuration: { ...base, permissionMode: "full", allowAllApps: true },
      },
      agent,
    ),
  ).rejects.toThrow("owner");
});
it("remembers an owner-approved app without retiring live snapshots", async () => {
  const f = await setup();
  await f.configure();
  const snapshot = await f.snapshot();
  expect(await f.control.appAllowed("Browser")).toBe(false);
  await expect(f.control.allowApp("-option")).rejects.toThrow("plain");
  await f.control.allowApp("Browser");
  await f.control.allowApp("Browser");
  expect(await f.control.appAllowed("Browser")).toBe(true);
  const status = await f.request({ op: "status" });
  expect(status.configuration).toMatchObject({ allowedApps: ["Notepad", "Browser"], version: 2 });
  // The snapshot taken before the approval still pages.
  const page = await f.control.request(
    { op: "snapshot", app: "Notepad", cursor: `0:${snapshot.snapshotId}` },
    agent,
  );
  expect(page.snapshot?.snapshotId).toBe(snapshot.snapshotId);
});
it("keeps Host presence headless and treats unsupported, failed and malformed reads as a locked, unsupported desktop", async () => {
  let args: string[] = [];
  const read = await readDesktopPresence({
    platform: "win32",
    run: async (_binary, input, options) => {
      args = input;
      expect(options.windowsHide).toBe(true);
      return '{"locked":false,"supported":true,"idleMs":20}';
    },
  });
  expect(read).toEqual({ locked: false, supported: true, idleMs: 20 });
  expect(args).toContain("Hidden");
  expect(await readDesktopPresence({ platform: "linux" })).toEqual({
    locked: true,
    supported: false,
  });
  expect(
    await readDesktopPresence({ platform: "win32", run: async () => '{"locked":false}' }),
  ).toEqual({ locked: true, supported: false });
});
it.runIf(process.platform === "win32")(
  "compiles the fixed presence helper and validates its native layout without reading or driving the desktop",
  async () => {
    const source =
      WINDOWS_DESKTOP_PRESENCE_SCRIPT.split("@{locked=")[0] +
      "[Runtime.InteropServices.Marshal]::SizeOf([type][BycodaDesktopPresence+Info])";
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(
        join(
          process.env.SystemRoot ?? "C:/Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", source],
        { windowsHide: true, shell: false, timeout: 15000, encoding: "utf8" },
        (error, result) => (error ? reject(error) : resolve(result)),
      ),
    );
    expect(stdout.trim()).toBe("232");
  },
);
const bigTree = (id: string, count: number) => ({
  role: "window",
  ref_id: `@${id}:root`,
  children: Array.from({ length: count }, (_, i) => ({
    role: "button",
    name: `Button ${i} ${"x".repeat(40)}`,
    ref_id: `@${id}:e${i}`,
  })),
});
function pagedRunner(options: { failRefresh?: boolean } = {}) {
  let counter = 0;
  const runner: DesktopRunner = async (_binary, args) => {
    const command = args[2] === "--headed" ? args[3] : args[2];
    if (command === "list-apps")
      return envelope(command, { apps: [{ name: "Notepad", pid: 123 }] });
    if (command === "snapshot") {
      if (options.failRefresh && counter > 0) throw new Error("helper gone");
      const id = `s${++counter}`;
      return envelope(command, {
        app: "Notepad",
        window: { id: "w-1" },
        snapshot_id: id,
        complete: true,
        tree: bigTree(id, 800),
      });
    }
    return envelope(command, {
      action: command,
      disposition: { delivery: "delivered_unverified", retry: "unsafe" },
    });
  };
  return runner;
}
it("pages large snapshots on node boundaries with continuous cursors", async () => {
  const f = await setup({ run: pagedRunner() });
  await f.configure();
  const first = (await f.control.request({ op: "snapshot", app: "Notepad", maxChars: 5000 }, agent))
    .snapshot!;
  expect(first.nextCursor).toBeTruthy();
  const pages = [first.treeJson];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = (
      await f.control.request({ op: "snapshot", app: "Notepad", maxChars: 5000, cursor }, agent)
    ).snapshot!;
    expect(page.snapshotId).toBe(first.snapshotId);
    expect(page.totalChars).toBe(first.totalChars);
    pages.push(page.treeJson);
    cursor = page.nextCursor;
  }
  expect(pages.length).toBeGreaterThan(3);
  const joined = pages.join("\n");
  expect(joined.length).toBe(first.totalChars);
  for (const page of pages) {
    expect(page.length).toBeLessThanOrEqual(5000);
    for (const line of page.split("\n")) expect(line.trim()).toMatch(/^\{.*\}$/);
  }
  expect(new Set(joined.match(/@s1:e\d+/g)).size).toBe(800);
  expect(f.calls).toHaveLength(0);
});
it("does not rerun the helper for cursor reads and binds them to the caller and app", async () => {
  let snapshots = 0;
  const inner = pagedRunner();
  const f = await setup({
    run: async (binary, args, options) => {
      if (args[2] === "snapshot") snapshots++;
      return inner(binary, args, options);
    },
  });
  await f.configure();
  const first = (await f.control.request({ op: "snapshot", app: "Notepad", maxChars: 5000 }, agent))
    .snapshot!;
  const cursor = first.nextCursor!;
  await f.control.request({ op: "snapshot", app: "Notepad", cursor }, agent);
  expect(snapshots).toBe(1);
  await expect(
    f.control.request({ op: "snapshot", app: "Notepad", cursor }, { ...agent, id: "other" }),
  ).rejects.toThrow("cursor");
  await expect(
    f.control.request({ op: "snapshot", app: "Notepad", cursor: "5:missing" }, agent),
  ).rejects.toThrow("cursor");
  await expect(
    f.control.request({ op: "snapshot", app: "Notepad", cursor: "nope" }, agent),
  ).rejects.toThrow("cursor");
});
it("act returns a fresh snapshot and marks the consumed refs expired", async () => {
  const f = await setup({ run: pagedRunner() });
  await f.configure();
  const old = (await f.control.request({ op: "snapshot", app: "Notepad" }, agent)).snapshot!;
  const act = {
    op: "act",
    requestId: "a1",
    snapshotId: old.snapshotId,
    ref: `@${old.snapshotId}:e1`,
    action: "click",
  };
  const result = await f.control.request(act, agent);
  expect(result.refsExpired).toBe(true);
  expect(result.next).toMatchObject({ snapshotId: "s2", app: "Notepad" });
  await expect(f.control.request({ ...act, requestId: "a2" }, agent)).rejects.toThrow("stale");
  const fresh = await f.control.request(
    { ...act, requestId: "a3", snapshotId: "s2", ref: "@s2:e2" },
    agent,
  );
  expect(fresh.operation?.ok).toBe(true);
});
it("a failed post-act refresh never fails the act", async () => {
  const f = await setup({ run: pagedRunner({ failRefresh: true }) });
  await f.configure();
  const old = (await f.control.request({ op: "snapshot", app: "Notepad" }, agent)).snapshot!;
  const result = await f.control.request(
    { op: "act", requestId: "a1", snapshotId: "s1", ref: "@s1:e1", action: "click" },
    agent,
  );
  expect(old.snapshotId).toBe("s1");
  expect(result.operation).toMatchObject({ state: "settled", ok: true });
  expect(result.refsExpired).toBe(true);
  expect(result.next).toMatchObject({ error: expect.stringContaining("helper gone") });
});
