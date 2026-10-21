// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
import {
  effectiveProfileId,
  loadTerminalProfile,
  saveTerminalProfile,
  useTerminalProfiles,
  type ShellProfiles,
} from "./terminalProfiles";

const listed: ShellProfiles = {
  profiles: [
    { id: "powershell", name: "Windows PowerShell", path: "powershell.exe", kind: "powershell" },
    { id: "git-bash", name: "Git Bash", path: "bash.exe", kind: "bash" },
  ],
  defaultId: "powershell",
};

afterEach(() => localStorage.clear());

describe("terminal profile choice", () => {
  it("exposes shell discovery failure and recovers in the mounted hook", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("Shell scan unavailable"))
      .mockResolvedValueOnce(listed);
    let state: ReturnType<typeof useTerminalProfiles> = null;
    function Consumer() {
      state = useTerminalProfiles();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(Consumer)));
      expect(state!.error).toBe("Shell scan unavailable");
      await act(async () => state!.retry());
      expect(state!.error).toBeUndefined();
      expect(state!.profiles).toEqual(listed.profiles);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
  it("is remembered and announced when it changes", async () => {
    const changed = vi.fn();
    window.addEventListener("bycoda:terminal-profile", changed);
    expect(loadTerminalProfile()).toBeUndefined();
    await saveTerminalProfile("git-bash");
    expect(loadTerminalProfile()).toBe("git-bash");
    await saveTerminalProfile(undefined);
    expect(loadTerminalProfile()).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener("bycoda:terminal-profile", changed);
  });
  it("retains the previous desktop choice when the shared host profile write fails", async () => {
    await saveTerminalProfile("git-bash");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("profile disk is read-only"));
    await expect(saveTerminalProfile("powershell")).rejects.toThrow("read-only");
    expect(loadTerminalProfile()).toBe("git-bash");
    await saveTerminalProfile("powershell");
    expect(loadTerminalProfile()).toBe("powershell");
  });

  it("follows the user's pick while that shell is installed, else the system default", () => {
    expect(effectiveProfileId(listed, "git-bash")).toBe("git-bash");
    expect(effectiveProfileId(listed, undefined)).toBe("powershell");
    expect(effectiveProfileId(listed, "uninstalled")).toBe("powershell");
    // Before the list arrives, the pick is passed through for the backend to resolve.
    expect(effectiveProfileId(null, "git-bash")).toBe("git-bash");
  });
});
