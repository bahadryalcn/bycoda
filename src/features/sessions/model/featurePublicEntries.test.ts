import { beforeEach, describe, expect, it, vi } from "vitest";

const entries = [
  {
    name: "sessions",
    root: () => import("../index"),
    contract: () => import("../public/questionDrafts"),
    owner: () => import("./questionDrafts"),
    symbol: "resolveQuestionDraft",
  },
  {
    name: "connections",
    root: () => import("../../connections/index"),
    contract: () => import("../../connections/public/remoteFailure"),
    owner: () => import("../../connections/model/remoteFailure"),
    symbol: "classifyRemoteError",
  },
  {
    name: "settings",
    root: () => import("../../settings/index"),
    contract: () => import("../../settings/public/settings"),
    owner: () => import("../../settings/model/settings"),
    symbol: "loadAutosave",
  },
  {
    name: "files",
    root: () => import("../../files/index"),
    contract: () => import("../../files/public/editorDoc"),
    owner: () => import("../../files/editor/editorDoc"),
    symbol: "restoreMixedLineEndings",
  },
  {
    name: "source-control",
    root: () => import("../../source-control/index"),
    contract: () => import("../../source-control/public/blameMapping"),
    owner: () => import("../../source-control/model/blameMapping"),
    symbol: "blameByLine",
  },
  {
    name: "projects",
    root: () => import("../../projects/index"),
    contract: () => import("../../projects/public/projectNames"),
    owner: () => import("../../projects/model/projectNames"),
    symbol: "projectDisplayName",
  },
] as const;

describe("feature public entry load isolation", () => {
  beforeEach(() => vi.resetModules());

  it.each(entries)("loads $name without a DOM and preserves API identity", async (entry) => {
    expect(typeof document).toBe("undefined");
    const root = await entry.root();
    // Roots describe contracts and expose deferred loaders, never eager UI.
    expect(
      Object.keys(root).every((name) => name.startsWith("load") || name.startsWith("HARNESS")),
    ).toBe(true);
    const publicApi = await entry.contract();
    const owner = await entry.owner();
    const name = entry.symbol;
    expect(publicApi[name as keyof typeof publicApi]).toEqual(expect.any(Function));
    expect(publicApi[name as keyof typeof publicApi]).toBe(owner[name as keyof typeof owner]);
  });
});
