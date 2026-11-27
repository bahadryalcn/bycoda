import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, it } from "vitest";
import {
  browserForBundleId,
  browserForProgId,
  detectBrowserSources,
  parseChromiumProfiles,
  parseFirefoxProfiles,
  parseMacUrlHandler,
  parseRegistryDefault,
  parseUserChoiceProgId,
} from "./browser-profile-sources";

const REG_OUTPUT = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice
    ProgId    REG_SZ    ChromeHTML
`;

it("reads the default browser ProgId from reg output", () => {
  expect(parseUserChoiceProgId(REG_OUTPUT)).toBe("ChromeHTML");
  expect(parseUserChoiceProgId("ERROR: The system was unable to find the specified registry")).toBe(
    null,
  );
  expect(browserForProgId("MSEdgeHTM")).toBe("edge");
  expect(browserForProgId("FirefoxURL-308046B0AF4A39CB")).toBe("firefox");
  expect(browserForProgId("OperaStable")).toBe("opera");
  expect(browserForProgId("OperaGXStable")).toBe("opera-gx");
  expect(browserForProgId("AppXunknown")).toBeNull();
});

it("lists Chromium profile folders by display name and ignores unsafe folder names", () => {
  const state = JSON.stringify({
    profile: {
      info_cache: {
        "Profile 10": { name: "Ten" },
        "Profile 2": { name: "Work" },
        Default: { name: "Personal" },
        "..": { name: "Escape" },
        "a/b": { name: "Nested" },
        "Profile 3": {},
      },
    },
  });
  expect(parseChromiumProfiles(state)).toEqual([
    { dir: "Default", name: "Personal" },
    { dir: "Profile 2", name: "Work" },
    { dir: "Profile 3", name: "Profile 3" },
    { dir: "Profile 10", name: "Ten" },
  ]);
  expect(parseChromiumProfiles("not json")).toEqual([]);
  expect(parseChromiumProfiles("{}")).toEqual([]);
});

it("parses Firefox profiles.ini with the installation default first", () => {
  const ini = [
    "[Profile1]",
    "Name=default",
    "IsRelative=1",
    "Path=Profiles/abc.default",
    "Default=1",
    "",
    "[Profile0]",
    "Name=default-release",
    "IsRelative=1",
    "Path=Profiles/xyz.default-release",
    "",
    "[Install308046B0AF4A39CB]",
    "Default=Profiles/xyz.default-release",
    "Locked=1",
    "",
    "[General]",
    "StartWithLastProfile=1",
  ].join("\r\n");
  const profiles = parseFirefoxProfiles(ini, "root");
  expect(profiles.map(({ name, isDefault }) => [name, isDefault])).toEqual([
    ["default-release", true],
    ["default", false],
  ]);
  expect(profiles[0]?.path).toBe(join("root", "Profiles/xyz.default-release"));
});

it("detects installed browsers, their profiles and the default browser", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-browser-sources-"));
  try {
    const local = join(root, "Local");
    const roaming = join(root, "Roaming");
    for (const [exe, data] of [
      ["Google/Chrome/Application/chrome.exe", "Google/Chrome/User Data"],
      ["Microsoft/Edge/Application/msedge.exe", "Microsoft/Edge/User Data"],
    ] as const) {
      await mkdir(join(local, exe, ".."), { recursive: true });
      await writeFile(join(local, exe), "");
      await mkdir(join(local, data, "Default"), { recursive: true });
      await writeFile(
        join(local, data, "Local State"),
        JSON.stringify({ profile: { info_cache: { Default: { name: "Main" } } } }),
      );
    }
    await mkdir(join(roaming, "Mozilla/Firefox/Profiles/p.default"), { recursive: true });
    await writeFile(
      join(roaming, "Mozilla/Firefox/profiles.ini"),
      "[Profile0]\nName=default\nIsRelative=1\nPath=Profiles/p.default\nDefault=1\n",
    );
    const result = await detectBrowserSources({
      platform: "win32",
      env: { LOCALAPPDATA: local, PROGRAMFILES: local, APPDATA: roaming },
      command: async () => REG_OUTPUT.replace("ChromeHTML", "MSEdgeHTM"),
    });
    expect(result.defaultBrowser).toEqual({ browser: "edge", name: "Microsoft Edge" });
    expect(result.sources.map(({ id, isDefault }) => [id, isDefault])).toEqual([
      ["edge:Default", true],
      ["chrome:Default", false],
      ["firefox:Profile0", false],
    ]);
    expect(result.sources[1]?.executable).toContain("chrome.exe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("returns no sources on other systems and an unknown default when the lookup fails", async () => {
  const failing = async () => {
    throw new Error("missing");
  };
  expect(await detectBrowserSources({ platform: "freebsd", command: failing })).toEqual({
    defaultBrowser: null,
    sources: [],
  });
  expect(
    (await detectBrowserSources({ platform: "darwin", env: { HOME: tmpdir() }, command: failing }))
      .defaultBrowser,
  ).toBeNull();
  expect(
    (await detectBrowserSources({ platform: "linux", command: async () => "firefox.desktop\n" }))
      .defaultBrowser?.browser,
  ).toBe("firefox");
});

it("reads a registered executable from App Paths output in any Windows language", () => {
  const output = String.raw`
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe
    (Varsayılan)    REG_SZ    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    Path    REG_SZ    C:\Program Files\Google\Chrome\Application
