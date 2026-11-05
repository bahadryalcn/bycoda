import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostTerminals, TERMINAL_OUTPUT_LIMIT } from "./terminals";
import { listShellProfiles } from "../execution/shellProfiles";
import { OutputBuffer } from "../execution/output-buffer";

const services: HostTerminals[] = [];
afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(async (service) => await service.close()));
});
const project = { id: "project", cwd: "/project" };
function setup(locate = async (root: string) => root, now?: () => number) {
  let output: (data: string) => void = () => {};
  let exit: (code: number | null) => void = () => {};
  const child = { write: vi.fn(async () => {}), stop: vi.fn(async () => exit(0)) };
  const launch = vi.fn((_profile, _cwd, onOutput, onExit) => {
    output = onOutput;
    exit = onExit;
    return child;
  });
  const service = new HostTerminals(
    launch,
    () => ({
      profiles: [{ id: "shell", name: "Shell", path: "/shell", kind: "sh" }],
      defaultId: "shell",
      chosenId: null,
    }),
    locate,
    now,
  );
  services.push(service);
  return {
    service,
    child,
    launch,
    output: (data: string) => output(data),
    exit: (code: number | null) => exit(code),
  };
}

it("indexes actual running workspace terminals and retires them on the original exit", async () => {
  const s = setup();
  const terminal = await s.service.create(
    project,
    { requestId: "indexed-01" },
    "owner",
    () => true,
  );
  expect(s.service.runningInWorkspace(project.cwd).map((entry) => entry.id)).toEqual([terminal.id]);
  expect(s.service.runningInWorkspace("/project-other")).toEqual([]);
  s.exit(0);
  expect(s.service.runningInWorkspace(project.cwd)).toEqual([]);
});

it("rejects reserved terminal admission before process launch and deduplicates the rejected request", async () => {
  const s = setup();
  const gate = vi.fn(async () => {
    throw new Error("Workspace reservation is active");
  });
  s.service.setActivityGate(gate);
  const create = () => s.service.create(project, { requestId: "blocked-01" }, "owner", () => true);
  const results = await Promise.allSettled([create(), create()]);
  for (const result of results)
    expect(result).toMatchObject({
      status: "rejected",
      reason: { message: "Workspace reservation is active" },
    });
  expect(gate).toHaveBeenCalledTimes(1);
  expect(s.launch).not.toHaveBeenCalled();
  expect(s.service.list(project.id).terminals).toEqual([]);
});

it.each(["exit", "interrupt", "remove", "close"])(
  "holds terminal admission until %s and releases it once despite simultaneous exit callbacks",
  async (finish) => {
    const s = setup();
    let completeRelease!: () => void;
    const release = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeRelease = resolve;
        }),
    );
    const gate = vi.fn(async () => release);
    s.service.setActivityGate(gate);
    const create = () =>
      s.service.create(project, { requestId: "admitted-01" }, "owner", () => true);
    const [terminal, retry] = await Promise.all([create(), create()]);
    expect(retry.id).toBe(terminal.id);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(s.launch).toHaveBeenCalledTimes(1);
    await s.service.write(project.id, { id: terminal.id, data: "hello\n" });
    expect(release).not.toHaveBeenCalled();
    const finishing =
      finish === "exit"
        ? (s.exit(0), Promise.resolve())
        : finish === "interrupt"
          ? s.service.interrupt(project.id, terminal.id)
          : finish === "remove"
            ? s.service.remove(project.id, terminal.id)
            : s.service.close();
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    completeRelease();
    await finishing;
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect((await create()).state).toBe("exited");
    expect(gate).toHaveBeenCalledTimes(1);
  },
);

