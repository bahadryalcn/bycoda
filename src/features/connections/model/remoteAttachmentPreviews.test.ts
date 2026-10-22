import { expect, it, vi } from "vitest";
import {
  bindRemoteAttachmentReaders,
  PREVIEW_BUDGET_BYTES,
  withRemoteAttachmentPreviews,
} from "./remoteAttachmentPreviews";
import type { HostSession } from "./protocol";

const snapshot = (): HostSession => ({
  projectId: "project",
  revision: 1,
  updatedAt: 0,
  status: "idle",
  session: {
    id: "session",
    cwd: "/repo",
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    title: "Image",
    blocks: [
      {
        id: "turn",
        role: "user",
        text: "Look",
        attachments: [
          {
            id: "image",
            name: "shot.png",
            mimeType: "image/png",
            kind: "image",
            size: 5,
            path: "/host/image",
          },
        ],
      },
    ],
  },
});

it.each(["report.pdf", "report.xlsx", "report.csv", "demo.mp4"])(
  "binds %s before first display without downloading it",
  async (name) => {
    const value = snapshot();
    value.session.blocks[0].attachments![0] = {
      id: "document",
      name,
      kind: "file",
      mimeType: "application/octet-stream",
      size: 5,
      path: "/host/private/opaque-id",
    };
    const read = vi.fn(async () => ({ offset: 5, size: 5, data: btoa("owner") }));
    const bound = bindRemoteAttachmentReaders(`first-${name}`, value, read);
    const attachment = bound.session.blocks[0].attachments![0];
    expect(attachment.loadPreview).toBeTypeOf("function");
    expect(attachment.path).toBe("/host/private/opaque-id");
    expect(read).not.toHaveBeenCalled();
    expect(bindRemoteAttachmentReaders(`first-${name}`, bound, read)).toBe(bound);
    const ready = await withRemoteAttachmentPreviews(`first-${name}`, bound, undefined, read);
    expect(read).not.toHaveBeenCalled();
    expect(await ready.session.blocks[0].attachments![0].loadPreview!()).toBe(btoa("owner"));
    expect(read).toHaveBeenCalledWith({ sessionId: "session", id: "document", offset: 0 });
  },
);

it("rejects oversized document metadata without invoking the host reader", async () => {
  const value = snapshot();
  value.session.blocks[0].attachments![0] = {
    id: "too-large",
    name: "report.pdf",
    kind: "file",
    mimeType: "application/pdf",
    size: 25 * 1024 * 1024 + 1,
    path: "/host/large.pdf",
  };
  const read = vi.fn();
  const bound = bindRemoteAttachmentReaders("large-document", value, read);
  await expect(bound.session.blocks[0].attachments![0].loadPreview!()).rejects.toThrow(
    "maximum 25 MB",
  );
  expect(read).not.toHaveBeenCalled();
});

it("rejects a chunk larger than its declared bytes before base64 decoding", async () => {
  const value = snapshot();
  value.session.blocks[0].attachments![0] = {
    id: "bad-chunk",
    name: "report.pdf",
    kind: "file",
    mimeType: "application/pdf",
    size: 5,
    path: "/host/report.pdf",
  };
  const read = vi.fn(async () => ({ offset: 5, size: 5, data: "a".repeat(200) }));
  const bound = bindRemoteAttachmentReaders("bad-document", value, read);
  const decode = vi.spyOn(globalThis, "atob");
  try {
    await expect(bound.session.blocks[0].attachments![0].loadPreview!()).rejects.toThrow(
      "Invalid image transfer",
    );
    expect(decode).not.toHaveBeenCalled();
  } finally {
    decode.mockRestore();
  }
});

it("keeps simultaneous same-named documents isolated by owning machine", async () => {
  const value = snapshot();
  value.session.blocks[0].attachments![0] = {
    id: "same-file",
    name: "report.pdf",
    kind: "file",
    mimeType: "application/pdf",
    size: 5,
    path: "/same/report.pdf",
  };
  const macRead = vi.fn(async () => ({ offset: 5, size: 5, data: btoa("mac!!") }));
  const linuxRead = vi.fn(async () => ({ offset: 5, size: 5, data: btoa("linux") }));
  const mac = bindRemoteAttachmentReaders("document-mac", value, macRead);
  const linux = bindRemoteAttachmentReaders("document-linux", value, linuxRead);
  const results = await Promise.all([
    mac.session.blocks[0].attachments![0].loadPreview!(),
    linux.session.blocks[0].attachments![0].loadPreview!(),
  ]);
  expect(results).toEqual([btoa("mac!!"), btoa("linux")]);
  expect(macRead).toHaveBeenCalledOnce();
  expect(linuxRead).toHaveBeenCalledOnce();
});

