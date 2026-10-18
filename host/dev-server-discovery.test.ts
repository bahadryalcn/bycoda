import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  DevServerDiscovery,
  parseLsofListeners,
  parseProcSockets,
  parseProcStat,
  parsePsProcesses,
  parseSsListeners,
  parseWindowsListeners,
  type DiscoveryCommand,
  type DiscoveryFileSystem,
} from "./dev-server-discovery.js";

const birth = "638958615012345678";
const processRow = {
  pid: 1234,
  parentPid: 20,
  name: "node.exe",
  command: "node server.js",
  startedAt: birth,
};
const windowsSnapshot = (rows: unknown[] = [processRow]) =>
  JSON.stringify({
    processes: rows,
    listeners: [
      { pid: 1234, address: "127.0.0.1", port: 5173 },
      { pid: 1234, address: "::", port: 5173 },
      { pid: 1234, address: "0.0.0.0", port: 8080 },
    ],
  });
const psLine = "1234 20 Mon Oct 12 13:14:15 2026 /usr/local/bin/node server.js\n";
const script = (args: string[]) => Buffer.from(args.at(-1)!, "base64").toString("utf16le");

describe("listener parsers", () => {
  it("groups all ports for a Windows process and retains wildcard addresses", () => {
    const [item] = parseWindowsListeners(windowsSnapshot());
    expect(item.process).toEqual(processRow);
    expect(item.endpoints).toEqual([
      { address: "127.0.0.1", port: 5173, url: "http://127.0.0.1:5173" },
      { address: "::", port: 5173, url: "http://[::1]:5173" },
      { address: "0.0.0.0", port: 8080, url: "http://127.0.0.1:8080" },
    ]);
  });
  it("allows inspect-only rows when process metadata is unavailable", () => {
    expect(parseWindowsListeners(windowsSnapshot([]))[0].process).toEqual({
      pid: 1234,
      name: "Unknown process",
      startedAt: "",
    });
    expect(() => parseWindowsListeners('{"processes":[],"listeners":"invalid"}')).toThrow();
    expect(parseWindowsListeners('{"processes":[],"listeners":[]}')).toEqual([]);
  });
  it("parses macOS lsof machine fields and refuses ps rounded birth for management", () => {
    expect(parseLsofListeners("p1234\nn127.0.0.1:5173\nn[::1]:8080\np5678\nn*:3000\n")).toEqual([
      { pid: 1234, address: "127.0.0.1", port: 5173 },
      { pid: 1234, address: "::1", port: 8080 },
      { pid: 5678, address: "*", port: 3000 },
    ]);
    expect(parsePsProcesses(psLine)).toEqual([
      {
        pid: 1234,
        parentPid: 20,
        startedAt: "",
        name: "node",
        command: "/usr/local/bin/node server.js",
      },
    ]);
  });
  it("parses Linux ss owners and leaves unreadable owners inspect-only", () => {
    expect(
      parseSsListeners(
        'LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=1234,fd=20))\nLISTEN 0 128 [::]:8080 [::]:*\n',
      ),
    ).toEqual([
      { pid: 1234, address: "127.0.0.1", port: 5173 },
      { pid: 0, address: "::", port: 8080 },
    ]);
  });
  it("uses Linux start ticks including commands with spaces and parentheses", () => {
    const fields = ["S", "20", ...Array(17).fill("0"), "456789", "0"];
    expect(
      parseProcStat(1234, `1234 (node (dev server)) ${fields.join(" ")}`, "boot-id\n"),
    ).toEqual({ pid: 1234, parentPid: 20, name: "node (dev server)", startedAt: "boot-id:456789" });
    expect(() => parseProcStat(1234, "bad", "boot")).toThrow("identity");
  });
  it("reads only LISTEN sockets from the Linux /proc fallback", () => {
    const header =
      "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n";
    const row = (address: string, state: string, inode: number) =>
      `0: ${address}:1435 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 ${inode}\n`;
    expect(
      parseProcSockets(header + row("0100007F", "0A", 999) + row("0100007F", "01", 998)),
    ).toEqual([{ address: "127.0.0.1", port: 5173, inode: "999" }]);
    expect(
      parseProcSockets(header + row("00000000000000000000000001000000", "0A", 999), true),
    ).toEqual([{ address: "::1", port: 5173, inode: "999" }]);
  });
});