it("retains terminal admission after an unknown launch failure or unconfirmed shutdown", async () => {
  const failed = setup();
  const failedRelease = vi.fn(async () => {});
  failed.service.setActivityGate(async () => failedRelease);
  failed.launch.mockImplementation(() => {
    throw new Error("spawn failed");
  });
  await expect(
    failed.service.create(project, { requestId: "failed-01" }, "owner", () => true),
  ).rejects.toThrow("Could not start terminal shell");
  expect(failedRelease).not.toHaveBeenCalled();

  const running = setup();
  const runningRelease = vi.fn(async () => {});
  running.service.setActivityGate(async () => runningRelease);
  const terminal = await running.service.create(
    project,
    { requestId: "running-01" },
    "owner",
    () => true,
  );
  running.child.stop.mockRejectedValueOnce(new Error("Process shutdown is unknown"));
  await expect(running.service.interrupt(project.id, terminal.id)).rejects.toThrow(
    "shutdown is unknown",
  );
  expect(runningRelease).not.toHaveBeenCalled();
  expect(running.service.read(project.id, { id: terminal.id }).terminal.state).toBe("running");
  await running.service.interrupt(project.id, terminal.id);
  expect(runningRelease).toHaveBeenCalledTimes(1);
});

it.each(["close", "revoke"])(
  "rechecks %s after pending workspace admission before launching",
  async (action) => {
    const s = setup();
    let finishAdmission!: () => void;
    const admission = new Promise<void>((resolve) => {
      finishAdmission = resolve;
    });
    const release = vi.fn(async () => {});
    const gate = vi.fn(async () => {
      await admission;
      return release;
    });
    s.service.setActivityGate(gate);
    let authorized = true;
    const creating = s.service.create(
      project,
      { requestId: "pending-01" },
      "owner",
      () => authorized,
    );
    await vi.waitFor(() => expect(gate).toHaveBeenCalledTimes(1));
    if (action === "close")
      await expect(s.service.close()).rejects.toThrow("shutdown was not confirmed");
    else authorized = false;
    finishAdmission();
    await expect(creating).rejects.toThrow(action === "close" ? "stopping" : "revoked");
    expect(s.launch).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  },
);

it("deduplicates concurrent creation and does not replay a closed creation receipt", async () => {
  const s = setup();
  const params = { requestId: "create-01", name: "Build" };
  const [first, second] = await Promise.all([
    s.service.create(project, params, "owner", () => true),
    s.service.create(project, params, "owner", () => true),
  ]);
  expect(first.id).toBe(second.id);
  expect(s.launch).toHaveBeenCalledTimes(1);
  await s.service.remove(project.id, first.id);
  expect(await s.service.create(project, params, "owner", () => true)).toMatchObject({
    id: first.id,
    state: "exited",
  });
  expect(s.launch).toHaveBeenCalledTimes(1);
  await expect(
    (async () =>
      await s.service.create(project, { ...params, name: "Different" }, "owner", () => true))(),
  ).rejects.toThrow("different options");
});

it("scopes every terminal operation to its registered project and bounds output with stable cursors", async () => {
  const s = setup();
  const terminal = await s.service.create(project, { requestId: "create-02" }, "owner", () => true);
  s.output("x".repeat(TERMINAL_OUTPUT_LIMIT + 10));
  const page = s.service.read(project.id, { id: terminal.id, after: 0, limit: 4 });
  expect(page).toMatchObject({ output: "xxxx", cursor: 14, truncated: true, hasMore: true });
  const next = s.service.read(project.id, { id: terminal.id, after: page.cursor, limit: 5 });
  expect(next).toMatchObject({ output: "xxxxx", cursor: 19, truncated: false, hasMore: true });
  expect(() => s.service.read("other", { id: terminal.id })).toThrow("unavailable");
  await expect(s.service.write("other", { id: terminal.id, data: "secret\n" })).rejects.toThrow(
    "unavailable",
  );
  await expect(s.service.interrupt("other", terminal.id)).rejects.toThrow("unavailable");
  await expect(s.service.remove("other", terminal.id)).rejects.toThrow("unavailable");
  expect(s.child.write).not.toHaveBeenCalled();
  expect(s.child.stop).not.toHaveBeenCalled();
  for (const params of [
    { after: -1 },
    { after: Infinity },
    { after: 9999999 },
    { limit: 65537 },
    { limit: 0 },
  ])
    expect(() => s.service.read(project.id, { id: terminal.id, ...params })).toThrow("range");
});

