import { describe, expect, it, vi } from "vitest";
import { openDevServerBrowser } from "./dev-server-browser";
import { execFileAsync } from "../src/shared/lib/processExecution.node";

describe("development server OS browser on owning host", () => {
  it.each([
    ["win32", "rundll32.exe"],
    ["darwin", "open"],
    ["linux", "xdg-open"],
  ] as const)("opens on %s using hidden bounded helpers", async (platform, file) => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    await expect(
      openDevServerBrowser("http://127.0.0.1:5173/", platform, run as typeof execFileAsync),
    ).resolves.toEqual({ url: "http://127.0.0.1:5173/" });
    expect(run).toHaveBeenCalledWith(
      file,
      expect.arrayContaining(["http://127.0.0.1:5173/"]),
      expect.objectContaining({ windowsHide: true, timeout: 5_000 }),
    );
  });
  it.each([
    "file:///tmp/server",
    "http://user:secret@127.0.0.1:5173",
    "https://example.org:5173",
    "ftp://localhost:5173/",
  ])("rejects arbitrary OS targets: %s", async (url) => {
    const run = vi.fn();
    await expect(openDevServerBrowser(url, "win32", run as typeof execFileAsync)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
