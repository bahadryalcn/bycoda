import { execFile } from "node:child_process";
import { parseProcessJson } from "./parse-process-json.mjs";
import { readFile, readdir, readlink } from "node:fs/promises";
import { basename } from "node:path";
import type {
  DevProcess,
  DevProcessIdentity,
  DevServerEndpoint,
} from "../src/features/host-tools/devServerTypes.js";

export type DiscoveredDevProcess = {
  process: DevProcess;
  endpoints: DevServerEndpoint[];
};
export interface ProcessDiscovery {
  invalidate?(): void;
  listeners(): Promise<DiscoveredDevProcess[]>;
  processes(): Promise<DevProcess[]>;
  identity(pid: number): Promise<DevProcess | undefined>;
  signal(identity: DevProcessIdentity, force: boolean): Promise<void>;
}
type CommandOptions = {
  windowsHide: true;
  timeout: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
};
export type DiscoveryCommand = (
  executable: string,
  args: string[],
  options: CommandOptions,
) => Promise<string>;
export type DiscoveryFileSystem = {
  text(path: string): Promise<string>;
  directories(path: string): Promise<string[]>;
  link(path: string): Promise<string>;
};
type Listener = { pid: number; address: string; port: number };
type ProcSocket = { address: string; port: number; inode: string };
const COMMAND_TIMEOUT = 8_000;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const SCAN_TIMEOUT = 15_000;
const MAX_PROCESSES = 16_384;
const procFiles: DiscoveryFileSystem = {
  async text(path) {
    const value = await readFile(path, {
      encoding: "utf8",
      signal: AbortSignal.timeout(COMMAND_TIMEOUT),
    });
    if (Buffer.byteLength(value) > OUTPUT_LIMIT)
      throw new Error("Process discovery file exceeds its output limit");
    return value;
  },
  directories: (path) => readdir(path),
  link: (path) => readlink(path),
};

const runCommand: DiscoveryCommand = (executable, args, options) =>
  new Promise((resolve, reject) => {
    execFile(executable, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const failure = Object.assign(
          new Error(
            `Process discovery command failed: ${error.message.slice(0, 500)}${stderr ? `: ${stderr.slice(-500)}` : ""}`,
          ),
          { code: (error as NodeJS.ErrnoException).code, stdout, stderr },
        );
        reject(failure);
      } else resolve(stdout);
    });
  });

const psProcessProjection = `@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;name=[string]$p.Name;command=[string]$p.CommandLine;startedAt=$birth}`;
// Birth comes from the native process handle, retaining all FILETIME precision.
const psBirth = `$birth='';try{$native=[System.Diagnostics.Process]::GetProcessById([int]$p.ProcessId);$ticks=$native.StartTime.ToUniversalTime().Ticks;if([Math]::Abs($ticks-$p.CreationDate.ToUniversalTime().Ticks) -le 10){$birth=$ticks.ToString()};$native.Dispose()}catch{}`;
const windowsProcesses = `$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process | ForEach-Object {$p=$_;${psBirth};${psProcessProjection}});ConvertTo-Json -InputObject $rows -Compress -Depth 4`;
const windowsListeners = `$ErrorActionPreference='Stop';$tcp=@(Get-NetTCPConnection -State Listen -ErrorAction Stop);$ids=@($tcp.OwningProcess | Select-Object -Unique);$rows=@(Get-CimInstance Win32_Process | Where-Object {$ids -contains $_.ProcessId} | ForEach-Object {$p=$_;${psBirth};${psProcessProjection}});ConvertTo-Json -InputObject @{processes=$rows;listeners=@($tcp | ForEach-Object {@{pid=[int]$_.OwningProcess;address=[string]$_.LocalAddress;port=[int]$_.LocalPort}})} -Compress -Depth 5`;

