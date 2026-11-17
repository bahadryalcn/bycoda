// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  applyConversationBackground,
  readConversationBackground,
  saveConversationBackground,
} from "./backgroundControl";
import { loadSavedThemes, saveSavedThemes } from "./savedThemes";
import { loadBackgroundHistory } from "./backgroundHistory";
import { loadChatBackgroundPath, saveChatBackgroundPath } from "./appearance";
import { loadProjectChatBackgroundSettings } from "../../projects/public/projectChatBackground";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "/assets/new.html"),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../projects/public/chatBackground", () => ({
  validateChatBackgroundMedia: vi.fn(async () => undefined),
}));
vi.mock("./savedThemes", async (original) => {
  const actual = await original<typeof import("./savedThemes")>();
  return { ...actual, saveSavedThemes: vi.fn(actual.saveSavedThemes) };
});
const assetPath = `/assets/asset-${"a".repeat(64)}.html`;
const library = {
  id: "a".repeat(24),
  path: `/library/${"a".repeat(24)}.html`,
  source: "generated",
  prompt: null,
  bytes: 20,
  createdMs: 1,
};
beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "list_background_library") return [library];
    if (command === "add_background_library_image") return library;
    if (command === "read_chat_background_html") return "<b>island</b>";
    return assetPath;
  });
});
const input = {
  title: "Quiet scene",
  html: "<style>body{margin:0}</style>",
  target: "global",
  confirmed: true,
};
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.mocked(invoke).mockClear();
});

it("requires explicit instruction and rejects invalid source before native work", async () => {
  await expect(
    applyConversationBackground({ ...input, confirmed: false }, "/project", async () => true),
  ).rejects.toThrow("Invalid");
  await expect(
    applyConversationBackground({ ...input, path: "/secret" }, "/project", async () => true),
  ).rejects.toThrow("Invalid");
  expect(invoke).not.toHaveBeenCalled();
});

it("returns authored Three.js source and runtime without sending the offline bundle", async () => {
  saveChatBackgroundPath("/scene.html");
  vi.mocked(invoke).mockResolvedValueOnce(
    "<script>large offline library</script><!--bycoda:scene-source--><script>THREE.Scene</script>",
  );
  expect(
    await readConversationBackground({ target: "global" }, "/project", async () => true),
  ).toMatchObject({ runtime: "three", html: "<script>THREE.Scene</script>", nextOffset: null });
});

it("reads bounded current HTML chunks after reopening, with an immutable path fence", async () => {
  saveChatBackgroundPath("/imported.html");
  vi.mocked(invoke).mockResolvedValueOnce("<b>old scene</b>");
  expect(
    await readConversationBackground({ target: "project", limit: 4 }, "/project", async () => true),
  ).toMatchObject({
    target: "global",
    kind: "html",
    html: "<b>o",
    nextOffset: 4,
    path: "/imported.html",
  });
  saveChatBackgroundPath("/new.html");
  await expect(
    readConversationBackground(
      { target: "global", expectedPath: "/imported.html", offset: 4 },
      "/project",
      async () => true,
    ),
  ).rejects.toThrow("selection changed");
});

it("refuses caller-named files and revoked authority when reading a scene", async () => {
  await expect(
    readConversationBackground({ target: "global", path: "/secret" }, "/project", async () => true),
  ).rejects.toThrow("Invalid");
  saveChatBackgroundPath("/scene.html");
  vi.mocked(invoke).mockResolvedValueOnce("<b>scene</b>");
  const authorized = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(
    readConversationBackground({ target: "global" }, "/project", authorized),
  ).rejects.toThrow("authority changed");
});

it("rechecks authority after asset copy and retains previous selection", async () => {
  saveChatBackgroundPath("/old.png");
  const authorized = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(applyConversationBackground(input, "/project", authorized)).rejects.toThrow(
    "authority changed",
  );
  expect(loadChatBackgroundPath()).toBe("/old.png");
});

it("applies project HTML without changing global selection and preserves scope", async () => {
  saveChatBackgroundPath("/old.png");
  const result = await applyConversationBackground(
    { ...input, target: "project" },
    "/project",
    async () => true,
  );
  expect(result).toMatchObject({ applied: true, target: "project" });
  expect(loadChatBackgroundPath()).toBe("/old.png");
  expect(loadProjectChatBackgroundSettings("/project")).toMatchObject({ path: assetPath });
});

