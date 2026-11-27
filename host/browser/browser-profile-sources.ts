import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { deviceCommand } from "../devices/device-process";

export type BrowserKey =
  | "chrome"
  | "edge"
  | "brave"
  | "vivaldi"
  | "opera"
  | "opera-gx"
  | "chromium"
  | "firefox";
export type BrowserSource = {
  /** Stable handle the client sends back; never a path. */
  id: string;
  browser: BrowserKey;
  browserName: string;
  profileName: string;
  isDefault: boolean;
  family: "chromium" | "firefox";
  executable?: string;
  /** Chromium user data directory, or the Firefox profile directory. */
  userDataDir: string;
  /** Chromium profile folder inside `userDataDir`; empty when the data directory is the profile. */
  profileDir: string;
};
export type PublicBrowserSource = Pick<
  BrowserSource,
  "id" | "browser" | "browserName" | "profileName" | "isDefault"
>;
export type BrowserSources = {
  defaultBrowser: { browser: BrowserKey; name: string } | null;
  sources: BrowserSource[];
};

/**
 * Where a path starts: a Windows folder variable, the home folder, the XDG config folder, the file
 * system root, or `PATH` (the name is looked up in each `PATH` directory).
 */
type Root =
  | "PROGRAMFILES"
  | "PROGRAMFILES(X86)"
  | "LOCALAPPDATA"
  | "APPDATA"
  | "HOME"
  | "CONFIG"
  | "ROOT"
  | "PATH";
type Place = { executables: [Root, string][]; data: [Root, string][] };
type SupportedPlatform = "win32" | "darwin" | "linux";
type Definition = {
  key: BrowserKey;
  name: string;
  family: "chromium" | "firefox";
  places: Partial<Record<SupportedPlatform, Place>>;
  /** Executable name registered under Windows `App Paths`, for installs outside the usual folders. */
  appPath?: string;
  /** macOS bundle identifiers, lower case, for the default-browser lookup. */
  bundleIds: string[];
};

/** A macOS app in /Applications or ~/Applications with data under ~/Library/Application Support. */
const mac = (binary: string, ...data: string[]): Place => ({
  executables: [
    ["ROOT", `Applications/${binary}`],
    ["HOME", `Applications/${binary}`],
  ],
  data: data.map((path) => ["HOME", `Library/Application Support/${path}`]),
});

