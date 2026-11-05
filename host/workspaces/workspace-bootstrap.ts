import type { WorkspaceBootstrapReceipts } from "./workspace-bootstrap-receipts";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { WorkspaceBootstrap } from "./workspace-service-contracts.ts";
import type { WorkspaceBootstrapStatus, WorkspaceDevEnvironment } from "./workspace-contracts.ts";
import { portLeaseEnvironment } from "../dev-servers/dev-port-leases.ts";

/** A caller may use this only after the build command has reached its verified close boundary. */
export class BuildCacheSettledFailure extends Error {
  readonly original: unknown;
  constructor(original: unknown) {
    super("Build failed after command completion", { cause: original });
    this.original = original;
  }
}

export type BootstrapCommand = (request: {
  command: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
}) => Promise<string>;
export interface WorkspaceBootstrapOptions {
  receipts?: WorkspaceBootstrapReceipts;
  resolveWorkspace(workspaceId: string): Promise<string>;
  runCommand?: BootstrapCommand;
  sharedCargoTargetRoot?: string;
  toolchain?: string;
  profile?: string;
  buildLeasePollMs?: number;
  onBuildCacheState?(workspaceId: string, state: "waitingForBuildCache" | "building"): void;
}
type Operation = {
  status: WorkspaceBootstrapStatus;
  abort: AbortController;
  finished: Promise<void>;
  physicalUnknown?: boolean;
  restored?: boolean;
  durableSettled?: boolean;
};
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const safeId = (text: string) => hash(text).slice(0, 24);
const cancelled = () =>
  Object.assign(new Error("Workspace preparation was cancelled."), { code: "ABORT_ERR" });
const snapshot = (operation: Operation): WorkspaceBootstrapStatus =>
  structuredClone(operation.status);

/** Returns only bounded command output; caller never puts package-manager output in RPC errors. */
export const runBootstrapCommand: BootstrapCommand = ({ command, args, cwd, signal, env }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const windows = process.platform === "win32";
    const pinnedEntry =
      command === "pnpm" &&
      process.env.npm_execpath &&
      isAbsolute(process.env.npm_execpath) &&
      /[/\\]pnpm(?:\.c?js|\.mjs|\.exe)$/.test(process.env.npm_execpath)
        ? process.env.npm_execpath
        : undefined;
    const nodeEntry = pinnedEntry && /\.[cm]?js$/.test(pinnedEntry);
    // All Windows shell arguments here are fixed internal pnpm flags/version queries.
    const child = spawn(
      pinnedEntry
        ? nodeEntry
          ? process.execPath
          : pinnedEntry
        : windows
          ? (process.env.ComSpec ?? "cmd.exe")
          : command,
      pinnedEntry
        ? nodeEntry
          ? [pinnedEntry, ...args]
          : args
        : windows
          ? ["/d", "/s", "/c", [command, ...args].join(" ")]
          : args,
      {
        cwd,
        // Version selection is validated explicitly. Disable pnpm's self-management
        // shim, which can rewrite package-manager metadata even for --version.
        env: { ...process.env, ...env, pnpm_config_pm_on_fail: "ignore" },
        windowsHide: true,
        detached: !windows,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8192);
    });
    // Drain stderr without persisting arbitrary installer diagnostics or credentials.
    child.stderr.resume();
    const abort = () => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      if (windows) {
        spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(cancelled());
      else if (code !== 0)
        reject(
          Object.assign(new Error("Workspace package manager command failed."), {
            code: "INSTALL_FAILED",
          }),
        );
      else resolve(output.trim());
    });
  });

export class WorkspaceBootstrapService implements WorkspaceBootstrap {
  private readonly operations = new Map<string, Operation>();
  private readonly identities = new Map<string, string>();
  private readonly requests = new Map<string, { fingerprint: string; id: string }>();
  private readonly activeWorkspaces = new Map<string, string>();
  private readonly options: WorkspaceBootstrapOptions;
  private admission: Promise<unknown> = Promise.resolve();
  constructor(options: WorkspaceBootstrapOptions) {
    this.options = options;
  }

