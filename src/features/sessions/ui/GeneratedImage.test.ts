// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "../../../platform/tauri/fs";
import type { GeneratedImageMeta } from "../model/session";
import { GeneratedImage } from "./GeneratedImage";

vi.mock("../../../platform/tauri/fs", () => ({ readBinaryFile: vi.fn(), saveFileCopy: vi.fn() }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image: GeneratedImageMeta = {
  path: "/app-data/generated-images/lazy.png",
  name: "lazy-image",
  mimeType: "image/png",
  size: 8,
};

let container: HTMLDivElement;
let root: Root;
let intersect: (visible: boolean) => void;
let disconnects = 0;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  disconnects = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = (visible) => callback([{ isIntersecting: visible }]);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnects += 1;
      }
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(fs.readBinaryFile).mockReset().mockResolvedValue(PNG);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:lazy-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reads nothing until the image nears the viewport, then loads it lazily", async () => {
  await act(async () => root.render(createElement(GeneratedImage, { image })));
  expect(fs.readBinaryFile).not.toHaveBeenCalled();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector('[role="status"]')).not.toBeNull();

  await act(async () => intersect(true));
  await act(async () => {
    await Promise.resolve();
  });
  expect(fs.readBinaryFile).toHaveBeenCalledTimes(1);
  const img = container.querySelector("img")!;
  expect(img.getAttribute("src")).toBe("blob:lazy-image");
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("decoding")).toBe("async");
  expect(disconnects).toBeGreaterThan(0);
});

it("releases the object URL and the decoded image when it unmounts", async () => {
  await act(async () => root.render(createElement(GeneratedImage, { image })));
  await act(async () => intersect(true));
  await act(async () => {
    await Promise.resolve();
  });
  expect(container.querySelector("img")).not.toBeNull();
  await act(async () => root.unmount());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:lazy-image");
});

const PNG_BASE64 = btoa(String.fromCharCode(...PNG));

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("decodes base64 generated images with the native decoder, keeping MIME and size", async () => {
  const nativeDecode = vi.fn(() => new Uint8Array(PNG));
  const original = (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64;
  (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 = nativeDecode;
  try {
    await act(async () =>
      root.render(createElement(GeneratedImage, { image: { ...image, data: PNG_BASE64 } })),
    );
    await act(async () => intersect(true));
    await flushEffects();

    expect(nativeDecode).toHaveBeenCalledWith(PNG_BASE64);
    expect(fs.readBinaryFile).not.toHaveBeenCalled();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(PNG.byteLength);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:lazy-image");

    await act(async () => root.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:lazy-image");
  } finally {
    (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 = original;
  }
});

it("shows the error state when base64 payload does not decode", async () => {
  await act(async () =>
    root.render(createElement(GeneratedImage, { image: { ...image, data: "not base64!!" } })),
  );
  await act(async () => intersect(true));
  await flushEffects();

  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("Could not open generated image.");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("rejects base64 bytes that are not a recognised image", async () => {
  await act(async () =>
    root.render(
      createElement(GeneratedImage, {
        image: { ...image, data: btoa("plain text, not an image") },
      }),
    ),
  );
  await act(async () => intersect(true));
  await flushEffects();

  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("Could not open generated image.");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("saves the generated image bytes from the session reader through the native dialog", async () => {
  vi.mocked(fs.saveFileCopy).mockReset().mockResolvedValue(true);
  const loadPreview = vi.fn(async () => PNG_BASE64);
  await act(async () =>
    root.render(createElement(GeneratedImage, { image: { ...image, loadPreview } })),
  );
  await act(async () => intersect(true));
  await flushEffects();

  const save = container.querySelector<HTMLButtonElement>('button[aria-label="Save lazy-image"]')!;
  await act(async () => save.click());
  await flushEffects();

  expect(fs.saveFileCopy).toHaveBeenCalledWith({ name: "lazy-image", data: PNG_BASE64 });
  expect(fs.readBinaryFile).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("shows a save failure next to the image", async () => {
  vi.mocked(fs.saveFileCopy).mockReset().mockRejectedValue(new Error("disk full"));
  await act(async () => root.render(createElement(GeneratedImage, { image })));
  await act(async () => intersect(true));
  await flushEffects();

  const save = container.querySelector<HTMLButtonElement>('button[aria-label="Save lazy-image"]')!;
  await act(async () => save.click());
  await flushEffects();

  expect(container.textContent).toContain("disk full");
});