const DEFINITIONS: Definition[] = [
  {
    key: "chrome",
    name: "Google Chrome",
    family: "chromium",
    places: {
      win32: {
        executables: [
          ["PROGRAMFILES", "Google/Chrome/Application/chrome.exe"],
          ["PROGRAMFILES(X86)", "Google/Chrome/Application/chrome.exe"],
          ["LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"],
        ],
        data: [["LOCALAPPDATA", "Google/Chrome/User Data"]],
      },
      darwin: mac("Google Chrome.app/Contents/MacOS/Google Chrome", "Google/Chrome"),
      linux: {
        executables: [
          ["ROOT", "opt/google/chrome/chrome"],
          ["PATH", "google-chrome-stable"],
          ["PATH", "google-chrome"],
        ],
        data: [["CONFIG", "google-chrome"]],
      },
    },
    appPath: "chrome.exe",
    bundleIds: ["com.google.chrome"],
  },
  {
    key: "edge",
    name: "Microsoft Edge",
    family: "chromium",
    places: {
      win32: {
        executables: [
          ["PROGRAMFILES(X86)", "Microsoft/Edge/Application/msedge.exe"],
          ["PROGRAMFILES", "Microsoft/Edge/Application/msedge.exe"],
        ],
        data: [["LOCALAPPDATA", "Microsoft/Edge/User Data"]],
      },
      darwin: mac("Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Microsoft Edge"),
      linux: {
        executables: [
          ["ROOT", "opt/microsoft/msedge/msedge"],
          ["PATH", "microsoft-edge-stable"],
          ["PATH", "microsoft-edge"],
        ],
        data: [["CONFIG", "microsoft-edge"]],
      },
    },
    appPath: "msedge.exe",
    bundleIds: ["com.microsoft.edgemac"],
  },
  {
    key: "brave",
    name: "Brave",
    family: "chromium",
    places: {
      win32: {
        executables: [
          ["PROGRAMFILES", "BraveSoftware/Brave-Browser/Application/brave.exe"],
          ["PROGRAMFILES(X86)", "BraveSoftware/Brave-Browser/Application/brave.exe"],
          ["LOCALAPPDATA", "BraveSoftware/Brave-Browser/Application/brave.exe"],
        ],
        data: [["LOCALAPPDATA", "BraveSoftware/Brave-Browser/User Data"]],
      },
      darwin: mac("Brave Browser.app/Contents/MacOS/Brave Browser", "BraveSoftware/Brave-Browser"),
      linux: {
        executables: [
          ["ROOT", "opt/brave.com/brave/brave"],
          ["PATH", "brave-browser"],
          ["PATH", "brave"],
        ],
        data: [
          ["CONFIG", "BraveSoftware/Brave-Browser"],
          ["HOME", "snap/brave/current/.config/BraveSoftware/Brave-Browser"],
        ],
      },
    },
    appPath: "brave.exe",
    bundleIds: ["com.brave.browser"],
  },
  {
    key: "vivaldi",
    name: "Vivaldi",
    family: "chromium",
    places: {
      win32: {
        executables: [
          ["LOCALAPPDATA", "Vivaldi/Application/vivaldi.exe"],
          ["PROGRAMFILES", "Vivaldi/Application/vivaldi.exe"],
        ],
        data: [["LOCALAPPDATA", "Vivaldi/User Data"]],
      },
      darwin: mac("Vivaldi.app/Contents/MacOS/Vivaldi", "Vivaldi"),
      linux: {
        executables: [
          ["ROOT", "opt/vivaldi/vivaldi"],
          ["PATH", "vivaldi-stable"],
          ["PATH", "vivaldi"],
        ],
        data: [["CONFIG", "vivaldi"]],
      },
    },
    appPath: "vivaldi.exe",
    bundleIds: ["com.vivaldi.vivaldi"],
  },
  {
    key: "opera",
    name: "Opera",
    family: "chromium",
    places: {
      win32: {
        executables: [
          ["LOCALAPPDATA", "Programs/Opera/opera.exe"],
          ["PROGRAMFILES", "Opera/opera.exe"],
          ["PROGRAMFILES(X86)", "Opera/opera.exe"],
        ],
        data: [["APPDATA", "Opera Software/Opera Stable"]],
      },
      darwin: mac("Opera.app/Contents/MacOS/Opera", "com.operasoftware.Opera"),
      linux: {
        executables: [
          ["ROOT", "usr/lib/x86_64-linux-gnu/opera/opera"],
          ["PATH", "opera"],
        ],
        data: [
          ["CONFIG", "opera"],
          ["HOME", "snap/opera/current/.config/opera"],
        ],
      },
    },
    bundleIds: ["com.operasoftware.opera"],
  },
  {
    key: "opera-gx",
    name: "Opera GX",
    family: "chromium",
    places: {
      win32: {
        executables: [
          ["LOCALAPPDATA", "Programs/Opera GX/opera.exe"],
          ["PROGRAMFILES", "Opera GX/opera.exe"],
          ["PROGRAMFILES(X86)", "Opera GX/opera.exe"],
        ],
        data: [["APPDATA", "Opera Software/Opera GX Stable"]],
      },
      darwin: mac("Opera GX.app/Contents/MacOS/Opera", "com.operasoftware.OperaGX"),
    },
    bundleIds: ["com.operasoftware.operagx"],
  },
  {
    key: "chromium",
    name: "Chromium",
    family: "chromium",
    places: {
      win32: {
        executables: [
          ["LOCALAPPDATA", "Chromium/Application/chrome.exe"],
          ["PROGRAMFILES", "Chromium/Application/chrome.exe"],
        ],
        data: [["LOCALAPPDATA", "Chromium/User Data"]],
      },
      darwin: mac("Chromium.app/Contents/MacOS/Chromium", "Chromium"),
      linux: {
        executables: [
          ["PATH", "chromium"],
          ["PATH", "chromium-browser"],
          ["ROOT", "snap/bin/chromium"],
        ],
        data: [
          ["CONFIG", "chromium"],
          ["HOME", "snap/chromium/common/chromium"],
        ],
      },
    },
    bundleIds: ["org.chromium.chromium"],
  },
  {
    key: "firefox",
    name: "Mozilla Firefox",
    family: "firefox",
    places: {
      win32: {
        executables: [
          ["PROGRAMFILES", "Mozilla Firefox/firefox.exe"],
          ["PROGRAMFILES(X86)", "Mozilla Firefox/firefox.exe"],
        ],
        data: [["APPDATA", "Mozilla/Firefox"]],
      },
      darwin: mac("Firefox.app/Contents/MacOS/firefox", "Firefox"),
      linux: {
        executables: [["PATH", "firefox"]],
        data: [
          ["HOME", ".mozilla/firefox"],
          ["CONFIG", "mozilla/firefox"],
          ["HOME", "snap/firefox/common/.mozilla/firefox"],
          ["HOME", ".var/app/org.mozilla.firefox/.mozilla/firefox"],
        ],
      },
    },
    appPath: "firefox.exe",
    bundleIds: ["org.mozilla.firefox"],
  },
];
const COMMAND_DEADLINE_MS = 4000;
const SAFE_DIRECTORY = /^(?!\.+$)[\w .-]{1,64}$/;

