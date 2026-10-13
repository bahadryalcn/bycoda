// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  effectiveProfileId,
  loadTerminalProfile,
  saveTerminalProfile,
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
  it("is remembered and announced when it changes", () => {
    const changed = vi.fn();
    window.addEventListener("bycoda:terminal-profile", changed);
    expect(loadTerminalProfile()).toBeUndefined();
    saveTerminalProfile("git-bash");
    expect(loadTerminalProfile()).toBe("git-bash");
    saveTerminalProfile(undefined);
    expect(loadTerminalProfile()).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener("bycoda:terminal-profile", changed);
  });

  it("follows the user's pick while that shell is installed, else the system default", () => {
    expect(effectiveProfileId(listed, "git-bash")).toBe("git-bash");
    expect(effectiveProfileId(listed, undefined)).toBe("powershell");
    expect(effectiveProfileId(listed, "uninstalled")).toBe("powershell");
    // Before the list arrives, the pick is passed through for the backend to resolve.
    expect(effectiveProfileId(null, "git-bash")).toBe("git-bash");
  });
});
