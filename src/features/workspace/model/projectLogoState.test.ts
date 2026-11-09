// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

async function load() {
  vi.resetModules();
  const state = await import("./projectLogoState");
  const groups = await import("./tabGroups");
  return { ...state, ...groups };
}

async function settled() {
  await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("shipped project logos", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
  });

  it("ignores an answer that is not a path", async () => {
    invoke.mockResolvedValue({ unexpected: true });
    const { resolveTabGroupLogo } = await load();
    expect(resolveTabGroupLogo("c:/work/p", {})).toBeNull();
    await settled();
    expect(resolveTabGroupLogo("c:/work/p", {})).toBeNull();
  });

  it("detects once, then shows the shipped logo and announces it", async () => {
    invoke.mockResolvedValue("/data/project-logos/auto-p.svg");
    const { detectedProjectLogo, resolveTabGroupLogo, TAB_GROUP_LOGOS_CHANGED } = await load();
    const changed = vi.fn();
    window.addEventListener(TAB_GROUP_LOGOS_CHANGED, changed);

    expect(resolveTabGroupLogo("c:/work/p", {})).toBeNull();
    await settled();
    expect(invoke).toHaveBeenCalledWith("detect_project_logo", { project: "c:/work/p" });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(resolveTabGroupLogo("c:/work/p", {})).toBe("/data/project-logos/auto-p.svg");
    detectedProjectLogo("c:/work/p");
    expect(invoke).toHaveBeenCalledTimes(1);
    window.removeEventListener(TAB_GROUP_LOGOS_CHANGED, changed);
  });

  it("remembers the last answer across launches", async () => {
    invoke.mockResolvedValue("/data/auto-p.png");
    await load().then(({ detectedProjectLogo }) => detectedProjectLogo("c:/work/p"));
    await settled();
    invoke.mockReturnValue(new Promise(() => undefined));
    const { detectedProjectLogo } = await load();
    expect(detectedProjectLogo("c:/work/p")).toBe("/data/auto-p.png");
  });

  it("lets a chosen logo or mascot win and skips remote projects", async () => {
    invoke.mockResolvedValue("/data/auto-p.svg");
    const { detectedProjectLogo, resolveTabGroupLogo, saveTabGroupMascot } = await load();
    detectedProjectLogo("c:/work/p");
    await settled();
    expect(resolveTabGroupLogo("c:/work/p", { "c:/work/p": "/data/mine.png" })).toBe(
      "/data/mine.png",
    );
    saveTabGroupMascot("c:/work/p", "fox");
    expect(resolveTabGroupLogo("c:/work/p", {})).toBeNull();
    saveTabGroupMascot("c:/work/p", null);
    expect(resolveTabGroupLogo("c:/work/p", {})).toBe("/data/auto-p.svg");

    invoke.mockClear();
    expect(detectedProjectLogo("remote://box/home/p")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).not.toHaveBeenCalled();
  });
});