`;
  expect(parseRegistryDefault(output, { ProgramFiles: String.raw`D:\Apps` })).toBe(
    String.raw`D:\Apps\Google\Chrome\Application\chrome.exe`,
  );
  expect(parseRegistryDefault("ERROR: not found")).toBeUndefined();
});

it("finds Opera and Opera GX in both profile layouts and Chrome outside its usual folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-browser-sources-"));
  try {
    const local = join(root, "Local");
    const roaming = join(root, "Roaming");
    const custom = join(root, "D", "Chrome", "chrome.exe");
    // Opera GX: current layout with Local State and a Default profile.
    await mkdir(join(local, "Programs/Opera GX"), { recursive: true });
    await writeFile(join(local, "Programs/Opera GX/opera.exe"), "");
    await mkdir(join(roaming, "Opera Software/Opera GX Stable/Default/Network"), {
      recursive: true,
    });
    await writeFile(join(roaming, "Opera Software/Opera GX Stable/Default/Network/Cookies"), "");
    await writeFile(
      join(roaming, "Opera Software/Opera GX Stable/Local State"),
      JSON.stringify({ profile: { info_cache: { Default: { name: "" } } } }),
    );
    // Opera: older flat layout with the cookie database in the data directory.
    await mkdir(join(local, "Programs/Opera"), { recursive: true });
    await writeFile(join(local, "Programs/Opera/opera.exe"), "");
    await mkdir(join(roaming, "Opera Software/Opera Stable/Network"), { recursive: true });
    await writeFile(join(roaming, "Opera Software/Opera Stable/Network/Cookies"), "");
    // Chrome installed elsewhere and registered under App Paths.
    await mkdir(join(custom, ".."), { recursive: true });
    await writeFile(custom, "");
    await mkdir(join(local, "Google/Chrome/User Data/Default"), { recursive: true });
    await writeFile(
      join(local, "Google/Chrome/User Data/Local State"),
      JSON.stringify({ profile: { info_cache: { Default: { name: "Me" } } } }),
    );
    const result = await detectBrowserSources({
      platform: "win32",
      env: { LOCALAPPDATA: local, APPDATA: roaming },
      command: async (_command, args) =>
        args.some((arg) => arg.endsWith(String.raw`App Paths\chrome.exe`))
          ? `    (Default)    REG_SZ    ${custom}\n`
          : args.includes("ProgId")
            ? REG_OUTPUT.replace("ChromeHTML", "OperaGXStable")
            : "",
    });
    expect(result.defaultBrowser?.browser).toBe("opera-gx");
    expect(
      result.sources.map(({ id, profileName, isDefault }) => [id, profileName, isDefault]),
    ).toEqual([
      ["opera-gx:Default", "Default", true],
      ["chrome:Default", "Me", false],
      ["opera:", "Opera", false],
    ]);
    expect(result.sources[1]?.executable).toBe(custom);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Writes a Chromium data directory with one `Default` profile. */
async function chromiumData(directory: string, name: string) {
  await mkdir(join(directory, "Default"), { recursive: true });
  await writeFile(
    join(directory, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name } } } }),
  );
}

async function touch(file: string) {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "");
}

it("reads the macOS default browser from LaunchServices handlers", () => {
  const handlers = JSON.stringify([
    { LSHandlerContentType: "public.html", LSHandlerRoleAll: "com.apple.safari" },
    { LSHandlerURLScheme: "https", LSHandlerRoleAll: "com.brave.Browser" },
  ]);
  expect(parseMacUrlHandler(handlers)).toBe("com.brave.browser");
  expect(browserForBundleId("com.brave.browser")).toBe("brave");
  expect(browserForBundleId("com.operasoftware.OperaGX")).toBe("opera-gx");
  expect(browserForBundleId("com.apple.safari")).toBeNull();
  expect(parseMacUrlHandler("not json")).toBeNull();
});

it("detects macOS browsers in the user's Applications folder", async () => {
  const home = await mkdtemp(join(tmpdir(), "bycoda-browser-mac-"));
  try {
    const support = join(home, "Library/Application Support");
    await touch(join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
    await chromiumData(join(support, "Google/Chrome"), "Personal");
    await touch(join(home, "Applications/Opera GX.app/Contents/MacOS/Opera"));
    await chromiumData(join(support, "com.operasoftware.OperaGX"), "");
    await mkdir(join(support, "Firefox/Profiles/a.default-release"), { recursive: true });
    await writeFile(
      join(support, "Firefox/profiles.ini"),
      "[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/a.default-release\nDefault=1\n",
    );
    const commands: string[] = [];
    const result = await detectBrowserSources({
      platform: "darwin",
      env: { HOME: home },
      root: join(home, "system"),
      command: async (command) => {
        commands.push(command);
        return JSON.stringify([
          { LSHandlerURLScheme: "https", LSHandlerRoleAll: "org.mozilla.firefox" },
        ]);
      },
    });
    expect(commands).toEqual(["plutil"]);
    expect(result.defaultBrowser?.browser).toBe("firefox");
    expect(result.sources.map(({ id, isDefault }) => [id, isDefault])).toEqual([
      ["firefox:Profile0", true],
      ["chrome:Default", false],
      ["opera-gx:Default", false],
    ]);
    expect(result.sources[1]?.executable).toBe(
      join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("detects Linux browsers on PATH, in XDG config and in snap folders", async () => {
  const home = await mkdtemp(join(tmpdir(), "bycoda-browser-linux-"));
  try {
    const bin = join(home, "bin");
    const config = join(home, "xdg");
    await touch(join(bin, "google-chrome-stable"));
    await chromiumData(join(config, "google-chrome"), "Main");
    await touch(join(bin, "chromium"));
    await chromiumData(join(home, "snap/chromium/common/chromium"), "Snap");
    // Data without an installed executable is ignored.
    await chromiumData(join(config, "microsoft-edge"), "Stale");
    await mkdir(join(home, "snap/firefox/common/.mozilla/firefox/p.default"), { recursive: true });
    await writeFile(
      join(home, "snap/firefox/common/.mozilla/firefox/profiles.ini"),
      "[Profile0]\nName=default\nIsRelative=1\nPath=p.default\nDefault=1\n",
    );
    const result = await detectBrowserSources({
      platform: "linux",
      env: { HOME: home, XDG_CONFIG_HOME: config, PATH: ["", bin].join(delimiter) },
      root: join(home, "system"),
      command: async () => "google-chrome.desktop\n",
    });
    expect(result.defaultBrowser?.browser).toBe("chrome");
    expect(result.sources.map(({ id, profileName }) => [id, profileName])).toEqual([
      ["chrome:Default", "Main"],
      ["chromium:Default", "Snap"],
      ["firefox:Profile0", "default"],
    ]);
    expect(result.sources[0]?.executable).toBe(join(bin, "google-chrome-stable"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
