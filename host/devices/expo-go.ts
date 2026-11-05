import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { deviceCommand } from "./device-process";

export function expoPreviewUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["exp:", "exps:", "http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname
  )
    throw new Error(
      "EXPO_URL_INVALID: Use a development server URL without credentials, query parameters or fragments.",
    );
  // WHATWG cannot change a non-special URL into a special URL in place.
  return new URL(url.href.replace(/^exp:/, "http:").replace(/^exps:/, "https:"));
}

async function boundedResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body)
    throw new Error(`EXPO_DOWNLOAD_FAILED: HTTP ${response.status}.`);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit)
        throw new Error("EXPO_RESPONSE_TOO_LARGE: The response exceeds its size limit.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

export async function expoManifest(value: string, platform: "ios" | "android", fetcher = fetch) {
  const url = expoPreviewUrl(value);
  const body = await boundedResponse(
    await fetcher(url, {
      headers: { "Expo-Platform": platform, Accept: "application/expo+json,application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }),
    1024 * 1024,
  );
  const manifest = JSON.parse(body.toString());
  const sdkVersion = manifest.extra?.expoClient?.sdkVersion ?? manifest.sdkVersion;
  if (typeof sdkVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(sdkVersion))
    throw new Error("EXPO_MANIFEST_INVALID: The server did not return an Expo SDK version.");
  const asset = manifest.launchAsset?.url ?? manifest.bundleUrl;
  if (typeof asset !== "string")
    throw new Error("EXPO_MANIFEST_INVALID: The server has no launch asset.");
  const assetUrl = new URL(asset);
  if (assetUrl.origin !== url.origin)
    throw new Error(
      "EXPO_SERVER_ADDRESS_MISMATCH: Metro advertises a different address or port. Forward the advertised port or set EXPO_PACKAGER_PROXY_URL before starting Metro.",
    );
  return { sdkVersion };
}

/** Downloads only Expo's official simulator/APK releases; never an incoming URL. */
export async function cachedExpoGo(
  directory: string,
  sdkVersion: string,
  platform: "ios" | "android",
  options: { env: NodeJS.ProcessEnv; fetcher?: typeof fetch; command?: typeof deviceCommand },
) {
  if (!/^\d+\.\d+\.\d+$/.test(sdkVersion))
    throw new Error("EXPO_SDK_INVALID: Expected a semantic SDK version.");
  const fetcher = options.fetcher ?? fetch,
    command = options.command ?? deviceCommand;
  const versions = JSON.parse(
    (
      await boundedResponse(
        await fetcher("https://api.expo.dev/v2/versions/latest", {
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        }),
        2 * 1024 * 1024,
      )
    ).toString(),
  );
  const version = versions.data?.sdkVersions?.[sdkVersion];
  const releaseUrl = version?.[platform === "ios" ? "iosClientUrl" : "androidClientUrl"];
  if (typeof releaseUrl !== "string")
    throw new Error("EXPO_RELEASE_INVALID: No release exists for this SDK.");
  const url = new URL(releaseUrl);
  if (
    url.protocol !== "https:" ||
    url.host !== "github.com" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/expo/expo-go-releases/releases/download/") ||
    url.search ||
    url.hash
  )
    throw new Error(
      "EXPO_RELEASE_INVALID: Expo did not provide an official release URL for this SDK.",
    );
  const versionName = version[platform === "ios" ? "iosClientVersion" : "androidClientVersion"];
  if (typeof versionName !== "string" || !/^\d+\.\d+\.\d+$/.test(versionName))
    throw new Error("EXPO_RELEASE_INVALID: Missing release version.");
  const cache = join(directory, "expo-go", `${platform}-${versionName}`);
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archive = join(cache, platform === "ios" ? "ExpoGo.tar.gz" : "ExpoGo.apk");
  const app = platform === "ios" ? join(cache, "ExpoGo.app") : archive;
  try {
    const ready = JSON.parse(await readFile(join(cache, "ready.json"), "utf8"));
    if (platform === "ios") await readFile(join(app, "Info.plist"));
    if (
      ready.sha256 ===
      createHash("sha256")
        .update(await readFile(archive))
        .digest("hex")
    )
      return { app, versionName };
  } catch {
    /* incomplete caches are not accepted */
  }
  let response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
  // GitHub release assets redirect once to its signed storage URL. Do not log it.
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = new URL(response.headers.get("location") ?? "");
    await response.body?.cancel();
    if (
      location.protocol !== "https:" ||
      !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(
        location.hostname,
      )
    )
      throw new Error("EXPO_RELEASE_INVALID: Unexpected download redirect.");
    response = await fetcher(location, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  }
  const bytes = await boundedResponse(response, 200 * 1024 * 1024);
  const stage = join(cache, `download-${randomUUID()}`);
  await writeFile(stage, bytes, { mode: 0o600 });
  await rename(stage, archive);
  if (platform === "ios") {
    const members = await command("/usr/bin/tar", ["-tzf", archive], { env: options.env });
    if (
      members.split(/\r?\n/).some((name) => name.startsWith("/") || name.split("/").includes(".."))
    )
      throw new Error("EXPO_ARCHIVE_INVALID: Unsafe archive entry.");
    await mkdir(app, { recursive: true, mode: 0o700 });
    await command("/usr/bin/tar", ["-xzf", archive, "-C", app], {
      env: options.env,
      timeoutMs: 60_000,
    });
    if (
      (
        await command(
          "/usr/libexec/PlistBuddy",
          ["-c", "Print :CFBundleIdentifier", join(app, "Info.plist")],
          { env: options.env },
        )
      ).trim() !== "host.exp.Exponent"
    )
      throw new Error("EXPO_PACKAGE_INVALID: The archive is not Expo Go.");
  }
  await writeFile(
    join(cache, "ready.json"),
    JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex") }),
    { mode: 0o600 },
  );
  return { app, versionName };
}
