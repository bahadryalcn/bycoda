import { describe, it, expect, vi } from "vitest";
import { expoManifest, expoPreviewUrl, cachedExpoGo } from "./expo-go";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { deviceCommand } from "./device-process";
describe("Expo preview boundaries", () => {
  it("reuses a verified official package and refreshes a corrupted archive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-expo-cache-"));
    let downloads = 0;
    const fetcher = vi
      .fn()
      .mockImplementation(async (value) =>
        String(value).includes("versions/latest")
          ? Response.json({
              data: {
                sdkVersions: {
                  "57.0.0": {
                    iosClientUrl:
                      "https://github.com/expo/expo-go-releases/releases/download/Expo-Go-57.0.9/Expo-Go-57.0.9.tar.gz",
                    iosClientVersion: "57.0.9",
                  },
                },
              },
            })
          : (downloads++, new Response("official archive")),
      );
    const command = vi.fn<typeof deviceCommand>().mockImplementation(async (exe, args) => {
      if (exe.endsWith("PlistBuddy")) return "host.exp.Exponent";
      if (args[0] === "-tzf") return "Info.plist\n";
      await writeFile(join(args[3], "Info.plist"), "official manifest");
      return "";
    });
    try {
      const options = { env: {}, fetcher, command };
      const first = await cachedExpoGo(directory, "57.0.0", "ios", options);
      expect((await cachedExpoGo(directory, "57.0.0", "ios", options)).app).toBe(first.app);
      expect(downloads).toBe(1);
      const archive = join(directory, "expo-go", "ios-57.0.9", "ExpoGo.tar.gz");
      await writeFile(archive, "corrupted");
      await cachedExpoGo(directory, "57.0.0", "ios", options);
      expect(downloads).toBe(2);
      expect((await readFile(archive)).toString()).toBe("official archive");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("converts Expo schemes and rejects secret-bearing or non-web URLs", () => {
    expect(expoPreviewUrl("exp://localhost:8081").href).toBe("http://localhost:8081/");
    for (const url of [
      "file:///tmp/script",
      "exp://user:secret@localhost:8081",
      "exp://localhost:8081/?token=secret",
      "exp://localhost:8081/#fragment",
    ])
      expect(() => expoPreviewUrl(url)).toThrow("EXPO_URL_INVALID");
  });
  it("rejects a mismatched advertised port before launching or installing anything", async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      Response.json({
        extra: { expoClient: { sdkVersion: "57.0.0" } },
        launchAsset: { url: "http://localhost:8094/index.bundle" },
      }),
    );
    await expect(expoManifest("exp://localhost:8095", "ios", fetcher)).rejects.toThrow(
      "EXPO_SERVER_ADDRESS_MISMATCH",
    );
    await expect(expoManifest("exp://localhost:8094", "ios", fetcher)).resolves.toEqual({
      sdkVersion: "57.0.0",
    });
  });
  it("does not download an arbitrary package from a changed SDK release entry", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          sdkVersions: {
            "57.0.0": {
              iosClientUrl: "https://evil.example/app.tar.gz",
              iosClientVersion: "57.0.9",
            },
          },
        },
      }),
    );
    await expect(
      cachedExpoGo("/unused-cache", "57.0.0", "ios", { env: {}, fetcher }),
    ).rejects.toThrow("EXPO_RELEASE_INVALID");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