// Darwin proc_info syscall / PROC_PIDTBSDINFO. The native proc_bsdinfo ABI is
// 136 bytes on supported 64-bit Macs; validate the PID and timeval before use.
// ABI source: https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
// Syscall: https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/syscalls.master
// System Perl avoids a compiler/developer-tools prompt or installing a package.
const macNativeHelper = `use strict;use warnings;use JSON::PP;
sub birth {
  my ($pid)=@_;my $buffer="\\0" x 136;
  my $length=syscall(336,2,int($pid),3,0,$buffer,136);
  return undef unless $length == 136;
  return undef unless unpack('L',substr($buffer,12,4)) == $pid;
  my ($sec,$usec)=unpack('Q2',substr($buffer,120,16));
  return undef unless $sec > 978307200 && $sec <= time()+60 && $usec < 1000000;
  return "$sec:$usec";
}
my $mode=shift @ARGV;
if ($mode eq 'signal') {
  my ($pid,$expected,$signal)=@ARGV;
  my $birth=birth($pid);
  die "Precise process identity unavailable or changed\\n" unless defined($birth) && $birth eq $expected;
  kill(int($signal),int($pid)) == 1 or die "Process signal failed: $!\\n";
} else {
  my @rows=map { my $birth=birth($_);{pid=>int($_),startedAt=>defined($birth)?$birth:''} } @ARGV;
  print encode_json(\\@rows);
}`;

function validPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid <= 0x7fffffff;
}
function endpoint(address: string, port: number): DevServerEndpoint {
  const host =
    address === "0.0.0.0" || address === "*"
      ? "127.0.0.1"
      : address === "::"
        ? "[::1]"
        : address.includes(":")
          ? `[${address.replace(/^\[|\]$/g, "")}]`
          : address;
  return { address, port, url: `http://${host}:${port}` };
}
function parseAddress(value: string): { address: string; port: number } | undefined {
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) return undefined;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return undefined;
  return { address: match[1].replace(/^\[|\]$/g, ""), port };
}
function sameAddress(first: string, second: string): boolean {
  const canonical = (address: string) => {
    if (!address.includes(":")) return address;
    try {
      return new URL(`http://[${address}]/`).hostname;
    } catch {
      return address;
    }
  };
  return first === "*"
    ? second === "0.0.0.0" || second === "::"
    : canonical(first) === canonical(second);
}
function jsonProcesses(value: unknown): DevProcess[] {
  if (!Array.isArray(value)) throw new Error("Invalid process discovery response");
  return value
    .filter((row: Record<string, unknown>) => Number(row.pid) !== 0)
    .map((row: Record<string, unknown>) => {
      if (!validPid(Number(row.pid))) throw new Error("Invalid discovered process PID");
      return {
        pid: Number(row.pid),
        parentPid: Number.isInteger(row.parentPid) ? Number(row.parentPid) : undefined,
        name: typeof row.name === "string" ? row.name : "Unknown process",
        command: typeof row.command === "string" && row.command ? row.command : undefined,
        cwd: typeof row.cwd === "string" && row.cwd ? row.cwd : undefined,
        startedAt: typeof row.startedAt === "string" ? row.startedAt : "",
      };
    });
}
export function parseWindowsListeners(output: string): DiscoveredDevProcess[] {
  const data = parseProcessJson(output) as {
    processes: unknown;
    listeners: unknown;
  };
  const processes = jsonProcesses(data.processes);
  if (!Array.isArray(data.listeners)) throw new Error("Invalid listener discovery response");
  const listeners = data.listeners.map((row: Record<string, unknown>) => {
    if (
      !Number.isInteger(row.pid) ||
      Number(row.pid) < 0 ||
      typeof row.address !== "string" ||
      !Number.isInteger(row.port) ||
      Number(row.port) < 1 ||
      Number(row.port) > 65535
    )
      throw new Error("Invalid discovered listener");
    return { pid: Number(row.pid), address: row.address, port: Number(row.port) };
  });
  return groupListeners(listeners, processes);
}
export function parseLsofListeners(output: string): Listener[] {
  let pid = 0;
  const result: Listener[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && validPid(pid)) {
      const parsed = parseAddress(line.slice(1).replace(/ \(LISTEN\)$/, ""));
      if (parsed) result.push({ pid, ...parsed });
    }
  }
  return result;
}
export function parseSsListeners(output: string): Listener[] {
  const result: Listener[] = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4) continue;
    // -H -ltnp includes state, recv/send queue, local, peer, process owners.
    const parsed = parseAddress(columns[3]);
    if (!parsed) continue;
    const pids = [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));
    for (const pid of pids.length ? new Set(pids) : [0]) result.push({ pid, ...parsed });
  }
  return result;
}
export function parsePsProcesses(output: string): DevProcess[] {
  const result: DevProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/.exec(
      line,
    );
    if (!match) continue;
    const command = match[4].trim();
    result.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      // ps lstart is rounded to seconds and cannot authorize management.
      startedAt: "",
      name: basename(command.split(/\s+/)[0]),
      command,
    });
  }
  return result;
}
export function parseProcStat(pid: number, stat: string, bootId: string): DevProcess {
  const end = stat.lastIndexOf(")");
  const start = stat.indexOf("(");
  const fields = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  if (start < 0 || end < start || fields.length < 20 || !/^\d+$/.test(fields[19]))
    throw new Error("Invalid /proc process identity");
  return {
    pid,
    parentPid: Number(fields[1]),
    name: stat.slice(start + 1, end),
    startedAt: `${bootId.trim()}:${fields[19]}`,
  };
}
export function parseProcSockets(output: string, ipv6 = false): ProcSocket[] {
  const result: ProcSocket[] = [];
  for (const line of output.split(/\r?\n/).slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[3] !== "0A" || fields.length < 10) continue;
    const [hexAddress, hexPort] = fields[1].split(":");
    if (!hexAddress || !hexPort) continue;
    const port = Number.parseInt(hexPort, 16);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    let address: string;
    if (ipv6 && hexAddress.length === 32) {
      const bytes = hexAddress.match(/.{8}/g)!.flatMap((word) => word.match(/.{2}/g)!.reverse());
      const groups = Array.from({ length: 8 }, (_, i) =>
        Number.parseInt(bytes.slice(i * 2, i * 2 + 2).join(""), 16).toString(16),
      );
      address = groups.every((group) => group === "0")
        ? "::"
        : groups.slice(0, 7).every((group) => group === "0") && groups[7] === "1"
          ? "::1"
          : groups.join(":");
    } else if (!ipv6 && hexAddress.length === 8) {
      address = hexAddress
        .match(/.{2}/g)!
        .reverse()
        .map((byte) => Number.parseInt(byte, 16))
        .join(".");
    } else continue;
    result.push({ address, port, inode: fields[9] });
  }
  return result;
}
function groupListeners(listeners: Listener[], processes: DevProcess[]): DiscoveredDevProcess[] {
  const processMap = new Map(processes.map((process) => [process.pid, process]));
  const grouped = new Map<string, DiscoveredDevProcess>();
  for (const listener of listeners) {
    const key = listener.pid
      ? String(listener.pid)
      : `unknown:${listener.address}:${listener.port}`;
    const item = grouped.get(key) ?? {
      process: processMap.get(listener.pid) ?? {
        pid: listener.pid,
        startedAt: "",
        name: "Unknown process",
      },
      endpoints: [],
    };
    if (
      !item.endpoints.some(
        (item) => item.port === listener.port && item.address === listener.address,
      )
    )
      item.endpoints.push(endpoint(listener.address, listener.port));
    grouped.set(key, item);
  }
  return [...grouped.values()].sort(
    (a, b) => (a.endpoints[0]?.port ?? 0) - (b.endpoints[0]?.port ?? 0),
  );
}
async function mapLimit<T, R>(
  values: T[],
  limit: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        result[index] = await work(values[index]);
      }
    }),
  );
  return result;
}

