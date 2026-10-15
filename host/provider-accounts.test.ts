import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { providerAccountEnvironment } from "./provider-accounts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-accounts-"));
  dirs.push(dir);
  return dir;
}

describe("providerAccountEnvironment", () => {
  it("leaves the default account to the inherited environment", async () => {
    expect(await providerAccountEnvironment(undefined, {}, [])).toBeNull();
    expect(await providerAccountEnvironment({ provider: "claude", id: "default" }, {}, [])).toBeNull();
  });

  it("runs Claude in the desktop profile and links shared agents", async () => {
    const root = temp();
    const shared = temp();
    mkdirSync(join(shared, "agents"));
    const dir = join(root, "provider-accounts", "claude", "account-1");
    mkdirSync(dir, { recursive: true });
    const env = await providerAccountEnvironment(
      { provider: "claude", id: "account-1" },
      { CLAUDE_CONFIG_DIR: shared },
      [temp(), root],
    );
    expect(env).toEqual({
      set: { CLAUDE_CONFIG_DIR: dir, CLAUDE_SECURESTORAGE_CONFIG_DIR: dir },
      remove: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
    });
    expect(lstatSync(join(dir, "agents")).isSymbolicLink()).toBe(true);
  });

  it("resolves linked terminal profiles from the desktop registry", async () => {
    const root = temp();
    const home = temp();
    writeFileSync(
      join(root, "terminal-profiles.json"),
      JSON.stringify({ "codex:terminal-abc": home }),
    );
    expect(
      await providerAccountEnvironment({ provider: "codex", id: "terminal-abc" }, {}, [root]),
    ).toEqual({
      set: { CODEX_HOME: home },
      remove: ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"],
    });
  });

  it("refuses to fall back to another account", async () => {
    await expect(
      providerAccountEnvironment({ provider: "claude", id: "account-missing" }, {}, [temp()]),
    ).rejects.toThrow("account is not available on the host computer");
    await expect(
      providerAccountEnvironment({ provider: "claude", id: "../escape" }, {}, []),
    ).rejects.toThrow("Invalid provider account id");
  });
});
