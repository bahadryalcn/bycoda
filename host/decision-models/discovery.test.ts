import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "./catalog";
import { assertLoopback } from "./contract-probe";
import { defaultDecisionConfig } from "./decision-config";
import { extractGgufPath, scan } from "./discovery";
import { sha256File } from "./gguf";

// Discovery must not spawn real processes in tests: process listing is replaced by an empty result.
vi.mock("./local-command", () => ({ runCommand: vi.fn(async () => undefined) }));

const GGUF_HEADER = Buffer.concat([
  Buffer.from("GGUF", "latin1"),
  Buffer.from([3, 0, 0, 0]),
  Buffer.alloc(16),
]);

function catalogWith(sha256: string | undefined, sizeBytes: number): Catalog {
  return {
    version: 1,
    updatedAt: "2026-11-07",
    providers: [
      {
        id: "clef-local",
        name: "Clef (local proxy)",
        auth: "none",
        verified: false,
        models: [
          {
            id: "clef-flash-9b",
            name: "Clef-Flash 9B",
            params: "9B",
            openWeights: true,
            vision: false,
            verified: false,
            localFiles: [
              {
                fileName: "clef.gguf",
                verified: false,
                ...(sha256 ? { sha256 } : {}),
                sizeBytes,
              },
            ],
          },
        ],
      },
    ],
  };
}

const refusedFetch = vi.fn(async () => {
  throw new TypeError("connection refused");
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "discovery-home-"));
  refusedFetch.mockClear();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("automatic discovery", () => {
  it("returns an actionable endpoint for a detected local service", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (!String(input).startsWith("http://127.0.0.1:8080/")) throw new TypeError("refused");
      return new Response(
        JSON.stringify(
          String(input).endsWith("/v1/systemone") ? { answers: { probe: { value: true } } } : {},
        ),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const result = await scan(defaultDecisionConfig(), new AbortController().signal, {
      catalog: catalogWith(undefined, 1),
      env: {},
      homeDirectory: home,
      fetchImpl,
    });
    expect(result.found).toContainEqual(
      expect.objectContaining({
        kind: "local_service",
        detail: "http://127.0.0.1:8080/v1/systemone",
      }),
    );
  });
  it("probes only loopback addresses", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      throw new TypeError("refused");
    }) as unknown as typeof fetch;
    await scan(defaultDecisionConfig(), new AbortController().signal, {
      catalog: catalogWith(undefined, 1),
      env: {},
      homeDirectory: home,
      fetchImpl,
    });
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|\[::1\]):\d+\//);
  });

  it("refuses a non-loopback address in the probe guard", () => {
    expect(() => assertLoopback("http://192.168.1.20:8080/health")).toThrow();
    expect(() => assertLoopback("https://127.0.0.1:8080/health")).toThrow();
    expect(() => assertLoopback("http://127.0.0.1:8080/health")).not.toThrow();
  });

  it("checks API key variables only for presence and never reads a value", async () => {
    const env = new Proxy(
      { TYPESAFE_API_KEY: "must-not-be-read" } as Record<string, string | undefined>,
      {
        get() {
          throw new Error("environment value was read");
        },
      },
    );
    const result = await scan(defaultDecisionConfig(), new AbortController().signal, {
      catalog: catalogWith(undefined, 1),
      env,
      homeDirectory: home,
      fetchImpl: refusedFetch as unknown as typeof fetch,
    });
    expect(result.found).toContainEqual(
      expect.objectContaining({
        id: "env:TYPESAFE_API_KEY",
        kind: "api_key",
        detail: "TYPESAFE_API_KEY",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("must-not-be-read");
  });

  it("lists only GGUF files inside the fixed model folders without hashing during discovery", async () => {
    const folder = join(home, ".cache", "huggingface", "hub", "models--x");
    mkdirSync(folder, { recursive: true });
    const model = join(folder, "clef.gguf");
    writeFileSync(model, Buffer.concat([GGUF_HEADER, Buffer.from("payload")]));
    writeFileSync(join(folder, "notes.gguf"), "not a model");
    const outside = mkdtempSync(join(tmpdir(), "discovery-outside-"));
    writeFileSync(join(outside, "secret.gguf"), Buffer.concat([GGUF_HEADER, Buffer.from("x")]));
    try {
      const size = Buffer.byteLength(Buffer.concat([GGUF_HEADER, Buffer.from("payload")]));
      const sha = await sha256File(model);
      const result = await scan(defaultDecisionConfig(), new AbortController().signal, {
        catalog: catalogWith(sha, size),
        env: {},
        homeDirectory: home,
        fetchImpl: refusedFetch as unknown as typeof fetch,
      });
      const models = result.found.filter((candidate) => candidate.kind === "model_file");
      expect(models).toEqual([
        expect.objectContaining({
          label: "Clef-Flash 9B",
          detail: expect.stringContaining("not verified"),
        }),
      ]);
      expect(models[0].detail).toContain(model);
      expect(result.found.some((candidate) => candidate.detail?.includes("secret.gguf"))).toBe(
        false,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reports an unmatched GGUF as not verified and skips files without a GGUF header", async () => {
    const folder = join(home, ".lmstudio", "models");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "other.gguf"), Buffer.concat([GGUF_HEADER, Buffer.from("y")]));
    const result = await scan(defaultDecisionConfig(), new AbortController().signal, {
      catalog: catalogWith("a".repeat(64), 999),
      env: {},
      homeDirectory: home,
      fetchImpl: refusedFetch as unknown as typeof fetch,
    });
    expect(result.found).toEqual([
      expect.objectContaining({
        kind: "model_file",
        label: "other.gguf",
        detail: expect.stringContaining("not verified"),
      }),
    ]);
  });

  it("returns no candidates and no error when the caller aborts before the scan starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await scan(defaultDecisionConfig(), controller.signal, {
      catalog: catalogWith(undefined, 1),
      env: {},
      homeDirectory: home,
      fetchImpl: refusedFetch as unknown as typeof fetch,
    });
    expect(result.found).toEqual([]);
  });

  it("extracts the model path from a runtime command line", () => {
    expect(extractGgufPath(`llama-server -m "C:\\Models\\Clef Flash.gguf" --port 8080`)).toBe(
      "C:\\Models\\Clef Flash.gguf",
    );
    expect(extractGgufPath("ollama serve")).toBeUndefined();
  });
});
