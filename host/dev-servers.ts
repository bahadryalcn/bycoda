import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type {
  DevProcess,
  DevProcessIdentity,
  DevServer,
  DevServerDetails,
  DevServerEndpoint,
  DevServerScan,
  DevServerStartResult,
  DevServerStop,
} from "../src/features/host-tools/devServerTypes";
import { DevServerDiscovery } from "./dev-server-discovery";
import { resolveShellProfile, shellInvocation, type ShellProfile } from "./shellProfiles";
import type { RuntimeLogLevel, RuntimeLogSource } from "../src/features/host-tools/runtimeLogTypes";
import { scrubRuntimeLogText, type RuntimeLogsService } from "./runtime-logs";

export type DevServerProject = { id: string; name: string; path: string };
export interface DevServerProcessDiscovery {
  listeners(): Promise<{ process: DevProcess; endpoints: DevServerEndpoint[] }[]>;
  processes(): Promise<DevProcess[]>;
  identity(pid: number): Promise<DevProcess | undefined>;
  signal(identity: DevProcessIdentity, force: boolean): Promise<void>;
  invalidate?(): void;
}

type ManagedServer = {
  server: DevServer;
  child: ChildProcess;
  identities: Map<number, DevProcess>;
  output: string;
  expectedPort?: number;
  failedPort?: number;
  exitCode?: number | null;
};

export type DevServersOptions = {
  discovery?: DevServerProcessDiscovery;
  spawnProcess?: typeof spawn;
  shellProfile?: ShellProfile | null;
  graceMs?: number;
  pollMs?: number;
  cacheMs?: number;
  scanTimeoutMs?: number;
  maxConcurrent?: number;
  queueTimeoutMs?: number;
  runtimeLogs?: RuntimeLogsService;
};

const same = (a: DevProcessIdentity | undefined, b: DevProcessIdentity | undefined) =>
  !!a && !!b && a.pid > 0 && !!a.startedAt && a.pid === b.pid && a.startedAt === b.startedAt;
const externalId = (process: DevProcessIdentity) =>
  `external:${process.pid}:${encodeURIComponent(process.startedAt)}`;
const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const MAX_LOG = 256 * 1024;
const MAX_MANAGED = 100;
const MAX_LINE = 8192;

function serverLogLevel(line: string): RuntimeLogLevel {
  if (
    /(?:\b(?:error|fatal|panic|exception|EADDRINUSE)\b|^\s*(?:TypeError|ReferenceError|SyntaxError):)/i.test(
      line,
    )
  )
    return "error";
  if (/\b(?:warn(?:ing)?|deprecated|deprecation)\b/i.test(line)) return "warn";
  if (/^\s*(?:\[debug\]|debug\s*[:\]])/i.test(line)) return "debug";
  // Toolchains often write successful builds and progress to stderr.
  return "info";
}