it("downloads generated images through the session chunk reader and reuses them", async () => {
  const value = snapshot();
  value.session.blocks = [
    {
      id: "generated",
      role: "image",
      text: "",
      image: {
        path: "/host/attachments/uuid",
        name: "result.png",
        mimeType: "image/png",
        size: 3,
      },
    },
  ];
  const read = vi.fn(async () => ({ offset: 3, size: 3, data: btoa("png") }));
  const first = await withRemoteAttachmentPreviews("generated-machine", value, undefined, read);
  expect(read).toHaveBeenCalledWith({
    sessionId: "session",
    id: "generated",
    offset: 0,
  });
  expect(first.session.blocks[0].image?.data).toBe(btoa("png"));
  const next = await withRemoteAttachmentPreviews("generated-machine", value, first, read);
  expect(next.session.blocks[0].image?.data).toBe(btoa("png"));
  expect(read).toHaveBeenCalledTimes(1);
});

it("reopens image previews from chunks and reuses bytes on subsequent syncs", async () => {
  const read = vi.fn(async ({ offset }: { offset: number }) =>
    offset === 0
      ? { offset: 3, size: 5, data: btoa("abc") }
      : { offset: 5, size: 5, data: btoa("de") },
  );
  const first = await withRemoteAttachmentPreviews("machine", snapshot(), undefined, read);
  expect(first.session.blocks[0].attachments?.[0].data).toBe(btoa("abcde"));
  expect(read).toHaveBeenCalledTimes(2);
  const next = await withRemoteAttachmentPreviews("machine", snapshot(), first, read);
  expect(next.session.blocks[0].attachments?.[0].data).toBe(btoa("abcde"));
  expect(read).toHaveBeenCalledTimes(2);
});

it("keeps the transcript available when an image is missing", async () => {
  const value = snapshot();
  const read = vi.fn(async () => {
    throw new Error("Image no longer available");
  });
  const result = await withRemoteAttachmentPreviews("machine", value, undefined, read);
  expect(result.session.blocks[0].text).toBe(value.session.blocks[0].text);
  expect(result.session.blocks[0].attachments?.[0].loadPreview).toBeTypeOf("function");
});

it("backs off a missing image across unchanged syncs", async () => {
  vi.useFakeTimers();
  try {
    const read = vi.fn(async () => {
      throw new Error("missing");
    });
    let known: HostSession | undefined;
    for (let i = 0; i < 5; i++)
      known = await withRemoteAttachmentPreviews("backoff-machine", snapshot(), known, read);
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await withRemoteAttachmentPreviews("backoff-machine", snapshot(), known, read);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("preserves the entire snapshot identity on unchanged successful previews", async () => {
  const read = vi.fn(async () => ({ offset: 5, size: 5, data: btoa("abcde") }));
  const ready = await withRemoteAttachmentPreviews("identity-machine", snapshot(), undefined, read);
  const again = await withRemoteAttachmentPreviews("identity-machine", ready, ready, read);
  expect(again).toBe(ready);
  expect(again.session.blocks[0]).toBe(ready.session.blocks[0]);
  expect(read).toHaveBeenCalledTimes(1);
});

it("keeps unchanged failed previews stable until their retry becomes due", async () => {
  vi.useFakeTimers();
  try {
    const read = vi.fn(async () => {
      throw new Error("missing");
    });
    const failed = await withRemoteAttachmentPreviews(
      "retry-stable-machine",
      snapshot(),
      undefined,
      read,
    );
    expect(await withRemoteAttachmentPreviews("retry-stable-machine", failed, failed, read)).toBe(
      failed,
    );
    vi.advanceTimersByTime(30_001);
    await withRemoteAttachmentPreviews("retry-stable-machine", failed, failed, read);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("limits concurrent reads and favors recent previews within the byte budget", async () => {
  const value = snapshot();
  const template = value.session.blocks[0].attachments![0];
  value.session.blocks[0].attachments = Array.from({ length: 6 }, (_, i) => ({
    ...template,
    id: `image${i}`,
  }));
  let active = 0;
  let peak = 0;
  const read = vi.fn(async () => {
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    active--;
    return { offset: 5, size: 5, data: btoa("abcde") };
  });
  await withRemoteAttachmentPreviews("bounded-machine", value, undefined, read);
  expect(peak).toBe(2);
  const oldData = "already downloaded";
  value.session.blocks[0].attachments = Array.from({ length: 3 }, (_, i) => ({
    ...template,
    id: `large${i}`,
    size: PREVIEW_BUDGET_BYTES / 2,
    data: oldData,
  }));
  const bounded = await withRemoteAttachmentPreviews("bounded-machine", value, undefined, read);
  expect(bounded.session.blocks[0].attachments!.map((file) => file.data)).toEqual([
    undefined,
    oldData,
    oldData,
  ]);
});
