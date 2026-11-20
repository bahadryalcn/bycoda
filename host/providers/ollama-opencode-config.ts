import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OllamaStatus } from "../../src/shared/model/host-contracts/ollama";
import { writeFileAtomic } from "../storage/atomic-write";
import { parseJsonc } from "../usage/limits-opencode";

/** OpenCode's own adapter for OpenAI-compatible servers, which Ollama's `/v1` API is. */
const OPENAI_COMPATIBLE_PACKAGE = "@ai-sdk/openai-compatible";

type ConfigState = OllamaStatus["opencode"]["config"];
type Json = Record<string, unknown>;

export type OpencodeConfigRead = { state: ConfigState; config: Json; raw?: string };

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * OpenCode's user config file, as OpenCode itself picks it: `OPENCODE_CONFIG`, else the first
 * existing `opencode.json` / `opencode.jsonc` in the XDG config folder, else a new `opencode.json`.
 */
export async function opencodeUserConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<string> {
  if (env.OPENCODE_CONFIG) return env.OPENCODE_CONFIG;
  const directory = join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const candidate = join(directory, name);
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  }
  return join(directory, "opencode.json");
}

/** Plain JSON can be rewritten; JSONC is read but never rewritten, so comments survive. */
export function parseOpencodeConfig(raw: string): OpencodeConfigRead {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? { state: "ready", config: parsed, raw } : invalid();
  } catch {
    // fall through to the lenient JSONC pass
  }
  try {
    const parsed = parseJsonc(raw);
    return isRecord(parsed) ? { state: "comments", config: parsed, raw } : invalid();
  } catch {
    return invalid();
  }
}

const invalid = (): OpencodeConfigRead => ({ state: "invalid", config: {} });

export async function readOpencodeConfig(path: string): Promise<OpencodeConfigRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "ready", config: {} }
      : { state: "unreadable", config: {} };
  }
  return raw.trim() ? parseOpencodeConfig(raw) : { state: "ready", config: {}, raw };
}

/** Model ids under `provider.ollama.models`; anything malformed reads as none. */
export function configuredOllamaModels(config: Json): string[] {
  const provider = isRecord(config.provider) ? config.provider : undefined;
  const ollama = provider && isRecord(provider.ollama) ? provider.ollama : undefined;
  return ollama && isRecord(ollama.models) ? Object.keys(ollama.models) : [];
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * The config with `provider.ollama` listing exactly `models`. Every other key, the owner's own
 * Ollama options and per-model settings of kept models are preserved, and a loopback `baseURL`
 * is updated to `baseURL`. No models removes the block.
 */
export function withOllamaModels(config: Json, models: readonly string[], baseURL: string): Json {
  if (config.provider !== undefined && !isRecord(config.provider))
    throw new Error("OpenCode config has a provider value that is not an object.");
  const provider: Json = { ...config.provider };
  const existing = isRecord(provider.ollama) ? provider.ollama : {};
  const existingModels = isRecord(existing.models) ? existing.models : {};
  const next: Json = { ...config };
  if (models.length === 0) {
    delete provider.ollama;
    if (Object.keys(provider).length) next.provider = provider;
    else delete next.provider;
    return next;
  }
  const options = isRecord(existing.options) ? existing.options : {};
  provider.ollama = {
    npm: OPENAI_COMPATIBLE_PACKAGE,
    name: "Ollama",
    ...existing,
    options: {
      ...options,
      // A loopback address follows the chosen port; one pointing at another machine is the owner's.
      baseURL:
        typeof options.baseURL === "string" && !isLoopbackUrl(options.baseURL)
          ? options.baseURL
          : baseURL,
    },
    models: Object.fromEntries(
      models.map((model) => [
        model,
        isRecord(existingModels[model]) ? existingModels[model] : { name: model },
      ]),
    ),
  };
  next.provider = provider;
  return next;
}

/**
 * Writes the Ollama block. The previous bytes go to `<file>.monocode.bak` first, so the owner
 * can restore the file by hand; JSONC, invalid and unreadable files are refused unchanged.
 */
export async function saveOllamaModelsToOpencode(
  path: string,
  models: readonly string[],
  baseURL: string,
): Promise<void> {
  const current = await readOpencodeConfig(path);
  if (current.state === "comments")
    throw new Error("The OpenCode config has comments. Edit it by hand to keep them.");
  if (current.state !== "ready") throw new Error("The OpenCode config could not be read.");
  const created = !current.raw?.trim();
  // Nothing to remove from a file that does not exist yet.
  if (created && models.length === 0) return;
  const base = created ? { $schema: "https://opencode.ai/config.json" } : current.config;
  const next = withOllamaModels(base, models, baseURL);
  if (!created && current.raw) await writeFileAtomic(`${path}.monocode.bak`, current.raw);
  await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
}