function legacyChunkRedactor() {
  let tail = "";
  let continuation: "line" | "bare" | '"' | "'" | undefined;
  return (chunk: string) => {
    const raw = tail + chunk;
    let safe = chunk;
    if (continuation) {
      const end =
        continuation === "line"
          ? chunk.search(/[\r\n]/)
          : continuation === "bare"
            ? chunk.search(/[\s,;&}\]\r\n]/)
            : chunk.indexOf(continuation);
      safe = end < 0 ? "[REDACTED]" : `[REDACTED]${chunk.slice(end)}`;
      if (end >= 0) continuation = undefined;
    }
    if (
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]*$/i.test(
        raw,
      )
    ) {
      continuation = "line";
    } else {
      const value =
        /(?:\b(?:password|passwd|secret|client[_-]?secret|(?:access|refresh|id)[_-]?token|token|api[_-]?key)["']?\s*[:=]\s*|\b(?:Bearer|Basic)\s+)(?:"([^"\r\n]*)|'([^'\r\n]*)|([^\s,;&}\]\r\n]*))$/i.exec(
          raw,
        );
      if (value)
        continuation = value[1] !== undefined ? '"' : value[2] !== undefined ? "'" : "bare";
    }
    tail = continuation ? "" : raw.slice(-128);
    return safe;
  };
}

function birthOrder(value: string): { namespace: string; time: bigint } | undefined {
  if (/^\d+$/.test(value)) return { namespace: "windows", time: BigInt(value) };
  const mac = /^(\d+):(\d+)$/.exec(value);
  if (mac) return { namespace: "mac", time: BigInt(mac[1]) * 1_000_000n + BigInt(mac[2]) };
  const linux = /^(.+):(\d+)$/.exec(value);
  if (linux) return { namespace: linux[1], time: BigInt(linux[2]) };
  return undefined;
}

/** Match only a known working directory. Command text is never project evidence. */
export function devServerProject(cwd: string | undefined, projects: DevServerProject[]) {
  if (!cwd) return undefined;
  const paths = /^[a-z]:[\\/]/i.test(cwd) ? win32 : { resolve, relative, isAbsolute };
  const normalized = paths.resolve(cwd);
  return projects
    .filter((project) => {
      const difference = paths.relative(paths.resolve(project.path), normalized);
      return !difference || (!difference.startsWith("..") && !paths.isAbsolute(difference));
    })
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** A bounded traversal, starting at the selected process, never its terminal/parent. */
export function devServerDescendants(root: DevProcessIdentity, processes: DevProcess[]) {
  const selected: DevProcess[] = [];
  const seen = new Set([root.pid]);
  const identities = new Map(processes.map((process) => [process.pid, process]));
  identities.set(root.pid, { ...root, name: "" });
  let parents = [root.pid];
  while (parents.length && selected.length < 4096) {
    const next: number[] = [];
    for (const process of processes) {
      if (
        process.parentPid !== undefined &&
        parents.includes(process.parentPid) &&
        !seen.has(process.pid)
      ) {
        // On Windows a child can retain an exited parent's reused PID. It is
        // unrelated to the younger process currently holding that parent PID.
        const parentBirth = birthOrder(identities.get(process.parentPid)!.startedAt);
        const childBirth = birthOrder(process.startedAt);
        if (
          parentBirth &&
          childBirth &&
          parentBirth.namespace === childBirth.namespace &&
          childBirth.time < parentBirth.time
        )
          continue;
        seen.add(process.pid);
        selected.push(process);
        next.push(process.pid);
      }
    }
    parents = next;
  }
  return selected;
}

/** Host-local service. Remote RPC runs this same service on the selected host. */
export class DevServersService {
  private readonly discovery: DevServerProcessDiscovery;
  private readonly options: DevServersOptions;
  private readonly managed = new Map<string, ManagedServer>();
  private readonly observed = new Map<string, DevServer>();
  private readonly busy = new Set<string>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private cache?: { key: string; until: number; result: DevServerScan };
  private scanning?: { key: string; generation: number; promise: Promise<DevServerScan> };
  private generation = 0;
  private logSourcesRefresh?: { key: string; nextAt: number; promise: Promise<void> };

  constructor(options: DevServersOptions = {}) {
    this.options = options;
    this.discovery = options.discovery ?? new DevServerDiscovery();
  }

  /** Call without awaiting from log polling. The first poll schedules discovery;
   * subsequent polls reuse the same work for at least fifteen seconds. */
  refreshLogSources(projects: DevServerProject[]): Promise<void> {
    const key = JSON.stringify(projects);
    if (this.logSourcesRefresh?.key === key && this.logSourcesRefresh.nextAt > Date.now())
      return this.logSourcesRefresh.promise;
    const promise = this.list(projects).then(() => {});
    this.logSourcesRefresh = { key, nextAt: Date.now() + 15_000, promise };
    return promise;
  }

  async handle(method: string, params: Record<string, unknown>, projects: DevServerProject[]) {
    if (this.active >= (this.options.maxConcurrent ?? 4)) {
      if (this.waiting.length >= 16)
        throw new Error("Dev server operations are busy; try again shortly.");
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(resume);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(new Error("Timed out waiting for a dev server operation slot."));
        }, this.options.queueTimeoutMs ?? 10_000);
        timer.unref?.();
        this.waiting.push(resume);
      });
    } else this.active++;
    try {
      switch (method) {
        case "devServers.list":
          return await this.list(projects, params.refresh === true);
        case "devServers.details":
          return await this.details(params, projects);
        case "devServers.start":
          return await this.exclusive("start", () => this.start(params, projects));
        case "devServers.stop":
        case "devServers.kill":
          return await this.exclusive(this.id(params), () =>
            this.stop(params, projects, method === "devServers.kill"),
          );
        case "devServers.restart":
          return await this.exclusive(this.id(params), () =>
            this.exclusive("start", () => this.restart(params, projects)),
          );
        case "devServers.logs": {
          const managed = this.managed.get(this.id(params));
          return { available: !!managed, output: managed?.output ?? "" };
        }
        default:
          throw new Error(`Unknown dev server method: ${method}`);
      }
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async exclusive<T>(key: string, work: () => Promise<T>) {
    if (this.busy.has(key)) throw new Error("This dev server operation is already in progress.");
    this.busy.add(key);
    try {
      return await work();
    } finally {
      this.busy.delete(key);
    }
  }

  private id(params: Record<string, unknown>) {
    if (typeof params.id !== "string" || !params.id)
      throw new Error("A dev server ID is required.");
    return params.id;
  }

  private invalidate() {
    this.cache = undefined;
    this.generation++;
    this.discovery.invalidate?.();
  }

  private async snapshot() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.all([this.discovery.listeners(), this.discovery.processes()]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Dev server discovery timed out.")),
            this.options.scanTimeoutMs ?? 12_000,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async list(projects: DevServerProject[], refresh = false): Promise<DevServerScan> {
    const key = JSON.stringify(projects);
    if (!refresh && this.cache?.key === key && this.cache.until > Date.now())
      return this.cache.result;
    if (this.scanning?.key === key && this.scanning.generation === this.generation)
      return this.scanning.promise;
    const generation = this.generation;
    const promise = this.scan(projects, generation);
    this.scanning = { key, generation, promise };
    try {
      const result = await promise;
      if (generation === this.generation && result.status === "ok")
        this.cache = { key, until: Date.now() + (this.options.cacheMs ?? 1500), result };
      return result;
    } finally {
      if (this.scanning?.promise === promise) this.scanning = undefined;
    }
  }

  private async scan(projects: DevServerProject[], generation: number): Promise<DevServerScan> {
    try {
      const [listeners, processes] = await this.snapshot();
      if (generation !== this.generation) return this.list(projects, true);
      const used = new Set<string>();
      const servers: DevServer[] = [];
      for (const record of this.managed.values()) {
        const root = record.server.process;
        const liveRoot = root && processes.find((process) => same(root, process));
        const children = liveRoot ? devServerDescendants(liveRoot, processes) : [];
        for (const child of children) record.identities.set(child.pid, child);
        const owned = processes.filter((process) =>
          same(record.identities.get(process.pid), process),
        );
        for (const [pid, identity] of record.identities) {
          if (pid !== root?.pid && !owned.some((process) => same(identity, process)))
            record.identities.delete(pid);
        }
        const endpoints: DevServerEndpoint[] = [];
        for (const listener of listeners) {
          if (owned.some((process) => same(process, listener.process))) {
            used.add(externalId(listener.process));
            endpoints.push(...listener.endpoints);
          }
        }
        if (owned.length) {
          if (record.server.state !== "stopping" && record.server.state !== "error") {
            record.server.state = endpoints.length ? "running" : "starting";
          }
        } else if (root && record.server.state !== "error") {
          record.server.state =
            record.exitCode === undefined || record.exitCode === 0 ? "stopped" : "error";
        }
        record.server.endpoints = this.endpoints(endpoints);
        servers.push({ ...record.server, endpoints: [...record.server.endpoints] });
      }
      const external = new Map<string, DevServer>();
      for (const listener of listeners) {
        const id =
          listener.process.pid > 0
            ? externalId(listener.process)
            : `unidentified:${listener.endpoints[0]?.address}:${listener.endpoints[0]?.port}`;
        if (used.has(id)) continue;
        const project = devServerProject(listener.process.cwd, projects);
        const previous = external.get(id);
        if (previous)
          previous.endpoints = this.endpoints([...previous.endpoints, ...listener.endpoints]);
        else
          external.set(id, {
            id,
            process: listener.process,
            endpoints: this.endpoints(listener.endpoints),
            managed: false,
            state: "running",
            name: listener.process.name,
            command: listener.process.command,
            cwd: listener.process.cwd,
            projectId: project?.id,
            projectName: project?.name,
            association: project ? "cwd" : "uncertain",
            logsAvailable: false,
          });
      }
      servers.push(...external.values());
      for (const previous of this.observed.values()) {
        if (!servers.some((server) => server.id === previous.id))
          this.options.runtimeLogs?.setSource({
            ...this.logSource(previous),
            available: false,
            reason: "This server is no longer observed on the host.",
          });
      }
      for (const server of servers) this.options.runtimeLogs?.setSource(this.logSource(server));
      this.observed.clear();
      for (const server of servers) this.observed.set(server.id, server);
      return { status: "ok", servers, scannedAt: Date.now() };
    } catch (error) {
      return { status: "error", servers: [], scannedAt: Date.now(), error: failure(error) };
    }
  }

  private endpoints(endpoints: DevServerEndpoint[]) {
    return [
      ...new Map(
        endpoints.map((endpoint) => [`${endpoint.address}:${endpoint.port}`, endpoint]),
      ).values(),
    ].sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
  }

  private logSource(server: DevServer): RuntimeLogSource {
    return {
      id: `server:${server.id}`,
      kind: "server",
      label: server.name,
      projectId: server.projectId,
      url: server.endpoints[0]?.url,
      available: server.managed && !["stopped", "error"].includes(server.state),
      reason: !server.managed
        ? "This process was started outside bycoda; its stdout and stderr history are unavailable."
        : ["stopped", "error"].includes(server.state)
          ? "The managed process has stopped. Retained logs remain available."
          : undefined,
    };
  }

  private async server(
    params: Record<string, unknown>,
    projects: DevServerProject[],
    mutation = false,
  ) {
    const id = this.id(params);
    const managed = this.managed.get(id);
    let server = managed?.server ?? this.observed.get(id);
    if (!server) {
      const scan = await this.list(projects, true);
      if (scan.status === "error") throw new Error(scan.error);
      server = scan.servers.find((entry) => entry.id === id);
    }
    if (!server) throw new Error("The selected server is no longer available; refresh the list.");
    if (mutation && (!managed || params.identity !== undefined)) {
      const identity = params.identity as Partial<DevProcessIdentity> | undefined;
      if (!identity || !server.process || !same(server.process, identity as DevProcessIdentity)) {
        throw new Error(
          "The selected process identity is missing or changed; refresh before stopping it.",
        );
      }
    }
    return { server, managed };
  }

  private async selection(
    params: Record<string, unknown>,
    projects: DevServerProject[],
    mutation: boolean,
  ) {
    const selected = await this.server(params, projects, mutation);
    const root = selected.server.process;
    if (!root)
      return {
        ...selected,
        targets: [] as DevProcess[],
        descendants: [] as DevProcess[],
        affectedPorts: [] as number[],
      };
    const [listeners, processes] = await this.snapshot();
    if (mutation) {
      const protectedPids = new Set([process.pid]);
      let ancestor = processes.find((entry) => entry.pid === process.pid);
      while (ancestor?.parentPid && !protectedPids.has(ancestor.parentPid)) {
        protectedPids.add(ancestor.parentPid);
        ancestor = processes.find((entry) => entry.pid === ancestor!.parentPid);
      }
      if (protectedPids.has(root.pid))
        throw new Error("The host process or its terminal parent cannot be stopped.");
      const tree = params.tree === true || (!!selected.managed && params.tree !== false);
      if (
        tree &&
        devServerDescendants(root, processes).some((entry) => protectedPids.has(entry.pid))
      ) {
        throw new Error(
          "The selected process tree contains the host or its terminal parent and cannot be stopped.",
        );
      }
    }
    let current = processes.find((process) => process.pid === root.pid);
    if (current && !same(root, current)) {
      if (selected.managed) current = undefined;
      else throw new Error("The PID now belongs to a different process; refresh the server list.");
    }
    const descendants = current ? devServerDescendants(current, processes) : [];
    const known = selected.managed
      ? processes.filter((process) => {
          const observed = selected.managed!.identities.get(process.pid);
          return !!observed && same(observed, process) && process.pid !== root.pid;
        })
      : [];
    const tree = params.tree === true || (!!selected.managed && params.tree !== false);
    const children = [
      ...new Map([...known, ...descendants].map((process) => [process.pid, process])).values(),
    ];
    if (selected.managed)
      for (const child of descendants) selected.managed.identities.set(child.pid, child);
    const targets = [...(current ? [current] : []), ...(tree ? children : [])];
    const listenersForServer = selected.managed
      ? [...(current ? [current] : []), ...children]
      : current
        ? [current]
        : [];
    const freshServer = {
      ...selected.server,
      endpoints: this.endpoints(
        listeners
          .filter((listener) =>
            listenersForServer.some((process) => same(process, listener.process)),
          )
          .flatMap((listener) => listener.endpoints),
      ),
    };
    const affectedPorts = [
      ...new Set(
        listeners
          .filter((listener) => targets.some((process) => same(process, listener.process)))
          .flatMap((listener) => listener.endpoints.map((endpoint) => endpoint.port)),
      ),
    ].sort((a, b) => a - b);
    return { ...selected, server: freshServer, targets, descendants: children, affectedPorts };
  }

  private async details(
    params: Record<string, unknown>,
    projects: DevServerProject[],
  ): Promise<DevServerDetails> {
    // Details show the impact of an explicit tree stop as well as the listener's own ports.
    const selected = await this.selection(
      { ...params, tree: params.tree !== false },
      projects,
      false,
    );
    return {
      server: selected.server,
      descendants: selected.descendants,
      affectedPorts: selected.affectedPorts,
    };
  }

  private async stop(
    params: Record<string, unknown>,
    projects: DevServerProject[],
    force: boolean,
  ): Promise<DevServerStop> {
    const selected = await this.selection(params, projects, true);
    if (selected.targets.some((process) => !process.startedAt || process.pid <= 0))
      throw new Error(
        "A process birth identity in the selected tree is unavailable; no process was signalled.",
      );
    if (selected.targets.length > 128)
      throw new Error("The selected process tree is too large to stop safely in one operation.");
    const operationDeadline = Date.now() + 20_000;
    if (selected.managed) selected.managed.server.state = "stopping";
    this.invalidate();
    let signalError: string | undefined;
    try {
      // Children first. Never ask the OS to kill an unverified process group/tree.
      for (const process of [...selected.targets].reverse()) {
        if (Date.now() >= operationDeadline)
          throw new Error("Process shutdown timed out before every process could be signalled.");
        const current = await this.discovery.identity(process.pid);
        if (!current) continue;
        if (!same(process, current))
          throw new Error(
            `PID ${process.pid} belongs to a different process; it was not signalled.`,
          );
        if (Date.now() >= operationDeadline)
          throw new Error("Process shutdown timed out before every process could be signalled.");
        try {
          await this.discovery.signal(process, force);
        } catch (error) {
          // Graceful shutdown may be unavailable to a windowless external console process.
          if (force) throw error;
          signalError = failure(error);
        }
      }
      const until = Date.now() + (this.options.graceMs ?? 1500);
      let alive: DevProcess[] = [];
      for (;;) {
        alive = [];
        for (const process of selected.targets) {
          if (Date.now() >= operationDeadline)
            throw new Error(
              "Process shutdown verification timed out. Refresh the process details before continuing.",
            );
          const current = await this.discovery.identity(process.pid);
          if (same(process, current)) alive.push(current!);
        }
        if (!alive.length || Date.now() >= until) break;
        await sleep(this.options.pollMs ?? 100);
      }
      if (selected.managed) selected.managed.server.state = alive.length ? "running" : "stopped";
      return {
        state: alive.length ? "running" : "stopped",
        requiresForce: alive.length > 0,
        affectedPorts: selected.affectedPorts,
        message: alive.length
          ? (signalError ?? "The process is still running. Force termination is available.")
          : undefined,
      };
    } catch (error) {
      if (selected.managed) {
        selected.managed.server.state = "error";
        selected.managed.server.error = failure(error);
      }
      throw error;
    } finally {
      this.invalidate();
    }
  }

  private async start(
    params: Record<string, unknown>,
    projects: DevServerProject[],
  ): Promise<DevServerStartResult> {
    const command = typeof params.command === "string" ? params.command.trim() : "";
    if (!command) throw new Error("A dev server command is required.");
    const project = projects.find((entry) => entry.id === params.projectId);
    const cwd = typeof params.cwd === "string" && params.cwd.trim() ? params.cwd : project?.path;
    if (!cwd || !isAbsolute(cwd)) throw new Error("An absolute working directory is required.");
    this.validateDirectory(cwd);
    const expectedPort = params.expectedPort;
    if (
      expectedPort !== undefined &&
      (typeof expectedPort !== "number" ||
        !Number.isInteger(expectedPort) ||
        expectedPort < 1 ||
        expectedPort > 65535)
    ) {
      throw new Error("Expected port must be an integer between 1 and 65535.");
    }
    if (expectedPort !== undefined) {
      const scan = await this.list(projects, true);
      if (scan.status === "error") throw new Error(scan.error);
      const conflicts = scan.servers.filter((server) =>
        server.endpoints.some((endpoint) => endpoint.port === expectedPort),
      );
      if (conflicts.length)
        return { conflict: { port: expectedPort as number, servers: conflicts } };
    }
    if (this.managed.size >= MAX_MANAGED) {
      const retired = [...this.managed].find(
        ([, record]) =>
          record.exitCode !== undefined && ["stopped", "error"].includes(record.server.state),
      );
      if (!retired) throw new Error("Too many managed dev servers are active.");
      this.managed.delete(retired[0]);
    }
    const profile =
      this.options.shellProfile === undefined ? resolveShellProfile() : this.options.shellProfile;
    const windows = process.platform === "win32";
    const invocation = profile
      ? shellInvocation(profile, command)
      : {
          file: windows ? "powershell.exe" : "/bin/sh",
          args: windows ? ["-NoProfile", "-Command", command] : ["-lc", command],
          env: {},
          verbatim: false,
        };
    const child = (this.options.spawnProcess ?? spawn)(invocation.file, invocation.args, {
      cwd,
      env: { ...process.env, ...invocation.env },
      windowsVerbatimArguments: invocation.verbatim,
      windowsHide: true,
      // A dedicated command, separate from shared terminal tabs. No group-wide kills.
      detached: !windows,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record: ManagedServer = {
      child,
      identities: new Map(),
      output: "",
      expectedPort: expectedPort as number | undefined,
      server: {
        id: randomUUID(),
        name: typeof params.name === "string" && params.name.trim() ? params.name : command,
        command,
        cwd,
        managed: true,
        state: "starting",
        endpoints: [],
        association: "managed",
        projectId: project?.id,
        projectName: project?.name,
        logsAvailable: true,
      },
    };
    this.managed.set(record.server.id, record);
    this.options.runtimeLogs?.setSource(this.logSource(record.server));
    const stdout = new StringDecoder("utf8");
    const stderr = new StringDecoder("utf8");
    const append = (chunk: string) => {
      // Redact before trimming: otherwise a giant credential can lose its key
      // while leaving its secret suffix in the retained rolling output.
      record.output = scrubRuntimeLogText(record.output + chunk, Number.MAX_SAFE_INTEGER).slice(
        -MAX_LOG,
      );
      if (/EADDRINUSE|address already in use/i.test(record.output)) {
        const explicit =
          /\bport\s*[:=]\s*(\d{1,5})\b/i.exec(record.output) ??
          /(?:EADDRINUSE|address already in use)[^\r\n]*:(\d{1,5})\b/i.exec(record.output);
        const port = explicit && Number(explicit[1]);
        if (port && port <= 65535) record.failedPort = port;
      }
      const port = record.expectedPort ?? record.failedPort;
      if (
        port &&
        record.server.error !==
          `Port ${port} is already in use. Refresh to inspect the current process or choose another port.` &&
        /EADDRINUSE|address already in use|port .{0,25}(?:already in use|occupied)/i.test(
          record.output,
        )
      ) {
        record.server.state = "error";
        record.server.error = `Port ${port} is already in use. Refresh to inspect the current process or choose another port.`;
        this.invalidate();
      }
    };
    let closed = false;
    const capture = (stream: "stdout" | "stderr") => {
      let pending = "";
      let timestamp = 0;
      let truncated = false;
      const emit = () => {
        // oxlint-disable-next-line no-control-regex -- Strip ANSI controls from process output.
        const line = pending.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
        if (line.trim()) {
          const stack = /^\s+at\s/.test(line) ? line : undefined;
          const frame =
            /(?:\(|\s)((?:[A-Za-z]:[\\/]|\/|file:\/\/|https?:\/\/)[^\s()]+):(\d+):(\d+)\)?/.exec(
              line,
            );
          this.options.runtimeLogs?.add(this.logSource(record.server), {
            timestamp,
            level: serverLogLevel(line),
            message: `${line}${truncated ? "… [truncated]" : ""}`,
            details: { stream },
            ...(stack ? { stack } : {}),
            ...(frame
              ? { location: { file: frame[1], line: Number(frame[2]), column: Number(frame[3]) } }
              : {}),
          });
        }
        pending = "";
        timestamp = 0;
        truncated = false;
      };
      return (text: string, flush = false) => {
        // A huge unterminated line is retained once, then discarded until a line
        // boundary. In particular, fragments of a long credential are never emitted.
        for (const part of text.split(/(\r\n|\n|\r)/)) {
          if (/^(?:\r\n|\n|\r)$/.test(part)) {
            emit();
          } else if (part) {
            if (!timestamp) timestamp = Date.now();
            const remaining = MAX_LINE - pending.length;
            pending += part.slice(0, remaining);
            if (part.length > remaining) truncated = true;
          }
        }
        if (flush) emit();
      };
    };
    const captureStdout = capture("stdout");
    const captureStderr = capture("stderr");
    const redactStdout = legacyChunkRedactor();
    const redactStderr = legacyChunkRedactor();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (closed) return;
      const text = stdout.write(chunk);
      append(redactStdout(text));
      captureStdout(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (closed) return;
      const text = stderr.write(chunk);
      append(redactStderr(text));
      captureStderr(text);
    });
    child.on("error", (error) => {
      if (closed) return;
      record.server.state = "error";
      record.server.error = error.message;
      append(`${error.message}\n`);
      captureStderr(`${error.message}\n`);
      this.options.runtimeLogs?.setSource(this.logSource(record.server));
      this.invalidate();
    });
    child.on("close", (code) => {
      if (closed) return;
      closed = true;
      const stdoutEnd = stdout.end(),
        stderrEnd = stderr.end();
      append(redactStdout(stdoutEnd) + redactStderr(stderrEnd));
      captureStdout(stdoutEnd, true);
      captureStderr(stderrEnd, true);
      record.exitCode = code;
      if (record.server.state !== "error" && record.server.state !== "stopping") {
        record.server.state = code === 0 ? "stopped" : "error";
        if (code !== 0) record.server.error = `Dev server exited (${code ?? "signal"}).`;
      }
      this.options.runtimeLogs?.setSource({
        ...this.logSource(record.server),
        available: false,
        reason: "The managed process has stopped. Retained logs remain available.",
      });
      this.invalidate();
    });
    this.invalidate();
    const until = Date.now() + 2000;
    while (child.pid && record.exitCode === undefined && record.server.state !== "error") {
      const identity = await this.discovery.identity(child.pid);
      if (
        record.exitCode !== undefined ||
        (child.exitCode !== undefined && child.exitCode !== null) ||
        (child.signalCode !== undefined && child.signalCode !== null)
      )
        break;
      if (identity?.startedAt) {
        record.server.process = identity;
        record.identities.set(identity.pid, identity);
        break;
      }
      if (Date.now() >= until) {
        record.server.error =
          "Could not verify the new process identity. Refresh discovery before managing it.";
        break;
      }
      await sleep(this.options.pollMs ?? 100);
    }
    {
      // Catch bind races between the preflight scan and the command starting.
      const settleUntil = Date.now() + 750;
      for (;;) {
        const scan = await this.list(projects, true);
        const current = scan.servers.find((server) => server.id === record.server.id);
        const conflictPort = record.failedPort ?? record.expectedPort;
        const conflicts = scan.servers.filter(
          (server) =>
            server.id !== record.server.id &&
            conflictPort !== undefined &&
            server.endpoints.some((endpoint) => endpoint.port === conflictPort),
        );
        if (conflicts.length)
          return {
            server: { ...record.server },
            conflict: { port: conflictPort!, servers: conflicts },
          };
        if (
          current?.endpoints.length ||
          record.server.state === "error" ||
          record.server.state === "stopped" ||
          Date.now() >= settleUntil
        )
          break;
        await sleep(this.options.pollMs ?? 100);
      }
    }
    return { server: { ...record.server } };
  }

  private validateDirectory(cwd: string) {
    try {
      if (statSync(cwd).isDirectory()) return;
    } catch {
      /* Report the requested directory without running a replacement command. */
    }
    throw new Error("The working directory does not exist or is not a directory.");
  }

  private async restart(
    params: Record<string, unknown>,
    projects: DevServerProject[],
  ): Promise<DevServerStartResult> {
    const selected = await this.server(params, projects, true);
    if (
      !selected.managed &&
      (typeof params.command !== "string" ||
        !params.command.trim() ||
        typeof params.cwd !== "string" ||
        !params.cwd.trim())
    ) {
      throw new Error(
        "Restarting an external server requires an explicit command and working directory.",
      );
    }
    // Validate replacement inputs before stopping the currently running command.
    const replacement = {
      ...params,
      command: selected.managed?.server.command ?? params.command,
      cwd: selected.managed?.server.cwd ?? params.cwd,
      projectId: selected.managed?.server.projectId ?? params.projectId,
      name: selected.managed?.server.name ?? params.name,
      expectedPort: params.expectedPort ?? selected.managed?.expectedPort,
    };
    if (typeof replacement.cwd !== "string" || !isAbsolute(replacement.cwd))
      throw new Error("An absolute working directory is required.");
    this.validateDirectory(replacement.cwd);
    if (
      replacement.expectedPort !== undefined &&
      (typeof replacement.expectedPort !== "number" ||
        !Number.isInteger(replacement.expectedPort) ||
        replacement.expectedPort < 1 ||
        replacement.expectedPort > 65535)
    ) {
      throw new Error("Expected port must be an integer between 1 and 65535.");
    }
    const result = await this.stop({ ...params, tree: true }, projects, false);
    if (result.requiresForce)
      throw new Error(
        "The previous process is still running. Stop it with force before restarting.",
      );
    return this.start(replacement, projects);
  }
}
