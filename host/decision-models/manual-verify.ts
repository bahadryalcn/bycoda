import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Catalog } from "./catalog";
import { catalogFileMatches } from "./catalog-files";
import { adapterForPath, assertLoopback, probeSystemOne } from "./contract-probe";
import type { DecisionSource } from "./decision-types";
import { readGgufHeader, sha256File } from "./gguf";
import { insideFile, isProjector, MAX_FOLDER_MODELS, scanModelFolder } from "./model-folders";

const ENDPOINT_TIMEOUT_MS = 5_000;
const MAX_INSTALLATION_JSON_BYTES = 64 * 1024;
const MAX_INSTALLATION_ANCESTORS = 8;
const RUNTIME_NAMES = [
  "llama-server.exe",
  "llama-server",
  "bin/llama-server.exe",
  "bin/llama-server",
  "runtime/llama-server.exe",
  "runtime/llama-server",
];

export type ModelFileCheck = {
  path: string;
  sizeBytes: number;
  ggufVersion: number;
  sha256?: string;
  /** True only when the file's SHA256 matches a catalog entry or the installation record. */
  verified: boolean;
  catalogModelId?: string;
};

/**
 * Checks a user-chosen .gguf file: absolute path, GGUF header, and SHA256 when a catalog entry (or
 * `expectedSha256` from an installation record) names one. A mismatch refuses the file. The
 * user's own file is never deleted or moved here.
 */
export async function verifyModelFile(
  path: string,
  catalog: Catalog,
  options: { expectedSha256?: string; signal?: AbortSignal } = {},
): Promise<ModelFileCheck> {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== ".gguf")
    throw new Error("Choose an absolute .gguf model file.");
  const real = await realpath(path).catch(() => undefined);
  if (!real) throw new Error("The model file was not found.");
  const info = await stat(real);
  if (!info.isFile()) throw new Error("Choose a model file, not a folder.");
  const header = await readGgufHeader(real);
  if (!header) throw new Error("The file is not a GGUF model.");
  const matches = catalogFileMatches(catalog, basename(real), info.size).filter(
    (match) => match.file.sha256,
  );
  const expected = [
    ...(options.expectedSha256 ? [options.expectedSha256.toLowerCase()] : []),
    ...matches.map((match) => match.file.sha256 as string),
  ];
  if (!expected.length) {
    return { path: real, sizeBytes: info.size, ggufVersion: header.version, verified: false };
  }
  const digest = await sha256File(real, options.signal);
  if (!expected.includes(digest))
    throw new Error("The model file does not match its expected SHA256.");
  const catalogModelId = matches.find((match) => match.file.sha256 === digest)?.model.id;
  return {
    path: real,
    sizeBytes: info.size,
    ggufVersion: header.version,
    sha256: digest,
    verified: true,
    ...(catalogModelId ? { catalogModelId } : {}),
  };
}

export type InstallationFolderCheck = {
  folder: string;
  model?: string;
  modelPath: string;
  runtimePath?: string;
  endpoint?: string;
  verified: boolean;
  projectorPath?: string;
  models?: FolderModel[];
  incomplete?: boolean;
};

export type FolderModel = {
  name: string;
  modelPath: string;
  runtimePath?: string;
  endpoint?: string;
  model?: string;
  projectorPath?: string;
  verified: boolean;
};

/**
 * Inspects a chosen folder without running programs. A manifest identifies the preferred model;
 * plain model folders work too. All referenced files stay inside the selected folder.
 */
