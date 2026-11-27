import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrowserSource } from "./browser-profile-sources";

export const MAX_IMPORT_COOKIES = 500;
/** Playwright defaults that replace the OS key store a real profile's cookies are encrypted with. */
export const KEYCHAIN_OVERRIDES = ["--use-mock-keychain", "--password-store=basic"];
export const MAX_IMPORT_ORIGINS = 100;
const MAX_IMPORT_LOCAL_STORAGE = 500;

export type ImportedCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds, or -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  partitionKey?: string;
};
export type ImportedState = {
  cookies: ImportedCookie[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
};
type RawCookie = Record<
  | "name"
  | "value"
  | "domain"
  | "path"
  | "expires"
  | "httpOnly"
  | "secure"
  | "sameSite"
  | "partitionKey",
  unknown
>;
type RawState = {
  cookies: Partial<RawCookie>[];
  origins?: { origin?: unknown; localStorage?: { name?: unknown; value?: unknown }[] }[];
};
type PersistentContext = { storageState(): Promise<RawState>; close(): Promise<void> };
export type PlaywrightLauncher = () => Promise<{
  chromium: {
    launchPersistentContext(
      userDataDir: string,
      options: {
        executablePath?: string;
        headless: boolean;
        timeout: number;
        args: string[];
        ignoreDefaultArgs: string[];
      },
    ): Promise<PersistentContext>;
  };
}>;

/** Raised for failures the owner can fix; its message is safe to show. */
export class BrowserImportError extends Error {}

function sameSite(value: unknown): ImportedCookie["sameSite"] {
  return value === "Strict" || value === "Lax" ? value : "None";
}

/**
 * Maps browser cookies and local storage into the stored profile shape within its limits:
 * drops expired and malformed entries and keeps secure/HTTP-only (sign-in) cookies first, then
 * the longest-lived ones.
 * shortcut: no per-cookie recency is available from Playwright; upgrade if a recency signal is exposed.
 */
export function limitImportedState(raw: RawState, nowSeconds: number): ImportedState {
  const seen = new Set<string>();
  const cookies: ImportedCookie[] = [];
  for (const cookie of raw.cookies) {
    const { name, value, domain, path } = cookie;
    if (
      typeof name !== "string" ||
      typeof value !== "string" ||
      typeof domain !== "string" ||
      !domain ||
      typeof path !== "string" ||
      !path.startsWith("/")
    )
      continue;
    const expires =
      typeof cookie.expires === "number" && Number.isFinite(cookie.expires) ? cookie.expires : -1;
    if (expires !== -1 && expires <= nowSeconds) continue;
    const key = `${domain}\0${path}\0${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cookies.push({
      name,
      value,
      domain,
      path,
      expires,
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
      sameSite: sameSite(cookie.sameSite),
      ...(typeof cookie.partitionKey === "string" ? { partitionKey: cookie.partitionKey } : {}),
    });
  }
  const rank = (cookie: ImportedCookie) => Number(cookie.secure || cookie.httpOnly);
  cookies.sort(
    (left, right) =>
      rank(right) - rank(left) ||
      (right.expires === -1 ? Infinity : right.expires) -
        (left.expires === -1 ? Infinity : left.expires),
  );
  const origins: ImportedState["origins"] = [];
  for (const entry of raw.origins ?? []) {
    const url = typeof entry.origin === "string" ? URL.parse(entry.origin) : null;
    if (!url || !["http:", "https:"].includes(url.protocol) || entry.origin !== url.origin)
      continue;
    const localStorage = (entry.localStorage ?? [])
      .flatMap(({ name, value }) =>
        typeof name === "string" && typeof value === "string" ? [{ name, value }] : [],
      )
      .slice(0, MAX_IMPORT_LOCAL_STORAGE);
    if (localStorage.length) origins.push({ origin: url.origin, localStorage });
    if (origins.length >= MAX_IMPORT_ORIGINS) break;
  }
  return { cookies: cookies.slice(0, MAX_IMPORT_COOKIES), origins };
}

/** Firefox `moz_cookies.sameSite`: 0 none, 1 lax, 2 strict. */
const FIREFOX_SAME_SITE = ["None", "Lax", "Strict"] as const;

export function firefoxRowsToCookies(rows: Record<string, unknown>[]): RawState["cookies"] {
  return rows.map((row) => {
    const expiry = Number(row.expiry);
    return {
      name: row.name,
      value: row.value,
      domain: row.host,
      path: row.path,
      // Older profiles stored milliseconds.
      expires: expiry > 1e11 ? Math.floor(expiry / 1000) : expiry,
      httpOnly: Number(row.isHttpOnly) === 1,
      secure: Number(row.isSecure) === 1,
      sameSite: FIREFOX_SAME_SITE[Number(row.sameSite)] ?? "None",
    };
  });
}

/** A file another process holds open reads as busy; a missing one is skipped. */
async function copyIfPresent(from: string, to: string, browserName: string) {
  try {
    await copyFile(from, to);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES")
      throw new BrowserImportError(
        `${browserName} is using its profile. Close ${browserName} completely, then try again.`,
      );
    throw error;
  }
}

/** Cookies written with Chrome's app-bound `v20` encryption, counted on the temporary copy. */
function appBoundCookieCount(profile: string) {
  for (const file of ["Network/Cookies", "Cookies"]) {
    const path = join(profile, file);
    if (!existsSync(path)) continue;
    try {
      const sqlite = new DatabaseSync(path, { readOnly: true });
      try {
        const row = sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM cookies WHERE substr(encrypted_value, 1, 3) = x'763230'",
          )
          .get() as { count: number } | undefined;
        return Number(row?.count ?? 0);
      } finally {
        sqlite.close();
      }
    } catch {
      return 0;
    }
  }
  return 0;
}

async function importChromium(source: BrowserSource, load: PlaywrightLauncher) {
  if (!source.executable) throw new BrowserImportError(`${source.browserName} was not found.`);
  const temp = await mkdtemp(join(tmpdir(), "bycoda-browser-import-"));
  try {
    // Only the key store, preferences and cookie database: the browser decrypts cookies itself,
    // which covers DPAPI and app-bound encryption that other processes cannot read.
    if (
      !(await copyIfPresent(
        join(source.userDataDir, "Local State"),
        join(temp, "Local State"),
        source.browserName,
      ))
    )
      throw new BrowserImportError(`${source.browserName} profile data could not be found.`);
    const profile = join(temp, source.profileDir);
    await mkdir(join(profile, "Network"), { recursive: true });
    let cookies = false;
    for (const file of [
      "Preferences",
      "Network/Cookies",
      "Network/Cookies-journal",
      "Cookies",
      "Cookies-journal",
    ]) {
      const copied = await copyIfPresent(
        join(source.userDataDir, source.profileDir, file),
        join(profile, file),
        source.browserName,
      );
      if (copied && file.endsWith("Cookies")) cookies = true;
    }
    if (!cookies) return { cookies: [], origins: [] };
    const appBound = appBoundCookieCount(profile);
    const { chromium } = await load();
    const context = await chromium.launchPersistentContext(temp, {
      executablePath: source.executable,
      headless: true,
      timeout: 30_000,
      args: source.profileDir ? [`--profile-directory=${source.profileDir}`] : [],
      // The cookie key lives in the macOS Keychain or the Linux secret service; Playwright's mock
      // keychain and basic password store would hide it and the browser would drop every cookie.
      ignoreDefaultArgs: KEYCHAIN_OVERRIDES,
    });
    try {
      const state = await context.storageState();
      // Chrome 127+ binds cookie keys to the installed app and profile location; a relocated copy
      // cannot decrypt them and the browser silently drops every such cookie.
      if (appBound > 0 && state.cookies.length === 0)
        throw new BrowserImportError(
          `${source.browserName} protects this profile's cookies with app-bound encryption, which cannot be imported automatically.`,
        );
      return state;
    } finally {
      await Promise.race([
        context.close(),
        new Promise((resolve) => setTimeout(resolve, 10_000).unref()),
      ]).catch(() => undefined);
    }
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(
      () => undefined,
    );
  }
}

