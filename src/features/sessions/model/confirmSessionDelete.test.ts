import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmSessionDelete } from "./confirmSessionDelete";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.ask.mockReset();
});

describe("session deletion confirmation", () => {
  it("awaits the native dialog in the desktop app without using WebView confirm", async () => {
    mocks.isTauri.mockReturnValue(true);
    const confirm = vi.fn(() => {
      throw new Error("WebView confirm must not run");
    });
    vi.stubGlobal("window", { confirm });
    let resolve!: (answer: boolean) => void;
    mocks.ask.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    let finished = false;
    const pending = confirmSessionDelete("Delete 9 conversations?").then((answer) => {
      finished = true;
      return answer;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(mocks.ask).toHaveBeenCalledWith(
      "Delete 9 conversations?",
      expect.objectContaining({ okLabel: "Delete", cancelLabel: "Cancel" }),
    );
    resolve(false);
    expect(await pending).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("uses browser confirmation in the web preview", async () => {
    mocks.isTauri.mockReturnValue(false);
    vi.stubGlobal("window", { confirm: vi.fn(() => true) });
    expect(await confirmSessionDelete("Delete? ")).toBe(true);
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
