import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { monotonicNow } from "../../src/shared/lib/time/timestamps";
import { prepareDevServerGuardian } from "../dev-server-guardian";
import type { NativeGuardianChild } from "../provider-guardian";
import type {
  DevProcess,
  DevProcessIdentity,
  DevServer,
  DevServerDetails,
  DevServerEndpoint,
  DevServerScan,
  DevServerStartResult,
  DevServerStop,
} from "../../src/features/host-tools/devServerTypes";
import { DevServerDiscovery } from "./dev-server-discovery";
import { DevPortLeases, portLeaseEnvironment } from "./dev-port-leases";
import type { WorkspacePortKind, WorkspacePortLease } from "../workspaces/workspace-contracts";
import { resolveShellProfile, shellInvocation, type ShellProfile } from "../execution/shellProfiles";
import type { RuntimeLogLevel, RuntimeLogSource } from "../../src/features/host-tools/runtimeLogTypes";
import {
  RuntimeLogLineRedactor,
  scrubRuntimeLogText,
  type RuntimeLogsService,
} from "../execution/runtime-logs";

export type DevServerProject = { id: string; name: string; path: string };
export type WorkspaceDevServerRequest = {
  workspaceId: string;
  runId: string;
  kinds: WorkspacePortKind[];
  preferred?: Partial<Record<WorkspacePortKind, number>>;
  command: string;
  cwd: string;
  projectId?: string;
  name?: string;
};
export interface DevServerProcessDiscovery {
  listeners(): Promise<{ process: DevProcess; endpoints: DevServerEndpoint[] }[]>;
  processes(): Promise<DevProcess[]>;
  identity(pid: number): Promise<DevProcess | undefined>;
  signal(identity: DevProcessIdentity, force: boolean): Promise<void>;
  invalidate?(): void;
}

type DevServerChild = EventEmitter & {
  readonly pid?: number;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
};
type ManagedServer = {
  server: DevServer;
  child: DevServerChild;
  guardian?: NativeGuardianChild;
  identities: Map<number, DevProcess>;
  output: RedactedOutput;
  expectedPort?: number;
  failedPort?: number;
  exitCode?: number | null;
  exited?: boolean;
  shutdownUnverified?: boolean;
  treeRetired?: boolean;
};

