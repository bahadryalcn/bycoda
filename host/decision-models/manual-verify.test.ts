import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "./catalog";
import { verifyEndpoint, verifyInstallationFolder, verifyModelFile } from "./manual-verify";
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
