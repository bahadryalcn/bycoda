import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromeDiscoveryFile, discoverChromeEndpoint } from "./existing-chrome-discovery";

describe("existing Chrome discovery", () => {
  it("uses the stable Chrome directory on Windows and Linux", () => {
    expect(chromeDiscoveryFile("win32", { LOCALAPPDATA: "C:/Local" }, "unused")).toContain(
      "Chrome",
    );
    expect(chromeDiscoveryFile("linux", { XDG_CONFIG_HOME: "/config" }, "/home/user")).toBe(
      join("/config", "google-chrome", "DevToolsActivePort"),
    );
    expect(() => chromeDiscoveryFile("freebsd", {}, "/home/user")).toThrow("unsupported");
  });
  it("reads a valid local endpoint and rejects malformed and oversized files without leaking contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chrome-discovery-"));
    const file = join(dir, "DevToolsActivePort");
    try {
      await writeFile(file, "12345\n/devtools/browser/abc-123\n");
      expect(await discoverChromeEndpoint(file)).toBe(
        "ws://127.0.0.1:12345/devtools/browser/abc-123",
      );
      await writeFile(file, "12345\n/devtools/browser/secret?remote=1\n");
      await expect(discoverChromeEndpoint(file)).rejects.toThrow("Chrome session unavailable");
      await writeFile(file, "x".repeat(1025));
      await expect(discoverChromeEndpoint(file)).rejects.toThrow("Chrome session unavailable");
      await expect(discoverChromeEndpoint(join(dir, "missing"))).rejects.toThrow(
        "Chrome session unavailable",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
