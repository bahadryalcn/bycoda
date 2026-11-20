// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOCAL_IMAGE_MAX_BYTES, LocalMedia } from "./LocalMedia";

const fs = vi.hoisted(() => ({
  prepareLocalFile: vi.fn<(path: string, options?: unknown) => Promise<string>>(),
  readBinaryFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split(/[\\/]/).pop() ?? "",
  prepareLocalFile: fs.prepareLocalFile,
  readBinaryFile: fs.readBinaryFile,
}));

type Watch = { margin: string; callback: IntersectionObserverCallback; live: boolean };
const watches: Watch[] = [];

class FakeObserver {
  private readonly watch: Watch;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.watch = { margin: options?.rootMargin ?? "", callback, live: true };
    watches.push(this.watch);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.watch.live = false;
  }
}

/** Delivers one intersection report to every live observer using this margin. */
function report(margin: string, isIntersecting: boolean) {
  for (const watch of watches) {
    if (watch.live && watch.margin === margin)
      watch.callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  }
}

let container: HTMLDivElement;
let root: Root;

const mount = (path: string) =>
  act(async () => {
    root.render(createElement(LocalMedia, { path, label: "Shot", fallback: "fallback-card" }));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  watches.length = 0;
  fs.prepareLocalFile.mockReset();
  fs.readBinaryFile.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("loads a near image through the size-gated native grant and never reads its bytes", async () => {
  fs.prepareLocalFile.mockImplementation(async (path) => path);
  await mount("/work/shot.png");
  expect(fs.prepareLocalFile).not.toHaveBeenCalled();

  await act(async () => report("400px", true));

  expect(fs.prepareLocalFile).toHaveBeenCalledWith(
    "/work/shot.png",
    expect.objectContaining({ maxBytes: LOCAL_IMAGE_MAX_BYTES }),
  );
  expect(fs.readBinaryFile).not.toHaveBeenCalled();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("asset:/work/shot.png");
});

it("shows the fallback card for an image the native size gate refuses", async () => {
  fs.prepareLocalFile.mockRejectedValue(new Error("File is too large to preview (maximum 20 MB)."));
  await mount("/work/huge.png");
  await act(async () => report("400px", true));

  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("fallback-card");
});

it("drops the source beyond the wide margin and reloads it when the row returns", async () => {
  fs.prepareLocalFile.mockImplementation(async (path) => path);
  await mount("/work/shot.png");
  await act(async () => report("400px", true));
  expect(container.querySelector("img")).not.toBeNull();

  await act(async () => report("2400px", false));
  expect(container.querySelector("img")).toBeNull();
  // The box stays mounted so the transcript keeps its layout.
  expect(container.querySelector("[data-local-media]")).not.toBeNull();

  await act(async () => report("400px", true));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("asset:/work/shot.png");
  expect(fs.prepareLocalFile).toHaveBeenCalledTimes(2);
});

it("does not publish a late reply for a previous path into the current one", async () => {
  const pending = new Map<string, (value: string) => void>();
  fs.prepareLocalFile.mockImplementation(
    (path) => new Promise<string>((resolve) => pending.set(path, resolve)),
  );
  await mount("/work/old.png");
  await act(async () => report("400px", true));
  await mount("/work/new.png");

  await act(async () => pending.get("/work/old.png")?.("/work/old.png"));
  expect(container.querySelector("img")).toBeNull();

  await act(async () => pending.get("/work/new.png")?.("/work/new.png"));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("asset:/work/new.png");
});

it("does not carry one path's failure into the next path", async () => {
  fs.prepareLocalFile.mockImplementation(async (path) => {
    if (path.endsWith("bad.png")) throw new Error("File is too large to preview (maximum 20 MB).");
    return path;
  });
  await mount("/work/bad.png");
  await act(async () => report("400px", true));
  expect(container.textContent).toContain("fallback-card");

  await mount("/work/good.png");
  await act(async () => {});
  expect(container.querySelector("img")?.getAttribute("src")).toBe("asset:/work/good.png");
});