export async function verifyInstallationFolder(
  folder: string,
  catalog: Catalog,
  options: { signal?: AbortSignal } = {},
): Promise<InstallationFolderCheck> {
  if (!isAbsolute(folder)) throw new Error("Choose an absolute installation folder.");
  const root = await realpath(folder).catch(() => undefined);
  if (!root || !(await stat(root)).isDirectory())
    throw new Error("The installation folder was not found.");
  const recordPath = join(root, "installation.json");
  const recordInfo = await stat(recordPath).catch(() => undefined);
  if (recordInfo && (!recordInfo.isFile() || recordInfo.size > MAX_INSTALLATION_JSON_BYTES))
    throw new Error("installation.json is not a valid installation record.");
  if (recordInfo && !(await insideFile(root, recordPath)))
    throw new Error("The installation record leaves the installation folder.");
  const record: unknown = recordInfo
    ? JSON.parse((await readFile(recordPath, "utf8")).replace(/^\uFEFF/, ""))
    : {};
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw new Error("installation.json is not a JSON object.");
  const fields = record as Record<string, unknown>;
  const modelRelative = typeof fields.modelPath === "string" ? fields.modelPath : undefined;
  if (recordInfo && !modelRelative) throw new Error("installation.json has no modelPath.");
  const modelPath = modelRelative ? resolve(root, modelRelative) : undefined;
  if (modelPath) {
    const within = relative(root, modelPath);
    if (
      !within ||
      within.startsWith("..") ||
      isAbsolute(within) ||
      !(await insideFile(root, modelPath))
    )
      throw new Error("The model path leaves the installation folder.");
    if (isProjector(modelPath))
      throw new Error("The recorded model is a vision projector, not a decision model.");
  }
  const recordedSha =
    typeof fields.sha256 === "string" && /^[a-f0-9]{64}$/i.test(fields.sha256)
      ? fields.sha256.toLowerCase()
      : undefined;
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(30_000),
  ]);
  const preferred = modelPath
    ? await verifyModelFile(modelPath, catalog, { expectedSha256: recordedSha, signal })
    : undefined;
  const projectorName =
    typeof fields.visionProjector === "string" ? fields.visionProjector : undefined;
  const projectorPath = projectorName
    ? ((await insideFile(root, resolve(root, projectorName))) ??
      (await insideFile(root, join(root, "models", projectorName))))
    : undefined;
  if (projectorName && (!projectorPath || !(await readGgufHeader(projectorPath))))
    throw new Error("The vision projector was not found inside the installation folder.");
  const runtimeDirectories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^runtime-vision-[a-z0-9._-]+$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const runtimeNames = [
    ...(projectorPath
      ? runtimeDirectories.flatMap((name) => [`${name}/llama-server.exe`, `${name}/llama-server`])
      : []),
    ...RUNTIME_NAMES,
  ];
  let runtimePath: string | undefined;
  for (const name of runtimeNames) {
    const candidate = await insideFile(root, join(root, name));
    if (candidate && (await stat(candidate)).isFile()) {
      runtimePath = candidate;
      break;
    }
  }
  let endpoint: string | undefined;
  if (typeof fields.endpoint === "string") {
    assertLoopback(fields.endpoint);
    const parsed = new URL(fields.endpoint);
    if (parsed.username || parsed.password)
      throw new Error("The endpoint must not contain credentials.");
    endpoint = `${parsed.origin}${parsed.pathname}`;
  }
  const model = typeof fields.model === "string" ? fields.model.slice(0, 200) : undefined;
  const models: FolderModel[] = preferred
    ? [
        {
          name: model ?? basename(preferred.path, extname(preferred.path)),
          modelPath: preferred.path,
          verified: preferred.verified,
          ...(runtimePath ? { runtimePath } : {}),
          ...(endpoint ? { endpoint } : {}),
          ...(model ? { model } : {}),
          ...(projectorPath ? { projectorPath } : {}),
        },
      ]
    : [];
  let truncated = false;
  const walk = await scanModelFolder(root, signal, (path) => {
    if (path === preferred?.path) return;
    if (models.length >= MAX_FOLDER_MODELS) {
      truncated = true;
      return;
    }
    models.push({
      name: basename(path, extname(path)).slice(0, 200),
      modelPath: path,
      verified: false,
      ...(runtimePath ? { runtimePath } : {}),
    });
  });
  const first = models[0];
  if (!first)
    throw new Error(
      walk.incomplete
        ? "The folder scan could not finish. Choose a more specific folder."
        : "No GGUF models were found in this folder.",
    );
  return {
    folder: root,
    modelPath: first.modelPath,
    verified: first.verified,
    ...(first.model ? { model: first.model } : {}),
    ...(first.runtimePath ? { runtimePath: first.runtimePath } : {}),
    ...(first.endpoint ? { endpoint: first.endpoint } : {}),
    ...(first.projectorPath ? { projectorPath: first.projectorPath } : {}),
    models,
    ...(walk.incomplete || truncated ? { incomplete: true } : {}),
  };
}

