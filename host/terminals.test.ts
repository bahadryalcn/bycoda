import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostTerminals, TERMINAL_OUTPUT_LIMIT } from "./terminals";
import { listShellProfiles } from "./shellProfiles";

const services: HostTerminals[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(async (service) => await service.close()));
});
const project = { id: "project", cwd: "/project" };
function setup(locate = async (root: string) => root) {
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

it("releases terminal admission after launch failure and holds it for an unconfirmed shutdown", async () => {
  const failed = setup();
  const failedRelease = vi.fn(async () => {});
  failed.service.setActivityGate(async () => failedRelease);
  failed.launch.mockImplementation(() => {
    throw new Error("spawn failed");
  });
  await expect(
    failed.service.create(project, { requestId: "failed-01" }, "owner", () => true),
  ).rejects.toThrow("Could not start terminal shell");
  expect(failedRelease).toHaveBeenCalledTimes(1);

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
    if (action === "close") await s.service.close();
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