describe("bounded discovery and birth-safe signals", () => {
  it("deduplicates concurrent scans and uses a short cache with hidden bounded helpers", async () => {
    const command = vi.fn<DiscoveryCommand>().mockResolvedValue(windowsSnapshot());
    const discovery = new DevServerDiscovery({ platform: "win32", command });
    const [first, second] = await Promise.all([discovery.listeners(), discovery.listeners()]);
    expect(first).toEqual(second);
    await discovery.listeners();
    expect(command).toHaveBeenCalledTimes(1);
    const [executable, args, options] = command.mock.calls[0];
    expect(executable).toBe("powershell.exe");
    expect(args).toContain("-NonInteractive");
    expect(script(args)).toContain("Get-NetTCPConnection -State Listen");
    expect(options.windowsHide).toBe(true);
    expect(options.timeout).toBeLessThanOrEqual(10_000);
    expect(options.maxBuffer).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
  it("propagates a failed or timed-out scan and does not cache it as no servers", async () => {
    const command = vi
      .fn<DiscoveryCommand>()
      .mockRejectedValueOnce(new Error("command timed out"))
      .mockResolvedValueOnce('{"processes":[],"listeners":[]}');
    const discovery = new DevServerDiscovery({ platform: "win32", command });
    await expect(discovery.listeners()).rejects.toThrow("timed out");
    await expect(discovery.listeners()).resolves.toEqual([]);
    expect(command).toHaveBeenCalledTimes(2);
  });
  it("always refreshes identity and refuses a reused PID without invoking a signal helper", async () => {
    const command = vi
      .fn<DiscoveryCommand>()
      .mockResolvedValueOnce(JSON.stringify([processRow]))
      .mockResolvedValueOnce(JSON.stringify([{ ...processRow, startedAt: "99999" }]));
    const discovery = new DevServerDiscovery({ platform: "win32", command });
    expect(await discovery.identity(1234)).toEqual(processRow);
    await expect(discovery.signal(processRow, true)).rejects.toThrow("identity changed");
    expect(command).toHaveBeenCalledTimes(2);
    await expect(discovery.signal({ pid: 1234, startedAt: "" }, true)).rejects.toThrow(
      "unavailable",
    );
  });
  it("pins the Windows native handle and checks birth inside force helper before killing", async () => {
    const command = vi
      .fn<DiscoveryCommand>()
      .mockResolvedValueOnce(JSON.stringify([processRow]))
      .mockRejectedValueOnce(new Error("Process identity changed"));
    const discovery = new DevServerDiscovery({ platform: "win32", command });
    await expect(discovery.signal(processRow, true)).rejects.toThrow("identity changed");
    const helper = script(command.mock.calls[1][1]);
    expect(helper.indexOf("$target.Handle")).toBeLessThan(helper.indexOf("$target.StartTime"));
    expect(helper.indexOf("$birth -cne")).toBeLessThan(helper.indexOf("$target.Kill()"));
    expect(helper).not.toContain("taskkill");
  });
  it("makes a graceful Windows attempt without disguising forced termination", async () => {
    const command = vi
      .fn<DiscoveryCommand>()
      .mockResolvedValueOnce(JSON.stringify([processRow]))
      .mockResolvedValueOnce("");
    await new DevServerDiscovery({ platform: "win32", command }).signal(processRow, false);
    const helper = script(command.mock.calls[1][1]);
    expect(helper).toContain("CloseMainWindow()");
    expect(helper).not.toContain(".Kill()");
  });
  it("keeps macOS inspection usable but denies management when precise birth helper is absent", async () => {
    const command = vi.fn<DiscoveryCommand>().mockImplementation(async (name) => {
      if (name === "ps") return psLine;
      if (name === "lsof") return "p1234\nn/work/dev\n";
      throw Object.assign(new Error("helper missing"), { code: "ENOENT" });
    });
    const discovery = new DevServerDiscovery({ platform: "darwin", command });
    expect(await discovery.identity(1234)).toEqual({
      pid: 1234,
      parentPid: 20,
      name: "node",
      command: "/usr/local/bin/node server.js",
      cwd: "/work/dev",
      startedAt: "",
    });
    await expect(discovery.signal({ pid: 1234, startedAt: "" }, true)).rejects.toThrow(
      "unavailable",
    );
  });
  it("uses precise microsecond macOS birth in snapshots and revalidates inside native signal helper", async () => {
    const preciseBirth = "1791792855:456789";
    const command = vi.fn<DiscoveryCommand>().mockImplementation(async (name, args) => {
      if (name === "ps") return psLine;
      if (name === "lsof") return "p1234\nn/work/dev\n";
      if (args[2] === "signal") return "";
      return JSON.stringify([{ pid: 1234, startedAt: preciseBirth }]);
    });
    const discovery = new DevServerDiscovery({ platform: "darwin", command });
    expect((await discovery.processes())[0].startedAt).toBe(preciseBirth);
    await discovery.signal({ pid: 1234, startedAt: preciseBirth }, false);
    const call = command.mock.calls.find(([, args]) => args[2] === "signal")!;
    expect(call[1].slice(2)).toEqual(["signal", "1234", preciseBirth, "15"]);
    expect(call[1][1]).toContain("$length == 136");
    expect(call[1][1]).toContain("unpack('L',substr($buffer,12,4)) == $pid");
    expect(call[1][1].indexOf("$birth eq $expected")).toBeLessThan(
      call[1][1].indexOf("kill(int($signal)"),
    );
  });
  it("distinguishes macOS empty lsof exit from an actual scanner error", async () => {
    const empty = new DevServerDiscovery({
      platform: "darwin",
      command: vi.fn<DiscoveryCommand>().mockRejectedValue({ code: 1, stdout: "", stderr: "" }),
    });
    await expect(empty.listeners()).resolves.toEqual([]);
    const failure = new DevServerDiscovery({
      platform: "darwin",
      command: vi.fn<DiscoveryCommand>().mockRejectedValue(new Error("permission denied")),
    });
    await expect(failure.listeners()).rejects.toThrow("permission denied");
  });
  it("checks Linux boot and start ticks in the same helper immediately before TERM or KILL", async () => {
    const command = vi.fn<DiscoveryCommand>().mockResolvedValue("");
    const discovery = new DevServerDiscovery({ platform: "linux", command });
    const identity = { pid: 1234, startedAt: "boot-id:456", name: "node" };
    vi.spyOn(discovery, "identity").mockResolvedValue(identity);
    await discovery.signal(identity, false);
    await discovery.signal(identity, true);
    expect(command.mock.calls[0][1].slice(-3)).toEqual(["1234", "boot-id:456", "TERM"]);
    expect(command.mock.calls[1][1].slice(-3)).toEqual(["1234", "boot-id:456", "KILL"]);
    const helper = command.mock.calls[0][1][1];
    expect(helper.indexOf('[ "$birth" = "$expected" ]')).toBeLessThan(
      helper.indexOf('kill -"$sig"'),
    );
    expect(helper).not.toContain("kill -- -");
  });
  it("limits helper concurrency even for fresh uncached identity requests", async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const command = vi.fn<DiscoveryCommand>().mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      active--;
      return JSON.stringify([processRow]);
    });
    const discovery = new DevServerDiscovery({ platform: "win32", command });
    const work = Array.from({ length: 8 }, () => discovery.identity(1234));
    await vi.waitFor(() => expect(releases.length).toBe(4));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases.length).toBe(4));
    releases.splice(0).forEach((release) => release());
    await Promise.all(work);
    expect(peak).toBe(4);
  });
  it("invalidates cached scans and prevents an older in-flight result repopulating the cache", async () => {
    let finish!: (value: string) => void;
    const command = vi
      .fn<DiscoveryCommand>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce('{"processes":[],"listeners":[]}');
    const discovery = new DevServerDiscovery({ platform: "win32", command });
    const oldScan = discovery.listeners();
    await vi.waitFor(() => expect(finish).toBeDefined());
    discovery.invalidate();
    expect(await discovery.listeners()).toEqual([]);
    finish(windowsSnapshot());
    await oldScan;
    expect(await discovery.listeners()).toEqual([]);
    expect(command).toHaveBeenCalledTimes(2);
  });
});

