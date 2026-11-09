import { describe, expect, it } from "vitest";
import type { HardwareInfo } from "./decision-types";
import { hardwareTier, parseNvidiaGpus } from "./hardware";
import { recommendLocal } from "./local-install";
import type { CatalogModel } from "./catalog";

const GIB = 1024 ** 3;

function hardware(overrides: Partial<HardwareInfo>): HardwareInfo {
  return {
    ramBytes: 32 * GIB,
    freeRamBytes: 16 * GIB,
    cpus: 8,
    gpus: [],
    freeDiskBytes: 500 * GIB,
    ...overrides,
  };
}

const gpu = (vramGb: number) => [{ name: "Test GPU", vramBytes: vramGb * GIB }];

describe("hardware tiers", () => {
  it("maps 8 GiB or more of VRAM to strong", () => {
    expect(hardwareTier(hardware({ gpus: gpu(12) }))).toBe("strong");
  });

  it("maps 4 to 8 GiB of VRAM, or 16 GiB RAM with 4 CPUs, to medium", () => {
    expect(hardwareTier(hardware({ gpus: gpu(6) }))).toBe("medium");
    expect(hardwareTier(hardware({ ramBytes: 16 * GIB, cpus: 4 }))).toBe("medium");
  });

  it("maps no usable GPU with at least 8 GiB RAM to cpu", () => {
    expect(hardwareTier(hardware({ ramBytes: 8 * GIB, cpus: 2 }))).toBe("cpu");
  });

  it("maps less than 8 GiB RAM and no GPU to insufficient", () => {
    expect(hardwareTier(hardware({ ramBytes: 4 * GIB, cpus: 8 }))).toBe("insufficient");
  });
});

describe("NVIDIA output parsing", () => {
  it("reads name and total memory in MiB, and keeps a name when memory is unreadable", () => {
    expect(parseNvidiaGpus("NVIDIA GeForce RTX 4070, 12282\r\nNVIDIA Odd, [N/A]\n")).toEqual([
      { name: "NVIDIA GeForce RTX 4070", vramBytes: 12282 * 1024 * 1024 },
      { name: "NVIDIA Odd" },
    ]);
  });

  it("ignores empty and malformed lines", () => {
    expect(parseNvidiaGpus("\n,\n  \n")).toEqual([]);
  });
});

describe("local recommendation", () => {
  const verifiedModel: CatalogModel = {
    id: "clef-flash-9b",
    name: "Clef-Flash 9B",
    params: "9B",
    openWeights: true,
    vision: false,
    verified: true,
    recommendedHardware: { minVramGb: 7 },
    localFiles: [
      {
        fileName: "clef.gguf",
        sha256: "a".repeat(64),
        url: "https://example.invalid/clef.gguf",
        verified: true,
      },
    ],
  };
  const unverifiedModel: CatalogModel = {
    ...verifiedModel,
    id: "unverified",
    localFiles: [{ fileName: "x.gguf", sha256: "b".repeat(64), verified: false }],
  };

  it("recommends a verified model that fits the strong tier", () => {
    expect(recommendLocal(hardware({ gpus: gpu(12) }), [verifiedModel])).toEqual({
      tier: "strong",
      modelId: "clef-flash-9b",
    });
  });

  it("does not recommend a model whose VRAM need the machine cannot meet", () => {
    expect(recommendLocal(hardware({ gpus: gpu(6) }), [verifiedModel])).toEqual({ tier: "medium" });
  });

  it("never recommends an unverified model, even on strong hardware", () => {
    expect(recommendLocal(hardware({ gpus: gpu(24) }), [unverifiedModel])).toEqual({
      tier: "strong",
    });
  });

  it("recommends nothing locally on insufficient hardware", () => {
    expect(recommendLocal(hardware({ ramBytes: 2 * GIB, cpus: 1 }), [verifiedModel])).toEqual({
      tier: "insufficient",
    });
  });
});