it("validates input, preserves exact write bytes, and retains output after stopping", async () => {
  const s = setup();
  const terminal = await s.service.create(project, { requestId: "create-03" }, "owner", () => true);
  await s.service.write(project.id, { id: terminal.id, data: "printf hello\n" });
  expect(s.child.write).toHaveBeenCalledWith("printf hello\n");
  await expect(
    s.service.write(project.id, { id: terminal.id, data: "💻".repeat(5000) }),
  ).rejects.toThrow("UTF-8");
  s.output("hello\n");
  await s.service.interrupt(project.id, terminal.id);
  expect(s.service.read(project.id, { id: terminal.id })).toMatchObject({
    output: "hello\n",
    terminal: { state: "exited" },
  });
  await expect(s.service.write(project.id, { id: terminal.id, data: "again\n" })).rejects.toThrow(
    "exited",
  );
});

it("rechecks owner authority after resolving cwd and rejects unavailable profiles before launch", async () => {
  const s = setup();
  await expect(
    s.service.create(project, { requestId: "create-04" }, "owner", () => false),
  ).rejects.toThrow("revoked");
  await expect(
    s.service.create(
      project,
      { requestId: "create-05", profileId: "uninstalled" },
      "owner",
      () => true,
    ),
  ).rejects.toThrow("not installed");
  expect(s.launch).not.toHaveBeenCalled();
});

