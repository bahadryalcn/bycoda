import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Catalog, CatalogModel } from "./catalog";
import { catalogFileMatches, type InstallFile, verifiedInstallFiles } from "./catalog-files";
import { writeFileAtomic } from "../storage/atomic-write";
import type {
  DecisionSource,
  HardwareInfo,
  LocalRecommendation,
  LocalStatus,
} from "./decision-types";
import { sha256File } from "./gguf";
import { bestVramGb, hardwareTier, readFreeDiskBytes, readHardware } from "./hardware";
import { LocalRuntime } from "./local-runtime";

/** The Host accepts an install only when the caller sends exactly this confirmation. */
export const INSTALL_CONFIRMATION = "INSTALL_DECISION_MODEL";

const GIB = 1024 ** 3;
const DISK_MARGIN_BYTES = 2 * GIB;
const MAX_FILE_BYTES = 16 * GIB;
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const RECORD_NAME = "install.json";

export type InstallPlan = {
  modelId: string;
  name: string;
  /** False when any file is unverified, has no HTTPS URL or has no SHA256. Such models are never downloaded. */
  installable: boolean;
  files: { fileName: string; sizeBytes?: number }[];
  downloadBytes: number;
  freeDiskBytes: number;
  fits: boolean;
};

type InstallRecord = { files: { fileName: string; sha256: string; sizeBytes: number }[] };

/** Bytes received by a running install. `bytesTotal` counts only files whose catalog size is known. */
export type InstallProgress = {
  modelId: string;
  fileName: string;
  fileIndex: number;
  fileCount: number;
  bytesDone: number;
  bytesTotal: number;
};

type RunningInstall = {
  controller: AbortController;
  progress: InstallProgress;
  promise: Promise<LocalStatus>;
};

/**
 * What `decisionModels.local.installProgress` reports: the running install's bytes, or how the last
 * install of the model ended. `error` is a fixed, path-free message.
 */
export type InstallState = {
  state: "idle" | "running" | "installed" | "failed" | "cancelled";
  progress?: InstallProgress;
  error?: string;
};

/** An install failure whose message is safe to show the owner: no paths, no raw system errors. */
class InstallError extends Error {}
/** The final move failed and replaced files could not all be put back; they stay in staging. */
class RestoreIncompleteError extends InstallError {}

const STAGING_PREFIX = ".staging-";
/** Written into every staging folder and touched while its install runs; a live writer keeps it fresh. */
const LEASE_NAME = ".lease";
const LEASE_BEAT_MS = 30_000;
const LEASE_STALE_MS = 5 * 60_000;
/** Files an install replaced are set aside here until the new files and the record are in place. */
const PREVIOUS_NAME = ".previous";
const CANCELLED_MESSAGE = "The model install was cancelled.";
const FAILED_MESSAGE =
  "The model install failed. Check your connection, free disk space and folder permissions, then try again.";

const diskFits = (downloadBytes: number, freeDiskBytes: number) =>
  freeDiskBytes >= downloadBytes + DISK_MARGIN_BYTES;

/** Picks the first verified catalog model that fits the tier. Catalog order is the preference order. */
export function recommendLocal(
  hardware: HardwareInfo,
  models: readonly CatalogModel[],
): LocalRecommendation {
  const tier = hardwareTier(hardware);
  if (tier === "insufficient") return { tier };
  const model = models.find(
    (candidate) => verifiedInstallFiles(candidate) !== undefined && fits(candidate, tier, hardware),
  );
  return model ? { tier, modelId: model.id } : { tier };
}

function fits(model: CatalogModel, tier: LocalRecommendation["tier"], hardware: HardwareInfo) {
  const requirement = model.recommendedHardware ?? {};
  if (hardware.ramBytes / GIB < (requirement.minRamGb ?? 0)) return false;
  if (tier === "cpu") return requirement.cpuOk === true;
  return bestVramGb(hardware) >= (requirement.minVramGb ?? 0);
}

