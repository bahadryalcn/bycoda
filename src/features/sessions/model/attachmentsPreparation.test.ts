// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  displayAttachments,
  MAX_EMBED_BYTES,
  MAX_TOTAL_EMBED_BYTES,
  mergeAttachments,
  persistableAttachment,
  prepareAttachments,
} from "./attachments";
import type { Attachment } from "./session";

beforeEach(() => {
  invoke.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("file attachment preparation", () => {
  it("preserves a pasted image on disk before transient preview bytes are discarded", async () => {
    invoke.mockResolvedValue("/owned/pasted.png");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pasted-image");
    const [image] = await attachmentsFromFiles([
      new File(["image"], "pasted.png", { type: "image/png" }),
    ]);
    expect(invoke).toHaveBeenCalledWith("write_attachment", {
      name: "pasted.png",
      data: "aW1hZ2U=",
    });
    expect(image).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      path: "/owned/pasted.png",
      data: "aW1hZ2U=",
      previewUrl: "blob:pasted-image",
    });
    const restored = JSON.parse(
      JSON.stringify(persistableAttachment(displayAttachments([image])[0])),
    );
    expect(restored).toMatchObject({ id: image.id, name: "pasted.png", path: "/owned/pasted.png" });
    expect(restored).not.toHaveProperty("data");
    expect(restored).not.toHaveProperty("previewUrl");
    expect(await prepareAttachments([image])).toEqual([image]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects failed image persistence, releases its preview and permits retry", async () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:failed-image")
      .mockReturnValueOnce("blob:retried-image");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const image = new File(["image"], "pasted.png", { type: "image/png" });
    invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(attachmentsFromFiles([image])).rejects.toThrow("disk full");
    expect(revoke).toHaveBeenCalledWith("blob:failed-image");
    invoke.mockResolvedValueOnce("/owned/retried.png");
    expect(await attachmentsFromFiles([image])).toMatchObject([
      { path: "/owned/retried.png", data: "aW1hZ2U=", previewUrl: "blob:retried-image" },
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).not.toHaveBeenCalledWith("blob:retried-image");
  });

  it("rejects a storage reply with no path instead of accepting an unrecoverable image", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:unsaved-image");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    invoke.mockResolvedValueOnce("");
    await expect(
      attachmentsFromFiles([new File(["image"], "pasted.png", { type: "image/png" })]),
    ).rejects.toThrow("Attachment storage returned no file path");
    expect(revoke).toHaveBeenCalledWith("blob:unsaved-image");
  });

  it.each([
    ["recording.wav", "audio/wav"],
    ["report.txt", "text/plain"],
  ])("reports a failed paste write for %s and permits retry", async (name, type) => {
    invoke.mockRejectedValueOnce(new Error("disk full"));
    const file = new File(["contents"], name, { type });
    await expect(attachmentsFromFiles([file])).rejects.toThrow(
      `Could not attach ${name}: disk full`,
    );
    invoke.mockResolvedValueOnce(`/tmp/${name}`);
    expect(await attachmentsFromFiles([file])).toMatchObject([{ name, path: `/tmp/${name}` }]);
  });
  it.each([
    ["report.pdf", "application/pdf"],
    ["transcript.md", "text/markdown"],
    ["server.log", "text/plain"],
  ])("persists a pasted %s before handing it to the harness", async (name, mimeType) => {
    const path = `/tmp/bycoda-attachments/${name}`;
    invoke.mockResolvedValue(path);
    const files = await attachmentsFromFiles([new File(["contents"], name, { type: mimeType })]);
    expect(invoke).toHaveBeenCalledWith("write_attachment", {
      name,
      data: "Y29udGVudHM=",
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name, mimeType, kind: "file", path });
    expect(files[0].data).toBeUndefined();
    expect(await prepareAttachments(files)).toEqual(files);
    expect(persistableAttachment(files[0]).path).toBe(path);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps large disk documents as paths without reading them into the prompt", async () => {
    invoke.mockResolvedValue([
      {
        path: "/tmp/large.md",
        name: "large.md",
        size: MAX_EMBED_BYTES + 1,
        isDir: false,
      },
    ]);
    const files = await prepareAttachments(await attachmentsFromPaths(["/tmp/large.md"]));
    expect(files[0]).toMatchObject({
      path: "/tmp/large.md",
      mimeType: "text/markdown",
    });
    expect(files[0].data).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("retains the image path when byte loading fails", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "inspect_paths")
        return [
          {
            path: "/tmp/image.png",
            name: "image.png",
            size: 100,
            isDir: false,
          },
        ];
      throw new Error("read failed");
    });
    const files = await prepareAttachments(await attachmentsFromPaths(["/tmp/image.png"]));
    expect(files[0]).toMatchObject({
      path: "/tmp/image.png",
      mimeType: "image/png",
    });
    expect(files[0].data).toBeUndefined();
  });

  it("keeps the order the files were attached in, which numbers their tokens", async () => {
    invoke.mockImplementation(async (command: string, args?: { path?: string }) => {
      // The first read finishes last, so a prepare that raced would reorder.
      if (command === "read_file_base64") {
        await new Promise((resolve) => setTimeout(resolve, args?.path === "/tmp/a.png" ? 20 : 0));
        return "YWJj";
      }
      return [];
    });
    const names = ["a.png", "b.png", "c.png"];
    const prepared = await prepareAttachments(
      names.map((name) => ({
        id: name,
        name,
        mimeType: "image/png",
        kind: "image" as const,
        size: 3,
        path: `/tmp/${name}`,
      })),
    );
    expect(prepared.map((file) => file.name)).toEqual(names);
    expect(prepared.every((file) => file.data === "YWJj")).toBe(true);
  });

  describe("pasted or dropped blobs over the embed limit", () => {
    function oversized(name: string, type: string) {
      const file = new File(["x"], name, { type });
      Object.defineProperty(file, "size", { value: MAX_EMBED_BYTES + 1 });
      return file;
    }

    it("names the oversized blob, writes nothing for it and still attaches its valid sibling", async () => {
      const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sibling");
      invoke.mockResolvedValue("/owned/small.png");
      const onSkipped = vi.fn();
      const files = await attachmentsFromFiles(
        [
          oversized("huge.png", "image/png"),
          new File(["image"], "small.png", { type: "image/png" }),
        ],
        { onSkipped },
      );
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ name: "small.png", path: "/owned/small.png" });
      expect(onSkipped).toHaveBeenCalledTimes(1);
      expect(onSkipped).toHaveBeenCalledWith([{ name: "huge.png", reason: "too-large" }]);
      // No bytes or preview URL are ever made for the file that cannot be attached.
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("reports a blob the webview cannot read as unreadable, not as too large", async () => {
      vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
        queueMicrotask(() => this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>));
      });
      const onSkipped = vi.fn();
      expect(
        await attachmentsFromFiles([new File(["x"], "broken.txt", { type: "text/plain" })], {
          onSkipped,
        }),
      ).toEqual([]);
      expect(onSkipped).toHaveBeenCalledWith([{ name: "broken.txt", reason: "unreadable" }]);
      expect(invoke).not.toHaveBeenCalled();
    });

    it("names an unnamed oversized blob by its fallback name and ignores OS junk files", async () => {
      const onSkipped = vi.fn();
      await attachmentsFromFiles(
        [oversized("", "image/png"), oversized(".DS_Store", "application/octet-stream")],
        { onSkipped },
      );
      expect(onSkipped).toHaveBeenCalledWith([{ name: "image.png", reason: "too-large" }]);
    });

    it("never calls onSkipped when everything attaches, and keeps large disk paths as paths", async () => {
      invoke.mockResolvedValue([
        { path: "/tmp/large.pdf", name: "large.pdf", size: MAX_EMBED_BYTES * 5, isDir: false },
      ]);
      const onSkipped = vi.fn();
      const files = await attachmentsFromFiles(
        [Object.assign(new File(["x"], "large.pdf"), { path: "/tmp/large.pdf" })],
        { onSkipped },
      );
      expect(files).toMatchObject([{ path: "/tmp/large.pdf", size: MAX_EMBED_BYTES * 5 }]);
      expect(onSkipped).not.toHaveBeenCalled();
    });
  });
});

