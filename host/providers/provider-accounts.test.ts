import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  providerAccountEnvironment,
  hostProviderAccounts,
  assertHostProviderAccount,
} from "./provider-accounts";
import { ModelsListResultSchema } from "../../src/shared/model/host-contracts/models";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-accounts-"));
  dirs.push(dir);
  return dir;
}
/** Creates a profile directory with the sign-in file that marks it as signed in. */
function signedIn(dir: string, file = "auth.json") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), "{}");
  return dir;
}

const stripColors = (catalog: Awaited<ReturnType<typeof hostProviderAccounts>>) =>
  Object.fromEntries(
    Object.entries(catalog).map(([provider, accounts]) => [
      provider,
      accounts.map(({ color: _color, ...account }) => account),
    ]),
  );

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

  it("runs Grok Build in the desktop profile through GROK_HOME", async () => {
    const root = temp();
    const dir = join(root, "provider-accounts", "grok", "account-1");
    mkdirSync(dir, { recursive: true });
    expect(
      await providerAccountEnvironment({ provider: "grok", id: "account-1" }, {}, [root]),
    ).toEqual({
      set: { GROK_HOME: dir },
      remove: ["XAI_API_KEY", "GROK_DEPLOYMENT_KEY"],
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
  signedIn(join(root, "provider-accounts", "claude", "account-other"), ".credentials.json");
  signedIn(join(root, "provider-accounts", "codex", "email@example.test"));
  writeFileSync(
    join(codex, "auth.json"),
    '{"email":"private@example.test","token":"DO_NOT_READ_OR_EXPOSE"}',
  );
  signedIn(terminal);
  writeFileSync(
    join(root, "terminal-profiles.json"),
    JSON.stringify({
      "codex:terminal-work": terminal,
      "claude:terminal-missing": join(root, "missing"),
      "codex:../escape": terminal,
    }),
  );
  const catalog = await hostProviderAccounts([root]);
  expect(stripColors(catalog)).toEqual({
    codex: [
      { id: "default", label: "Host default" },
      { id: "account-work", label: "Codex account 1" },
      { id: "terminal-work", label: "Codex account 2" },
    ],
    claude: [
      { id: "default", label: "Host default" },
      { id: "account-other", label: "Claude account 1" },
    ],
    grok: [{ id: "default", label: "Host default" }],
  });
  for (const accounts of Object.values(catalog))
    for (const account of accounts) expect(account.color).toMatch(/^hsl\(/);
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

it("publishes an account catalog every client accepts in models.list", async () => {
  const root = temp();
  for (const provider of ["codex", "claude", "grok"])
    signedIn(
      join(root, "provider-accounts", provider, "account-work"),
      provider === "claude" ? ".credentials.json" : "auth.json",
    );
  const catalog = await hostProviderAccounts([root]);
  // A Host-only provider here once failed every WS models.list with "Host read failed".
  const result = ModelsListResultSchema.safeParse({ models: {}, errors: {}, accounts: catalog });
  expect(result.error?.issues).toBeUndefined();
});

it("bounds named Host account inventory and ignores malformed terminal metadata", async () => {
  const root = temp();
  for (let index = 0; index < 130; index++)
    signedIn(join(root, "provider-accounts", "codex", `account-${String(index).padStart(3, "0")}`));
  writeFileSync(join(root, "terminal-profiles.json"), "malformed metadata");
  const catalog = await hostProviderAccounts([root]);
  expect(catalog.codex).toHaveLength(129);
  expect(catalog.claude).toEqual([
    {
      id: "default",
      label: "Host default",
      color: expect.stringMatching(/^hsl\(/),
    },
  ]);
  expect(await assertHostProviderAccount("codex", "account-129", [root])).toBe("account-129");
});

describe("hostProviderAccounts sign-in evidence", () => {
  it("excludes a leftover Claude folder with projects but no sign-in", async () => {
    const root = temp();
    const dir = join(root, "provider-accounts", "claude", "account-leftover");
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(join(dir, ".claude.json"), JSON.stringify({ numStartups: 3 }));
    expect((await hostProviderAccounts([root])).claude).toEqual([
      expect.objectContaining({ id: "default" }),
    ]);
  });

  it("includes Claude folders with .credentials.json or an oauthAccount email", async () => {
    const root = temp();
    signedIn(join(root, "provider-accounts", "claude", "account-creds"), ".credentials.json");
    const oauth = join(root, "provider-accounts", "claude", "account-oauth");
    mkdirSync(oauth, { recursive: true });
    writeFileSync(
      join(oauth, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "owner@example.test" } }),
    );
    const claude = (await hostProviderAccounts([root])).claude?.map((account) => account.id);
    expect(claude).toEqual(["default", "account-creds", "account-oauth"]);
  });

  it("excludes Claude config without a non-empty oauth email, malformed or oversized", async () => {
    const root = temp();
    const cases = {
      "account-empty": JSON.stringify({ oauthAccount: { emailAddress: "  " } }),
      "account-no-object": JSON.stringify({ oauthAccount: "x" }),
      "account-malformed": "{not json",
      "account-oversized": JSON.stringify({
        oauthAccount: { emailAddress: "owner@example.test" },
        pad: "x".repeat(1024 * 1024),
      }),
    };
    for (const [id, content] of Object.entries(cases)) {
      const dir = join(root, "provider-accounts", "claude", id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".claude.json"), content);
    }
    expect((await hostProviderAccounts([root])).claude).toEqual([
      expect.objectContaining({ id: "default" }),
    ]);
  });

  it("includes Grok folders with auth.json and excludes Grok folders without it", async () => {
    const root = temp();
    signedIn(join(root, "provider-accounts", "grok", "account-signed"));
    mkdirSync(join(root, "provider-accounts", "grok", "account-bare"), { recursive: true });
    expect((await hostProviderAccounts([root])).grok?.map((account) => account.id)).toEqual([
      "default",
      "account-signed",
    ]);
  });

  it("excludes terminal registry paths without sign-in evidence", async () => {
    const root = temp();
    const bare = join(root, "bare-home");
    mkdirSync(bare, { recursive: true });
    writeFileSync(
      join(root, "terminal-profiles.json"),
      JSON.stringify({ "codex:terminal-bare": bare }),
    );
    expect((await hostProviderAccounts([root])).codex?.map((account) => account.id)).toEqual([
      "default",
    ]);
  });
});

describe("provider account styles", () => {
  it("applies the owner's names and palette colours and drops malformed entries", async () => {
    const { applyProviderAccountStyles, parseProviderAccountStyles } =
      await import("./provider-account-styles");
    const styles = parseProviderAccountStyles({
      claude: {
        "account-a": { label: "  Work   Max ", color: "coral" },
        "account-b": { color: "not-a-colour" },
        "bad id": { label: "x" },
      },
      cursor: { a: { label: "x" } },
    });
    expect(styles).toEqual({ claude: { "account-a": { label: "Work Max", color: "coral" } } });
    const merged = applyProviderAccountStyles(
      {
        claude: [
          { id: "default", label: "Host default", color: "#111" },
          { id: "account-a", label: "Claude account 1", color: "#222" },
          { id: "account-b", label: "Claude account 2", color: "#333" },
        ],
      },
      styles,
    );
    expect(merged.claude?.[1]).toMatchObject({ label: "Work Max" });
    expect(merged.claude?.[1].color).not.toBe("#222");
    expect(merged.claude?.[2]).toEqual({
      id: "account-b",
      label: "Claude account 2",
      color: "#333",
    });
  });
});