export type LocalInstallerOptions = {
  /** Folder that holds one subfolder per installed model. */
  root: string;
  catalog: () => Catalog;
  runtime?: LocalRuntime;
  fetchImpl?: typeof fetch;
  hardware?: (options: { diskPath: string; signal?: AbortSignal }) => Promise<HardwareInfo>;
  freeDisk?: (path: string) => Promise<number>;
  /**
   * Runs after a verified install, and when the model was already installed, before the install
   * reports `installed`. The Host registers the model as a source here, so a detached install is
   * complete once it reports success. Must be idempotent.
   */
  onInstalled?: (modelId: string) => Promise<void>;
};

/**
 * Local model lifecycle: plan, confirmed install, verified start, stop and uninstall. Nothing is
 * downloaded without `install({ confirm: INSTALL_CONFIRMATION })`, and nothing runs when its
 * recorded or catalog SHA256 no longer matches.
 */
export function createLocalInstaller(options: LocalInstallerOptions) {
  const runtime = options.runtime ?? new LocalRuntime();
  const fetchImpl =
    options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const hardware = options.hardware ?? readHardware;
  const freeDisk = options.freeDisk ?? readFreeDiskBytes;
  const models = () => options.catalog().providers.flatMap((provider) => provider.models);
  /** Full-file hashes already checked this session, keyed by path, size and modification time. */
  const verifiedCache = new Map<string, string>();

  const findModel = (modelId: string): CatalogModel => {
    const model = MODEL_ID.test(modelId)
      ? models().find((entry) => entry.id === modelId)
      : undefined;
    if (!model) throw new Error("Unknown decision model.");
    return model;
  };

  const expectedSha = async (file: string, size: number): Promise<string | undefined> => {
    const record = await readRecord(dirname(file));
    const recorded = record?.files.find((entry) => entry.fileName === basename(file));
    if (recorded) return recorded.sha256;
    return catalogFileMatches(options.catalog(), basename(file), size).find(
      (match) => match.file.sha256,
    )?.file.sha256;
  };

  /** A mismatching file is moved aside and never executed. A file with no known SHA256 is allowed. */
  const verifyBeforeRun = async (file: string): Promise<void> => {
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) throw new Error("The local model file was not found.");
    const expected = await expectedSha(file, info.size);
    if (!expected) return;
    const key = `${file}|${info.size}|${info.mtimeMs}`;
    if (verifiedCache.get(key) === expected) return;
    if ((await sha256File(file)) !== expected) {
      await rename(file, `${file}.quarantine-${Date.now()}`).catch(() => undefined);
      throw new Error("A local model file failed SHA256 verification and was quarantined.");
    }
    verifiedCache.set(key, expected);
  };

  /** Installs in flight, one per model. */
  const installs = new Map<string, RunningInstall>();
  /** Staging folders of installs in flight; the stale-staging sweep never touches these. */
  const activeStaging = new Set<string>();
  /** How the last install of each model ended, until the next one starts. Bounded by the catalog. */
  const outcomes = new Map<string, InstallState>();
  let closed = false;

  /**
   * A staging folder is stale only when no writer has touched it for a while. Another Host process
   * or window may be installing into the same root, so being absent from `activeStaging` proves
   * nothing: its lease (or, for a folder that never got one, the folder itself) must be old.
   * A folder that still holds set-aside model files is kept; after a crash they may be the only copy.
   */
  const isStaleStaging = async (folder: string): Promise<boolean> => {
    const touched = (
      (await stat(join(folder, LEASE_NAME)).catch(() => undefined)) ??
      (await stat(folder).catch(() => undefined))
    )?.mtimeMs;
    if (touched === undefined || Date.now() - touched < LEASE_STALE_MS) return false;
    const setAside = await readdir(join(folder, PREVIOUS_NAME)).catch(() => []);
    return setAside.length === 0;
  };

  /** Removes staging folders a crashed Host left behind. Staging lives beside the models, never inside one. */
  const sweepStaleStaging = async (): Promise<void> => {
    const entries = await readdir(options.root, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX))
        .map((entry) => join(options.root, entry.name))
        .filter((folder) => !activeStaging.has(folder))
        .map(async (folder) => {
          if (await isStaleStaging(folder))
            await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        }),
    );
  };

  /**
   * Downloads into a temporary folder under `root`, then moves the verified files into the model
   * folder. A model that is already installed is never touched: files are written to the model
   * folder only after every download verified, any file they replace is set aside and put back if
   * the move fails, and the record is written last.
   */
  const runInstall = async (
    modelId: string,
    files: InstallFile[],
    entry: RunningInstall,
  ): Promise<LocalStatus> => {
    const target = join(options.root, modelId);
    if (await readRecord(target)) return { state: "installed" };
    const freeDiskBytes = await freeDisk(options.root);
    if (!diskFits(entry.progress.bytesTotal, freeDiskBytes))
      throw new InstallError("Not enough free disk space for this model.");
    const staging = join(options.root, `${STAGING_PREFIX}${randomUUID()}`);
    activeStaging.add(staging);
    let beat: ReturnType<typeof setInterval> | undefined;
    let keepStaging = false;
    try {
      await mkdir(staging, { recursive: true });
      const lease = join(staging, LEASE_NAME);
      await writeFile(lease, `${process.pid}\n`);
      // The lease tells every other installer on this root that this staging folder has a live writer.
      beat = setInterval(() => {
        const now = new Date();
        void utimes(lease, now, now).catch(() => undefined);
      }, LEASE_BEAT_MS);
      beat.unref();
      await sweepStaleStaging();
      const record: InstallRecord = { files: [] };
      for (const [index, file] of files.entries()) {
        entry.progress.fileName = file.fileName;
        entry.progress.fileIndex = index;
        const result = await downloadVerified(
          file,
          join(staging, file.fileName),
          fetchImpl,
          entry.controller.signal,
          (bytes) => {
            entry.progress.bytesDone += bytes;
          },
        ).catch((error: unknown) => {
          throw entry.controller.signal.aborted ? new InstallError(CANCELLED_MESSAGE) : error;
        });
        record.files.push({ fileName: file.fileName, ...result });
      }
      if (entry.controller.signal.aborted) throw new InstallError(CANCELLED_MESSAGE);
      // Heartbeat covers the move too: a sweeper must not remove `.previous` while it is in use.
      await promoteInstall({ staging, target, modelId, files, record }).catch((error: unknown) => {
        keepStaging = error instanceof RestoreIncompleteError;
        throw error;
      });
    } finally {
      clearInterval(beat);
      activeStaging.delete(staging);
      // Replaced files that could not be put back stay in `.previous`; deleting them would lose them.
      if (!keepStaging) await rm(staging, { recursive: true, force: true });
    }
    return { state: "installed" };
  };

  const safeMessage = (error: unknown): string =>
    error instanceof InstallError ? error.message : FAILED_MESSAGE;

  /** Starts the install of a model, or joins the one already running. Registered before any await. */
  const install = async (input: { modelId: string; confirm: string }): Promise<LocalStatus> => {
    if (input.confirm !== INSTALL_CONFIRMATION)
      throw new Error("Installing a local model needs explicit confirmation.");
    const model = findModel(input.modelId);
    const files = verifiedInstallFiles(model);
    if (!files)
      throw new Error(
        "Model download refused: unverified model (the catalog lacks a verified URL or SHA256).",
      );
    if (closed) throw new Error("The local decision runtime is closed.");
    // A second call for the same model (double click, another window) joins the running install.
    // Nothing below this line awaits before the entry is registered, so two calls cannot both start.
    const running = installs.get(input.modelId);
    if (running) return running.promise;
    const controller = new AbortController();
    const entry: RunningInstall = {
      controller,
      progress: {
        modelId: input.modelId,
        fileName: files[0]?.fileName ?? "",
        fileIndex: 0,
        fileCount: files.length,
        bytesDone: 0,
        bytesTotal: files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
      },
      promise: Promise.resolve({ state: "not_installed" }),
    };
    const finish = async (): Promise<LocalStatus> => {
      const status = await runInstall(input.modelId, files, entry);
      if (status.state === "installed") await options.onInstalled?.(input.modelId);
      return status;
    };
    outcomes.delete(input.modelId);
    entry.promise = finish()
      .then(
        (status) => {
          outcomes.set(input.modelId, { state: "installed" });
          return status;
        },
        (error: unknown) => {
          outcomes.set(
            input.modelId,
            controller.signal.aborted
              ? { state: "cancelled" }
              : { state: "failed", error: safeMessage(error) },
          );
          throw error;
        },
      )
      .finally(() => {
        if (installs.get(input.modelId) === entry) installs.delete(input.modelId);
      });
    installs.set(input.modelId, entry);
    return entry.promise;
  };

  const installState = (modelId: string): InstallState => {
    const running = installs.get(modelId);
    if (running) return { state: "running", progress: { ...running.progress } };
    return { ...(outcomes.get(modelId) ?? { state: "idle" }) };
  };

  return {
    async recommend(signal?: AbortSignal): Promise<LocalRecommendation> {
      return recommendLocal(await hardware({ diskPath: options.root, signal }), models());
    },

    async plan(modelId: string): Promise<InstallPlan> {
      const model = findModel(modelId);
      const files = model.localFiles ?? [];
      const downloadBytes = files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
      const freeDiskBytes = await freeDisk(options.root);
      return {
        modelId,
        name: model.name,
        installable: verifiedInstallFiles(model) !== undefined,
        files: files.map((file) => ({
          fileName: file.fileName,
          ...(file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {}),
        })),
        downloadBytes,
        freeDiskBytes,
        fits: diskFits(downloadBytes, freeDiskBytes),
      };
    },

    /** Runs the install to its end. Callers that cannot wait that long use `startInstall`. */
    install,

    /**
     * Starts the install (or joins the running one) and returns at once; `installState` reports how
     * it goes. Refusals (confirmation, unknown or unverified model, closed Host) reject here.
     */
    async startInstall(input: { modelId: string; confirm: string }): Promise<InstallState> {
      const run = install(input);
      run.catch(() => undefined);
      if (!installs.has(input.modelId)) await run;
      return installState(input.modelId);
    },

    /** The running install's progress, or how the last install of this model ended. */
    installState,

    /** Cancels the running install of a model. Returns false when none is running. */
    cancelInstall(modelId: string): boolean {
      const entry = installs.get(modelId);
      if (!entry || entry.controller.signal.aborted) return false;
      entry.controller.abort();
      return true;
    },

    /** Bytes received so far by the running install of a model, or undefined when none runs. */
    installProgress(modelId: string): InstallProgress | undefined {
      const progress = installs.get(modelId)?.progress;
      return progress ? { ...progress } : undefined;
    },

    async start(source: DecisionSource): Promise<LocalStatus> {
      const local = source.local;
      if (!local?.runtimePath) throw new Error("This source has no local runtime path.");
      await verifyBeforeRun(local.modelPath);
      await verifyBeforeRun(local.runtimePath);
      if (local.projectorPath) await verifyBeforeRun(local.projectorPath);
      await runtime.start({
        sourceId: source.id,
        executable: local.runtimePath,
        modelPath: local.modelPath,
        ...(local.projectorPath ? { projectorPath: local.projectorPath } : {}),
        ...(source.model ? { model: source.model } : {}),
      });
      return { state: "running", sourceId: source.id };
    },

    async stop(sourceId: string): Promise<LocalStatus> {
      await runtime.stop(sourceId);
      return { state: "stopped", sourceId };
    },

    /** Removes only a folder under `root` that holds an install record. User-chosen files are never deleted. */
    async uninstall(source: DecisionSource): Promise<LocalStatus> {
      await runtime.stop(source.id);
      const folder = source.local ? dirname(source.local.modelPath) : undefined;
      if (folder && isInside(options.root, folder) && (await readRecord(folder)))
        await rm(folder, { recursive: true, force: true });
      return { state: "not_installed", sourceId: source.id };
    },

    async status(source?: DecisionSource): Promise<LocalStatus> {
      if (!source) return { state: "not_installed" };
      if (runtime.isRunning(source.id)) return { state: "running", sourceId: source.id };
      const modelPath = source.local?.modelPath;
      const present = modelPath ? (await stat(modelPath).catch(() => undefined))?.isFile() : false;
      return { state: present ? "stopped" : "not_installed", sourceId: source.id };
    },

    endpoint: (sourceId: string) => runtime.endpoint(sourceId),
    touch: (sourceId: string) => runtime.touch(sourceId),
    stopAll: () => runtime.stopAll(),
    /**
     * Host shutdown: cancels installs in flight and waits for their cleanup, then stops the servers
     * this installer started and refuses later starts and installs.
     */
    close: async () => {
      closed = true;
      const running = [...installs.values()];
      for (const entry of running) entry.controller.abort();
      await Promise.allSettled(running.map((entry) => entry.promise));
      await runtime.close();
    },
  };
}

