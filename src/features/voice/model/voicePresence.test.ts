// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { classifyVoicePresence, readNativeVoicePresence } from "./voicePresence";
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.resetAllMocks();
});
it("requires fresh supported native presence for an explicit Away/DND capture override", async () => {
  expect(await readNativeVoicePresence(10)).toBe("unknown");
  expect(invoke).not.toHaveBeenCalled();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  invoke
    .mockResolvedValueOnce({ idleMs: 0, locked: false, supported: false })
    .mockResolvedValueOnce({ idleMs: 0, locked: true, supported: true })
    .mockResolvedValueOnce({ idleMs: 0, locked: false, supported: true })
    .mockRejectedValueOnce(new Error("native unavailable"));
  expect(await readNativeVoicePresence(10)).toBe("unknown");
  expect(await readNativeVoicePresence(10)).toBe("away");
  expect(await readNativeVoicePresence(10)).toBe("active");
  expect(await readNativeVoicePresence(10)).toBe("unknown");
  expect(invoke.mock.calls.every(([method]) => method === "get_user_presence")).toBe(true);
});

describe("computer presence admission", () => {
  it("does not infer activity from unsupported or failed measurements", () => {
    expect(classifyVoicePresence({ idleMs: 0, locked: false, supported: false }, 10)).toBe(
      "unknown",
    );
    expect(classifyVoicePresence({ idleMs: NaN, locked: false, supported: true }, 10)).toBe(
      "unknown",
    );
    expect(classifyVoicePresence({ idleMs: -1, locked: false, supported: true }, 10)).toBe(
      "unknown",
    );
  });
  it("sleeps at the configured threshold and keeps lock authoritative when idle sleep is disabled", () => {
    expect(classifyVoicePresence({ idleMs: 599_999, locked: false, supported: true }, 10)).toBe(
      "active",
    );
    expect(classifyVoicePresence({ idleMs: 600_000, locked: false, supported: true }, 10)).toBe(
      "idle",
    );
    expect(classifyVoicePresence({ idleMs: 600_000, locked: false, supported: true }, 0)).toBe(
      "active",
    );
    expect(classifyVoicePresence({ idleMs: 0, locked: true, supported: true }, 0)).toBe("away");
  });
});
