import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { type Catalog, loadCatalog } from "./catalog";
import { catalogFileMatches, localhostPortsFromCatalog } from "./catalog-files";
import { assertLoopback, probeRequest, probeSystemOne, SYSTEMONE_PATHS } from "./contract-probe";
import type { DecisionConfig, DiscoveryCandidate, DiscoveryResult } from "./decision-types";
import { readGgufHeader, sha256File } from "./gguf";
import { runCommand } from "./local-command";

/** Whole-scan budget. The caller's signal can end it sooner. */
export const SCAN_BUDGET_MS = 8_000;
const PROBE_TIMEOUT_MS = 1_200;
const PORT_CONCURRENCY = 6;
const MAX_PORTS = 24;
const MAX_SCAN_DEPTH = 5;
const MAX_SCAN_FILES = 5_000;
const HEALTH_PATHS = ["/health", "/props", "/v1/models", "/api/tags"] as const;
/** The catalog has no port list, so llama.cpp server, Ollama and LM Studio defaults live here. */
const DEFAULT_RUNTIME_PORTS = [8080, 11434, 1234];
const RUNTIME_PROCESS_NAME = /^(llama-server|ollama)(\.exe)?$/i;
/** Only presence is checked. Values are never read. The provider id maps to a catalog label. */
const API_KEY_ENVIRONMENT: { name: string; providerId: string }[] = [
  { name: "TYPESAFE_API_KEY", providerId: "typesafe-jev" },
  { name: "OPENROUTER_API_KEY", providerId: "openrouter" },
  { name: "CLOUDFLARE_API_TOKEN", providerId: "cloudflare-workers-ai" },
  { name: "VERCEL_AI_GATEWAY_API_KEY", providerId: "vercel-ai-gateway" },
  { name: "OPENAI_API_KEY", providerId: "openai-decisions" },
];

export type DiscoveryDeps = {
  catalog?: Catalog;
  /** Only `in` is used on this object; tests pass a trap that fails on any value read. */
  env?: Record<string, string | undefined>;
  homeDirectory?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Lists candidates for the owner to add. It connects nothing and it sends no secrets. It scans
 * loopback ports, runtime processes, a fixed set of model folders and API-key presence.
 */
export async function scan(
  config: DecisionConfig,
  signal: AbortSignal,
  deps: DiscoveryDeps = {},
): Promise<DiscoveryResult> {
  const budget = AbortSignal.any([signal, AbortSignal.timeout(SCAN_BUDGET_MS)]);
  const catalog = deps.catalog ?? loadCatalog();
  const env = deps.env ?? process.env;
  const fetchImpl =
    deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const home = deps.homeDirectory ?? homedir();
  const [services, processes, models] = await Promise.all([
    settle(() => localServices(catalog, config, budget, fetchImpl)),
    settle(() => runtimeProcesses(budget)),
    settle(() => modelFiles(catalog, config, home, budget)),
  ]);
  const byId = new Map<string, DiscoveryCandidate>();
  for (const candidate of [...services, ...processes, ...models, ...apiKeys(catalog, env)])
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  return { found: [...byId.values()] };
}

function settle(task: () => Promise<DiscoveryCandidate[]>): Promise<DiscoveryCandidate[]> {
  return task().catch(() => []);
}

async function localServices(
  catalog: Catalog,
  config: DecisionConfig,
  budget: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DiscoveryCandidate[]> {
  const ports = [
    ...new Set([
      ...localhostPortsFromCatalog(catalog),
      ...DEFAULT_RUNTIME_PORTS,
      ...config.discovery.extraPorts,
    ]),
  ].slice(0, MAX_PORTS);
  const groups = await mapPool(ports, PORT_CONCURRENCY, (port) =>
    probePort(port, budget, fetchImpl),
  );
  return groups.flat();
}

/** Tries 127.0.0.1 first and ::1 only when the IPv4 loopback address does not answer. */
async function probePort(
  port: number,
  budget: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DiscoveryCandidate[]> {
  for (const host of ["127.0.0.1", "[::1]"]) {
    if (budget.aborted) return [];
    const base = `http://${host}:${port}`;
    const answers = await Promise.all(
      HEALTH_PATHS.map((path) => getJson(`${base}${path}`, budget, fetchImpl)),
    );
    if (!answers.some(Boolean)) continue;
    const systemOne = await systemOnePath(base, budget, fetchImpl);
    return [
      {
        id: `local:${port}`,
        label: `Local model service on port ${port}`,
        kind: "local_service",
        detail: systemOne ? `System One at ${systemOne}` : "Answers health or model list requests",
      },
    ];
  }
  return [];
}

async function getJson(
  url: string,
  budget: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  assertLoopback(url);
  const response = await probeRequest(url, {
    method: "GET",
    timeoutMs: PROBE_TIMEOUT_MS,
    signal: budget,
    fetchImpl,
  });
  return response?.status === 200 && response.body !== undefined;
}

async function systemOnePath(
  base: string,
  budget: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  for (const path of SYSTEMONE_PATHS) {
    if (budget.aborted) return undefined;
    const url = `${base}${path}`;
    assertLoopback(url);
    const probe = await probeSystemOne(url, {
      fetchImpl,
      signal: budget,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (probe.systemone) return path;
  }
  return undefined;
}

async function runtimeProcesses(budget: AbortSignal): Promise<DiscoveryCandidate[]> {
  const rows = await (process.platform === "win32"
    ? windowsProcessRows(budget)
    : posixProcessRows(budget));
  return rows.map((row, index): DiscoveryCandidate => {
    // Only the model path is kept. The rest of the command line can carry secrets and is dropped.
    const modelPath = extractGgufPath(row.commandLine);
    return {
      id: `process:${index}:${row.name}`,
      label: row.name,
      kind: "runtime_process",
      ...(modelPath ? { detail: modelPath } : {}),
    };
  });
}

async function windowsProcessRows(
  budget: AbortSignal,
): Promise<{ name: string; commandLine: string }[]> {
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(llama-server|ollama)(\\.exe)?$' } | ForEach-Object { $_.Name + '|' + $_.CommandLine }";
  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeoutMs: 5_000, signal: budget },
  );
  if (!result) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .map((line) => {
      const cut = line.indexOf("|");
      return { name: line.slice(0, cut), commandLine: line.slice(cut + 1) };
    })
    .filter((row) => RUNTIME_PROCESS_NAME.test(row.name));
}

async function posixProcessRows(
  budget: AbortSignal,
): Promise<{ name: string; commandLine: string }[]> {
  const result = await runCommand("ps", ["-eo", "comm=,args="], {
    timeoutMs: 5_000,
    signal: budget,
    maxOutputChars: 512_000,
  });
  if (!result) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const space = line.search(/\s/);
      if (space < 0) return { name: line, commandLine: "" };
      return { name: basename(line.slice(0, space)), commandLine: line.slice(space + 1) };
    })
    .filter((row) => RUNTIME_PROCESS_NAME.test(row.name));
}

export function extractGgufPath(commandLine: string): string | undefined {
  const quoted = commandLine.match(/"([^"]+\.gguf)"/i)?.[1];
  const bare = commandLine.match(/(?:^|\s)(\S+\.gguf)(?=\s|$)/i)?.[1];
  return quoted ?? bare;
}

