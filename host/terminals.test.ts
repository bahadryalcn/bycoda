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
  return { service, child, launch, output: (data: string) => output(data) };
}

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