export type DevServersOptions = {
  discovery?: DevServerProcessDiscovery;
  spawnProcess?: typeof spawn;
  prepareGuardian?: typeof prepareDevServerGuardian;
  shellProfile?: ShellProfile | null;
  graceMs?: number;
  pollMs?: number;
  cacheMs?: number;
  scanTimeoutMs?: number;
  maxConcurrent?: number;
  queueTimeoutMs?: number;
  closeTimeoutMs?: number;
  runtimeLogs?: RuntimeLogsService;
  portLeases?: DevPortLeases;
  startActivity?(cwd: string, ownerId: string): Promise<() => Promise<void>>;
  workspaceIdForDirectory?(cwd: string): Promise<string | undefined>;
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

class RedactedOutput {
  private parts: string[] = [];
  private head = 0;
  private length = 0;
  private tail = "";

  append(chunk: string) {
    let scrubbed = scrubRuntimeLogText(this.tail + chunk, Number.MAX_SAFE_INTEGER);
    if (scrubbed.length > MAX_LOG) {
      // Copy the retained suffix so V8 cannot keep a huge discarded parent string alive.
      scrubbed = Buffer.from(scrubbed.slice(-MAX_LOG), "utf16le").toString("utf16le");
    }
    const boundary = Math.max(0, scrubbed.length - MAX_LINE);
    const prefix = scrubbed.slice(0, boundary);
    this.tail = scrubbed.slice(boundary);
    if (prefix) {
      this.parts.push(prefix);
      this.length += prefix.length;
    }
    let excess = this.length + this.tail.length - MAX_LOG;
    while (excess > 0 && this.head < this.parts.length) {
      const part = this.parts[this.head];
      if (part.length <= excess) {
        excess -= part.length;
        this.length -= part.length;
        this.parts[this.head] = "";
        this.head++;
      } else {
        this.parts[this.head] = part.slice(excess);
        this.length -= excess;
        excess = 0;
      }
    }
    if (this.head > 1024 && this.head * 2 > this.parts.length) {
      this.parts = this.parts.slice(this.head);
      this.head = 0;
    }
  }

  read() {
    return this.parts.slice(this.head).join("") + this.tail;
  }
}

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
  let pemTail = "";
  let pem = false;
  let continuation: "line" | "bare" | '"' | "'" | undefined;
  return (chunk: string) => {
    const pemRaw = pemTail + chunk;
    const begin = /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/.exec(pemRaw);
    if (pem || begin) {
      const end = /-----END [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/.exec(
        pemRaw.slice(begin?.index ?? 0),
      );
      pemTail = pemRaw.slice(-128);
      pem = !end;
      tail = "";
      continuation = undefined;
      if (!end) return "[REDACTED]";
      const suffix = (begin?.index ?? 0) + end.index + end[0].length;
      pemTail = "";
      return `[REDACTED]${scrubRuntimeLogText(pemRaw.slice(suffix))}`;
    }
    pemTail = pemRaw.slice(-128);
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
      else if (/\b(?:sk-|github_pat_|gh[pousr]_)[A-Za-z0-9_-]*$/.test(raw)) continuation = "bare";
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
      return (
        !difference ||
        (difference !== ".." && !/^\.\.[\\/]/.test(difference) && !paths.isAbsolute(difference))
      );
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
  private readonly operations = new Set<Promise<unknown>>();
  private closing = false;
  private closePromise?: Promise<void>;
  readonly portLeases: DevPortLeases;
  private readonly serverLeases = new Map<string, string>();
  private readonly workspaceLaunches = new Map<string, WorkspaceDevServerRequest>();
  private readonly activityReleases = new Map<string, () => Promise<void>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private cache?: { key: string; until: number; result: DevServerScan };
  private scanning?: { key: string; generation: number; promise: Promise<DevServerScan> };
  private generation = 0;
  private logSourcesRefresh?: { key: string; nextAt: number; promise: Promise<void> };

  constructor(options: DevServersOptions = {}) {
    this.options = options;
    this.discovery = options.discovery ?? new DevServerDiscovery();
    this.portLeases = options.portLeases ?? new DevPortLeases();
  }

  /** Internal workspace adapter. The authenticated Host resolves cwd before invoking this method. */
  async startWorkspace(
    request: WorkspaceDevServerRequest,
    projects: DevServerProject[],
    authorize?: () => Promise<void>,
  ): Promise<{ lease: WorkspacePortLease; result: DevServerStartResult }> {
    return this.exclusive("start", async () => {
      await authorize?.();
      return this.startWorkspaceUnlocked(request, projects, authorize);
    });
  }

  private async startWorkspaceUnlocked(
    request: WorkspaceDevServerRequest,
    projects: DevServerProject[],
    authorize?: () => Promise<void>,
  ) {
    const launched = await this.portLeases.launchWithRetry(request, async (lease) => {
      await authorize?.();
      let result: DevServerStartResult;
      try {
        result = await this.start(
          { ...request, expectedPort: lease.ports.vite ?? lease.ports.host },
          projects,
          portLeaseEnvironment(lease),
          authorize,
        );
      } catch (error) {
        const id = (error as { devServerId?: unknown })?.devServerId;
        const uncertain = typeof id === "string" ? this.managed.get(id) : undefined;
        if (!uncertain) throw error;
        this.serverLeases.set(uncertain.server.id, lease.id);
        this.workspaceLaunches.set(uncertain.server.id, structuredClone(request));
        return { server: { ...uncertain.server } };
      }
      if (
        result.conflict ||
        (result.server?.state === "error" && /already in use/i.test(result.server.error ?? ""))
      ) {
        if (result.server) {
          const stopped = await this.stop(
            { id: result.server.id, tree: true },
            projects,
            false,
            authorize,
          );
          if (stopped.requiresForce)
            throw new Error(
              "The failed development process is still running; stop it before retrying.",
            );
        }
        throw Object.assign(new Error("Development port bind race."), { code: "EADDRINUSE" });
      }
      if (!result.server || result.server.state === "error" || result.server.state === "stopped")
        throw new Error(result.server?.error ?? "Development process did not start.");
      this.serverLeases.set(result.server.id, lease.id);
      this.workspaceLaunches.set(result.server.id, structuredClone(request));
      return result;
    });
    return { lease: launched.lease, result: launched.value };
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

  async handle(
    method: string,
    params: Record<string, unknown>,
    projects: DevServerProject[],
    authorize?: () => Promise<void>,
  ) {
    if (this.closing) throw new Error("Development server service is closing.");
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
      if (this.closing) throw new Error("Development server service is closing.");
      await authorize?.();
      switch (method) {
        case "devServers.list":
          return await this.list(projects, params.refresh === true);
        case "devServers.details":
          return await this.details(params, projects);
        case "devServers.start":
          if (this.options.workspaceIdForDirectory) {
            const project = projects.find((entry) => entry.id === params.projectId);
            const cwd =
              typeof params.cwd === "string" && params.cwd.trim() ? params.cwd : project?.path;
            const workspaceId = cwd ? await this.options.workspaceIdForDirectory(cwd) : undefined;
            if (workspaceId && cwd)
              return (
                await this.startWorkspace(
                  {
                    workspaceId,
                    cwd,
                    projectId: project?.id,
                    runId: randomUUID(),
                    kinds: ["vite", "hmr", "host", "cdp"],
                    command: String(params.command ?? ""),
                    ...(typeof params.name === "string" ? { name: params.name } : {}),
                  },
                  projects,
                  authorize,
                )
              ).result;
          }
          return await this.exclusive("start", () =>
            this.start(params, projects, undefined, authorize),
          );
        case "devServers.stop":
        case "devServers.kill":
          return await this.exclusive(this.id(params), () =>
            this.stop(params, projects, method === "devServers.kill", authorize),
          );
        case "devServers.restart":
          return await this.exclusive(this.id(params), () =>
            this.exclusive("start", () => this.restart(params, projects, authorize)),
          );
        case "devServers.logs": {
          const managed = this.managed.get(this.id(params));
          return { available: !!managed, output: managed?.output.read() ?? "" };
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
    if (this.closing) throw new Error("Development server service is closing.");
    if (this.busy.has(key)) throw new Error("This dev server operation is already in progress.");
    this.busy.add(key);
    const operation = Promise.resolve().then(work);
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
      this.busy.delete(key);
    }
  }

  /** Drain only children admitted by this service; discovery alone grants no ownership. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      const errors: Error[] = [];
      const deadline = monotonicNow() + (this.options.closeTimeoutMs ?? 20_000);
      const bounded = async <T>(work: Promise<T>, ms: number): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error("Development server shutdown timed out; ownership remains unknown."),
                  ),
                ms,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      try {
        await bounded(Promise.allSettled(this.operations), Math.max(1, deadline - monotonicNow()));
      } catch (error) {
        errors.push(new Error(failure(error)));
      }
      for (const [id, record] of this.managed) {
        try {
          if (this.busy.has(id) || this.busy.has("start"))
            throw new Error("An owned operation is still running; shutdown is unverified.");
          if (monotonicNow() >= deadline)
            throw new Error("Development server shutdown timed out; ownership remains unknown.");
          if (record.guardian) {
            await bounded(record.guardian.stop(), Math.max(1, deadline - monotonicNow()));
            if (!record.guardian.retirementVerified)
              throw new Error("Guardian did not verify process tree retirement.");
            record.treeRetired = true;
            record.server.state = "stopped";
            if (this.serverLeases.has(id)) {
              await bounded(
                this.portLeases.release(this.serverLeases.get(id)!),
                Math.max(1, deadline - monotonicNow()),
              );
              this.serverLeases.delete(id);
            }
            await bounded(
              Promise.resolve(this.activityReleases.get(id)?.()),
              Math.max(1, deadline - monotonicNow()),
            );
            this.activityReleases.delete(id);
            continue;
          }
          if (!record.server.process) {
            throw new Error("Owned process identity is unavailable; shutdown is unverified.");
          }
          const root = await bounded(
            this.discovery.identity(record.server.process.pid),
            Math.max(1, deadline - monotonicNow()),
          );
          if (!same(root, record.server.process) && !record.treeRetired)
            throw new Error(
              "Owned process tree is no longer observable; descendant shutdown is unverified.",
            );
          if (
            record.treeRetired &&
            (record.exited || record.child.exitCode != null || record.child.signalCode != null)
          )
            continue;
          const result = await bounded(
            this.stop({ id, tree: true }, [], false, undefined, true),
            Math.max(1, deadline - monotonicNow()),
          );
          if (result.requiresForce) {
            if (monotonicNow() >= deadline)
              throw new Error("Development server shutdown timed out; ownership remains unknown.");
            const forced = await bounded(
              this.stop({ id, tree: true }, [], true, undefined, true),
              Math.max(1, deadline - monotonicNow()),
            );
            if (forced.requiresForce) throw new Error("Owned process shutdown remains unverified.");
          }
          if (!record.exited && record.child.exitCode == null && record.child.signalCode == null) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(
                done,
                Math.max(1, Math.min(this.options.graceMs ?? 3_000, deadline - monotonicNow())),
              );
              function done() {
                clearTimeout(timer);
                record.child.off("exit", done);
                resolve();
              }
              record.child.once("exit", done);
              if (record.exited || record.child.exitCode != null || record.child.signalCode != null)
                done();
            });
            if (!record.exited && record.child.exitCode == null && record.child.signalCode == null)
              throw new Error("Owned child exit was not observed; shutdown is unverified.");
          }
          if (this.serverLeases.has(id)) {
            await bounded(
              this.portLeases.release(this.serverLeases.get(id)!),
              Math.max(1, deadline - monotonicNow()),
            );
            this.serverLeases.delete(id);
          }
          await bounded(
            Promise.resolve(this.activityReleases.get(id)?.()),
            Math.max(1, deadline - monotonicNow()),
          );
          this.activityReleases.delete(id);
        } catch (error) {
          record.shutdownUnverified = true;
          record.server.state = "error";
          record.server.error = failure(error);
          errors.push(new Error(`${id}: ${failure(error)}`));
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "Development server shutdown was not fully verified.");
    })();
    return this.closePromise;
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
          const conflictPort = record.expectedPort ?? record.failedPort;
          const conflictError = `Port ${conflictPort} is already in use. Refresh to inspect the current process or choose another port.`;
          if (
            conflictPort &&
            record.server.state === "error" &&
            record.server.error === conflictError &&
            !record.shutdownUnverified &&
            !record.exited &&
            endpoints.some((endpoint) => endpoint.port === conflictPort)
          ) {
            record.server.state = "running";
            record.server.error = undefined;
            record.failedPort = undefined;
          }
          if (record.server.state !== "stopping" && record.server.state !== "error") {
            record.server.state = endpoints.length ? "running" : "starting";
          }
        } else if (
          record.guardian &&
          !record.guardian.retirementVerified &&
          record.server.state !== "error"
        ) {
          record.server.state = "starting";
        } else if (root && record.server.state !== "error") {
          record.server.state =
            record.exitCode === undefined || record.exitCode === 0 ? "stopped" : "error";
        }
        if (!owned.length && root && this.serverLeases.has(record.server.id)) {
          await this.portLeases.release(this.serverLeases.get(record.server.id)!);
          this.serverLeases.delete(record.server.id);
        }
        if (!owned.length && root && record.exitCode !== undefined) {
          await this.activityReleases.get(record.server.id)?.();
          this.activityReleases.delete(record.server.id);
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
    // Impact confirmation must not be checked against a discovery cache.
    if (mutation) this.discovery.invalidate?.();
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
      expectedImpact: this.impact(selected),
      server: selected.server,
      descendants: selected.descendants,
      affectedPorts: selected.affectedPorts,
    };
  }

  private async stop(
    params: Record<string, unknown>,
    projects: DevServerProject[],
    force: boolean,
    authorize?: () => Promise<void>,
    retainUntilExit = false,
  ): Promise<DevServerStop> {
    const selected = await this.selection(params, projects, true);
    if (params.expectedImpact !== undefined && params.expectedImpact !== this.impact(selected))
      throw new Error(
        "The reviewed process tree or ports changed; refresh and review before continuing. No process was signalled.",
      );
    if (selected.targets.some((process) => !process.startedAt || process.pid <= 0))
      throw new Error(
        "A process birth identity in the selected tree is unavailable; no process was signalled.",
      );
    if (selected.targets.length > 128)
      throw new Error("The selected process tree is too large to stop safely in one operation.");
    if (selected.managed?.guardian) {
      const record = selected.managed;
      record.server.state = "stopping";
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await authorize?.();
        await Promise.race([
          record.guardian!.stop(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error("Guardian retirement timed out; process ownership is unknown.")),
              20_000,
            );
          }),
        ]);
        if (!record.guardian!.retirementVerified)
          throw new Error("Guardian retirement is unknown.");
        record.treeRetired = true;
        record.server.state = "stopped";
        if (!retainUntilExit) {
          const id = selected.server.id;
          if (this.serverLeases.has(id)) {
            await this.portLeases.release(this.serverLeases.get(id)!);
            this.serverLeases.delete(id);
          }
          await this.activityReleases.get(id)?.();
          this.activityReleases.delete(id);
        }
        return { state: "stopped", requiresForce: false, affectedPorts: selected.affectedPorts };
      } catch (error) {
        record.shutdownUnverified = true;
        record.server.state = "error";
        record.server.error = failure(error);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        this.invalidate();
      }
    }
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
        await authorize?.();
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
      if (selected.managed && !selected.managed.shutdownUnverified)
        selected.managed.server.state = alive.length ? "running" : "stopped";
      if (
        selected.managed &&
        !alive.length &&
        selected.targets.some((process) => same(process, selected.managed!.server.process))
      )
        selected.managed.treeRetired = true;
      if (!alive.length && !retainUntilExit && this.serverLeases.has(selected.server.id)) {
        await this.portLeases.release(this.serverLeases.get(selected.server.id)!);
        this.serverLeases.delete(selected.server.id);
      }
      if (!alive.length && !retainUntilExit) {
        await this.activityReleases.get(selected.server.id)?.();
        this.activityReleases.delete(selected.server.id);
      }
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

  private impact(selected: { server: DevServer; targets: DevProcess[]; affectedPorts: number[] }) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          id: selected.server.id,
          command: selected.server.command,
          cwd: selected.server.cwd,
          targets: selected.targets
            .map(({ pid, startedAt }) => ({ pid, startedAt }))
            .sort((a, b) => a.pid - b.pid),
          ports: selected.affectedPorts,
        }),
      )
      .digest("hex");
  }

  private async start(
    params: Record<string, unknown>,
    projects: DevServerProject[],
    environment?: Record<string, string>,
    authorize?: () => Promise<void>,
  ): Promise<DevServerStartResult> {
    await authorize?.();
    const project = projects.find((entry) => entry.id === params.projectId);
    const cwd = typeof params.cwd === "string" && params.cwd.trim() ? params.cwd : project?.path;
    const release = cwd
      ? await this.options.startActivity?.(cwd, `dev-server:${randomUUID()}`)
      : undefined;
    try {
      const result = await this.startAdmitted(params, projects, environment, authorize);
      if (result.server && !["stopped", "error"].includes(result.server.state)) {
        if (release) this.activityReleases.set(result.server.id, release);
      } else await release?.();
      return result;
    } catch (error) {
      const id = (error as { devServerId?: unknown })?.devServerId;
      if (typeof id === "string" && release) this.activityReleases.set(id, release);
      else await release?.();
      throw error;
    }
  }

  private async startAdmitted(
    params: Record<string, unknown>,
    projects: DevServerProject[],
    environment?: Record<string, string>,
    authorize?: () => Promise<void>,
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
          record.exitCode !== undefined &&
          ["stopped", "error"].includes(record.server.state) &&
          (!record.guardian || record.guardian.retirementVerified) &&
          !this.serverLeases.has(record.server.id) &&
          !this.activityReleases.has(record.server.id),
      );
      if (!retired) throw new Error("Too many managed dev servers are active.");
      // Only this exact verified-retired record loses restart metadata. Held
      // leases/releases remain authoritative and are never evicted for capacity.
      this.managed.delete(retired[0]);
      this.workspaceLaunches.delete(retired[0]);
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
    const prepared =
      isAbsolute(invocation.file) &&
      !invocation.verbatim &&
      (!this.options.spawnProcess || this.options.prepareGuardian)
        ? await (this.options.prepareGuardian ?? prepareDevServerGuardian)()
        : undefined;
    try {
      await authorize?.();
      if (this.closing) throw new Error("Development server service is closing.");
    } catch (error) {
      await prepared?.dispose();
      throw error;
    }
    let guardian: NativeGuardianChild | undefined;
    if (prepared) {
      try {
        guardian = prepared.spawn(
          {
            command: invocation.file,
            args: invocation.args,
            cwd,
            env: { ...process.env, ...invocation.env, ...environment },
          },
          async () => {
            await authorize?.();
          },
          () => {
            if (this.closing) throw new Error("Development server service is closing.");
          },
        );
      } finally {
        await prepared.dispose();
      }
    }
    const child: DevServerChild =
      guardian ??
      (this.options.spawnProcess ?? spawn)(invocation.file, invocation.args, {
        cwd,
        env: { ...process.env, ...invocation.env, ...environment },
        windowsVerbatimArguments: invocation.verbatim,
        windowsHide: true,
        // A dedicated command, separate from shared terminal tabs. No group-wide kills.
        detached: !windows,
        stdio: ["ignore", "pipe", "pipe"],
      });
    const record: ManagedServer = {
      child,
      guardian,
      identities: new Map(),
      output: new RedactedOutput(),
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
    let diagnosticTail = "";
    let conflictPending = false;
    const append = (chunk: string) => {
      record.output.append(chunk);
      const diagnostic = diagnosticTail + chunk;
      const boundary = diagnosticTail.length;
      diagnosticTail = diagnostic.slice(-1024);
      const matches = [
        ...diagnostic.matchAll(
          /EADDRINUSE|address already in use|port .{0,25}(?:already in use|occupied)/gi,
        ),
      ];
      const newConflict = matches.some((match) => match.index + match[0].length > boundary);
      if (!newConflict && !conflictPending) return;
      conflictPending = !/[\r\n]/.test(chunk);
      if (/EADDRINUSE|address already in use/i.test(diagnostic)) {
        const explicit =
          /\bport\s*[:=]\s*(\d{1,5})\b/i.exec(diagnostic) ??
          /(?:EADDRINUSE|address already in use)[^\r\n]*:(\d{1,5})\b/i.exec(diagnostic);
        const port = explicit && Number(explicit[1]);
        if (port && port <= 65535) record.failedPort = port;
      }
      const port = record.expectedPort ?? record.failedPort;
      if (
        port &&
        record.server.error !==
          `Port ${port} is already in use. Refresh to inspect the current process or choose another port.` &&
        record.server.state !== "stopping" &&
        record.server.state !== "error"
      ) {
        record.server.state = "error";
        record.server.error = `Port ${port} is already in use. Refresh to inspect the current process or choose another port.`;
        conflictPending = false;
        this.invalidate();
      }
    };
    let closed = false;
    const capture = (stream: "stdout" | "stderr") => {
      const redactor = new RuntimeLogLineRedactor();
      let pending = "";
      let timestamp = 0;
      let truncated = false;
      const emit = () => {
        // oxlint-disable-next-line no-control-regex -- Strip ANSI controls from process output.
        const line = redactor.redact(pending.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""));
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
            if (part.length > remaining) {
              redactor.observeOverflow(part.slice(remaining), pending);
              truncated = true;
            }
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
    child.on("error", (error: Error) => {
      if (closed) return;
      record.server.state = "error";
      record.server.error = error.message;
      append(`${error.message}\n`);
      captureStderr(`${error.message}\n`);
      this.options.runtimeLogs?.setSource(this.logSource(record.server));
      this.invalidate();
    });
    child.once("exit", () => {
      record.exited = true;
    });
    child.on("close", (code: number | null) => {
      if (closed) return;
      closed = true;
      const stdoutEnd = stdout.end(),
        stderrEnd = stderr.end();
      append(redactStdout(stdoutEnd) + redactStderr(stderrEnd));
      captureStdout(stdoutEnd, true);
      captureStderr(stderrEnd, true);
      record.exitCode = code;
      if (guardian && !guardian.retirementVerified) {
        record.shutdownUnverified = true;
        record.server.state = "error";
        record.server.error = "Guardian process tree retirement is unknown.";
      } else if (record.server.state !== "error" && record.server.state !== "stopping") {
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
    if (guardian) {
      try {
        await guardian.started;
      } catch (error) {
        record.server.state = "error";
        record.server.error = `Guardian startup outcome is unknown for ${record.server.id}; verify retirement before retrying.`;
        throw Object.assign(new Error(record.server.error, { cause: error }), {
          devServerId: record.server.id,
        });
      }
    }
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
    authorize?: () => Promise<void>,
  ): Promise<DevServerStartResult> {
    const selected = await this.server(params, projects, true);
    const workspaceLaunch = this.workspaceLaunches.get(selected.server.id);
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
    const requestedCommand =
      params.command === undefined ? selected.managed?.server.command : params.command;
    const command = typeof requestedCommand === "string" ? requestedCommand.trim() : "";
    if (!command) throw new Error("A dev server command is required.");
    const replacement = {
      ...params,
      command,
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
    const result = await this.stop({ ...params, tree: true }, projects, false, authorize);
    if (result.requiresForce)
      throw new Error(
        "The previous process is still running. Stop it with force before restarting.",
      );
    if (workspaceLaunch)
      return (
        await this.startWorkspaceUnlocked(
          { ...workspaceLaunch, command, name: replacement.name as string | undefined },
          projects,
          authorize,
        )
      ).result;
    return this.start(replacement, projects, undefined, authorize);
  }
}