/** Chromium `Local State` -> profile folders with their display names. */
export function parseChromiumProfiles(json: string): { dir: string; name: string }[] {
  let cache: unknown;
  try {
    cache = (JSON.parse(json) as { profile?: { info_cache?: unknown } }).profile?.info_cache;
  } catch {
    return [];
  }
  if (typeof cache !== "object" || cache === null) return [];
  return Object.entries(cache as Record<string, { name?: unknown }>)
    .filter(([dir]) => SAFE_DIRECTORY.test(dir))
    .map(([dir, entry]) => ({
      dir,
      name: typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : dir,
    }))
    .sort(
      (left, right) =>
        Number(right.dir === "Default") - Number(left.dir === "Default") ||
        left.dir.localeCompare(right.dir, "en", { numeric: true }),
    );
}

/** Firefox `profiles.ini` -> profiles, the installation's default first. */
export function parseFirefoxProfiles(
  ini: string,
  root: string,
): { section: string; name: string; path: string; isDefault: boolean }[] {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = new Map();
      sections.set(header[1] ?? "", current);
      continue;
    }
    const separator = line.indexOf("=");
    if (current && separator > 0)
      current.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const installDefaults = new Set(
    [...sections]
      .filter(([section]) => section.startsWith("Install"))
      .map(([, values]) => values.get("Default"))
      .filter((value): value is string => !!value),
  );
  const profiles = [...sections]
    .filter(([section]) => /^Profile\d+$/.test(section))
    .flatMap(([section, values]) => {
      const path = values.get("Path");
      if (!path) return [];
      const resolved = values.get("IsRelative") === "0" ? path : join(root, path);
      const isDefault =
        installDefaults.size > 0 ? installDefaults.has(path) : values.get("Default") === "1";
      return [{ section, name: values.get("Name") ?? section, path: resolved, isDefault }];
    });
  return profiles.sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}

/** `reg query ...\UserChoice /v ProgId` output -> the ProgId. */
export function parseUserChoiceProgId(output: string) {
  return /ProgId\s+REG_SZ\s+(\S+)/i.exec(output)?.[1] ?? null;
}

export function browserForProgId(progId: string): BrowserKey | null {
  if (/^ChromeHTML/i.test(progId)) return "chrome";
  if (/^MSEdgeHTM/i.test(progId)) return "edge";
  if (/^BraveHTML/i.test(progId)) return "brave";
  if (/^VivaldiHTM/i.test(progId)) return "vivaldi";
  if (/^OperaGXStable/i.test(progId)) return "opera-gx";
  if (/^OperaStable/i.test(progId)) return "opera";
  if (/^ChromiumHTM/i.test(progId)) return "chromium";
  if (/^FirefoxURL/i.test(progId)) return "firefox";
  return null;
}

