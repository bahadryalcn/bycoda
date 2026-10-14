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
vi.mock("../../../../features/sessions/model/models", () => ({
  setHarnessModels: mock.setModels,
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
    );
    expect(mock.setModels).toHaveBeenCalledWith("antigravity", [
      {
        id: "antigravity:gemini-3.8-flash-high",
        harness: "antigravity",
        name: "Gemini 3.8 Flash (High)",
        nativeId: "gemini-3.8-flash-high",
      },
    ]);
  });

  it("keeps the previous catalog when agy is signed out", async () => {
    mock.exec.mockResolvedValue("Please sign in to view available models.\n");
    expect(await discoverAntigravityModels()).toEqual([]);
    await refreshAntigravityCatalog();
    expect(mock.setModels).not.toHaveBeenCalled();
  });
});
