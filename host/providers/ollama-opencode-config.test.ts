import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configuredOllamaModels,
  opencodeUserConfigPath,
  parseOpencodeConfig,
  readOpencodeConfig,
  saveOllamaModelsToOpencode,
  withOllamaModels,
} from "./ollama-opencode-config";

const BASE = "http://127.0.0.1:11434/v1";

describe("withOllamaModels", () => {
  it("keeps other config, the owner's Ollama options and kept models' settings", () => {
    const config = {
      $schema: "https://opencode.ai/config.json",
      mcp: { tool: { type: "local" } },
      provider: {
        openai: { options: { apiKey: "{env:KEY}" } },
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://192.168.1.5:11434/v1", timeout: 5 },
          models: { "qwen3:8b": { name: "Qwen", limit: { context: 32768 } }, "old:1b": {} },
        },
      },
    };
    const next = withOllamaModels(config, ["qwen3:8b", "llama3.1:8b"], BASE);
    expect(next.mcp).toEqual(config.mcp);
    expect((next.provider as Record<string, unknown>).openai).toEqual(config.provider.openai);
    expect((next.provider as Record<string, unknown>).ollama).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "Ollama",
      options: { baseURL: "http://192.168.1.5:11434/v1", timeout: 5 },
      models: {
        "qwen3:8b": { name: "Qwen", limit: { context: 32768 } },
        "llama3.1:8b": { name: "llama3.1:8b" },
      },
    });
    // The input is not mutated.
    expect(Object.keys(config.provider.ollama.models)).toEqual(["qwen3:8b", "old:1b"]);
  });

  it("moves a loopback address to the chosen port", () => {
    for (const baseURL of ["http://127.0.0.1:11434/v1", "http://localhost:11434/v1"]) {
      const next = withOllamaModels(
        { provider: { ollama: { options: { baseURL }, models: { "a:1b": {} } } } },
        ["a:1b"],
        "http://127.0.0.1:12000/v1",
      );
      expect(
        (next.provider as Record<string, Record<string, Record<string, unknown>>>).ollama.options
          .baseURL,
      ).toBe("http://127.0.0.1:12000/v1");
    }
  });

  it("adds a new block with the default address", () => {
    expect(withOllamaModels({}, ["qwen3:0.6b"], BASE)).toEqual({
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama",
          options: { baseURL: BASE },
          models: { "qwen3:0.6b": { name: "qwen3:0.6b" } },
        },
      },
    });
  });

  it("removes the block, and an emptied provider object, when no model is chosen", () => {
    expect(withOllamaModels({ provider: { ollama: { models: {} } }, a: 1 }, [], BASE)).toEqual({
      a: 1,
    });
    expect(withOllamaModels({ provider: { ollama: {}, openai: {} } }, [], BASE).provider).toEqual({
      openai: {},
    });
  });

  it("refuses a provider value that is not an object", () => {
    expect(() => withOllamaModels({ provider: [] }, ["a"], BASE)).toThrow(/not an object/);
  });
});

describe("parseOpencodeConfig", () => {
  it("tells plain JSON, JSONC and invalid files apart", () => {
    expect(parseOpencodeConfig('{"a":1}').state).toBe("ready");
    const jsonc = parseOpencodeConfig(
      '{\n // note\n "provider": {"ollama": {"models": {"x:1b": {}}}},\n}',
    );
    expect(jsonc.state).toBe("comments");
    expect(configuredOllamaModels(jsonc.config)).toEqual(["x:1b"]);
    expect(parseOpencodeConfig("[1]").state).toBe("invalid");
    expect(parseOpencodeConfig("{ not json").state).toBe("invalid");
  });
});

describe("OpenCode config file", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ollama-opencode-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("follows OpenCode's path order", async () => {
    expect(await opencodeUserConfigPath({ OPENCODE_CONFIG: "/x/c.json" }, directory)).toBe(
      "/x/c.json",
    );
    const config = join(directory, "xdg", "opencode");
    expect(await opencodeUserConfigPath({ XDG_CONFIG_HOME: join(directory, "xdg") }, "/h")).toBe(
      join(config, "opencode.json"),
    );
    await saveOllamaModelsToOpencode(join(config, "opencode.jsonc"), ["a:1b"], BASE);
    expect(await opencodeUserConfigPath({ XDG_CONFIG_HOME: join(directory, "xdg") }, "/h")).toBe(
      join(config, "opencode.jsonc"),
    );
  });

  it("creates a missing file only when there is something to add", async () => {
    const path = join(directory, "opencode.json");
    await saveOllamaModelsToOpencode(path, [], BASE);
    expect((await readOpencodeConfig(path)).config).toEqual({});
    await saveOllamaModelsToOpencode(path, ["qwen3:0.6b"], BASE);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.$schema).toBe("https://opencode.ai/config.json");
    expect(configuredOllamaModels(saved)).toEqual(["qwen3:0.6b"]);
  });

  it("backs up the previous bytes before replacing them", async () => {
    const path = join(directory, "opencode.json");
    const original = '{"mcp":{"x":{"type":"remote"}}}';
    await writeFile(path, original);
    await saveOllamaModelsToOpencode(path, ["qwen3:0.6b"], BASE);
    expect(await readFile(`${path}.monocode.bak`, "utf8")).toBe(original);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.mcp).toEqual({ x: { type: "remote" } });
  });

  it("leaves a file with comments or invalid content untouched", async () => {
    const path = join(directory, "opencode.json");
    const jsonc = '{\n  // keep me\n  "mcp": {}\n}';
    await writeFile(path, jsonc);
    await expect(saveOllamaModelsToOpencode(path, ["a:1b"], BASE)).rejects.toThrow(/comments/);
    await writeFile(path, "{ broken");
    await expect(saveOllamaModelsToOpencode(path, ["a:1b"], BASE)).rejects.toThrow(/could not/);
    expect(await readFile(path, "utf8")).toBe("{ broken");
  });
});
