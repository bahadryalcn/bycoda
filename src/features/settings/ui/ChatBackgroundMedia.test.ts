// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ChatBackgroundMedia } from "./ChatBackgroundMedia";

const motion = vi.hoisted(() => ({ enabled: true, reduced: false }));
vi.mock("../model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => motion.enabled,
  useSystemReducedMotion: () => motion.reduced,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `preview://${path}`,
}));
let root: Root;
let container: HTMLDivElement;
let intersect: (entries: { isIntersecting: boolean }[]) => void;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {
        intersect([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
  motion.enabled = true;
  motion.reduced = false;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) =>
      command === "create_html_preview" ? (args as { token: string }).token : "<b>scene</b>",
    );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("retries a failed design after switching away and returning", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Temporary read failure"));
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.html" })));
  expect(container.querySelector("iframe")).toBeNull();
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: null })));
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.html" })));
  expect(container.querySelector("iframe")).not.toBeNull();
});

it("releases the video decoder immediately when hidden or failed", async () => {
  const pause = vi.spyOn(HTMLVideoElement.prototype, "pause").mockImplementation(() => {});
  const load = vi.spyOn(HTMLVideoElement.prototype, "load").mockImplementation(() => {});
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.mp4" })));
  const video = container.querySelector("video")!;
  await act(() => intersect([{ isIntersecting: false }]));
  expect(pause).toHaveBeenCalled();
  expect(load).toHaveBeenCalled();
  expect(video.hasAttribute("src")).toBe(false);
  await act(() => intersect([{ isIntersecting: true }]));
  const failedVideo = container.querySelector("video")!;
  pause.mockClear();
  await act(() => failedVideo.dispatchEvent(new Event("error")));
  expect(pause).toHaveBeenCalled();
  expect(failedVideo.hasAttribute("src")).toBe(false);
});

it("holds one opaque preview token and disposes when hidden, including a late reply", async () => {
  let resolve!: (value: string) => void;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "read_chat_background_html"
      ? new Promise<string>((done) => {
          resolve = done;
        })
      : "token",
  );
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.html" })));
  await act(() =>
    root.render(createElement(ChatBackgroundMedia, { path: "/asset.html", active: false })),
  );
  await act(async () => resolve("<script>1</script>"));
  expect(
    vi.mocked(invoke).mock.calls.filter(([command]) => command === "create_html_preview"),
  ).toHaveLength(0);
  expect(invoke).toHaveBeenCalledWith("close_html_preview", { token: expect.any(String) });
  expect(container.querySelector("iframe")).toBeNull();
});

it("unmounts muted looping video offscreen and honors reduced motion even with preference override", async () => {
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.mp4" })));
  const video = container.querySelector("video")!;
  expect(video).not.toBeNull();
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  await act(() => intersect([{ isIntersecting: false }]));
  expect(container.querySelector("video")).toBeNull();
  await act(() => intersect([{ isIntersecting: true }]));
  motion.reduced = true;
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.mp4" })));
  const still = container.querySelector("video")!;
  expect(still.autoplay).toBe(false);
  expect(still.loop).toBe(false);
  expect(still.getAttribute("src")).toContain("#t=0.001");
});

const createCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([command]) => command === "create_html_preview");

it("shows a paused first frame for a video in a pane that is not live", async () => {
  await act(() =>
    root.render(createElement(ChatBackgroundMedia, { path: "/asset.mp4", live: false })),
  );
  expect(container.querySelector("video")?.autoplay).toBe(false);
});

it("mounts a still scene in a pane that is not live, then goes live with a new token", async () => {
  await act(() =>
    root.render(createElement(ChatBackgroundMedia, { path: "/asset.html", live: false })),
  );
  expect(container.querySelector("iframe")).not.toBeNull();
  expect(createCalls()[0][1]).toMatchObject({ still: true });
  const stillToken = (createCalls()[0][1] as { token: string }).token;
  await act(() =>
    root.render(createElement(ChatBackgroundMedia, { path: "/asset.html", live: true })),
  );
  expect(createCalls()).toHaveLength(2);
  expect(createCalls()[1][1]).toMatchObject({ still: false });
  expect((createCalls()[1][1] as { token: string }).token).not.toBe(stillToken);
  expect(invoke).toHaveBeenCalledWith("close_html_preview", { token: stillToken });
  expect(container.querySelector("iframe")).not.toBeNull();
});

it("renders a still scene under reduced motion and renders nothing when inactive", async () => {
  motion.reduced = true;
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.html" })));
  expect(container.querySelector("iframe")).not.toBeNull();
  expect(createCalls()[0][1]).toMatchObject({ still: true });
  await act(() =>
    root.render(createElement(ChatBackgroundMedia, { path: "/asset.html", active: false })),
  );
  expect(container.querySelector("iframe")).toBeNull();
});

it("uses the offline native route, excludes same-origin/forms, and closes exact creation token", async () => {
  await act(() => root.render(createElement(ChatBackgroundMedia, { path: "/asset.html" })));
  const frame = container.querySelector("iframe")!;
  expect(container.querySelector(".chat-background-media")?.hasAttribute("inert")).toBe(true);
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  const create = vi
    .mocked(invoke)
    .mock.calls.find(([command]) => command === "create_html_preview")!;
  expect(create[1]).toMatchObject({ path: "background://scene.html", content: "<b>scene</b>" });
  await act(() => root.render(null));
  expect(invoke).toHaveBeenCalledWith("close_html_preview", {
    token: (create[1] as { token: string }).token,
  });
});