/** macOS LaunchServices handlers (`plutil -extract LSHandlers json`) -> the https handler's bundle id. */
export function parseMacUrlHandler(json: string): string | null {
  let handlers: unknown;
  try {
    handlers = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(handlers)) return null;
  for (const scheme of ["https", "http"]) {
    const entry = (handlers as Record<string, unknown>[]).find(
      (handler) =>
        typeof handler?.LSHandlerURLScheme === "string" &&
        handler.LSHandlerURLScheme.toLowerCase() === scheme,
    );
    if (typeof entry?.LSHandlerRoleAll === "string") return entry.LSHandlerRoleAll.toLowerCase();
  }
  return null;
}

export function browserForBundleId(bundleId: string): BrowserKey | null {
  const id = bundleId.toLowerCase();
  return DEFINITIONS.find(({ bundleIds }) => bundleIds.includes(id))?.key ?? null;
}

function browserForDesktopEntry(entry: string): BrowserKey | null {
  const name = entry.toLowerCase();
  if (name.includes("firefox")) return "firefox";
  if (name.includes("chromium")) return "chromium";
  if (name.includes("chrome")) return "chrome";
  if (name.includes("edge")) return "edge";
  if (name.includes("brave")) return "brave";
  if (name.includes("vivaldi")) return "vivaldi";
  if (name.includes("opera")) return name.includes("gx") ? "opera-gx" : "opera";
  return null;
}

/** `reg query ... /ve` output -> the default value, quotes removed and `%VAR%` expanded. */
export function parseRegistryDefault(output: string, env: NodeJS.ProcessEnv = process.env) {
  const value = /REG_(?:EXPAND_)?SZ[ \t]+(.+?)\s*$/m.exec(output)?.[1]?.replace(/^"|"$/g, "");
  return value
    ? value.replace(/%([^%]+)%/g, (whole, name: string) => env[name] ?? whole)
    : undefined;
}

type Dependencies = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  command?: typeof deviceCommand;
};

/** The OS default web browser, or null when unknown or not one of the supported browsers. */
export async function detectDefaultBrowser({
  platform = process.platform,
  env = process.env,
  command = deviceCommand,
}: Dependencies = {}): Promise<BrowserKey | null> {
  try {
    if (platform === "win32") {
      for (const scheme of ["https", "http"]) {
        const output = await command(
          "reg",
          [
            "query",
            `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`,
            "/v",
            "ProgId",
          ],
          { timeoutMs: COMMAND_DEADLINE_MS },
        ).catch(() => "");
        const progId = parseUserChoiceProgId(output);
        if (progId) return browserForProgId(progId);
      }
      return null;
    }
    if (platform === "darwin") {
      // Without a LaunchServices entry for https the system default (Safari) applies.
      const bundleId = parseMacUrlHandler(
        await command(
          "plutil",
          [
            "-extract",
            "LSHandlers",
            "json",
            "-o",
            "-",
            join(
              env.HOME ?? homedir(),
              "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
            ),
          ],
          { timeoutMs: COMMAND_DEADLINE_MS },
        ),
      );
      return bundleId ? browserForBundleId(bundleId) : null;
    }
    if (platform === "linux")
      return browserForDesktopEntry(
        await command("xdg-settings", ["get", "default-web-browser"], {
          timeoutMs: COMMAND_DEADLINE_MS,
        }),
      );
  } catch {
    /* An unknown default browser only hides a hint. */
  }
  return null;
}

