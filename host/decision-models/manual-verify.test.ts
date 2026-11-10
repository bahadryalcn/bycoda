import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "./catalog";
import {
  verifyEndpoint,
  verifyInstallationFolder,
  verifyModelFile,
  verifyModelInstallation,
} from "./manual-verify";
import { readGgufHeader, sha256File } from "./gguf";

const GGUF_HEADER = Buffer.concat([
  Buffer.from("GGUF", "latin1"),
  Buffer.from([3, 0, 0, 0]),
  Buffer.alloc(16),
]);
const EMPTY_CATALOG: Catalog = { version: 1, updatedAt: "2026-11-07", providers: [] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "manual-verify-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("GGUF reading", () => {
  it("reads the fixed header and rejects a file that is not GGUF", async () => {
    const good = join(dir, "good.gguf");
    writeFileSync(good, GGUF_HEADER);
    expect(await readGgufHeader(good)).toEqual({
      version: 3,
      tensorCount: 0n,
      metadataCount: 0n,
    });
    const bad = join(dir, "bad.gguf");
    writeFileSync(bad, "not a model at all, just text");
    expect(await readGgufHeader(bad)).toBeUndefined();
  });

  it("hashes a file with SHA256", async () => {
    const file = join(dir, "hash.gguf");
    writeFileSync(file, "abc");
    expect(await sha256File(file)).toBe(createHash("sha256").update("abc").digest("hex"));
  });
});

describe("manual model file check", () => {
  it("refuses a relative path, a non-gguf extension and a non-GGUF body", async () => {
    await expect(verifyModelFile("model.gguf", EMPTY_CATALOG)).rejects.toThrow("absolute");
    const text = join(dir, "model.txt");
    writeFileSync(text, GGUF_HEADER);
    await expect(verifyModelFile(text, EMPTY_CATALOG)).rejects.toThrow(".gguf");
    const fake = join(dir, "fake.gguf");
    writeFileSync(fake, "plain text");
    await expect(verifyModelFile(fake, EMPTY_CATALOG)).rejects.toThrow("not a GGUF");
  });

  it("accepts a GGUF file with no catalog entry but marks it unverified", async () => {
    const file = join(dir, "custom.gguf");
    writeFileSync(file, GGUF_HEADER);
    const check = await verifyModelFile(file, EMPTY_CATALOG);
    expect(check.verified).toBe(false);
    expect(check.sha256).toBeUndefined();
  });

  it("refuses a file whose SHA256 does not match the expected value", async () => {
    const file = join(dir, "mismatch.gguf");
    writeFileSync(file, GGUF_HEADER);
    await expect(
      verifyModelFile(file, EMPTY_CATALOG, { expectedSha256: "0".repeat(64) }),
    ).rejects.toThrow("does not match");
  });
});

describe("installation folder check", () => {
  it("finds models without a manifest and excludes vision projectors", async () => {
    mkdirSync(join(dir, "models"));
    mkdirSync(join(dir, "runtime"));
    writeFileSync(join(dir, "models", "custom.gguf"), GGUF_HEADER);
    writeFileSync(join(dir, "models", "mmproj-custom.gguf"), GGUF_HEADER);
    writeFileSync(join(dir, "runtime", "llama-server.exe"), "runtime");
    const result = await verifyInstallationFolder(dir, EMPTY_CATALOG);
    expect(result.models).toEqual([
      expect.objectContaining({
        name: "custom",
        modelPath: join(dir, "models", "custom.gguf"),
        runtimePath: join(dir, "runtime", "llama-server.exe"),
        verified: false,
      }),
    ]);
  });

  it("recognizes the Clef vision runtime and projector from the installation record", async () => {
    mkdirSync(join(dir, "models"));
    mkdirSync(join(dir, "runtime-vision-b11429"));
    const modelPath = join(dir, "models", "Clef-Flash-vision.gguf");
    const projectorPath = join(dir, "models", "mmproj-Clef-Flash.gguf");
    writeFileSync(modelPath, GGUF_HEADER);
    writeFileSync(projectorPath, GGUF_HEADER);
    writeFileSync(join(dir, "runtime-vision-b11429", "llama-server.exe"), "runtime");
    writeFileSync(
      join(dir, "installation.json"),
      JSON.stringify({
        model: "clef-flash",
        modelPath: "models/Clef-Flash-vision.gguf",
        visionProjector: "mmproj-Clef-Flash.gguf",
      }),
    );
    const result = await verifyInstallationFolder(dir, EMPTY_CATALOG);
    expect(result.runtimePath).toBe(join(dir, "runtime-vision-b11429", "llama-server.exe"));
    expect(result.projectorPath).toBe(projectorPath);
    expect(result.models).toHaveLength(1);
  });

  it("reads installation.json and verifies the recorded model", async () => {
    const folder = join(dir, "clef");
    mkdirSync(join(folder, "models"), { recursive: true });
    const model = join(folder, "models", "clef.gguf");
    writeFileSync(model, GGUF_HEADER);
    const sha = await sha256File(model);
    writeFileSync(
      join(folder, "installation.json"),
      JSON.stringify({
        model: "clef-flash",
        modelPath: "models/clef.gguf",
        sha256: sha,
        endpoint: "http://127.0.0.1:8767/v1/systemone",
      }),
    );
    const check = await verifyInstallationFolder(folder, EMPTY_CATALOG);
    expect(check.verified).toBe(true);
    expect(check.model).toBe("clef-flash");
    expect(check.endpoint).toBe("http://127.0.0.1:8767/v1/systemone");
  });

  it("refuses a model path that leaves the installation folder", async () => {
    const folder = join(dir, "escape");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(dir, "outside.gguf"), GGUF_HEADER);
    writeFileSync(
      join(folder, "installation.json"),
      JSON.stringify({ modelPath: "../outside.gguf" }),
    );
    await expect(verifyInstallationFolder(folder, EMPTY_CATALOG)).rejects.toThrow("leaves");
  });

  it("refuses a recorded SHA256 that does not match the model file", async () => {
    const folder = join(dir, "wrong-sha");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "m.gguf"), GGUF_HEADER);
    writeFileSync(
      join(folder, "installation.json"),
      JSON.stringify({ modelPath: "m.gguf", sha256: "f".repeat(64) }),
    );
    await expect(verifyInstallationFolder(folder, EMPTY_CATALOG)).rejects.toThrow("does not match");
  });
});