it("failed import leaves current choice usable", async () => {
  saveChatBackgroundPath("/old.png");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
  await expect(applyConversationBackground(input, "/project", async () => true)).rejects.toThrow(
    "disk full",
  );
  expect(loadChatBackgroundPath()).toBe("/old.png");
});

it("does not overwrite a newer manual selection while native import is pending", async () => {
  saveChatBackgroundPath("/old.png");
  vi.mocked(invoke).mockImplementationOnce(async () => {
    saveChatBackgroundPath("/manual.png");
    return "/generated.html";
  });
  await expect(applyConversationBackground(input, "/project", async () => true)).rejects.toThrow(
    "selection changed",
  );
  expect(loadChatBackgroundPath()).toBe("/manual.png");
});

it.each(["global", "project"])(
  "saves a named %s design without applying, reopens and applies with its saved name",
  async (target) => {
    saveChatBackgroundPath("/old.png");
    const saved = await saveConversationBackground(
      { ...input, title: "Robotun adası", target },
      "/project",
      async () => true,
    );
    expect(saved).toMatchObject({ saved: true, applied: false, title: "Robotun adası" });
    expect(loadChatBackgroundPath()).toBe("/old.png");
    expect(loadProjectChatBackgroundSettings("/project")).toBeNull();
    expect(loadBackgroundHistory()).toEqual([]);
    expect(loadBackgroundHistory("/project")).toEqual([]);
    // Reopen by durable catalog id, independent of the active choice or 30-entry history.
    const reopened = await readConversationBackground(
      { target, designId: saved.designId },
      "/project",
      async () => true,
    );
    expect(reopened).toMatchObject({
      title: "Robotun adası",
      html: "<b>island</b>",
      designId: saved.designId,
    });
    const applied = await applyConversationBackground(
      { ...input, title: "Ignored preview title", target },
      "/project",
      async () => true,
    );
    expect(applied).toMatchObject({
      applied: true,
      title: "Robotun adası",
      designId: saved.designId,
    });
    expect(loadSavedThemes()).toHaveLength(1);
    expect(loadSavedThemes()[0].imageId).toBe(library.id);
  },
);

it("failed catalog save retains selection and rejects stale saved-design edits", async () => {
  saveChatBackgroundPath("/old.png");
  vi.mocked(saveSavedThemes).mockReturnValueOnce(false);
  await expect(applyConversationBackground(input, "/project", async () => true)).rejects.toThrow(
    "save",
  );
  expect(loadChatBackgroundPath()).toBe("/old.png");
  expect(loadBackgroundHistory()).toEqual([]);
  const saved = await saveConversationBackground(input, "/project", async () => true);
  await expect(
    saveConversationBackground(
      { ...input, designId: saved.designId, expectedUpdatedAt: saved.updatedAt! - 1 },
      "/project",
      async () => true,
    ),
  ).rejects.toThrow("changed");
  expect(loadSavedThemes()[0].name).toBe("Quiet scene");
  expect(loadChatBackgroundPath()).toBe("/old.png");
});

it("updates the same saved design only with its current version and rechecks authority before saving", async () => {
  vi.spyOn(Date, "now").mockReturnValue(42);
  const saved = await saveConversationBackground(input, "/project", async () => true);
  const revised = await saveConversationBackground(
    {
      ...input,
      title: "Island dawn",
      designId: saved.designId,
      expectedUpdatedAt: saved.updatedAt,
    },
    "/project",
    async () => true,
  );
  expect(revised.designId).toBe(saved.designId);
  expect(revised.updatedAt).toBe(43);
  await expect(
    saveConversationBackground(
      { ...input, designId: saved.designId, expectedUpdatedAt: saved.updatedAt },
      "/project",
      async () => true,
    ),
  ).rejects.toThrow("changed");
  expect(loadSavedThemes()).toHaveLength(1);
  expect(loadSavedThemes()[0].name).toBe("Island dawn");
  const authorized = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  await expect(
    saveConversationBackground({ ...input, title: "Revoked" }, "/project", authorized),
  ).rejects.toThrow("authority changed");
  expect(loadSavedThemes()[0].name).toBe("Island dawn");
});