async function importFirefox(source: BrowserSource): Promise<RawState> {
  const temp = await mkdtemp(join(tmpdir(), "bycoda-browser-import-"));
  try {
    const database = join(temp, "cookies.sqlite");
    if (
      !(await copyIfPresent(
        join(source.userDataDir, "cookies.sqlite"),
        database,
        source.browserName,
      ))
    )
      return { cookies: [] };
    for (const suffix of ["-wal", "-shm"])
      await copyIfPresent(
        join(source.userDataDir, `cookies.sqlite${suffix}`),
        `${database}${suffix}`,
        source.browserName,
      );
    const sqlite = new DatabaseSync(database);
    try {
      // Containers and partitioned cookies carry origin attributes and do not apply to a plain context.
      const rows = sqlite
        .prepare(
          `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies
           WHERE originAttributes = '' ORDER BY lastAccessed DESC LIMIT 5000`,
        )
        .all() as Record<string, unknown>[];
      return { cookies: firefoxRowsToCookies(rows) };
    } finally {
      sqlite.close();
    }
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(
      () => undefined,
    );
  }
}

/** Reads a detected browser profile's sign-in state in the stored profile shape. */
export async function importBrowserState(
  source: BrowserSource,
  load: PlaywrightLauncher,
  nowSeconds = Date.now() / 1000,
) {
  const raw =
    source.family === "firefox" ? await importFirefox(source) : await importChromium(source, load);
  return limitImportedState(raw, nowSeconds);
}
