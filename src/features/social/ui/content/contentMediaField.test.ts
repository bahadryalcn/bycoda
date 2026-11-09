// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { SocialMediaEditor } from "../../model/socialMediaEditor";
import { ContentMediaField, type ContentMediaFieldProps } from "./ContentMediaField";
import type { ContentMedia } from "./contentDraft";
import { probeVideo } from "./mediaProbe";

vi.mock("./mediaProbe", () => ({ probeVideo: vi.fn() }));

let element: HTMLDivElement;
let root: Root;

const upload = vi.fn();
const uploadVideo = vi.fn();
const mediaClaim = vi.fn(async (..._args: unknown[]) => ({ revision: 2 }));
const mediaInspect = vi.fn(async (..._args: unknown[]) => ({ managed: true, revision: 2 }));
const onChange = vi.fn();

const client = { upload, uploadVideo, mediaClaim, mediaInspect } as unknown as SocialClient;

function render(patch: Partial<ContentMediaFieldProps> = {}) {
  act(() =>
    root.render(
      createElement(ContentMediaField, {
        client,
        editor: new SocialMediaEditor(client),
        media: [],
        disabled: false,
        onChange,
        ...patch,
      }),
    ),
  );
}

const text = () => element.textContent ?? "";
const fileInput = () => element.querySelector<HTMLInputElement>('input[type="file"]')!;

function choose(...files: File[]) {
  const input = fileInput();
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const png = (name = "a.png") => new File(["x"], name, { type: "image/png" });
const mp4 = (name = "clip.mp4") => new File(["xxxxxxxxxxxxxx"], name, { type: "video/mp4" });

function saved(localId: string, mediaId?: string): ContentMedia {
  return { localId, name: `${localId}.png`, media: { kind: "image", uploadId: localId }, mediaId };
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  upload.mockReset().mockImplementation(async () => ({ uploadId: "u1" }));
  uploadVideo.mockReset().mockImplementation(async () => ({ uploadId: "v1" }));
  mediaClaim.mockClear();
  mediaInspect.mockClear();
  onChange.mockReset();
  vi.mocked(probeVideo)
    .mockReset()
    .mockResolvedValue({ durationSeconds: 12, width: 1080, height: 1920 });
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

describe("attaching files", () => {
  it("uploads a PNG and adds it after the media already attached", async () => {
    render({ media: [saved("old")] });
    choose(png());
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as ContentMedia[];
    expect(next.map((item) => item.localId)).toEqual(["old", "u1"]);
    expect(next[1]).toMatchObject({ name: "a.png", media: { kind: "image", uploadId: "u1" } });
    expect(probeVideo).not.toHaveBeenCalled();
  });

  it("attaches several images in the order they were chosen, in one change", async () => {
    upload
      .mockImplementationOnce(async () => ({ uploadId: "u1" }))
      .mockImplementationOnce(async () => ({ uploadId: "u2" }));
    render();
    choose(png("a.png"), png("b.png"));
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]![0] as ContentMedia[]).map((item) => item.name)).toEqual([
      "a.png",
      "b.png",
    ]);
  });

  it("keeps the Host's managed media id and adopts the upload for this editor", async () => {
    upload.mockImplementation(async () => ({
      uploadId: "u1",
      managed: { mediaId: "m1", uploadClaimId: "claim", revision: 1 },
    }));
    render();
    choose(png());
    await flush();
    expect(mediaClaim).toHaveBeenCalledWith(
      "transfer",
      expect.objectContaining({ mediaId: "m1", expectedRevision: 1 }),
    );
    expect((onChange.mock.calls[0]![0] as ContentMedia[])[0]!.mediaId).toBe("m1");
  });

  it("uploads an MP4 as a video and records its length and size from the local file", async () => {
    render();
    choose(mp4());
    await flush();
    expect(uploadVideo).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    const [item] = onChange.mock.calls[0]![0] as ContentMedia[];
    expect(item).toMatchObject({
      media: { kind: "video", uploadId: "v1" },
      probe: { durationSeconds: 12, width: 1080, height: 1920 },
    });
  });

  it("still attaches a video whose length cannot be read, so the platform rules can name it", async () => {
    vi.mocked(probeVideo).mockRejectedValue(new Error("The video could not be read."));
    render();
    choose(mp4());
    await flush();
    const [item] = onChange.mock.calls[0]![0] as ContentMedia[];
    expect(item!.media.kind).toBe("video");
    expect(item!.probe).toBeUndefined();
  });
});

