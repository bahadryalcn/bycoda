// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  displayAttachments,
  MAX_EMBED_BYTES,
  persistableAttachment,
  prepareAttachments,
} from "./attachments";

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
});
