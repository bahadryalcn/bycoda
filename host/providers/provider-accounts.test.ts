import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  providerAccountEnvironment,
  hostProviderAccounts,
  assertHostProviderAccount,
} from "./provider-accounts";

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
    expect(
      await providerAccountEnvironment({ provider: "claude", id: "default" }, {}, []),
    ).toBeNull();
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

it("exposes only safe metadata for real Host profiles and validates the exact launch resolution without writes", async () => {
  const root = temp(),
    terminal = temp();
  const codex = join(root, "provider-accounts", "codex", "account-work");
  mkdirSync(codex, { recursive: true });
  mkdirSync(join(root, "provider-accounts", "claude", "account-other"), { recursive: true });
  mkdirSync(join(root, "provider-accounts", "codex", "email@example.test"), { recursive: true });
  writeFileSync(
    join(codex, "auth.json"),
    '{"email":"private@example.test","token":"DO_NOT_READ_OR_EXPOSE"}',
  );
  writeFileSync(
    join(root, "terminal-profiles.json"),
    JSON.stringify({
      "codex:terminal-work": terminal,
      "claude:terminal-missing": join(root, "missing"),
      "codex:../escape": terminal,
    }),
  );
  const catalog = await hostProviderAccounts([root]);
  expect(catalog).toEqual({
    codex: [
      { id: "default", label: "Host default" },
      { id: "account-work", label: "Codex account 1" },
      { id: "terminal-work", label: "Codex account 2" },
    ],
    claude: [
      { id: "default", label: "Host default" },
      { id: "account-other", label: "Claude account 1" },
    ],
  });
  const serialized = JSON.stringify(catalog);
  for (const secret of [
    "private@example.test",
    "DO_NOT_READ_OR_EXPOSE",
    root.replaceAll("\\", "\\\\"),
    terminal.replaceAll("\\", "\\\\"),
  ])
    expect(serialized).not.toContain(secret);
  expect(await assertHostProviderAccount("codex", "account-work", [root])).toBe("account-work");
  expect(await assertHostProviderAccount("codex", "terminal-work", [root])).toBe("terminal-work");
  expect(await assertHostProviderAccount("codex", "default", [])).toBeUndefined();
  await expect(assertHostProviderAccount("claude", "account-work", [root])).rejects.toThrow(
    "not available",
  );
  await expect(assertHostProviderAccount("pi", "account-work", [root])).rejects.toThrow(
    "Invalid provider account",
  );
  expect(() => lstatSync(join(codex, "agents"))).toThrow();
});

it("bounds named Host account inventory and ignores malformed terminal metadata", async () => {
  const root = temp();
  for (let index = 0; index < 130; index++)
    mkdirSync(
      join(root, "provider-accounts", "codex", `account-${String(index).padStart(3, "0")}`),
      { recursive: true },
    );
  writeFileSync(join(root, "terminal-profiles.json"), "malformed metadata");
  const catalog = await hostProviderAccounts([root]);
  expect(catalog.codex).toHaveLength(129);
  expect(catalog.claude).toEqual([{ id: "default", label: "Host default" }]);
  expect(await assertHostProviderAccount("codex", "account-129", [root])).toBe("account-129");
});