  async prepare(
    request: Parameters<WorkspaceBootstrap["prepare"]>[0],
  ): Promise<WorkspaceBootstrapStatus> {
    const pending = this.admission.then(() => this.prepareOwned(request));
    this.admission = pending.catch(() => undefined);
    return pending;
  }
  private async prepareOwned(
    request: Parameters<WorkspaceBootstrap["prepare"]>[0],
  ): Promise<WorkspaceBootstrapStatus> {
    if (!request.workspaceId || !request.idempotencyKey || !request.lockfileFingerprint)
      throw new Error("Workspace, lockfile fingerprint and idempotency key are required.");
    const requestKey = JSON.stringify([request.workspaceId, request.idempotencyKey]);
    const existingRequest = this.options.receipts ? await this.options.receipts.request(requestKey) : this.requests.get(requestKey);
    if (existingRequest) {
      if (existingRequest.fingerprint !== request.lockfileFingerprint)
        throw new Error("Bootstrap idempotency key was already used with another lockfile.");
      return snapshot(await this.operation(existingRequest.id));
    }
    const key = JSON.stringify([request.workspaceId, request.lockfileFingerprint]);
    const previous = this.options.receipts ? await this.options.receipts.identity(request.workspaceId, request.lockfileFingerprint) : this.identities.get(key);
    if (previous) {
      const operation = await this.operation(previous);
      if (!["cancelled", "failed"].includes(operation.status.state)) {
        if (this.options.receipts) await this.options.receipts.link(requestKey, request.lockfileFingerprint, previous);
        else this.requests.set(requestKey, { fingerprint: request.lockfileFingerprint, id: previous });
        return snapshot(operation);
      }
    }
    if (this.activeWorkspaces.has(request.workspaceId) || await this.options.receipts?.held(request.workspaceId))
      throw new Error("Another lockfile preparation is already running for this workspace.");
    const id = randomUUID();
    const operation: Operation = {
      status: {
        id,
        workspaceId: request.workspaceId,
        lockfileFingerprint: request.lockfileFingerprint,
        state: "pending",
      },
      abort: new AbortController(),
      finished: Promise.resolve(),
    };
    // Persist original identity before resolving paths or starting commands.
    if (this.options.receipts) await this.options.receipts.admit(operation.status, requestKey);
    this.operations.set(id, operation);
    if (!this.options.receipts) {
      this.requests.set(requestKey, { fingerprint: request.lockfileFingerprint, id });
      this.identities.set(key, id);
    }
    this.activeWorkspaces.set(request.workspaceId, id);
    operation.finished = this.install(operation).then(async () => {
      // Rejected command may still own physical descendants. Keep its exact owner.
      const settled = !operation.physicalUnknown;
      await this.options.receipts?.finish(operation.status, settled);
      operation.durableSettled = settled;
      if (settled && this.activeWorkspaces.get(request.workspaceId) === id)
        this.activeWorkspaces.delete(request.workspaceId);
      if (this.options.receipts && settled) {
        // Durable exact lookup backs bounded settled hot snapshots.
        const ready = [...this.operations].filter(([, value]) =>
          value.durableSettled === true);
        for (const [oldId, original] of ready.slice(0, Math.max(0, ready.length - 128)))
          if (this.operations.get(oldId) === original) this.operations.delete(oldId);
      }
    });
    void operation.finished.catch(() => undefined);
    return snapshot(operation);
  }

