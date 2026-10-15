import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newTab } from "../../features/workspace/model/layout";
import { collectWindowTransfer } from "./windowTransfer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(invoke).mockReset();
});

describe("window transfer bootstrap", () => {
  it("takes a valid payload once across repeated boot requests", async () => {
    const tab = newTab("conversation");
    const payload = collectWindowTransfer(
      [tab],
      [
        {
          id: "conversation",
          cwd: "/p",
          harness: "cursor",
          title: "",
          blocks: [],
          busy: false,
          model: "",
          modelSettings: {},
          runtimeMode: "default",
        },
      ],
      [tab.id],
      tab.id,
      new Set(),
      "/p",
    )!;
    vi.mocked(invoke).mockResolvedValue(JSON.stringify(payload));
    const { loadWindowTransfer } = await import("./windowTransferBootstrap");
    const [first, second] = await Promise.all([loadWindowTransfer(), loadWindowTransfer()]);
    expect(first).toEqual(payload);
    expect(second).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed content so a seeded window cannot acknowledge an unrelated workspace", async () => {
    vi.mocked(invoke).mockResolvedValue('{"tabs":[],"sessions":[]}');
    const { loadWindowTransfer } = await import("./windowTransferBootstrap");
    await expect(loadWindowTransfer()).rejects.toThrow("Invalid window transfer payload");
  });

  it("allows ordinary browser startup without a native transfer transport", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("No Tauri transport"));
    const { loadWindowTransfer } = await import("./windowTransferBootstrap");
    await expect(loadWindowTransfer()).resolves.toBeNull();
  });
});
