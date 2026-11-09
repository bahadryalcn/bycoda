import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "./catalog";
import type { DecisionSource, HardwareInfo } from "./decision-types";
import { createLocalInstaller, INSTALL_CONFIRMATION } from "./local-install";
import { LocalRuntime } from "./local-runtime";

const GIB = 1024 ** 3;
const MODEL_BYTES = Buffer.from("clef-model-weights-for-tests");
const MODEL_SHA = createHash("sha256").update(MODEL_BYTES).digest("hex");
const URL_FILE = "https://example.invalid/clef.gguf";

type FileOverrides = { sha256?: string | undefined; url?: string | undefined; verified?: boolean };

function catalogWith(file: FileOverrides): Catalog {
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
            id: "test-model",
            name: "Test Model",
            params: "9B",
            openWeights: true,
            vision: false,
            verified: false,
            recommendedHardware: { minVramGb: 7 },
            localFiles: [
              {
                fileName: "clef.gguf",
                sha256: MODEL_SHA,
                sizeBytes: MODEL_BYTES.length,
                url: URL_FILE,
                verified: true,
                ...file,
              },
            ],
          },
        ],
      },
    ],
  };
}

const hardwareWith = (freeDiskBytes: number) => async (): Promise<HardwareInfo> => ({
  ramBytes: 32 * GIB,
  freeRamBytes: 16 * GIB,
  cpus: 8,
  gpus: [{ name: "Test GPU", vramBytes: 12 * GIB }],
  freeDiskBytes,
});

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { pid?: number; kill: () => boolean };
  child.kill = vi.fn(() => true);
  return child;
}

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "local-install-root-"));
  outside = mkdtempSync(join(tmpdir(), "local-install-outside-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function downloadingWith(bytes: Buffer) {
  return vi.fn(async () => new Response(bytes, { status: 200 }));
}

function makeInstaller(options: {
  catalog: Catalog;
  download: ReturnType<typeof downloadingWith>;
  freeDiskBytes?: number;
  health?: () => Promise<Response>;
  spawnImpl?: typeof spawn;
}) {
  const runtime = new LocalRuntime({
    spawnImpl: options.spawnImpl ?? (vi.fn(() => fakeChild()) as unknown as typeof spawn),
    fetchImpl: (options.health ??
      (async () => new Response("{}", { status: 200 }))) as unknown as typeof fetch,
    allocatePort: async () => 45123,
    now: () => Date.now(),
  });
  return createLocalInstaller({
    root,
    catalog: () => options.catalog,
    runtime,
    fetchImpl: options.download as unknown as typeof fetch,
    hardware: hardwareWith(options.freeDiskBytes ?? 100 * GIB),
  });
}

describe("local model installation", () => {
  it("downloads nothing without the explicit confirmation", async () => {
    const download = downloadingWith(MODEL_BYTES);
    const installer = makeInstaller({ catalog: catalogWith({}), download });
    await expect(installer.install({ modelId: "test-model", confirm: "yes" })).rejects.toThrow(
      "explicit confirmation",
    );
    await expect(
      installer.install({ modelId: "test-model", confirm: true as never }),
    ).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses a model with no catalog SHA256 or URL as an unverified model", async () => {
    const download = downloadingWith(MODEL_BYTES);
    const noHash = makeInstaller({ catalog: catalogWith({ sha256: undefined }), download });
    await expect(
      noHash.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow("unverified model");
    const noUrl = makeInstaller({ catalog: catalogWith({ url: undefined }), download });
    await expect(
      noUrl.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow("unverified model");
    const notVerified = makeInstaller({ catalog: catalogWith({ verified: false }), download });
    await expect(
      notVerified.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow("unverified model");
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses a download whose SHA256 does not match and leaves nothing installed", async () => {
    const download = downloadingWith(Buffer.from("tampered-bytes"));
    const installer = makeInstaller({ catalog: catalogWith({}), download });
    await expect(
      installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow("verification failed");
    expect(existsSync(join(root, "test-model", "clef.gguf"))).toBe(false);
    expect(existsSync(join(root, "test-model", "install.json"))).toBe(false);
    expect(readdirSync(join(root, "test-model"))).toEqual([]);
  });

  it("refuses to install when free disk space is short", async () => {
    const download = downloadingWith(MODEL_BYTES);
    const installer = makeInstaller({ catalog: catalogWith({}), download, freeDiskBytes: 0 });
    await expect(
      installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow("Not enough free disk space");
    expect(download).not.toHaveBeenCalled();
  });

  it("installs a verified file and records its SHA256 for later start checks", async () => {
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
    });
    await expect(
      installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).resolves.toEqual({ state: "installed" });
    const record = JSON.parse(readFileSync(join(root, "test-model", "install.json"), "utf8")) as {
      files: { fileName: string; sha256: string }[];
    };
    expect(record.files).toEqual([
      expect.objectContaining({ fileName: "clef.gguf", sha256: MODEL_SHA }),
    ]);
  });

  it("starts only after the installed file still matches, and quarantines a changed file", async () => {
    const spawnImpl = vi.fn(() => fakeChild()) as unknown as typeof spawn;
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
      spawnImpl,
    });
    await installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    const folder = join(root, "test-model");
    const runtimePath = join(folder, "llama-server");
    writeFileSync(runtimePath, "runtime-binary");
    const source: DecisionSource = {
      id: "src-local-1",
      name: "Test Model",
      kind: "local",
      adapter: "systemone",
      status: "unknown",
      local: { modelPath: join(folder, "clef.gguf"), runtimePath },
    };
    await expect(installer.start(source)).resolves.toEqual({
      state: "running",
      sourceId: "src-local-1",
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      runtimePath,
      expect.arrayContaining(["--host", "127.0.0.1", "--port", "45123"]),
      expect.any(Object),
    );
    await installer.stop("src-local-1");

    writeFileSync(join(folder, "clef.gguf"), "tampered after install");
    await expect(installer.start({ ...source, id: "src-local-2" })).rejects.toThrow("quarantined");
    expect(existsSync(join(folder, "clef.gguf"))).toBe(false);
    expect(readdirSync(folder).some((name) => name.startsWith("clef.gguf.quarantine-"))).toBe(true);
  });

  it("uninstalls only an installed folder under the root and never deletes a user file", async () => {
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
    });
    await installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    const installed: DecisionSource = {
      id: "src-a",
      name: "Installed",
      kind: "local",
      adapter: "systemone",
      status: "unknown",
      local: { modelPath: join(root, "test-model", "clef.gguf") },
    };
    await installer.uninstall(installed);
    expect(existsSync(join(root, "test-model"))).toBe(false);

    const userFile = join(outside, "my-model.gguf");
    writeFileSync(userFile, "user file");
    await installer.uninstall({
      ...installed,
      id: "src-b",
      local: { modelPath: userFile },
    });
    expect(existsSync(userFile)).toBe(true);
  });
});