async function modelFiles(
  catalog: Catalog,
  config: DecisionConfig,
  home: string,
  budget: AbortSignal,
): Promise<DiscoveryCandidate[]> {
  const folders = new Set([
    join(home, ".cache", "huggingface", "hub"),
    join(home, ".ollama", "models"),
    join(home, ".lmstudio", "models"),
    join(home, ".cache", "lm-studio", "models"),
    ...config.discovery.extraFolders.filter((folder) => isAbsolute(folder)),
  ]);
  const files: string[] = [];
  for (const folder of folders) await collectGguf(folder, 0, files, budget);
  const candidates: DiscoveryCandidate[] = [];
  for (const file of files) {
    if (budget.aborted) break;
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (!(await readGgufHeader(file))) continue;
    const name = basename(file);
    // Hashing is expensive, so it runs only when a catalog entry has this name and size.
    const expected = catalogFileMatches(catalog, name, info.size).filter(
      (match) => match.file.sha256,
    );
    const digest = expected.length
      ? await sha256File(file, budget).catch(() => undefined)
      : undefined;
    const match = expected.find((entry) => entry.file.sha256 === digest);
    candidates.push({
      id: `model:${file}`,
      label: match ? match.model.name : name,
      kind: "model_file",
      detail: match ? `${file} (SHA256 matches the catalog)` : `${file} (not verified)`,
    });
  }
  return candidates;
}

async function collectGguf(
  folder: string,
  depth: number,
  out: string[],
  budget: AbortSignal,
): Promise<void> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (budget.aborted || out.length >= MAX_SCAN_FILES) return;
    // Symbolic links are skipped so the scan cannot leave the listed folders.
    if (entry.isSymbolicLink()) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_SCAN_DEPTH) await collectGguf(path, depth + 1, out, budget);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".gguf") {
      out.push(path);
    }
  }
}

function apiKeys(catalog: Catalog, env: Record<string, string | undefined>): DiscoveryCandidate[] {
  const labels = new Map(catalog.providers.map((provider) => [provider.id, provider.name]));
  return API_KEY_ENVIRONMENT.filter(({ name }) => name in env).map(
    ({ name, providerId }): DiscoveryCandidate => ({
      id: `env:${name}`,
      label: labels.get(providerId) ?? name,
      kind: "api_key",
      detail: name,
    }),
  );
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R[]>,
): Promise<R[][]> {
  const results: R[][] = items.map(() => []);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
