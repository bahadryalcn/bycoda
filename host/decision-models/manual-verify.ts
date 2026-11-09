import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Catalog } from "./catalog";
import { catalogFileMatches } from "./catalog-files";
import { adapterForPath, probeSystemOne } from "./contract-probe";
import type { DecisionSource } from "./decision-types";
import { readGgufHeader, sha256File } from "./gguf";

const ENDPOINT_TIMEOUT_MS = 5_000;
const MAX_INSTALLATION_JSON_BYTES = 64 * 1024;
const RUNTIME_NAMES = [
  "llama-server.exe",
  "llama-server",
  "bin/llama-server.exe",
  "bin/llama-server",
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
};

/**
 * Recognizes a local installation folder by its installation.json (for example the Clef layout).
 * Only reads the file. The model path must stay inside the folder, and the recorded SHA256 must match.
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
  if (!recordInfo?.isFile() || recordInfo.size > MAX_INSTALLATION_JSON_BYTES)
    throw new Error("installation.json was not found in this folder.");
  const record: unknown = JSON.parse(await readFile(recordPath, "utf8"));
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw new Error("installation.json is not a JSON object.");
  const fields = record as Record<string, unknown>;
  const modelRelative = typeof fields.modelPath === "string" ? fields.modelPath : undefined;
  if (!modelRelative) throw new Error("installation.json has no modelPath.");
  const modelPath = resolve(root, modelRelative);
  const inside = relative(root, modelPath);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw new Error("The model path leaves the installation folder.");
  const recordedSha =
    typeof fields.sha256 === "string" && /^[a-f0-9]{64}$/i.test(fields.sha256)
      ? fields.sha256.toLowerCase()
      : undefined;
  const check = await verifyModelFile(modelPath, catalog, {
    expectedSha256: recordedSha,
    signal: options.signal,
  });
  const runtimePath = RUNTIME_NAMES.map((name) => join(root, name)).find((candidate) =>
    existsSync(candidate),
  );
  return {
    folder: root,
    ...(typeof fields.model === "string" ? { model: fields.model.slice(0, 200) } : {}),
    modelPath: check.path,
    ...(runtimePath ? { runtimePath } : {}),
    ...(typeof fields.endpoint === "string" ? { endpoint: fields.endpoint } : {}),
    verified: check.verified,
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