/** The executable Windows registered for `exe`, per user first; undefined when absent. */
async function registeredExecutable(
  exe: string,
  env: NodeJS.ProcessEnv,
  command: typeof deviceCommand,
) {
  for (const hive of ["HKCU", "HKLM"]) {
    const output = await command(
      "reg",
      ["query", `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, "/ve"],
      { timeoutMs: COMMAND_DEADLINE_MS },
    ).catch(() => "");
    const path = parseRegistryDefault(output, env);
    if (path && existsSync(path)) return path;
  }
  return undefined;
}

/** A profile folder that holds a cookie database. */
const hasCookies = (profile: string) =>
  existsSync(join(profile, "Network", "Cookies")) || existsSync(join(profile, "Cookies"));

async function readText(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Turns a place into an absolute path; `PATH` entries resolve to the first matching file. */
function resolver(env: NodeJS.ProcessEnv, platform: SupportedPlatform) {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const bases: Partial<Record<Root, string>> = {
    PROGRAMFILES: env.PROGRAMFILES,
    "PROGRAMFILES(X86)": env["PROGRAMFILES(X86)"],
    LOCALAPPDATA: env.LOCALAPPDATA,
    APPDATA: env.APPDATA,
    HOME: home,
    CONFIG: env.XDG_CONFIG_HOME || join(home, ".config"),
    ROOT: platform === "win32" ? undefined : "/",
  };
  return ([root, path]: [Root, string]) => {
    if (root === "PATH")
      return (env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, path))
        .find((candidate) => existsSync(candidate));
    const base = bases[root];
    return base ? join(base, path) : undefined;
  };
}

/**
 * Installed browsers and their profiles on Windows, macOS and Linux; the default browser's
 * profiles come first.
 */
export async function detectBrowserSources(
  dependencies: Dependencies = {},
): Promise<BrowserSources> {
  const { platform = process.platform, env = process.env, command = deviceCommand } = dependencies;
  const defaultKey = await detectDefaultBrowser(dependencies);
  const defaultBrowser = defaultKey
    ? { browser: defaultKey, name: DEFINITIONS.find(({ key }) => key === defaultKey)?.name ?? "" }
    : null;
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux")
    return { defaultBrowser, sources: [] };
  const resolve = resolver(env, platform);
  const sources: BrowserSource[] = [];
  for (const definition of DEFINITIONS) {
    const place = definition.places[platform];
    if (!place) continue;
    const userDataDir = place.data
      .map(resolve)
      .find((candidate): candidate is string => !!candidate && existsSync(candidate));
    if (!userDataDir) continue;
    const executable =
      place.executables
        .map(resolve)
        .find((candidate): candidate is string => !!candidate && existsSync(candidate)) ??
      (platform === "win32" && definition.appPath
        ? await registeredExecutable(definition.appPath, env, command)
        : undefined);
    const profiles: { id: string; name: string; dir: string; userDataDir: string }[] = [];
    if (definition.family === "chromium") {
      if (!executable) continue;
      const state = await readText(join(userDataDir, "Local State"));
      for (const { dir, name } of state ? parseChromiumProfiles(state) : [])
        if (existsSync(join(userDataDir, dir))) profiles.push({ id: dir, name, dir, userDataDir });
      // Older Opera builds keep their one profile directly in the data directory.
      if (!profiles.length && hasCookies(userDataDir))
        profiles.push({ id: "", name: definition.name, dir: "", userDataDir });
      else if (!profiles.length && hasCookies(join(userDataDir, "Default")))
        profiles.push({ id: "Default", name: "Default", dir: "Default", userDataDir });
    } else {
      const ini = await readText(join(userDataDir, "profiles.ini"));
      for (const profile of ini ? parseFirefoxProfiles(ini, userDataDir) : [])
        if (existsSync(profile.path))
          profiles.push({
            id: profile.section,
            name: profile.name,
            dir: "",
            userDataDir: profile.path,
          });
    }
    profiles.forEach((profile, index) =>
      sources.push({
        id: `${definition.key}:${profile.id}`,
        browser: definition.key,
        browserName: definition.name,
        profileName: profile.name,
        isDefault: definition.key === defaultKey && index === 0,
        family: definition.family,
        executable,
        userDataDir: profile.userDataDir,
        profileDir: profile.dir,
      }),
    );
  }
  sources.sort(
    (left, right) => Number(right.browser === defaultKey) - Number(left.browser === defaultKey),
  );
  return { defaultBrowser, sources };
}

export const publicSource = ({
  id,
  browser,
  browserName,
  profileName,
  isDefault,
}: BrowserSource): PublicBrowserSource => ({ id, browser, browserName, profileName, isDefault });