describe("model installation check", () => {
  it("resolves a discovered nested Clef model to its installation and runtime", async () => {
    mkdirSync(join(dir, "models"));
    mkdirSync(join(dir, "runtime-vision-b11429"));
    const modelPath = join(dir, "models", "Clef-Flash-vision.gguf");
    const projectorPath = join(dir, "models", "mmproj-Clef-Flash.gguf");
    writeFileSync(modelPath, GGUF_HEADER);
    writeFileSync(projectorPath, GGUF_HEADER);
    writeFileSync(join(dir, "runtime-vision-b11429", "llama-server.exe"), "runtime");
    writeFileSync(
      join(dir, "installation.json"),
      JSON.stringify({
        model: "clef-flash",
        modelPath: "models/Clef-Flash-vision.gguf",
        visionProjector: "mmproj-Clef-Flash.gguf",
        endpoint: "http://127.0.0.1:8767/v1/systemone",
      }),
    );
    const result = await verifyModelInstallation(modelPath, EMPTY_CATALOG);
    expect(result).toMatchObject({
      folder: dir,
      modelPath,
      model: "clef-flash",
      projectorPath,
      runtimePath: join(dir, "runtime-vision-b11429", "llama-server.exe"),
      endpoint: "http://127.0.0.1:8767/v1/systemone",
    });
  });

  it("preserves a nonpreferred selected file without applying the preferred model's alias or projector", async () => {
    mkdirSync(join(dir, "models"));
    const preferred = join(dir, "models", "preferred.gguf");
    const modelPath = join(dir, "models", "other.gguf");
    writeFileSync(preferred, GGUF_HEADER);
    writeFileSync(modelPath, GGUF_HEADER);
    writeFileSync(
      join(dir, "installation.json"),
      JSON.stringify({
        model: "clef-flash",
        modelPath: "models/preferred.gguf",
        endpoint: "http://127.0.0.1:8767/v1/systemone",
      }),
    );
    const result = await verifyModelInstallation(modelPath, EMPTY_CATALOG);
    expect(result.modelPath).toBe(modelPath);
    expect(result.models).toHaveLength(2);
    expect(result.model).toBeUndefined();
    expect(result.projectorPath).toBeUndefined();
    expect(result.endpoint).toBeUndefined();
  });

  it("falls back to the model's own folder without an installation record", async () => {
    mkdirSync(join(dir, "runtime"));
    writeFileSync(join(dir, "runtime", "llama-server.exe"), "runtime");
    const modelPath = join(dir, "custom.gguf");
    writeFileSync(modelPath, GGUF_HEADER);
    expect(await verifyModelInstallation(modelPath, EMPTY_CATALOG)).toMatchObject({
      folder: dir,
      modelPath,
      runtimePath: join(dir, "runtime", "llama-server.exe"),
      verified: false,
    });
  });

  it("rejects invalid paths, non-GGUF bodies, directories and projector files", async () => {
    await expect(verifyModelInstallation("relative.gguf", EMPTY_CATALOG)).rejects.toThrow(
      "absolute",
    );
    await expect(verifyModelInstallation(join(dir, "missing.gguf"), EMPTY_CATALOG)).rejects.toThrow(
      "not found",
    );
    writeFileSync(join(dir, "fake.gguf"), "invalid");
    await expect(verifyModelInstallation(join(dir, "fake.gguf"), EMPTY_CATALOG)).rejects.toThrow(
      "GGUF",
    );
    mkdirSync(join(dir, "folder.gguf"));
    await expect(verifyModelInstallation(join(dir, "folder.gguf"), EMPTY_CATALOG)).rejects.toThrow(
      "not a folder",
    );
    writeFileSync(join(dir, "mmproj-test.gguf"), GGUF_HEADER);
    await expect(
      verifyModelInstallation(join(dir, "mmproj-test.gguf"), EMPTY_CATALOG),
    ).rejects.toThrow("projector");
  });
});

describe("endpoint check", () => {
  it("refuses URLs with credentials or a non-http scheme", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      verifyEndpoint("http://user:pass@127.0.0.1:8767/v1/systemone", { fetchImpl }),
    ).rejects.toThrow("without credentials");
    await expect(verifyEndpoint("ftp://127.0.0.1/x", { fetchImpl })).rejects.toThrow("http");
    await expect(verifyEndpoint("not a url", { fetchImpl })).rejects.toThrow("valid endpoint");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("detects a System One answer and drops query strings from the stored address", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ answers: { probe: { value: true, confidence: 0.9 } } }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const check = await verifyEndpoint("http://127.0.0.1:8767/v1/systemone?token=x", { fetchImpl });
    expect(check).toEqual({
      url: "http://127.0.0.1:8767/v1/systemone",
      reachable: true,
      contract: "systemone",
      adapter: "systemone",
    });
  });

  it("reports an endpoint that answers without the System One shape as reachable only", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>not it</html>", { status: 404 }),
    ) as unknown as typeof fetch;
    const check = await verifyEndpoint("https://example.invalid/api", { fetchImpl });
    expect(check.reachable).toBe(true);
    expect(check.contract).toBeUndefined();
  });
});