describe("Linux /proc fallback", () => {
  const stat = `1234 (node) ${["S", "20", ...Array(17).fill("0"), "456789", "0"].join(" ")}`;
  const tcp =
    "header\n0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 999\n";
  const files = (): DiscoveryFileSystem => ({
    text: vi.fn(async (path) => {
      if (path === "/proc/net/tcp") return tcp;
      if (path === "/proc/net/tcp6") return "header\n";
      if (path === "/proc/sys/kernel/random/boot_id") return "boot-id\n";
      if (path === "/proc/1234/stat") return stat;
      if (path === "/proc/1234/cmdline") return "node\0server.js\0";
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    }),
    directories: vi.fn(async (path) => (path === "/proc" ? ["1234", "net", "sys"] : ["20"])),
    link: vi.fn(async (path) => (path.endsWith("/cwd") ? "/work/dev" : "socket:[999]")),
  });
  it("discovers sockets and metadata without ss using bounded fd ownership lookup", async () => {
    const command = vi
      .fn<DiscoveryCommand>()
      .mockRejectedValue(Object.assign(new Error("ss missing"), { code: "ENOENT" }));
    const fileSystem = files();
    const discovery = new DevServerDiscovery({ platform: "linux", command, files: fileSystem });
    expect(await discovery.listeners()).toEqual([
      {
        process: {
          pid: 1234,
          parentPid: 20,
          name: "node",
          startedAt: "boot-id:456789",
          command: "node server.js",
          cwd: "/work/dev",
        },
        endpoints: [{ address: "127.0.0.1", port: 5173, url: "http://127.0.0.1:5173" }],
      },
    ]);
    expect(fileSystem.text).toHaveBeenCalledWith("/proc/net/tcp");
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("resolves ownerless ss listeners through /proc and retains unreadable owners inspect-only", async () => {
    const fileSystem = files();
    const command = vi
      .fn<DiscoveryCommand>()
      .mockResolvedValue("LISTEN 0 511 127.0.0.1:5173 0.0.0.0:*\n");
    const discovery = new DevServerDiscovery({ platform: "linux", command, files: fileSystem });
    expect((await discovery.listeners())[0].process.pid).toBe(1234);
    const blocked = files();
    blocked.directories = vi.fn(async (path) => {
      if (path === "/proc") return ["1234"];
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    const unknown = new DevServerDiscovery({ platform: "linux", command, files: blocked });
    expect((await unknown.listeners())[0].process).toEqual({
      pid: 0,
      name: "Unknown process",
      startedAt: "",
    });
  });
  it("matches equivalent IPv6 address spellings during owner recovery", async () => {
    const fileSystem = files();
    const originalText = fileSystem.text;
    fileSystem.text = async (path) =>
      path === "/proc/net/tcp"
        ? "header\n"
        : path === "/proc/net/tcp6"
          ? "header\n0: 00000000000000000000000001000000:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 999\n"
          : originalText(path);
    const command = vi
      .fn<DiscoveryCommand>()
      .mockResolvedValue("LISTEN 0 511 [0:0:0:0:0:0:0:1]:5173 [::]:*\n");
    const discovery = new DevServerDiscovery({ platform: "linux", command, files: fileSystem });
    expect((await discovery.listeners())[0].process.pid).toBe(1234);
  });
  it("treats already exited Linux zombies as stopped", async () => {
    const fileSystem = files();
    const originalText = fileSystem.text;
    fileSystem.text = async (path) =>
      path.endsWith("/stat") ? stat.replace(") S ", ") Z ") : originalText(path);
    expect(
      await new DevServerDiscovery({ platform: "linux", files: fileSystem }).identity(1234),
    ).toBeUndefined();
  });
  it.each([false, true])(
    "does not signal an already exited Linux target (force: %s)",
    async (force) => {
      const fileSystem = files();
      const originalText = fileSystem.text;
      fileSystem.text = async (path) =>
        path.endsWith("/stat") ? stat.replace(") S ", ") Z ") : originalText(path);
      const command = vi.fn<DiscoveryCommand>();
      const discovery = new DevServerDiscovery({ platform: "linux", files: fileSystem, command });
      await expect(
        discovery.signal({ pid: 1234, startedAt: "boot-id:456" }, force),
      ).resolves.toBeUndefined();
      expect(command).not.toHaveBeenCalled();
    },
  );
  it("still refuses an existing reused Linux PID before running any signal helper", async () => {
    const command = vi.fn<DiscoveryCommand>();
    const discovery = new DevServerDiscovery({ platform: "linux", files: files(), command });
    await expect(discovery.signal({ pid: 1234, startedAt: "stale-birth" }, true)).rejects.toThrow(
      "identity changed",
    );
    expect(command).not.toHaveBeenCalled();
  });
  it("accepts an owned Linux child disappearing after fresh validation without signalling another PID", async () => {
    const fileSystem = files();
    const originalText = fileSystem.text;
    let exited = false;
    fileSystem.text = async (path) => {
      if (exited && path.endsWith("/stat"))
        throw Object.assign(new Error("Gone"), { code: "ENOENT" });
      return originalText(path);
    };
    const command = vi.fn<DiscoveryCommand>();
    const discovery = new DevServerDiscovery({ platform: "linux", files: fileSystem, command });
    const validated = await discovery.identity(1234);
    expect(validated?.startedAt).toBeTruthy();
    exited = true;
    await expect(discovery.signal(validated!, true)).resolves.toBeUndefined();
    expect(command).not.toHaveBeenCalled();
  });
  it.each(["EACCES", "EPERM"])(
    "refuses an unreadable Linux identity instead of assuming exit: %s",
    async (code) => {
      const fileSystem = files();
      const originalText = fileSystem.text;
      fileSystem.text = async (path) => {
        if (path.endsWith("/stat")) throw Object.assign(new Error("Denied"), { code });
        return originalText(path);
      };
      const command = vi.fn<DiscoveryCommand>();
      const discovery = new DevServerDiscovery({ platform: "linux", files: fileSystem, command });
      await expect(discovery.signal({ pid: 1234, startedAt: "boot-id:456" }, true)).rejects.toThrow(
        "identity changed",
      );
      expect(command).not.toHaveBeenCalled();
    },
  );
  it("does not treat a failed ss scan or unreadable /proc scan as no servers", async () => {
    const command = vi
      .fn<DiscoveryCommand>()
      .mockRejectedValue(Object.assign(new Error("scan permission denied"), { code: "EACCES" }));
    await expect(
      new DevServerDiscovery({ platform: "linux", command, files: files() }).listeners(),
    ).rejects.toThrow("scan permission denied");
    const missing = vi
      .fn<DiscoveryCommand>()
      .mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const unreadable = files();
    unreadable.text = vi.fn(async () => {
      throw Object.assign(new Error("proc permission denied"), { code: "EACCES" });
    });
    await expect(
      new DevServerDiscovery({
        platform: "linux",
        command: missing,
        files: unreadable,
      }).listeners(),
    ).rejects.toThrow("proc permission denied");
  });
});

it("discovers the owned real test listener and refuses its stale identity", async () => {
  // Never signal or stop any pre-existing host process. This child owns two
  // ephemeral ports and is closed only through the ChildProcess handle we made.
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const http=require('node:http');const a=http.createServer((_,r)=>r.end('a'));const b=http.createServer((_,r)=>r.end('b'));a.listen(0,'127.0.0.1',()=>b.listen(0,'127.0.0.1',()=>console.log(JSON.stringify([a.address().port,b.address().port]))));`,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const ports = await new Promise<number[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Owned listener did not start")), 5_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout!.once("data", (data: Buffer) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
    const discovery = new DevServerDiscovery({ cacheMs: 0 });
    const found = (await discovery.listeners()).find((item) => item.process.pid === child.pid);
    expect(found).toBeDefined();
    expect(found!.endpoints.map((item) => item.port)).toEqual(expect.arrayContaining(ports));
    expect(found!.process.startedAt).not.toBe("");
    const identity = await discovery.identity(child.pid!);
    expect(identity!.startedAt).toBe(found!.process.startedAt);
    await expect(
      discovery.signal({ pid: child.pid!, startedAt: `${identity!.startedAt}-stale` }, true),
    ).rejects.toThrow("identity changed");
    expect(child.exitCode).toBeNull();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
}, 30_000);