export class DevServerDiscovery implements ProcessDiscovery {
  private readonly platform: NodeJS.Platform;
  private readonly command: DiscoveryCommand;
  private readonly files: DiscoveryFileSystem;
  private readonly cacheMs: number;
  private listenerCache?: { time: number; value: DiscoveredDevProcess[] };
  private listenerFlight?: Promise<DiscoveredDevProcess[]>;
  private processCache?: { time: number; value: DevProcess[] };
  private processFlight?: Promise<DevProcess[]>;
  private cacheRevision = 0;
  private activeCommands = 0;
  private commandQueue: (() => void)[] = [];
  constructor(
    options: {
      platform?: NodeJS.Platform;
      command?: DiscoveryCommand;
      files?: DiscoveryFileSystem;
      cacheMs?: number;
    } = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.command = options.command ?? runCommand;
    this.files = options.files ?? procFiles;
    this.cacheMs = options.cacheMs ?? 1_000;
  }
  private run(executable: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const start = () => {
        clearTimeout(timer);
        this.activeCommands++;
        void Promise.resolve()
          .then(() =>
            this.command(executable, args, {
              windowsHide: true,
              timeout: COMMAND_TIMEOUT,
              maxBuffer: OUTPUT_LIMIT,
              env: { ...process.env, LC_ALL: "C", LANG: "C" },
            }),
          )
          .then(resolve, reject)
          .finally(() => {
            this.activeCommands--;
            this.commandQueue.shift()?.();
          });
      };
      const timer = setTimeout(() => {
        const index = this.commandQueue.indexOf(start);
        if (index >= 0) this.commandQueue.splice(index, 1);
        reject(new Error("Process discovery command queue timed out"));
      }, COMMAND_TIMEOUT);
      if (this.activeCommands < 4) start();
      else if (this.commandQueue.length >= 64) {
        clearTimeout(timer);
        reject(new Error("Process discovery command queue is full"));
      } else this.commandQueue.push(start);
    });
  }
  private powershell(script: string): Promise<string> {
    return this.run("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ]);
  }
  invalidate(): void {
    this.cacheRevision++;
    this.listenerCache = undefined;
    this.processCache = undefined;
    this.listenerFlight = undefined;
    this.processFlight = undefined;
  }
  listeners(): Promise<DiscoveredDevProcess[]> {
    if (this.listenerCache && Date.now() - this.listenerCache.time < this.cacheMs)
      return Promise.resolve(this.listenerCache.value);
    if (this.listenerFlight) return this.listenerFlight;
    const revision = this.cacheRevision;
    const flight = this.scanListeners()
      .then((value) => {
        if (revision === this.cacheRevision) this.listenerCache = { time: Date.now(), value };
        return value;
      })
      .finally(() => {
        if (this.listenerFlight === flight) this.listenerFlight = undefined;
      });
    this.listenerFlight = flight;
    return flight;
  }
  processes(): Promise<DevProcess[]> {
    if (this.processCache && Date.now() - this.processCache.time < this.cacheMs)
      return Promise.resolve(this.processCache.value);
    if (this.processFlight) return this.processFlight;
    const revision = this.cacheRevision;
    const flight = this.scanProcesses()
      .then((value) => {
        if (revision === this.cacheRevision) this.processCache = { time: Date.now(), value };
        return value;
      })
      .finally(() => {
        if (this.processFlight === flight) this.processFlight = undefined;
      });
    this.processFlight = flight;
    return flight;
  }
  /** Always fresh: callers must never signal using a cached identity. */
  async identity(pid: number): Promise<DevProcess | undefined> {
    if (!validPid(pid)) return undefined;
    if (this.platform === "win32") {
      const rows = jsonProcesses(
        parseProcessJson(
          await this.powershell(
            `$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ForEach-Object {$p=$_;${psBirth};${psProcessProjection}});ConvertTo-Json -InputObject $rows -Compress -Depth 4`,
          ),
        ),
      );
      return rows[0];
    }
    if (this.platform === "linux") return this.linuxIdentity(pid);
    if (this.platform === "darwin") {
      try {
        const item = parsePsProcesses(
          await this.run("ps", ["-p", String(pid), "-o", "pid=,ppid=,lstart=,args="]),
        )[0];
        if (item) {
          item.startedAt = (await this.macBirths([pid])).get(pid) ?? "";
          item.cwd = await this.macCwd(pid);
        }
        return item;
      } catch (error) {
        if ((error as { code?: number }).code === 1) return undefined;
        throw error;
      }
    }
    throw new Error(`Process discovery is unsupported on ${this.platform}`);
  }
  async signal(identity: DevProcessIdentity, force: boolean): Promise<void> {
    if (!validPid(identity.pid) || !identity.startedAt)
      throw new Error("Process birth identity is unavailable; management is disabled");
    if (identity.pid === process.pid) throw new Error("The bycoda host process cannot be stopped");
    const current = await this.identity(identity.pid);
    // Linux returns undefined only for ENOENT/ESRCH or an exited zombie. A child
    // or its waiting shell can exit after the service's check, leaving no target.
    // Unavailable birth identities and present reused PIDs still fail closed.
    if (!current && this.platform === "linux") return;
    if (!current || current.startedAt !== identity.startedAt)
      throw new Error("Process identity changed; refresh the server list before stopping it");
    this.invalidate();
    if (this.platform === "win32") {
      if (!/^\d+$/.test(identity.startedAt))
        throw new Error("Invalid Windows process birth identity");
      // Opening Handle pins the process object. Kill() uses that cached handle,
      // so PID reuse between validation and the actual signal cannot target a new process.
      await this.powershell(
        `$ErrorActionPreference='Stop';$target=[System.Diagnostics.Process]::GetProcessById(${identity.pid});try{$null=$target.Handle;$birth=$target.StartTime.ToUniversalTime().Ticks.ToString();if($birth -cne '${identity.startedAt}'){throw 'Process identity changed'};${force ? "$target.Kill()" : "$null=$target.CloseMainWindow()"}}finally{$target.Dispose()}`,
      );
    } else if (this.platform === "linux") {
      // Re-read boot ID and /proc start ticks in the same helper immediately before kill.
      await this.run("/bin/sh", [
        "-c",
        `set -eu
# Already exited: there is nothing left to stop.
stat=$(cat "/proc/$1/stat" 2>/dev/null) || exit 0
fields=\${stat##*) }
set -- "$1" "$2" "$3" $fields
pid=$1; expected=$2; sig=$3
shift 3
shift 19
birth="$(cat /proc/sys/kernel/random/boot_id):$1"
[ "$birth" = "$expected" ] || { echo 'Process identity changed' >&2; exit 3; }
kill -"$sig" "$pid" 2>/dev/null || [ ! -e "/proc/$pid" ]`,
        "bycoda-process-signal",
        String(identity.pid),
        identity.startedAt,
        force ? "KILL" : "TERM",
      ]);
    } else if (this.platform === "darwin") {
      if (!/^\d+:\d+$/.test(identity.startedAt))
        throw new Error(
          "Precise macOS process birth identity is unavailable; management is disabled",
        );
      await this.run("/usr/bin/perl", [
        "-e",
        macNativeHelper,
        "signal",
        String(identity.pid),
        identity.startedAt,
        force ? "9" : "15",
      ]);
    } else throw new Error(`Process signaling is unsupported on ${this.platform}`);
  }
  private async scanProcesses(): Promise<DevProcess[]> {
    if (this.platform === "win32")
      return jsonProcesses(parseProcessJson(await this.powershell(windowsProcesses)));
    if (this.platform === "darwin") {
      const items = parsePsProcesses(await this.run("ps", ["-axo", "pid=,ppid=,lstart=,args="]));
      if (items.length > MAX_PROCESSES)
        throw new Error("Process discovery exceeded its process limit");
      const births = await this.macBirths(items.map((item) => item.pid));
      return items.map((item) => ({ ...item, startedAt: births.get(item.pid) ?? "" }));
    }
    if (this.platform !== "linux")
      throw new Error(`Process discovery is unsupported on ${this.platform}`);
    const deadline = Date.now() + SCAN_TIMEOUT;
    const ids = (await this.files.directories("/proc"))
      .filter((value) => /^\d+$/.test(value))
      .map(Number);
    if (ids.length > MAX_PROCESSES) throw new Error("Process discovery exceeded its process limit");
    const bootId = await this.files.text("/proc/sys/kernel/random/boot_id");
    return (
      await mapLimit(ids, 8, async (pid) => {
        if (Date.now() > deadline) throw new Error("Process discovery timed out");
        return this.linuxIdentity(pid, bootId);
      })
    ).filter((item): item is DevProcess => !!item);
  }
  private async linuxIdentity(pid: number, knownBootId?: string): Promise<DevProcess | undefined> {
    const file = (path: string) => this.files.text(path);
    let item: DevProcess;
    try {
      const [stat, bootId] = await Promise.all([
        file(`/proc/${pid}/stat`),
        knownBootId ? Promise.resolve(knownBootId) : file("/proc/sys/kernel/random/boot_id"),
      ]);
      if (/^[ZX]$/.test(stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[0])) return undefined;
      item = parseProcStat(pid, stat, bootId);
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return undefined;
      if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return { pid, name: "Unknown process", startedAt: "" };
      throw error;
    }
    const [command, cwd] = await Promise.allSettled([
      file(`/proc/${pid}/cmdline`),
      this.files.link(`/proc/${pid}/cwd`),
    ]);
    if (command.status === "fulfilled")
      item.command = command.value.replace(/\0/g, " ").trim() || undefined;
    if (cwd.status === "fulfilled") item.cwd = cwd.value;
    return item;
  }
  private async macCwd(pid: number): Promise<string | undefined> {
    try {
      const output = await this.run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
      return output
        .split(/\r?\n/)
        .find((line) => line.startsWith("n"))
        ?.slice(1);
    } catch {
      return undefined;
    }
  }
  private async macBirths(pids: number[]): Promise<Map<number, string>> {
    try {
      const rows = JSON.parse(
        await this.run("/usr/bin/perl", ["-e", macNativeHelper, "identity", ...pids.map(String)]),
      ) as { pid: number; startedAt: string }[];
      if (!Array.isArray(rows)) return new Map();
      return new Map(
        rows
          .filter((row) => validPid(row.pid) && /^\d+:\d+$/.test(row.startedAt))
          .map((row) => [row.pid, row.startedAt]),
      );
    } catch {
      // Discovery remains usable without the native helper. Management fails
      // closed: never fall back to ps's coarse timestamp for a signal.
      return new Map();
    }
  }
  private async scanListeners(): Promise<DiscoveredDevProcess[]> {
    if (this.platform === "win32")
      return parseWindowsListeners(await this.powershell(windowsListeners));
    if (this.platform === "darwin") {
      const deadline = Date.now() + SCAN_TIMEOUT;
      let output: string;
      try {
        output = await this.run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]);
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        if (failure.code === 1 && !failure.stdout && !failure.stderr) return [];
        throw error;
      }
      const listeners = parseLsofListeners(output);
      const processes = await this.processes();
      const ids = new Set(listeners.map((item) => item.pid));
      const owners = processes.filter((item) => ids.has(item.pid));
      await mapLimit(owners, 4, async (item) => {
        if (Date.now() > deadline) throw new Error("Listener discovery timed out");
        item.cwd = await this.macCwd(item.pid);
      });
      return groupListeners(listeners, owners);
    }
    if (this.platform !== "linux")
      throw new Error(`Listener discovery is unsupported on ${this.platform}`);
    let listeners: Listener[];
    let usedProc = false;
    try {
      listeners = parseSsListeners(await this.run("ss", ["-H", "-ltnp"]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      listeners = await this.procListeners();
      usedProc = true;
    }
    if (!usedProc && listeners.some((item) => item.pid === 0)) {
      const proc = await this.procListeners();
      listeners = listeners.flatMap((item) =>
        item.pid
          ? [item]
          : proc.filter(
                (owner) => owner.port === item.port && sameAddress(item.address, owner.address),
              ).length
            ? proc.filter(
                (owner) => owner.port === item.port && sameAddress(item.address, owner.address),
              )
            : [item],
      );
    }
    return groupListeners(listeners, await this.processes());
  }
  private async procListeners(): Promise<Listener[]> {
    const deadline = Date.now() + SCAN_TIMEOUT;
    const [tcp, tcp6] = await Promise.all([
      this.files.text("/proc/net/tcp"),
      this.files.text("/proc/net/tcp6").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      }),
    ]);
    const sockets = [...parseProcSockets(tcp), ...parseProcSockets(tcp6, true)];
    const needed = new Set(sockets.map((item) => item.inode));
    const owners = new Map<string, Set<number>>();
    const pids = (await this.files.directories("/proc"))
      .filter((value) => /^\d+$/.test(value))
      .map(Number);
    if (pids.length > MAX_PROCESSES)
      throw new Error("Process discovery exceeded its process limit");
    await mapLimit(pids, 8, async (pid) => {
      if (Date.now() > deadline) throw new Error("Listener discovery timed out");
      let descriptors: string[];
      try {
        descriptors = await this.files.directories(`/proc/${pid}/fd`);
        if (descriptors.length > MAX_PROCESSES)
          throw new Error("Listener discovery exceeded its descriptor limit");
      } catch (error) {
        if (
          ["ENOENT", "EACCES", "EPERM", "ESRCH"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          return;
        throw error;
      }
      for (const fd of descriptors) {
        if (Date.now() > deadline) throw new Error("Listener discovery timed out");
        let link: string;
        try {
          link = await this.files.link(`/proc/${pid}/fd/${fd}`);
        } catch (error) {
          if (
            ["ENOENT", "EACCES", "EPERM", "ESRCH", "EINVAL"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            continue;
          throw error;
        }
        const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
        if (inode && needed.has(inode)) {
          const set = owners.get(inode) ?? new Set<number>();
          set.add(pid);
          owners.set(inode, set);
        }
      }
    });
    return sockets.flatMap((socket) =>
      [...(owners.get(socket.inode) ?? [0])].map((pid) => ({
        pid,
        address: socket.address,
        port: socket.port,
      })),
    );
  }
}