/**
 * Resolves a discovered model to its installation without scanning arbitrary ancestor folders.
 * Only ancestors containing a manifest are inspected; an ordinary model falls back to its own folder.
 * Reading the selected file's header first avoids hashing it again before manifest verification.
 */
export async function verifyModelInstallation(
  path: string,
  catalog: Catalog,
  options: { signal?: AbortSignal } = {},
): Promise<InstallationFolderCheck> {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== ".gguf")
    throw new Error("Choose an absolute .gguf model file.");
  const selectedPath = await realpath(path).catch(() => undefined);
  if (!selectedPath) throw new Error("The model file was not found.");
  if (!(await stat(selectedPath)).isFile()) throw new Error("Choose a model file, not a folder.");
  if (isProjector(path) || isProjector(selectedPath))
    throw new Error("Choose a decision model, not a vision projector.");
  if (!(await readGgufHeader(selectedPath))) throw new Error("The file is not a GGUF model.");
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(30_000),
  ]);
  const selectedFolder = dirname(selectedPath);
  let folder = selectedFolder;
  const samePath = (candidate: string) =>
    process.platform === "win32"
      ? candidate.toLowerCase() === selectedPath.toLowerCase()
      : candidate === selectedPath;
  const selectModel = (result: InstallationFolderCheck): InstallationFolderCheck | undefined => {
    const selected = result.models?.find((candidate) => samePath(candidate.modelPath));
    if (!selected) return undefined;
    return {
      folder: result.folder,
      modelPath: selected.modelPath,
      verified: selected.verified,
      ...(selected.runtimePath ? { runtimePath: selected.runtimePath } : {}),
      ...(selected.endpoint ? { endpoint: selected.endpoint } : {}),
      ...(selected.model ? { model: selected.model } : {}),
      ...(selected.projectorPath ? { projectorPath: selected.projectorPath } : {}),
      models: result.models,
      ...(result.incomplete ? { incomplete: true } : {}),
    };
  };
  for (let depth = 0; depth < MAX_INSTALLATION_ANCESTORS; depth++) {
    signal.throwIfAborted();
    const parent = dirname(folder);
    // A manifest at a drive/filesystem root must not turn a file choice into a drive-wide scan.
    if (parent === folder) break;
    if (await stat(join(folder, "installation.json")).catch(() => undefined)) {
      const result = await verifyInstallationFolder(folder, catalog, { signal });
      const selected = selectModel(result);
      if (selected) return selected;
      if (result.incomplete)
        throw new Error(
          "The installation scan could not reach the selected model. Choose its folder directly.",
        );
    }
    folder = parent;
  }
  let runtimePath: string | undefined;
  for (const name of RUNTIME_NAMES) {
    signal.throwIfAborted();
    const candidate = await insideFile(selectedFolder, join(selectedFolder, name));
    if (candidate && (await stat(candidate)).isFile()) {
      runtimePath = candidate;
      break;
    }
  }
  const selected: FolderModel = {
    name: basename(selectedPath, extname(selectedPath)).slice(0, 200),
    modelPath: selectedPath,
    verified: false,
    ...(runtimePath ? { runtimePath } : {}),
  };
  return {
    folder: selectedFolder,
    modelPath: selectedPath,
    verified: false,
    ...(runtimePath ? { runtimePath } : {}),
    models: [selected],
  };
}

export type EndpointCheck = {
  /** Origin and path only; query strings and fragments are dropped. */
  url: string;
  reachable: boolean;
  contract?: "systemone";
  adapter?: DecisionSource["adapter"];
};

/** Probes a user-entered endpoint once. Credentials in the URL are refused, and no key is sent. */
export async function verifyEndpoint(
  address: string,
  options: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<EndpointCheck> {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    throw new Error("Enter a valid endpoint address.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error("The endpoint must be an http or https address without credentials.");
  const url = `${parsed.origin}${parsed.pathname}`;
  const probe = await probeSystemOne(url, {
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    timeoutMs: ENDPOINT_TIMEOUT_MS,
  });
  return {
    url,
    reachable: probe.reachable,
    ...(probe.systemone
      ? { contract: "systemone" as const, adapter: adapterForPath(parsed.pathname) }
      : {}),
  };
}
