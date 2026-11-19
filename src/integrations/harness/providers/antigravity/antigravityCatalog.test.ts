import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  transport: "stream-json" as "acp" | "stream-json",
  exec: vi.fn(async () => ""),
  setModels: vi.fn(),
}));

vi.mock("../../core/child", () => ({
  resolveAntigravityBinary: async () => ({
    path: "C:\agy\bin\agy.exe",
    args: [],
    transport: mock.transport,
  }),
  execChild: mock.exec,
  spawnChild: vi.fn(),
  watchChild: vi.fn(),
  unwatchChild: vi.fn(),
  killChild: vi.fn(),
}));
vi.mock("../../core/probedCatalogStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../core/probedCatalogStore")>()),
  publishProbedCatalog: mock.setModels,
}));
vi.mock("../../../../platform/tauri/fs", () => ({ homeDir: async () => "C:\Users\me" }));

const { discoverAntigravityModels, refreshAntigravityCatalog } =
  await import("./antigravityCatalog");

describe("antigravity catalog on the stream-json transport", () => {
  beforeEach(() => {
    mock.exec.mockReset();
    mock.setModels.mockReset();
  });

  it("lists models with `agy models` instead of opening an ACP session", async () => {
    mock.exec.mockResolvedValue(
      "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n",
    );
    await refreshAntigravityCatalog();
    expect(mock.exec).toHaveBeenCalledWith(
      "C:\agy\bin\agy.exe",
      ["models"],
      undefined,
      "antigravity",
      undefined,
      "management",
    );
    expect(mock.setModels).toHaveBeenCalledWith(
      "antigravity",
      [
        {
          id: "antigravity:gemini-3.8-flash-high",
          harness: "antigravity",
          name: "Gemini 3.8 Flash (High)",
          nativeId: "gemini-3.8-flash-high",
        },
      ],
      true,
    );
  });

  it("keeps the previous catalog and reports the refresh as failed when agy is signed out", async () => {
    mock.exec.mockResolvedValue("Please sign in to view available models.\n");
    expect(await discoverAntigravityModels()).toEqual([]);
    await expect(refreshAntigravityCatalog()).rejects.toThrow("antigravity reported no models.");
    expect(mock.setModels).not.toHaveBeenCalled();
  });

  it("publishes every Gemini 4 family and listed effort without inventing account entitlements", async () => {
    const rows = [
      ...["carbon", "argon", "neon", "hydrogen"].flatMap((family) =>
        ["low", "medium", "high", ...(["neon", "hydrogen"].includes(family) ? ["xhigh"] : [])].map(
          (effort) => [`gemini-4-${family}-${effort}`, `Gemini 4 ${family} (${effort})`],
        ),
      ),
      ["orchestrator-neon", "Orchestrator (Neon)"],
      ["orchestrator-carbon", "Orchestrator (Carbon)"],
      ["orchestrator-argon", "Orchestrator (Argon)"],
    ];
    mock.exec.mockResolvedValue(rows.map((row) => row.join("\t")).join("\n"));
    await refreshAntigravityCatalog();
    expect(mock.setModels).toHaveBeenLastCalledWith(
      "antigravity",
      rows.map(([nativeId, name]) => ({
        id: `antigravity:${nativeId}`,
        harness: "antigravity",
        nativeId,
        name,
      })),
      true,
    );

    mock.exec.mockResolvedValue("gemini-4-neon-xhigh\tGemini 4 Neon (Extra)\n");
    await refreshAntigravityCatalog();
    expect(mock.setModels).toHaveBeenLastCalledWith(
      "antigravity",
      [
        {
          id: "antigravity:gemini-4-neon-xhigh",
          harness: "antigravity",
          nativeId: "gemini-4-neon-xhigh",
          name: "Gemini 4 Neon (Extra)",
        },
      ],
      true,
    );
  });

  it("rejects instead of swallowing a failed probe", async () => {
    mock.exec.mockRejectedValue(new Error("agy crashed"));
    await expect(refreshAntigravityCatalog()).rejects.toThrow("agy crashed");
    expect(mock.setModels).not.toHaveBeenCalled();
  });
});