describe("aggregate inline image budget", () => {
  const FILE_BYTES = MAX_EMBED_BYTES; // each image is at the per-file limit
  const fitting = Math.floor(MAX_TOTAL_EMBED_BYTES / FILE_BYTES);

  function image(name: string, extra: Partial<Attachment> = {}): Attachment {
    return {
      id: name,
      name,
      mimeType: "image/png",
      kind: "image",
      size: FILE_BYTES,
      path: `/tmp/${name}`,
      ...extra,
    };
  }

  it("reads a selection's images in order only until the total budget is spent", async () => {
    const names = ["a.png", "b.png", "c.png", "d.png"];
    invoke.mockImplementation(async (command: string) => {
      if (command === "inspect_paths")
        return names.map((name) => ({
          path: `/tmp/${name}`,
          name,
          size: FILE_BYTES,
          isDir: false,
        }));
      return "YWJj";
    });
    const files = await attachmentsFromPaths(names.map((name) => `/tmp/${name}`));
    expect(files.map((file) => file.name)).toEqual(names);
    expect(invoke.mock.calls.filter(([command]) => command === "read_file_base64")).toHaveLength(
      fitting,
    );
    expect(files.map((file) => file.data !== undefined)).toEqual(
      names.map((_, index) => index < fitting),
    );
    // The over-budget files are still attached as paths the harness can read.
    expect(files.slice(fitting).every((file) => file.path?.startsWith("/tmp/"))).toBe(true);
  });

  it("prepares a send within the budget, keeps order and bounds concurrent reads", async () => {
    let active = 0;
    let peak = 0;
    invoke.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return "YWJj";
    });
    const names = ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"];
    const prepared = await prepareAttachments(names.map((name) => image(name)));
    expect(prepared.map((file) => file.name)).toEqual(names);
    expect(prepared.filter((file) => file.data)).toHaveLength(fitting);
    expect(prepared.slice(0, fitting).every((file) => file.data === "YWJj")).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(fitting);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("counts bytes a draft already holds when preparing a send", async () => {
    invoke.mockResolvedValue("YWJj");
    const held = image("held.png", { data: "QUJD" });
    const prepared = await prepareAttachments([held, image("next.png"), image("last.png")]);
    expect(invoke).toHaveBeenCalledTimes(fitting - 1);
    expect(prepared[0]).toBe(held);
  });

  it("merges past the draft budget as path references without losing the attachment", () => {
    const existing = Array.from({ length: fitting }, (_, index) =>
      image(`held${index}.png`, { data: "QUJD" }),
    );
    const incoming = image("late.png", { data: "QUJD", previewUrl: "blob:late" });
    const merged = mergeAttachments(existing, [incoming]);
    expect(merged).toHaveLength(fitting + 1);
    expect(merged.slice(0, fitting)).toEqual(existing);
    expect(merged[fitting]).toMatchObject({
      id: "late.png",
      path: "/tmp/late.png",
      previewUrl: "blob:late",
    });
    expect(merged[fitting]).not.toHaveProperty("data");
    // The caller's attachment is not mutated.
    expect(incoming.data).toBe("QUJD");
  });

  it("keeps a file with bytes and no path inline, since it has nothing to fall back to", () => {
    const existing = Array.from({ length: fitting }, (_, index) =>
      image(`held${index}.png`, { data: "QUJD" }),
    );
    const bytesOnly = image("only.png", { data: "QUJD", path: undefined });
    expect(mergeAttachments(existing, [bytesOnly])[fitting]).toBe(bytesOnly);
  });

  it("saves an over-budget pasted blob but embeds no bytes for it", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pasted");
    invoke.mockImplementation(async (_command: string, args: { name: string }) => `/owned/${args.name}`);
    const blobs = Array.from({ length: fitting + 1 }, (_, index) => {
      const file = new File(["x"], `shot${index}.png`, { type: "image/png" });
      Object.defineProperty(file, "size", { value: FILE_BYTES });
      return file;
    });
    const files = await attachmentsFromFiles(blobs);
    expect(files).toHaveLength(fitting + 1);
    expect(files.slice(0, fitting).every((file) => file.data !== undefined)).toBe(true);
    expect(files[fitting]).toMatchObject({ path: `/owned/shot${fitting}.png`, previewUrl: "blob:pasted" });
    expect(files[fitting].data).toBeUndefined();
  });
});
