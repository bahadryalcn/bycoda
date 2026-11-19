import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

const gpuProbeMustNotRun = async (): Promise<HardwareInfo> => {
  throw new Error("plan and install must not run the GPU probe");
};

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

/** Sends four bytes, then stalls until the request's signal aborts, like a long download. */
function hangingDownload() {
  return vi.fn(async (_url?: unknown, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(MODEL_BYTES.subarray(0, 4));
        init?.signal?.addEventListener("abort", () =>
          controller.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return new Response(stream, { status: 200 });
  });
}

function makeInstaller(options: {
  catalog: Catalog;
  download: ReturnType<typeof downloadingWith> | ReturnType<typeof hangingDownload>;
  freeDiskBytes?: number;
  health?: () => Promise<Response>;
  spawnImpl?: typeof spawn;
  onInstalled?: (modelId: string) => Promise<void>;
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
    hardware: gpuProbeMustNotRun,
    freeDisk: async () => options.freeDiskBytes ?? 100 * GIB,
    ...(options.onInstalled ? { onInstalled: options.onInstalled } : {}),
  });
}

describe("local model installation", () => {
  it("plans from the disk probe alone and never runs the GPU probe", async () => {
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
      freeDiskBytes: 1024 * GIB,
    });
    const plan = await installer.plan("test-model");
    expect(plan.freeDiskBytes).toBe(1024 * GIB);
    expect(plan.fits).toBe(true);
  });

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
    // Nothing is left behind: not the model folder and not the staging folder.
    expect(readdirSync(root)).toEqual([]);
  });

  it("shares one download between concurrent installs of the same model", async () => {
    const gate = Promise.withResolvers<void>();
    const download = vi.fn(async () => {
      await gate.promise;
      return new Response(MODEL_BYTES, { status: 200 });
    });
    const installer = makeInstaller({ catalog: catalogWith({}), download });
    const input = { modelId: "test-model", confirm: INSTALL_CONFIRMATION };
    const first = installer.install(input);
    const second = installer.install(input);
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { state: "installed" },
      { state: "installed" },
    ]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(installer.installProgress("test-model")).toBeUndefined();
  });

  it("reports progress and cancels a running install without leaving files", async () => {
    const download = hangingDownload();
    const installer = makeInstaller({ catalog: catalogWith({}), download });
    const running = installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    const rejected = expect(running).rejects.toThrow("cancelled");
    await vi.waitFor(() =>
      expect(installer.installProgress("test-model")).toMatchObject({
        fileName: "clef.gguf",
        fileCount: 1,
        bytesDone: 4,
        bytesTotal: MODEL_BYTES.length,
      }),
    );
    expect(installer.cancelInstall("test-model")).toBe(true);
    await rejected;
    expect(installer.cancelInstall("test-model")).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("cancels installs in flight when the Host closes and refuses later installs", async () => {
    const installer = makeInstaller({ catalog: catalogWith({}), download: hangingDownload() });
    const running = installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    const rejected = expect(running).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(installer.installProgress("test-model")).toBeDefined());
    await installer.close();
    await rejected;
    expect(readdirSync(root)).toEqual([]);
    await expect(
      installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow("closed");
  });

  it("restores the files it replaced and leaves no record when the final move fails", async () => {
    const folder = join(root, "test-model");
    mkdirSync(join(folder, "install.json"), { recursive: true });
    writeFileSync(join(folder, "clef.gguf"), "previous bytes");
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
    });
    await expect(
      installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow();
    expect(readFileSync(join(folder, "clef.gguf"), "utf8")).toBe("previous bytes");
    expect(readdirSync(root)).toEqual(["test-model"]);
  });

  it("removes staging folders a crashed Host left behind", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    const crashed = join(root, ".staging-crashed");
    mkdirSync(crashed);
    writeFileSync(join(crashed, "clef.gguf"), "partial");
    writeFileSync(join(crashed, ".lease"), "1\n");
    utimesSync(join(crashed, ".lease"), old, old);
    const unleased = join(root, ".staging-unleased");
    mkdirSync(unleased);
    utimesSync(unleased, old, old);
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
    });
    await installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    expect(readdirSync(root)).toEqual(["test-model"]);
  });

  it("leaves a staging folder another live writer holds, and one that keeps replaced files", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    // Another Host process installing into the same root: its folder is old but its lease is fresh.
    const live = join(root, ".staging-live");
    mkdirSync(live);
    writeFileSync(join(live, "clef.gguf"), "downloading");
    writeFileSync(join(live, ".lease"), "4242\n");
    utimesSync(live, old, old);
    // Just created, lease not written yet.
    mkdirSync(join(root, ".staging-starting"));
    // Crashed in the middle of the final move: the replaced file may be the only copy.
    const aside = join(root, ".staging-aside");
    mkdirSync(join(aside, ".previous"), { recursive: true });
    writeFileSync(join(aside, ".previous", "clef.gguf"), "only copy");
    writeFileSync(join(aside, ".lease"), "1\n");
    utimesSync(join(aside, ".lease"), old, old);
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
    });
    await installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    expect(readdirSync(root).sort()).toEqual([
      ".staging-aside",
      ".staging-live",
      ".staging-starting",
      "test-model",
    ]);
    expect(readFileSync(join(live, "clef.gguf"), "utf8")).toBe("downloading");
    expect(readFileSync(join(aside, ".previous", "clef.gguf"), "utf8")).toBe("only copy");
  });

  it("marks its own staging folder with a lease while it downloads", async () => {
    const installer = makeInstaller({ catalog: catalogWith({}), download: hangingDownload() });
    const running = installer.install({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    const rejected = expect(running).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(installer.installProgress("test-model")?.bytesDone).toBe(4));
    const [staging] = readdirSync(root).filter((name) => name.startsWith(".staging-"));
    expect(existsSync(join(root, staging!, ".lease"))).toBe(true);
    installer.cancelInstall("test-model");
    await rejected;
    expect(readdirSync(root)).toEqual([]);
  });

  it("starts an install without waiting, then reports progress and how it ended", async () => {
    const gate = Promise.withResolvers<void>();
    const download = vi.fn(async () => {
      await gate.promise;
      return new Response(MODEL_BYTES, { status: 200 });
    });
    const installer = makeInstaller({ catalog: catalogWith({}), download });
    const input = { modelId: "test-model", confirm: INSTALL_CONFIRMATION };
    expect(installer.installState("test-model")).toEqual({ state: "idle" });
    await expect(installer.startInstall(input)).resolves.toMatchObject({
      state: "running",
      progress: { modelId: "test-model", fileName: "clef.gguf", fileCount: 1 },
    });
    // A second window starting the same model joins the run instead of downloading again.
    await expect(installer.startInstall(input)).resolves.toMatchObject({ state: "running" });
    gate.resolve();
    await vi.waitFor(() =>
      expect(installer.installState("test-model")).toEqual({ state: "installed" }),
    );
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("refuses to start without confirmation or for an unverified model", async () => {
    const download = downloadingWith(MODEL_BYTES);
    const installer = makeInstaller({ catalog: catalogWith({}), download });
    await expect(installer.startInstall({ modelId: "test-model", confirm: "yes" })).rejects.toThrow(
      "explicit confirmation",
    );
    const unverified = makeInstaller({ catalog: catalogWith({ verified: false }), download });
    await expect(
      unverified.startInstall({ modelId: "test-model", confirm: INSTALL_CONFIRMATION }),
    ).rejects.toThrow("unverified model");
    expect(installer.installState("test-model")).toEqual({ state: "idle" });
    expect(download).not.toHaveBeenCalled();
  });

  it("keeps a cancelled outcome and a failed outcome with a message free of paths", async () => {
    const hanging = makeInstaller({ catalog: catalogWith({}), download: hangingDownload() });
    const input = { modelId: "test-model", confirm: INSTALL_CONFIRMATION };
    await hanging.startInstall(input);
    await vi.waitFor(() => expect(hanging.installProgress("test-model")?.bytesDone).toBe(4));
    expect(hanging.cancelInstall("test-model")).toBe(true);
    await vi.waitFor(() =>
      expect(hanging.installState("test-model")).toEqual({ state: "cancelled" }),
    );

    const tampered = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(Buffer.from("tampered-bytes")),
    });
    await tampered.startInstall(input);
    await vi.waitFor(() => expect(tampered.installState("test-model").state).toBe("failed"));
    expect(tampered.installState("test-model").error).toContain("verification failed");

    const broken = makeInstaller({
      catalog: catalogWith({}),
      download: vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED ${root}`);
      }),
    });
    await broken.startInstall(input);
    await vi.waitFor(() => expect(broken.installState("test-model").state).toBe("failed"));
    const failure = broken.installState("test-model");
    expect(failure.error).toBeTruthy();
    expect(failure.error).not.toContain(root);
    expect(failure.error).not.toContain("ECONNREFUSED");
  });

  it("registers a finished install before it reports installed", async () => {
    const gate = Promise.withResolvers<void>();
    const registered: string[] = [];
    const installer = makeInstaller({
      catalog: catalogWith({}),
      download: downloadingWith(MODEL_BYTES),
      onInstalled: async (modelId) => {
        await gate.promise;
        registered.push(modelId);
      },
    });
    await installer.startInstall({ modelId: "test-model", confirm: INSTALL_CONFIRMATION });
    await vi.waitFor(() => expect(readdirSync(join(root, "test-model"))).toContain("install.json"));
    expect(installer.installState("test-model").state).toBe("running");
    gate.resolve();
    await vi.waitFor(() =>
      expect(installer.installState("test-model")).toEqual({ state: "installed" }),
    );
    expect(registered).toEqual(["test-model"]);
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