  async status(bootstrapId: string): Promise<WorkspaceBootstrapStatus> {
    return snapshot(await this.operation(bootstrapId));
  }
  async wait(bootstrapId: string): Promise<WorkspaceBootstrapStatus> {
    const operation = await this.operation(bootstrapId);
    if (operation.restored && operation.physicalUnknown)
      throw new Error(`Workspace bootstrap ${bootstrapId} retains an unresolved original owner.`);
    await operation.finished;
    return snapshot(operation);
  }
  async cancel(bootstrapId: string): Promise<WorkspaceBootstrapStatus> {
    const operation = await this.operation(bootstrapId);
    if (operation.restored && operation.physicalUnknown)
      throw new Error(`Workspace bootstrap ${bootstrapId} retains an unresolved original owner; cancellation requires its original process.`);
    if (["pending", "installing", "waitingForBuildCache"].includes(operation.status.state)) {
      operation.abort.abort();
      await operation.finished;
    }
    return snapshot(operation);
  }
  private async operation(id: string): Promise<Operation> {
    const operation = this.operations.get(id);
    if (operation) return operation;
    const receipt = await this.options.receipts?.status(id);
    if (!receipt) throw new Error("Unknown workspace bootstrap.");
    // Read-only durable snapshot: never recreate an install or accumulate read cache.
    return {
      status: receipt.settled ? receipt.status : {
        ...receipt.status,
        error: { code: "BOOTSTRAP_OWNER_UNRESOLVED", message: "Original workspace preparation owner requires inspection before retrying." },
      },
      abort: new AbortController(), finished: Promise.resolve(), restored: true,
      physicalUnknown: !receipt.settled,
    };
  }
  private async workspace(id: string): Promise<string> {
    const path = await this.options.resolveWorkspace(id);
    if (!isAbsolute(path)) throw new Error("Workspace path must be absolute.");
    return realpath(path);
  }
  private async assertDependenciesLocal(root: string) {
    try {
      if ((await lstat(join(root, "node_modules"))).isSymbolicLink())
        throw new Error("NODE_MODULES_LINK");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private async install(operation: Operation) {
    const signal = operation.abort.signal;
    try {
      const root = await this.workspace(operation.status.workspaceId);
      const fingerprint = hash(await readFile(join(root, "pnpm-lock.yaml")));
      if (fingerprint !== operation.status.lockfileFingerprint) throw new Error("LOCKFILE_CHANGED");
      await this.assertDependenciesLocal(root);
      const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
        packageManager?: string;
      };
      const pin = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha\d+\..+)?$/.exec(manifest.packageManager ?? "");
      if (!pin) throw new Error("PNPM_PIN_REQUIRED");
      signal.throwIfAborted();
      operation.status.state = "installing";
      const command = this.options.runCommand ?? runBootstrapCommand;
      const run: BootstrapCommand = async (request) => {
        await this.options.receipts?.commandEvidence(operation.status.id, {
          command: request.command, args: request.args, cwd: request.cwd,
        });
        operation.physicalUnknown = true;
        const output = await command(request);
        operation.physicalUnknown = false;
        return output;
      };
      const version = await run({ command: "pnpm", args: ["--version"], cwd: root, signal });
      if (version.trim() !== pin[1]) throw new Error("PNPM_VERSION_MISMATCH");
      signal.throwIfAborted();
      await run({
        command: "pnpm",
        args: ["install", "--frozen-lockfile", "--prefer-offline"],
        cwd: root,
        signal,
      });
      signal.throwIfAborted();
      await this.assertDependenciesLocal(root);
      if (hash(await readFile(join(root, "pnpm-lock.yaml"))) !== fingerprint)
        throw new Error("LOCKFILE_CHANGED");
      operation.status.state = "ready";
    } catch (error) {
      operation.status.state = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted) {
        const code =
          error instanceof Error && /^[A-Z_]+$/.test(error.message)
            ? error.message
            : "BOOTSTRAP_FAILED";
        operation.status.error = {
          code,
          message:
            (
              {
                NODE_MODULES_LINK: "Workspace node_modules must not be a junction or symlink.",
                LOCKFILE_CHANGED:
                  "The workspace lockfile changed; prepare the current lockfile again.",
                PNPM_PIN_REQUIRED: "The workspace must pin its pnpm version.",
                PNPM_VERSION_MISMATCH:
                  "The active pnpm version does not match the workspace packageManager pin.",
              } as Record<string, string>
            )[code] ?? "Workspace preparation failed. Check the package manager setup and retry.",
        };
      }
    }
  }

  private async cargoTarget(root: string) {
    if (!this.options.sharedCargoTargetRoot) return join(root, "temp", "build", "cargo-target");
    if (!this.options.toolchain)
      throw new Error("A concrete Rust toolchain identity is required for a shared Cargo target.");
    const lock = await readFile(join(root, "src-tauri", "Cargo.lock")).catch(async () =>
      readFile(join(root, "Cargo.lock")),
    );
    const key = hash(
      JSON.stringify([
        process.platform,
        process.arch,
        this.options.toolchain ?? "default",
        this.options.profile ?? "debug",
        hash(lock),
      ]),
    );
    return join(resolve(this.options.sharedCargoTargetRoot), key);
  }

  async devEnvironment(
    request: Parameters<WorkspaceBootstrap["devEnvironment"]>[0],
  ): Promise<WorkspaceDevEnvironment> {
    if (
      !request.runId ||
      request.ports.workspaceId !== request.workspaceId ||
      request.ports.runId !== request.runId ||
      !request.ports.ports.vite
    )
      throw new Error("Development ports must belong to this workspace and run.");
    const root = await this.workspace(request.workspaceId);
    const runRoot = join(
      root,
      "temp",
      "build",
      "managed-runs",
      safeId(request.workspaceId),
      safeId(request.runId),
    );
    const environment: WorkspaceDevEnvironment = {
      workspaceId: request.workspaceId,
      runId: request.runId,
      ports: structuredClone(request.ports),
      devUrl: `http://127.0.0.1:${request.ports.ports.vite}`,
      hostDataPath: join(runRoot, "host"),
      desktopDataPath: "",
      cargoTargetDir: await this.cargoTarget(root),
      executableRunDir: join(runRoot, "bin"),
      instanceId: `${safeId(request.workspaceId)}-${safeId(request.runId)}`,
    };
    environment.desktopDataPath = nativeDevDesktopDataPath(environment.instanceId);
    await Promise.all(
      [environment.hostDataPath, environment.executableRunDir].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    );
    return environment;
  }

  /** The sentinel is published atomically after its generation is durable. */
  async withBuildCache<T>(
    workspaceId: string,
    signal: AbortSignal,
    build: (environment: {
      cargoTargetDir: string;
      cargoHome: string;
      buildReceipt: { nonce: string; path: string };
    }) => Promise<T>,
  ): Promise<T> {
    const root = await this.workspace(workspaceId);
    const cargoTargetDir = await this.cargoTarget(root);
    await mkdir(cargoTargetDir, { recursive: true });
    const path = join(cargoTargetDir, ".bycoda-build-lease");
    const dbPath = join(cargoTargetDir, ".bycoda-build-lease.db");
    const nonce = randomUUID();
    const temporary = join(cargoTargetDir, `.bycoda-build-lease-${nonce}.tmp`);
    const owner = JSON.stringify({ version: 2, nonce, pid: process.pid, workspaceId });
    let db: DatabaseSync | undefined;
    let published = false;
    let effectStarted = false;
    let settled = false;
    const retireReceipt = async (receiptNonce: string) => {
      const receiptPath = join(cargoTargetDir, `.bycoda-build-retired-${receiptNonce}.json`);
      try {
        const before = await lstat(receiptPath);
        if (!before.isFile() || before.isSymbolicLink() || before.size > 1024) return;
        const proof = JSON.parse(await readFile(receiptPath, "utf8"));
        const after = await lstat(receiptPath);
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          Object.keys(proof).sort().join(",") !== "nonce,retirement,version" ||
          proof.version !== 1 ||
          proof.nonce !== receiptNonce ||
          proof.retirement !== "verified"
        )
          return;
        await unlink(receiptPath);
      } catch {
        /* Cleanup failure keeps harmless proof for later inspection. */
      }
    };
    const retireSettledReceipt = async () => {
      try {
        db!.exec("BEGIN EXCLUSIVE");
        const current = db!
          .prepare("SELECT nonce, uncertain FROM lease_generation WHERE id=1")
          .get() as { nonce?: unknown; uncertain?: unknown } | undefined;
        if (current?.nonce === nonce && current.uncertain === 0) await retireReceipt(nonce);
        db!.exec("COMMIT");
      } catch {
        try {
          db!.exec("ROLLBACK");
        } catch {
          /* No witness was acquired. */
        }
      }
    };
    const pause = async () => {
      this.options.onBuildCacheState?.(workspaceId, "waitingForBuildCache");
      await new Promise<void>((done, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(cancelled());
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          done();
        }, this.options.buildLeasePollMs ?? 100);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    };
    const busy = (error: unknown) => {
      const code = (error as { errcode?: number }).errcode;
      return code !== undefined && [5, 6].includes(code & 0xff);
    };
    try {
      // A complete, synced inode exists before the atomic hard-link publication.
      const temporaryHandle = await open(temporary, "wx", 0o600);
      try {
        await temporaryHandle.writeFile(owner);
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle.close();
      }
      while (!published) {
        signal.throwIfAborted();
        const candidate = new DatabaseSync(dbPath);
        try {
          candidate.exec(
            "PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lease_generation (id INTEGER PRIMARY KEY CHECK(id=1), nonce TEXT NOT NULL, uncertain INTEGER NOT NULL DEFAULT 1)",
          );
          const columns = candidate.prepare("PRAGMA table_info(lease_generation)").all();
          if (!columns.some((column) => column.name === "uncertain"))
            candidate.exec(
              "ALTER TABLE lease_generation ADD COLUMN uncertain INTEGER NOT NULL DEFAULT 1",
            );
        } catch (error) {
          candidate.close();
          if (!busy(error)) throw error;
          await pause();
          continue;
        }
        db = candidate;
        try {
          let recoveredNonce: string | undefined;
          const generation = db
            .prepare("SELECT nonce, uncertain FROM lease_generation WHERE id=1")
            .get() as { nonce?: unknown; uncertain?: unknown } | undefined;
          if (generation?.uncertain === 1) {
            const priorNonce = generation.nonce;
            let proven = false;
            if (
              typeof priorNonce === "string" &&
              /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
                priorNonce,
              )
            ) {
              const receiptPath = join(cargoTargetDir, `.bycoda-build-retired-${priorNonce}.json`);
              try {
                const stat = await lstat(receiptPath);
                if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024) {
                  const file = await open(
                    receiptPath,
                    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
                  );
                  try {
                    const before = await file.stat();
                    const proof = JSON.parse(await file.readFile({ encoding: "utf8" }));
                    const after = await file.stat();
                    proven =
                      before.isFile() &&
                      before.dev === stat.dev &&
                      before.ino === stat.ino &&
                      before.size <= 1024 &&
                      before.size === after.size &&
                      before.mtimeMs === after.mtimeMs &&
                      Object.keys(proof).sort().join(",") === "nonce,retirement,version" &&
                      proof.version === 1 &&
                      proof.nonce === priorNonce &&
                      proof.retirement === "verified";
                  } finally {
                    await file.close();
                  }
                }
              } catch {
                /* Missing, corrupt or unreadable proof remains unknown. */
              }
            }
            if (!proven || typeof priorNonce !== "string")
              throw new Error(
                "Build cache is held: previous build completion is unknown; verify its process tree before recovery.",
              );
            db.prepare(
              "UPDATE lease_generation SET uncertain=0 WHERE id=1 AND nonce=? AND uncertain=1",
            ).run(priorNonce);
            generation.uncertain = 0;
            recoveredNonce = priorNonce;
          }
          let old: string | undefined;
          try {
            old = await readFile(path, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (old !== undefined) {
            let record: unknown;
            try {
              record = JSON.parse(old);
            } catch {
              /* Unknown sentinel stays. */
            }
            if (
              !(
                record &&
                typeof record === "object" &&
                "version" in record &&
                record.version === 2 &&
                "nonce" in record &&
                typeof record.nonce === "string" &&
                record.nonce === generation?.nonce &&
                generation?.uncertain === 0 &&
                "pid" in record &&
                Number.isSafeInteger(record.pid) &&
                Number(record.pid) > 0 &&
                "workspaceId" in record &&
                typeof record.workspaceId === "string" &&
                (await readFile(path, "utf8")) === old
              )
            ) {
              db.close();
              db = undefined;
              await pause();
              continue;
            }
            await unlink(path);
          }
          db.prepare(
            "INSERT INTO lease_generation(id, nonce, uncertain) VALUES (1, ?, 0) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce, uncertain=0",
          ).run(nonce);
          db.exec("COMMIT");
          // COMMIT releases the kernel witness. Another builder may win during
          // this gap; reacquire and compare the exact durable generation first.
          try {
            db.exec("BEGIN EXCLUSIVE");
          } catch (error) {
            if (!busy(error)) throw error;
            db.close();
            db = undefined;
            await pause();
            continue;
          }
          const currentGeneration = db
            .prepare("SELECT nonce FROM lease_generation WHERE id=1")
            .get() as { nonce?: unknown } | undefined;
          if (currentGeneration?.nonce !== nonce) {
            db.close();
            db = undefined;
            await pause();
            continue;
          }
          if (recoveredNonce) await retireReceipt(recoveredNonce);
          signal.throwIfAborted();
          try {
            await link(temporary, path);
            published = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            db.close();
            db = undefined;
            await pause();
          }
        } catch (error) {
          if (!published) {
            db?.close();
            db = undefined;
          }
          throw error;
        }
      }
      signal.throwIfAborted();
      this.options.onBuildCacheState?.(workspaceId, "building");
      effectStarted = true;
      db!.prepare("UPDATE lease_generation SET uncertain=1 WHERE id=1 AND nonce=?").run(nonce);
      db!.exec("COMMIT");
      while (true) {
        signal.throwIfAborted();
        try {
          db!.exec("BEGIN EXCLUSIVE");
          break;
        } catch (error) {
          if (!busy(error)) throw error;
          await pause();
        }
      }
      let result: T;
      try {
        result = await build({
          cargoTargetDir,
          cargoHome: process.env.CARGO_HOME ?? join(homedir(), ".cargo"),
          buildReceipt: {
            nonce,
            path: join(cargoTargetDir, `.bycoda-build-retired-${nonce}.json`),
          },
        });
      } catch (error) {
        if (!(error instanceof BuildCacheSettledFailure)) throw error;
        db!.prepare("UPDATE lease_generation SET uncertain=0 WHERE id=1 AND nonce=?").run(nonce);
        db!.exec("COMMIT");
        settled = true;
        await retireSettledReceipt();
        throw error.original;
      }
      db!.prepare("UPDATE lease_generation SET uncertain=0 WHERE id=1 AND nonce=?").run(nonce);
      db!.exec("COMMIT");
      settled = true;
      await retireSettledReceipt();
      return result;
    } finally {
      try {
        if (published && (!effectStarted || settled)) {
          try {
            if ((await readFile(path, "utf8")) === owner) await unlink(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      } finally {
        db?.close();
        try {
          await unlink(temporary);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  }

  /** Call inside withBuildCache, after the compiler exits, before releasing the output lease. */
  async copyExecutable(request: {
    workspaceId: string;
    runId: string;
    sourcePath: string;
  }): Promise<string> {
    const root = await this.workspace(request.workspaceId);
    const directory = join(
      root,
      "temp",
      "build",
      "managed-runs",
      safeId(request.workspaceId),
      safeId(request.runId),
      "bin",
    );
    await mkdir(directory, { recursive: true });
    await access(request.sourcePath, constants.R_OK);
    const destination = join(directory, basename(request.sourcePath));
    // Never overwrite a potentially running executable, even for a repeated run ID.
    await copyFile(request.sourcePath, destination, constants.COPYFILE_EXCL);
    return destination;
  }
}

export function nativeDevDesktopDataPath(instanceId: string): string {
  const identifier = `com.bycoda.desktop.dev.${hash(instanceId).slice(0, 20)}`;
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));
  return join(base, identifier);
}

export function workspaceEnvironmentVariables(
  environment: WorkspaceDevEnvironment,
): Record<string, string> {
  return {
    ...portLeaseEnvironment(environment.ports),
    BYCODA_HOST_DIR: environment.hostDataPath,
    BYCODA_DESKTOP_DATA_DIR: environment.desktopDataPath,
    BYCODA_DEV_PROFILE: environment.instanceId,
    BYCODA_DEV_PROFILE_ID: environment.instanceId,
    BYCODA_WORKSPACE_ID: environment.workspaceId,
    BYCODA_DEV_RUN_ID: environment.runId,
    CARGO_TARGET_DIR: environment.cargoTargetDir,
  };
}
