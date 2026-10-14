import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  choicePath,
  chosenProfileId,
  detectShellProfiles,
  listShellProfiles,
  resolveShellProfile,
  setChosenProfile,
} from "./shellProfiles";
import { runHostShell } from "./shell";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-profiles-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("host shell profiles", () => {
  it("reads the terminal choice the desktop app saves beside the host data", () => {
    expect(choicePath(join("home", "me"))).toBe(
      join("home", "me", ".bycoda-host", "terminal-profile.json"),
    );
  });

  it("lists only shells, never terminal multiplexers from /etc/shells", () => {
    for (const profile of detectShellProfiles())
      expect(profile.path).not.toMatch(/\/(screen|tmux)$/);
  });

  it("lists this machine's shells with a default", () => {
    const listed = listShellProfiles(join(scratch(), "choice.json"));
    expect(listed.profiles.length).toBeGreaterThan(0);
    expect(listed.profiles.some((profile) => profile.id === listed.defaultId)).toBe(true);
    expect(listed.chosenId).toBeNull();
  });

  it("uses the shell chosen for the machine, and the default once that is cleared or gone", () => {
    const path = join(scratch(), "nested", "choice.json");
    const profiles = detectShellProfiles();
    const other = profiles.at(-1)!;
    setChosenProfile(other.id, path);
    expect(chosenProfileId(path)).toBe(other.id);
    expect(resolveShellProfile(path)?.id).toBe(other.id);

    setChosenProfile(null, path);
    expect(chosenProfileId(path)).toBeNull();
    const fallback = listShellProfiles(path).defaultId;
    expect(resolveShellProfile(path)?.id).toBe(fallback);

    writeFileSync(path, JSON.stringify({ profile: "uninstalled-shell" }));
    expect(resolveShellProfile(path)?.id).toBe(fallback);
  });

  it("refuses a shell this machine does not have", () => {
    expect(() => setChosenProfile("uninstalled-shell", join(scratch(), "choice.json"))).toThrow(
      "not installed",
    );
  });

  it("runs a command in every listed shell", async () => {
    for (const profile of detectShellProfiles()) {
      // WSL may be installed with no distribution.
      if (profile.kind === "wsl") continue;
      const result = await runHostShell(scratch(), "echo bycoda-host", 30_000, profile);
      expect(result.output, profile.name).toContain("bycoda-host");
      expect(result.exitCode, profile.name).toBe(0);
    }
  }, 60_000);

  it("runs bash commands in Git Bash from the session's folder", async () => {
    const bash = detectShellProfiles().find((profile) => profile.id === "git-bash");
    if (!bash) return;
    const dir = scratch();
    writeFileSync(join(dir, "marker.txt"), "x");
    const result = await runHostShell(dir, "ls | grep marker && echo $((2 + 3))", 30_000, bash);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("marker.txt");
    expect(result.output).toContain("5");
  }, 30_000);
});