describe("files that cannot be attached", () => {
  it.each([
    ["a GIF", new File(["x"], "a.gif", { type: "image/gif" })],
    ["a PDF", new File(["x"], "a.pdf", { type: "application/pdf" })],
    ["a WebM video", new File(["x"], "a.webm", { type: "video/webm" })],
  ])("refuses %s before uploading anything", async (_name, file) => {
    render();
    choose(file);
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(text()).toContain("Use JPEG or PNG images, or one MP4 video.");
  });

  it("shows the upload error and attaches nothing", async () => {
    uploadVideo.mockImplementation(async () => {
      throw new Error("MP4/WebM videos can be at most 64 MiB.");
    });
    render();
    choose(mp4());
    await flush();
    expect(text()).toContain("MP4/WebM videos can be at most 64 MiB.");
    expect(onChange).not.toHaveBeenCalled();
    expect(fileInput().disabled).toBe(false);
  });

  it("clears the old error when the next attempt starts", async () => {
    upload.mockImplementationOnce(async () => {
      throw new Error("Upload failed.");
    });
    render();
    choose(png());
    await flush();
    expect(text()).toContain("Upload failed.");
    choose(png("b.png"));
    // The control stops reporting the error as soon as the next attempt starts.
    expect(fileInput().getAttribute("aria-invalid")).not.toBe("true");
    // The message row leaves with an exit animation, so its text is checked once that has finished.
    await vi.waitFor(() => expect(text()).not.toContain("Upload failed."), { timeout: 2000 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("refuses a mixed pick before uploading any of its files", async () => {
    render();
    choose(png(), new File(["x"], "a.gif", { type: "image/gif" }));
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(text()).toContain("Use JPEG or PNG images, or one MP4 video.");
  });

  it("blocks a second pick while an upload runs", async () => {
    let finish!: (value: { uploadId: string }) => void;
    upload.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    render();
    choose(png());
    await flush();
    expect(fileInput().disabled).toBe(true);
    expect(text()).toContain("Uploading…");
    finish({ uploadId: "u1" });
    await flush();
    expect(fileInput().disabled).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("removing media and disabled state", () => {
  it("removes the file from the post and releases its managed claim", async () => {
    const editor = { releaseCurrent: vi.fn(async () => undefined) } as unknown as SocialMediaEditor;
    render({ editor, media: [saved("a", "m1"), saved("b")] });
    act(() =>
      [...element.querySelectorAll("button")]
        .find((item) => item.textContent === "Remove a.png")!
        .click(),
    );
    expect((onChange.mock.calls[0]![0] as ContentMedia[]).map((item) => item.localId)).toEqual([
      "b",
    ]);
    expect(editor.releaseCurrent).toHaveBeenCalledWith("m1");
  });

  it("does not release anything for media that was not uploaded here", () => {
    const editor = { releaseCurrent: vi.fn(async () => undefined) } as unknown as SocialMediaEditor;
    render({ editor, media: [saved("b")] });
    act(() =>
      [...element.querySelectorAll("button")]
        .find((item) => item.textContent === "Remove b.png")!
        .click(),
    );
    expect(onChange).toHaveBeenCalledWith([]);
    expect(editor.releaseCurrent).not.toHaveBeenCalled();
  });

  it("removes the file even when the claim cannot be released right now", async () => {
    const editor = {
      releaseCurrent: vi.fn(async () => {
        throw new Error("Host offline");
      }),
    } as unknown as SocialMediaEditor;
    render({ editor, media: [saved("a", "m1")] });
    act(() =>
      [...element.querySelectorAll("button")]
        .find((item) => item.textContent === "Remove a.png")!
        .click(),
    );
    await flush();
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows why attaching is off and blocks picking and removing", () => {
    render({
      disabled: true,
      disabledReason: "Photos and video: Not available yet",
      media: [saved("a")],
    });
    expect(fileInput().disabled).toBe(true);
    expect(text()).toContain("Photos and video: Not available yet");
    const remove = [...element.querySelectorAll("button")].find(
      (item) => item.textContent === "Remove a.png",
    )!;
    expect(remove.disabled).toBe(true);
  });
});
