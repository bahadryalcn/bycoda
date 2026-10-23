// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { XMediaFields } from "./XMediaFields";
import type { SocialClient } from "../model/socialClient";
it("edits each image description while preserving other media metadata", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element),
    change = vi.fn();
  const value = [
    { kind: "image" as const, uploadId: "first", alt: "Original" },
    { kind: "image" as const, uploadId: "second", alt: "Keep this" },
  ];
  try {
    await act(async () =>
      root.render(
        createElement(XMediaFields, { value, client: {} as SocialClient, onChange: change }),
      ),
    );
    const input = element.querySelector<HTMLInputElement>(
      '[aria-label="Image alt text 1"], input:not([type="file"])',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Updated description",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(change).toHaveBeenLastCalledWith([
      { ...value[0], alt: "Updated description" },
      value[1],
    ]);
    expect(input.maxLength).toBe(1000);
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
it("uploads selected images together, rejects mixed video and preserves existing media on failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element),
    change = vi.fn(),
    busy = vi.fn();
  const upload = vi.fn().mockResolvedValue({ uploadId: "image" }),
    video = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(XMediaFields, {
          value: [{ kind: "image", uploadId: "old" }],
          client: { upload, uploadVideo: video } as unknown as SocialClient,
          onChange: change,
          onBusyChange: busy,
        }),
      ),
    );
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    const select = async (files: File[]) => {
      Object.defineProperty(input, "files", { configurable: true, value: files });
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    };
    const image = new File(["image"], "image.png", { type: "image/png" });
    await select([image, new File(["video"], "video.mp4", { type: "video/mp4" })]);
    expect(upload).not.toHaveBeenCalled();
    expect(video).not.toHaveBeenCalled();
    expect(element.textContent).toContain("single MP4");
    await select([image, image]);
    expect(change).toHaveBeenLastCalledWith([
      { kind: "image", uploadId: "image" },
      { kind: "image", uploadId: "image" },
    ]);
    expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
    change.mockClear();
    upload.mockRejectedValueOnce(new Error("synthetic"));
    await select([image]);
    expect(change).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Upload failed");
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
