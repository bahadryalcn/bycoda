// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, GeneratedImageMeta } from "../model/session";
import * as fs from "../../../platform/tauri/fs";
import { GeneratedImage } from "./GeneratedImage";

vi.mock("../../../platform/tauri/fs", () => ({
  readBinaryFile: vi.fn(),
}));
import { AttachmentChip } from "./AttachmentChip";
vi.mock("../../../integrations/harness", () => ({
  canRunHarnessTextPrompt: () => false,
  runHarnessTextPrompt: vi.fn(),
}));

const attachment: Attachment = {
  id: "image-1",
  name: "diagram.png",
  mimeType: "image/png",
  kind: "image",
  size: 42,
  previewUrl: "blob:image-preview",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(fs.readBinaryFile).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(onRemove?: () => void) {
  act(() => root.render(createElement(AttachmentChip, { attachment, onRemove })));
}

describe("AttachmentChip image preview", () => {
  it("does not fall back to a bare path for an image outside the host preview limit", () => {
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: {
            ...attachment,
            previewUrl: undefined,
            path: "/host/large.png",
            size: 26 * 1024 * 1024,
          },
        }),
      ),
    );
    expect(container.querySelector("button")).toBeNull();
    expect(fs.readBinaryFile).not.toHaveBeenCalled();
  });
  it("reopens a persisted local image on demand and releases its bytes on close", async () => {
    vi.mocked(fs.readBinaryFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:history");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: { ...attachment, previewUrl: undefined, path: "/saved/diagram.png" },
        }),
      ),
    );
    expect(fs.readBinaryFile).not.toHaveBeenCalled();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open diagram.png full screen"]',
    )!;
    act(() => trigger.focus());
    await act(async () => trigger.click());
    expect(fs.readBinaryFile).toHaveBeenCalledWith("/saved/diagram.png");
    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe("blob:history");
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Close image preview"]')!.click(),
    );
    expect(revoke).toHaveBeenCalledWith("blob:history");
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    expect(fs.readBinaryFile).toHaveBeenCalledTimes(2);
  });

  it("uses the remote reader instead of opening a host path on this machine", async () => {
    const loadPreview = vi.fn(async () => btoa("image"));
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: {
            ...attachment,
            previewUrl: undefined,
            path: "/host/diagram.png",
            loadPreview,
          },
        }),
      ),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(loadPreview).toHaveBeenCalledOnce();
    expect(fs.readBinaryFile).not.toHaveBeenCalled();
  });

  it("ignores late preview results after switching attachments", async () => {
    let resolve!: (data: string) => void;
    const loadPreview = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: { ...attachment, previewUrl: undefined, loadPreview },
        }),
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: { ...attachment, id: "other", previewUrl: "blob:other" },
        }),
      ),
    );
    await act(async () => resolve(btoa("old")));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not open a missing image even when a loader is present", () => {
    const loadPreview = vi.fn();
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: { ...attachment, previewUrl: undefined, missing: true, loadPreview },
        }),
      ),
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("missing");
    expect(loadPreview).not.toHaveBeenCalled();
  });

  it("loads a remote history image only on click and releases the preview on close", async () => {
    const loadPreview = vi.fn(async () => btoa("image"));
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: { ...attachment, previewUrl: undefined, loadPreview },
        }),
      ),
    );
    expect(loadPreview).not.toHaveBeenCalled();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open diagram.png full screen"]')!
        .click();
    });
    expect(loadPreview).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe(
      `data:image/png;base64,${btoa("image")}`,
    );

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a retryable error when a remote preview fails", async () => {
    const loadPreview = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(btoa("image"));
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: { ...attachment, previewUrl: undefined, loadPreview },
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open diagram.png full screen"]',
    )!;
    await act(async () => trigger.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Try again");
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("opens the image full screen and closes it with Escape", () => {
    render();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open diagram.png full screen"]',
    )!;

    act(() => trigger.focus());
    act(() => trigger.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Image preview: diagram.png");
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe(attachment.previewUrl);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Image preview: diagram.png");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("loads persisted generated images and opens a lightbox", async () => {
    const image: GeneratedImageMeta = {
      path: "/app-data/generated-images/image.png",
      name: "generated-image",
      mimeType: "image/png",
      size: 8,
      alt: "A clean product photo",
    };
    vi.mocked(fs.readBinaryFile).mockResolvedValue(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // Generated images load once near the viewport; report this one as visible.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
        observe() {
          this.callback([{ isIntersecting: true }]);
        }
        disconnect() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await act(async () => {
      root.render(createElement(GeneratedImage, { image }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const preview = container.querySelector<HTMLImageElement>("img");
    expect(preview?.getAttribute("src")).toBe("blob:generated-image");
    expect(preview?.getAttribute("alt")).toBe("A clean product photo");

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open generated-image full screen"]',
    )!;
    act(() => trigger.click());
    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe(
      "blob:generated-image",
    );
  });

  it("removes an image without opening the preview", () => {
    const onRemove = vi.fn();
    render(onRemove);

    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove diagram.png"]')!.click(),
    );

    expect(onRemove).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows an error for an image the browser cannot decode and still closes", () => {
    render();
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());
    act(() => document.querySelector('[role="dialog"] img')!.dispatchEvent(new Event("error")));
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
      "Preview unavailable",
    );
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Close image preview"]')!.click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows its token label and inserts the token without opening the preview", () => {
    const onInsertToken = vi.fn();
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment,
          token: "[image2]",
          onInsertToken,
        }),
      ),
    );
    const label = container.querySelector<HTMLButtonElement>(
      '[aria-label="Insert [image2] into the message"]',
    )!;
    expect(label.textContent).toBe("image2");

    act(() => label.click());

    expect(onInsertToken).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows a plain label when the token cannot be inserted", () => {
    act(() => root.render(createElement(AttachmentChip, { attachment, token: "[image1]" })));
    expect(container.textContent).toContain("image1");
    expect(container.querySelector('[aria-label^="Insert "]')).toBeNull();
  });

  it("shows no label without a token", () => {
    render();
    expect(container.textContent).toBe("");
  });
});
