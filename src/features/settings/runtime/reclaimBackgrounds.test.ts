// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildBackgroundKeepSet, reclaimUnreferencedBackgrounds } from "./reclaimBackgrounds";
import type { BackgroundLibraryImage } from "../model/backgroundLibrary";
import type { SavedTheme } from "../model/savedThemes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));

const image = (id: string, path: string): BackgroundLibraryImage => ({
  id,
  path,
  createdMs: 0,
  bytes: 1,
  source: "added",
  prompt: null,
});

it("keeps every reference source and drops oversized or multiline strings", () => {
  const keep = buildBackgroundKeepSet({
    library: [image("a".repeat(24), "/store/library/a.png")],
    themes: [
      { id: "t", imageId: "a".repeat(24), backgroundPaths: ["/store/alias.png"] } as SavedTheme,
    ],
    globalPath: "/store/global.html",
    projectPaths: ["/store/project.png"],
    historyPaths: ["/store/history.webp"],
    sessionStrings: ["/store/draft.html", "<html>\nsource</html>", "x".repeat(5000)],
  });
  expect(new Set(keep)).toEqual(
    new Set([
      "/store/library/a.png",
      "/store/alias.png",
      "/store/global.html",
      "/store/project.png",
      "/store/history.webp",
      "/store/draft.html",
    ]),
  );
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

it("sweeps with the collected keep set", async () => {
  localStorage.setItem("bycoda.chatBackgroundPath", "/store/global.png");
  localStorage.setItem(
    "bycoda:project-chat-backgrounds",
    JSON.stringify({ a: { path: "/store/a.png" }, b: { path: "/store/b.png" } }),
  );
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "list_background_library" ? [] : { count: 0, bytes: 0 },
  );
  await reclaimUnreferencedBackgrounds();
  const call = vi.mocked(invoke).mock.calls.find(([name]) => name === "chat_background_reclaim");
  expect(new Set((call![1] as { keep: string[] }).keep)).toEqual(
    new Set(["/store/global.png", "/store/a.png", "/store/b.png"]),
  );
});

it("fails closed when a reference source is unreadable", async () => {
  localStorage.setItem("bycoda:project-chat-backgrounds", "{not json");
  vi.mocked(invoke).mockResolvedValue([]);
  await reclaimUnreferencedBackgrounds();
  expect(invoke).not.toHaveBeenCalledWith("chat_background_reclaim", expect.anything());
});

it("fails closed when the library cannot be listed and logs a rejected sweep", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("boom"));
  await expect(reclaimUnreferencedBackgrounds()).resolves.toBeUndefined();
  expect(invoke).not.toHaveBeenCalledWith("chat_background_reclaim", expect.anything());
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "list_background_library") return [];
    throw new Error("sweep failed");
  });
  await expect(reclaimUnreferencedBackgrounds()).resolves.toBeUndefined();
});
