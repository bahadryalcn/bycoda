import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
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
import { bestVramGb, hardwareTier, readHardware } from "./hardware";
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

  return {
    async recommend(signal?: AbortSignal): Promise<LocalRecommendation> {
      return recommendLocal(await hardware({ diskPath: options.root, signal }), models());
    },

    async plan(modelId: string): Promise<InstallPlan> {
      const model = findModel(modelId);
      const files = model.localFiles ?? [];
      const downloadBytes = files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
      const freeDiskBytes = (await hardware({ diskPath: options.root })).freeDiskBytes;
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

    async install(input: { modelId: string; confirm: string }): Promise<LocalStatus> {
      if (input.confirm !== INSTALL_CONFIRMATION)
        throw new Error("Installing a local model needs explicit confirmation.");
      const model = findModel(input.modelId);
      const files = verifiedInstallFiles(model);
      if (!files)
        throw new Error(
          "Model download refused: unverified model (the catalog lacks a verified URL or SHA256).",
        );
      const target = join(options.root, input.modelId);
      if (await readRecord(target)) return { state: "installed" };
      const downloadBytes = files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
      const freeDiskBytes = (await hardware({ diskPath: options.root })).freeDiskBytes;
      if (!diskFits(downloadBytes, freeDiskBytes))
        throw new Error("Not enough free disk space for this model.");
      await mkdir(target, { recursive: true });
      const staging = join(target, `.staging-${randomUUID()}`);
      await mkdir(staging);
      try {
        const record: InstallRecord = { files: [] };
        for (const file of files) {
          const result = await downloadVerified(file, join(staging, file.fileName), fetchImpl);
          record.files.push({ fileName: file.fileName, ...result });
        }
        for (const file of files)
          await rename(join(staging, file.fileName), join(target, file.fileName));
        await writeFileAtomic(
          join(target, RECORD_NAME),
          `${JSON.stringify({ modelId: input.modelId, installedAt: new Date().toISOString(), ...record }, null, 2)}\n`,
        );
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      return { state: "installed" };
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
  };
}

export type LocalInstaller = ReturnType<typeof createLocalInstaller>;

/** Streams one catalog file into a new file, hashing as it goes. A mismatch removes the file and throws. */
async function downloadVerified(
  file: InstallFile,
  destination: string,
  fetchImpl: typeof fetch,
): Promise<{ sha256: string; sizeBytes: number }> {
  const response = await fetchImpl(file.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body)
    throw new Error("The model could not be downloaded. Check your connection and try again.");
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const handle = await open(destination, "wx");
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new Error("The model file is too large.");
      hash.update(value);
      await handle.write(value);
    }
  } finally {
    await handle.close();
    await reader.cancel().catch(() => undefined);
  }
  const digest = hash.digest("hex");
  if (digest !== file.sha256 || (file.sizeBytes !== undefined && size !== file.sizeBytes)) {
    await rm(destination, { force: true });
    throw new Error("Model file verification failed. The file was removed and not installed.");
  }
  return { sha256: digest, sizeBytes: size };
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
