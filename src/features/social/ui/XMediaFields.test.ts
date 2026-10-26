// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { XMediaFields } from "./XMediaFields";
import type { SocialClient } from "../model/socialClient";
import type { SocialMedia } from "../model/social";
it("rejects video from an image-only editor without replacing approved image metadata", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element),
    change = vi.fn(),
    upload = vi.fn(),
    uploadVideo = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(XMediaFields, {
          value: [{ kind: "image", uploadId: "existing", alt: "Preserve" }],
          imagesOnly: true,
          client: { upload, uploadVideo } as unknown as SocialClient,
          onChange: change,
        }),
      ),
    );
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe("image/jpeg,image/png");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["video"], "video.mp4", { type: "video/mp4" })],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(change).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Select up to 4 JPEG/PNG images.");
    expect(element.textContent).not.toContain("tweet");
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
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

it("shows indeterminate progress instead of a fictitious percentage for image uploads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  let finish!: (value: { uploadId: string }) => void;
  const upload = vi.fn(
    () =>
      new Promise<{ uploadId: string }>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await act(async () =>
      root.render(
        createElement(XMediaFields, {
          value: [],
          client: { upload } as unknown as SocialClient,
          onChange: vi.fn(),
        }),
      ),
    );
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["image"], "image.png", { type: "image/png" })],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(element.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(element.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(
      false,
    );
    expect(element.textContent).not.toContain("0%");
    await act(async () => finish({ uploadId: "uploaded" }));
    expect(input.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});

it("supports a platform video-only uploader, keeps blob previews local and revokes them on replacement and unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:first")
    .mockReturnValueOnce("blob:second");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element),
    duration = vi.fn(),
    changed = vi.fn();
  const uploadVideo = vi
    .fn()
    .mockResolvedValueOnce({ uploadId: "first" })
    .mockResolvedValueOnce({ uploadId: "second" });
  const localClient = { uploadVideo } as unknown as SocialClient;
  function Editor() {
    const [media, setMedia] = useState<SocialMedia[]>([]);
    return createElement(XMediaFields, {
      value: media,
      client: localClient,
      videoOnly: true,
      maxCount: 1,
      label: "TikTok attachments",
      help: "Browser video",
      showPreview: true,
      onVideoDurationChange: duration,
      onChange: (next: SocialMedia[]) => {
        changed(next);
        setMedia(next);
      },
    });
  }
  try {
    await act(async () => root.render(createElement(Editor)));
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe("video/mp4");
    expect(input.multiple).toBe(false);
    const select = async (file: File) => {
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    };
    await select(new File(["image"], "wrong.png", { type: "image/png" }));
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Select a single MP4 video");
    await select(new File(["video"], "first.mp4", { type: "video/mp4" }));
    expect(changed).toHaveBeenLastCalledWith([{ kind: "video", uploadId: "first" }]);
    const video = element.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("blob:first");
    Object.defineProperty(video, "duration", { configurable: true, value: 32 });
    await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
    expect(duration).toHaveBeenLastCalledWith(32);
    await select(new File(["video"], "second.mp4", { type: "video/mp4" }));
    expect(revoke).toHaveBeenCalledWith("blob:first");
    expect(changed).toHaveBeenLastCalledWith([{ kind: "video", uploadId: "second" }]);
    expect(JSON.stringify(changed.mock.calls)).not.toContain("blob:");
    expect(create).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    expect(revoke).toHaveBeenCalledWith("blob:second");
    element.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("does not replace the parent draft when a pending upload finishes after the editor unmounts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element),
    change = vi.fn();
  let finish!: (result: { uploadId: string }) => void;
  const upload = vi.fn(
    () =>
      new Promise<{ uploadId: string }>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await act(async () =>
      root.render(
        createElement(XMediaFields, {
          value: [],
          client: { upload } as unknown as SocialClient,
          onChange: change,
        }),
      ),
    );
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["image"], "image.png", { type: "image/png" })],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => root.unmount());
    await act(async () => finish({ uploadId: "late" }));
    expect(change).not.toHaveBeenCalled();
  } finally {
    element.remove();
    vi.unstubAllGlobals();
  }
});

it("does not attach an upload from an old host after the selected host changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element),
    oldChange = vi.fn(),
    newChange = vi.fn();
  let finish!: (result: { uploadId: string }) => void;
  const oldClient = {
    upload: () =>
      new Promise<{ uploadId: string }>((resolve) => {
        finish = resolve;
      }),
  } as unknown as SocialClient;
  const newClient = { upload: vi.fn() } as unknown as SocialClient;
  try {
    await act(async () =>
      root.render(
        createElement(XMediaFields, { value: [], client: oldClient, onChange: oldChange }),
      ),
    );
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["image"], "image.png", { type: "image/png" })],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () =>
      root.render(
        createElement(XMediaFields, { value: [], client: newClient, onChange: newChange }),
      ),
    );
    await act(async () => finish({ uploadId: "old-host-file" }));
    expect(oldChange).not.toHaveBeenCalled();
    expect(newChange).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  }
});