it("runs a real persistent shell through its guardian and confirms shutdown", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-terminal-")));
  const service = new HostTerminals();
  services.push(service);
  try {
    const p = { id: "real", cwd: root };
    const terminal = await service.create(p, { requestId: "real-shell-01" }, "owner", () => true);
    const profile = listShellProfiles().profiles.find((profile) => profile.name === terminal.shell);
    const command =
      profile?.kind === "pwsh" || profile?.kind === "powershell"
        ? "$bycodaTerminalValue = 'PERSISTENT'; Write-Output $bycodaTerminalValue\n\n"
        : profile?.kind === "cmd"
          ? "set BYCODA_TERMINAL_VALUE=PERSISTENT\necho %BYCODA_TERMINAL_VALUE%\n"
          : "BYCODA_TERMINAL_VALUE=PERSISTENT; printf '%s\\n' \"$BYCODA_TERMINAL_VALUE\"\n";
    await service.write(p.id, { id: terminal.id, data: command });
    await vi.waitFor(
      () => expect(service.read(p.id, { id: terminal.id }).output).toContain("PERSISTENT"),
      { timeout: 10000 },
    );
    const next =
      profile?.kind === "pwsh" || profile?.kind === "powershell"
        ? "Write-Output ('SECOND-' + $bycodaTerminalValue)\n\n"
        : profile?.kind === "cmd"
          ? "echo SECOND-%BYCODA_TERMINAL_VALUE%\n"
          : "printf 'SECOND-%s\\n' \"$BYCODA_TERMINAL_VALUE\"\n";
    await service.write(p.id, { id: terminal.id, data: next });
    await vi.waitFor(
      () => expect(service.read(p.id, { id: terminal.id }).output).toContain("SECOND-PERSISTENT"),
      { timeout: 10000 },
    );
    await service.interrupt(p.id, terminal.id);
    expect(service.read(p.id, { id: terminal.id }).terminal.state).toBe("exited");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("stops only its owned shell tree, including a running shell descendant", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-terminal-tree-")));
  const service = new HostTerminals();
  services.push(service);
  try {
    const p = { id: "tree", cwd: root };
    await writeFile(
      join(root, "heartbeat.cjs"),
      "const fs = require('node:fs'); setInterval(() => fs.writeFileSync('heartbeat.txt', String(Date.now())), 30);",
    );
    const terminal = await service.create(p, { requestId: "real-shell-02" }, "owner", () => true);
    const profile = listShellProfiles().profiles.find((profile) => profile.name === terminal.shell);
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const command =
      profile?.kind === "pwsh" || profile?.kind === "powershell"
        ? `& ${quote(process.execPath)} heartbeat.cjs\n\n`
        : profile?.kind === "cmd"
          ? `"${process.execPath}" heartbeat.cjs\n`
          : `'${process.execPath.replace(/'/g, "'\\''")}' heartbeat.cjs\n`;
    await service.write(p.id, { id: terminal.id, data: command });
    await vi.waitFor(
      async () => expect(await readFile(join(root, "heartbeat.txt"), "utf8")).toMatch(/^\d+$/),
      { timeout: 10000 },
    );
    await service.interrupt(p.id, terminal.id);
    const stopped = await readFile(join(root, "heartbeat.txt"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await readFile(join(root, "heartbeat.txt"), "utf8")).toBe(stopped);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("expires settled receipts without re-executing old IDs and bounds exited history separately", async () => {
  let now = 0;
  const s = setup(undefined, () => now);
  for (let i = 0; i < 270; i++) {
    await s.service.create(
      project,
      { requestId: `terminal-${i.toString().padStart(4, "0")}` },
      "owner",
      () => true,
    );
    s.exit(0);
    now += 10 * 60 * 1000 + 1;
  }
  expect(s.launch).toHaveBeenCalledTimes(270);
  await expect(async () =>
    s.service.create(project, { requestId: "terminal-0000" }, "owner", () => true),
  ).rejects.toThrow("receipt expired");
  expect(s.launch).toHaveBeenCalledTimes(270);
  const live = await s.service.create(project, { requestId: "live-0001" }, "owner", () => true);
  expect(s.service.list(project.id).terminals).toContainEqual(
    expect.objectContaining({ id: live.id, state: "running" }),
  );
  expect(s.service.list(project.id).terminals.length).toBeLessThanOrEqual(33);
});

it("rechecks authorization before replaying a creation receipt", async () => {
  const s = setup();
  const params = { requestId: "auth-replay-01" };
  await s.service.create(project, params, "owner", () => true);
  await expect(s.service.create(project, params, "owner", () => false)).rejects.toThrow("revoked");
  expect(s.launch).toHaveBeenCalledTimes(1);
});

it("does not retire a terminal when stop resolves without an exit callback", async () => {
  let now = 0;
  const s = setup(undefined, () => now);
  const params = { requestId: "unknown-stop-01" };
  const terminal = await s.service.create(project, params, "owner", () => true);
  s.child.stop.mockResolvedValue(undefined);
  await expect(s.service.remove(project.id, terminal.id)).rejects.toThrow("not confirmed");
  now += 20 * 60 * 1000;
  expect((await s.service.create(project, params, "owner", () => true)).id).toBe(terminal.id);
  expect(s.service.list(project.id).terminals).toContainEqual(
    expect.objectContaining({ id: terminal.id, state: "running" }),
  );
  expect(s.launch).toHaveBeenCalledTimes(1);
  s.exit(0);
});

it("keeps at most 32 exited outputs without counting them against live capacity", async () => {
  const s = setup();
  for (let i = 0; i < 40; i++) {
    await s.service.create(
      project,
      { requestId: `history-${i.toString().padStart(4, "0")}` },
      "owner",
      () => true,
    );
    s.exit(0);
  }
  const live = await s.service.create(
    project,
    { requestId: "history-live-01" },
    "owner",
    () => true,
  );
  const rows = s.service.list(project.id).terminals;
  expect(rows.filter((row) => row.state === "exited")).toHaveLength(32);
  expect(rows).toContainEqual(expect.objectContaining({ id: live.id, state: "running" }));
});

it("retains unknown launch outcomes past receipt TTL", async () => {
  let now = 0;
  const s = setup(undefined, () => now);
  const release = vi.fn(async () => {});
  s.service.setActivityGate(async () => release);
  s.launch.mockImplementation(() => {
    throw new Error("unknown spawn");
  });
  const params = { requestId: "unknown-launch-01" };
  await expect(s.service.create(project, params, "owner", () => true)).rejects.toThrow(
    "Could not start",
  );
  now += 20 * 60 * 1000;
  await expect(s.service.create(project, params, "owner", () => true)).rejects.toThrow(
    "Could not start",
  );
  await expect(
    s.service.create(project, { ...params, name: "Changed" }, "owner", () => false),
  ).rejects.toThrow("revoked");
  expect(s.launch).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
});

it("retains exited receipts and capacity when activity release is uncertain", async () => {
  let now = 0;
  const s = setup(undefined, () => now);
  const release = vi.fn(async () => {
    throw new Error("release unavailable");
  });
  s.service.setActivityGate(async () => release);
  const params = { requestId: "release-unknown-01" };
  const terminal = await s.service.create(project, params, "owner", () => true);
  s.exit(0);
  expect(release).toHaveBeenCalledOnce();
  await Promise.resolve();
  now += 20 * 60 * 1000;
  expect((await s.service.create(project, params, "owner", () => true)).id).toBe(terminal.id);
  expect(s.service.list(project.id).terminals).toContainEqual(
    expect.objectContaining({ id: terminal.id, state: "exited" }),
  );
  expect(s.launch).toHaveBeenCalledOnce();
});

it("retries failed activity cleanup when authorization expires before launch", async () => {
  const s = setup();
  let allowed = true;
  const release = vi
    .fn()
    .mockRejectedValueOnce(new Error("release unavailable"))
    .mockResolvedValue(undefined);
  s.service.setActivityGate(async () => {
    allowed = false;
    return release;
  });
  await expect(
    s.service.create(project, { requestId: "prelaunch-release-01" }, "owner", () => allowed),
  ).rejects.toThrow("release unavailable");
  const [entry] = s.service.list(project.id).terminals;
  expect(entry.state).toBe("exited");
  expect(s.launch).not.toHaveBeenCalled();
  expect(await s.service.remove(project.id, entry.id)).toEqual({ closed: true });
  expect(release).toHaveBeenCalledTimes(2);
});

it("requires original admission authority when replaying with a fresh callback", async () => {
  const s = setup();
  let originalAllowed = true;
  const params = { requestId: "original-auth-01" };
  await s.service.create(project, params, "owner", () => originalAllowed);
  originalAllowed = false;
  await expect(s.service.create(project, params, "owner", () => true)).rejects.toThrow("revoked");
  expect(s.launch).toHaveBeenCalledOnce();
});

it("reports unconfirmed shutdown and retains the terminal for retry", async () => {
  const s = setup();
  const terminal = await s.service.create(
    project,
    { requestId: "close-unknown-01" },
    "owner",
    () => true,
  );
  s.child.stop.mockResolvedValueOnce(undefined);
  await expect(s.service.close()).rejects.toThrow("shutdown was not confirmed");
  expect(s.service.list(project.id).terminals).toContainEqual(
    expect.objectContaining({ id: terminal.id, state: "running" }),
  );
  await s.service.close();
  expect(s.service.list(project.id).terminals).toHaveLength(0);
});

it("tiny terminal chunks retain exact ANSI/UTF16 ranges without append-time materialization", async () => {
  const s = setup();
  const terminal = await s.service.create(
    project,
    { requestId: "paged-output" },
    "owner",
    () => true,
  );
  const reads = vi.spyOn(OutputBuffer.prototype, "slice");
  try {
    let expected = "x".repeat(TERMINAL_OUTPUT_LIMIT);
    let end = expected.length;
    s.output(expected);
    for (const chunk of ["\ud83d", "\ude80", "\u001b[", "31m", "終", "\r\n"]) {
      s.output(chunk);
      end += chunk.length;
      expected = (expected + chunk).slice(-TERMINAL_OUTPUT_LIMIT);
    }
    expect(reads).not.toHaveBeenCalled();
    const start = end - expected.length;
    expect(s.service.read(project.id, { id: terminal.id, after: 0, limit: 3 })).toMatchObject({
      output: expected.slice(0, 3),
      cursor: start + 3,
      truncated: true,
      hasMore: true,
    });
    const after = end - 10;
    const first = s.service.read(project.id, { id: terminal.id, after, limit: 3 });
    expect(first).toMatchObject({
      output: expected.slice(after - start, after - start + 3),
      cursor: after + 3,
      truncated: false,
    });
    const rest = s.service.read(project.id, { id: terminal.id, after: first.cursor, limit: 65536 });
    expect(rest).toMatchObject({
      output: expected.slice(first.cursor - start),
      cursor: end,
      truncated: false,
      hasMore: false,
    });
    s.output("later");
    expect(rest.output).toBe(expected.slice(first.cursor - start));
  } finally {
    reads.mockRestore();
  }
});
