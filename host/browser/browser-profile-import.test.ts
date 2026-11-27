import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  firefoxRowsToCookies,
  importBrowserState,
  limitImportedState,
  MAX_IMPORT_COOKIES,
  MAX_IMPORT_ORIGINS,
  type PlaywrightLauncher,
} from "./browser-profile-import";
import type { BrowserSource } from "./browser-profile-sources";

const NOW = 1_800_000_000;
const cookie = (over: Record<string, unknown> = {}) => ({
  name: "n",
  value: "v",
  domain: ".example.com",
  path: "/",
  expires: NOW + 1000,
  httpOnly: false,
  secure: false,
  sameSite: "Lax",
  ...over,
});

it("drops expired, duplicate and malformed cookies and maps sameSite", () => {
  const state = limitImportedState(
    {
      cookies: [
        cookie({ name: "keep", sameSite: "Strict" }),
        cookie({ name: "old", expires: NOW - 1 }),
        cookie({ name: "keep" }),
        cookie({ name: "session", expires: -1, sameSite: "unspecified" }),
        cookie({ name: "bad-path", path: "x" }),
        cookie({ name: "no-domain", domain: "" }),
        cookie({ name: "bad", value: 5 }),
      ],
    },
    NOW,
  );
  expect(state.cookies.map(({ name, sameSite }) => [name, sameSite])).toEqual([
    ["session", "None"],
    ["keep", "Strict"],
  ]);
});

it("keeps signed-in cookies first within the cookie limit", () => {
  const cookies = Array.from({ length: MAX_IMPORT_COOKIES + 20 }, (_, index) =>
    cookie({
      name: `c${index}`,
      expires: NOW + 10_000 - index,
      secure: index >= MAX_IMPORT_COOKIES,
    }),
  );
  const state = limitImportedState({ cookies }, NOW);
  expect(state.cookies).toHaveLength(MAX_IMPORT_COOKIES);
  expect(state.cookies.slice(0, 20).every(({ secure }) => secure)).toBe(true);
});

it("limits origins and rejects non-origin entries", () => {
  const origins = [
    { origin: "https://a.example/path", localStorage: [{ name: "k", value: "v" }] },
    { origin: "file:///x", localStorage: [{ name: "k", value: "v" }] },
    { origin: "https://empty.example", localStorage: [] },
    ...Array.from({ length: MAX_IMPORT_ORIGINS + 5 }, (_, index) => ({
      origin: `https://site${index}.example`,
      localStorage: [{ name: "k", value: "v" }],
    })),
  ];
  const state = limitImportedState({ cookies: [], origins }, NOW);
  expect(state.origins).toHaveLength(MAX_IMPORT_ORIGINS);
  expect(state.origins.every(({ origin }) => origin.startsWith("https://site"))).toBe(true);
});

it("maps Firefox rows", () => {
  const [row] = firefoxRowsToCookies([
    {
      name: "a",
      value: "b",
      host: ".x.test",
      path: "/",
      expiry: NOW * 1000,
      isSecure: 1,
      isHttpOnly: 0,
      sameSite: 2,
    },
  ]);
  expect(row).toMatchObject({ expires: NOW, secure: true, httpOnly: false, sameSite: "Strict" });
});

const source = (over: Partial<BrowserSource>): BrowserSource => ({
  id: "x:y",
  browser: "firefox",
  browserName: "Mozilla Firefox",
  profileName: "default",
  isDefault: false,
  family: "firefox",
  userDataDir: "",
  profileDir: "",
  ...over,
});
const profileRoot = () => mkdtemp(join(tmpdir(), "bycoda-import-test-"));
const noBrowser: PlaywrightLauncher = async () => {
  throw new Error("Firefox must not launch a browser");
};

it("reads Firefox cookies from a copy and skips container cookies", async () => {
  const root = await profileRoot();
  try {
    const db = new DatabaseSync(join(root, "cookies.sqlite"));
    db.exec(`CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
      lastAccessed INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)`);
    const insert = db.prepare("INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?,?,?)");
    insert.run("sid", "secret", ".example.com", "/", NOW + 100, 5, 1, 1, 1, "");
    insert.run("part", "x", ".example.com", "/", NOW + 100, 4, 0, 0, 0, "^partitionKey=%28x%29");
    db.close();
    const state = await importBrowserState(source({ userDataDir: root }), noBrowser, NOW);
    expect(state.cookies.map(({ name, secure, sameSite }) => [name, secure, sameSite])).toEqual([
      ["sid", true, "Lax"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function chromiumProfile(encryptedPrefix: string) {
  const root = await profileRoot();
  await writeFile(join(root, "Local State"), "{}");
  await mkdir(join(root, "Default", "Network"), { recursive: true });
  const db = new DatabaseSync(join(root, "Default", "Network", "Cookies"));
  db.exec("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)");
  db.prepare("INSERT INTO cookies VALUES (?, ?)").run("a", Buffer.from(`${encryptedPrefix}xxxx`));
  db.close();
  return root;
}
const chromiumSource = (root: string) =>
  source({
    browser: "chrome",
    browserName: "Google Chrome",
    family: "chromium",
    executable: "chrome.exe",
    userDataDir: root,
    profileDir: "Default",
  });
const launcher = (storageState: () => Promise<{ cookies: Record<string, unknown>[] }>) =>
  vi.fn<PlaywrightLauncher>(async () => ({
    chromium: {
      launchPersistentContext: vi.fn(async () => ({ storageState, close: async () => {} })),
    },
  }));

it("launches the browser on a temporary copy and removes the copy", async () => {
  const root = await chromiumProfile("v10");
  try {
    const load = launcher(async () => ({ cookies: [cookie()] }));
    const state = await importBrowserState(chromiumSource(root), load, NOW);
    expect(state.cookies).toHaveLength(1);
    const { chromium } = await load.mock.results[0]!.value;
    const [directory, options] = chromium.launchPersistentContext.mock.calls[0]!;
    expect(directory).not.toBe(root);
    expect(options).toMatchObject({
      executablePath: "chrome.exe",
      args: ["--profile-directory=Default"],
      // The real profile's cookies need the OS key store, not Playwright's mock keychain.
      ignoreDefaultArgs: ["--use-mock-keychain", "--password-store=basic"],
    });
    expect(
      (await readdir(tmpdir())).filter((name) => name === directory.split(/[\\/]/).pop()),
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("explains app-bound cookies that decrypt to nothing", async () => {
  const root = await chromiumProfile("v20");
  try {
    await expect(
      importBrowserState(
        chromiumSource(root),
        launcher(async () => ({ cookies: [] })),
        NOW,
      ),
    ).rejects.toThrow("app-bound");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