export type LocalInstaller = ReturnType<typeof createLocalInstaller>;

/**
 * Streams one catalog file into a new file, hashing as it goes. A mismatch removes the file and
 * throws. `signal` cancels the transfer; `onBytes` receives each chunk's size.
 */
async function downloadVerified(
  file: InstallFile,
  destination: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
): Promise<{ sha256: string; sizeBytes: number }> {
  const response = await fetchImpl(file.url, {
    redirect: "follow",
    signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]),
  });
  if (!response.ok || !response.body)
    throw new InstallError(
      "The model could not be downloaded. Check your connection and try again.",
    );
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const handle = await open(destination, "wx");
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new InstallError("The model file is too large.");
      hash.update(value);
      await handle.write(value);
      onBytes(value.byteLength);
    }
  } finally {
    await handle.close();
    await reader.cancel().catch(() => undefined);
  }
  const digest = hash.digest("hex");
  if (digest !== file.sha256 || (file.sizeBytes !== undefined && size !== file.sizeBytes)) {
    await rm(destination, { force: true });
    throw new InstallError(
      "Model file verification failed. The file was removed and not installed.",
    );
  }
  return { sha256: digest, sizeBytes: size };
}

/**
 * Moves verified files from staging into the model folder and writes the record last. On any
 * failure the files already moved are removed, files they replaced are restored and a model
 * folder this call created is removed, so no partial model is left without a record.
 */
