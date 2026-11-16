// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { applyConversationBackground, readConversationBackground } from "./backgroundControl";
import { loadChatBackgroundPath, saveChatBackgroundPath } from "./appearance";
import { loadProjectChatBackgroundSettings } from "../../projects/public/projectChatBackground";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "/assets/new.html"),
  convertFileSrc: (path: string) => path,
}));
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
  ).rejects.toThrow("authority or selection changed");
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
  expect(loadProjectChatBackgroundSettings("/project")).toMatchObject({ path: "/assets/new.html" });
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