async function promoteInstall(input: {
  staging: string;
  target: string;
  modelId: string;
  files: InstallFile[];
  record: InstallRecord;
}): Promise<void> {
  const { staging, target, files } = input;
  const previous = join(staging, PREVIOUS_NAME);
  const createdTarget = await stat(target).then(
    () => false,
    () => true,
  );
  const moved: string[] = [];
  const setAside: string[] = [];
  try {
    await mkdir(previous, { recursive: true });
    await mkdir(target, { recursive: true });
    for (const file of files) {
      const destination = join(target, file.fileName);
      const exists = await stat(destination).then(
        () => true,
        () => false,
      );
      if (exists) {
        await rename(destination, join(previous, file.fileName));
        setAside.push(file.fileName);
      }
      await rename(join(staging, file.fileName), destination);
      moved.push(file.fileName);
    }
    await writeFileAtomic(
      join(target, RECORD_NAME),
      `${JSON.stringify({ modelId: input.modelId, installedAt: new Date().toISOString(), ...input.record }, null, 2)}\n`,
    );
  } catch (error) {
    let restored = true;
    for (const name of moved)
      await rm(join(target, name), { force: true }).catch(() => {
        restored = false;
      });
    for (const name of setAside)
      await rename(join(previous, name), join(target, name)).catch(() => {
        restored = false;
      });
    if (!restored)
      // The caller keeps staging, so the files still in `.previous` are not deleted with it.
      throw new RestoreIncompleteError(
        "The model install failed and some files it replaced could not be restored. They were kept in the models folder.",
        { cause: error },
      );
    if (createdTarget) await rmdir(target).catch(() => undefined);
    throw error;
  }
}

async function readRecord(folder: string): Promise<InstallRecord | undefined> {
  const text = await readFile(join(folder, RECORD_NAME), "utf8").catch(() => undefined);
  if (!text || text.length > 256 * 1024) return undefined;
  try {
    const parsed = JSON.parse(text) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return undefined;
    const files = parsed.files.filter(
      (entry): entry is InstallRecord["files"][number] =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as { fileName?: unknown }).fileName === "string" &&
        /^[a-f0-9]{64}$/.test(String((entry as { sha256?: unknown }).sha256)),
    );
    return { files };
  } catch {
    return undefined;
  }
}

function isInside(root: string, folder: string): boolean {
  const rel = relative(resolve(root), resolve(folder));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
