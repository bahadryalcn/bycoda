// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { copyMessage, copyText, messageFilesFromClipboard } from "./clipboard";
import { invoke } from "@tauri-apps/api/core";
import {
  MAX_EMBED_BYTES,
  MAX_ATTACHMENTS,
  attachmentsFromFiles,
  displayAttachments,
  persistableAttachment,
} from "../../features/sessions/model/attachments";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

it("copies lazy remote images and documents through their authorized readers", async () => {
  vi.mocked(invoke).mockClear();
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  const imageReader = vi.fn(async () => btoa("remote image"));
  const documentReader = vi.fn(async () => btoa("remote document"));
  await copyMessage("Remote files", [
    {
      id: "remote-image",
      name: "image.png",
      mimeType: "image/png",
      kind: "image",
      size: 12,
      path: "/remote/image.png",
      loadPreview: imageReader,
    },
    {
      id: "remote-file",
      name: "report.pdf",
      mimeType: "application/pdf",
      kind: "file",
      size: 15,
      path: "/remote/report.pdf",
      loadPreview: documentReader,
    },
  ]);
  expect(imageReader).toHaveBeenCalledOnce();
  expect(documentReader).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
  const html = await (await write.mock.calls[0][0][0].getType("text/html")).text();
  const pasted = messageFilesFromClipboard({ getData: () => html });
  expect(await Promise.all(pasted!.map((file) => file.text()))).toEqual([
    "remote image",
    "remote document",
  ]);
});

it.each(["image", "file"] as const)(
  "preserves the clipboard and exposes a failed lazy %s read without a local fallback",
  async (kind) => {
    await navigator.clipboard.writeText("Previous clipboard");
    vi.mocked(invoke).mockClear();
    const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
    const reader = vi.fn(async () => {
      throw new Error("Remote owner disconnected");
    });
    await expect(
      copyMessage("New content", [
        {
          id: "remote",
          name: "remote.bin",
          mimeType: "application/octet-stream",
          kind,
          size: 3,
          path: "/remote/file",
          loadPreview: reader,
        },
      ]),
    ).rejects.toThrow("Could not copy remote.bin: Remote owner disconnected");
    expect(reader).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(await navigator.clipboard.readText()).toBe("Previous clipboard");
  },
);

function zeroFile(size: number, id: string) {
  const padding = (3 - (size % 3)) % 3;
  return {
    id,
    name: `${id}.bin`,
    mimeType: "application/octet-stream",
    kind: "file" as const,
    size,
    data: "A".repeat(Math.ceil(size / 3) * 4 - padding) + "=".repeat(padding),
  };
}

it("rejects valid individual files above the combined 20 MiB budget before replacing the clipboard", async () => {
  await navigator.clipboard.writeText("Previous clipboard");
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  await expect(
    copyMessage("Large pair", [
      zeroFile(MAX_EMBED_BYTES / 2 + 1, "first"),
      zeroFile(MAX_EMBED_BYTES / 2 + 1, "second"),
    ]),
  ).rejects.toThrow("combined 20 MB clipboard limit");
  expect(write).not.toHaveBeenCalled();
  expect(await navigator.clipboard.readText()).toBe("Previous clipboard");
});

it("round trips multiple files exactly at the combined 20 MiB budget", async () => {
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  await copyMessage("Boundary", [
    zeroFile(MAX_EMBED_BYTES / 2, "first"),
    zeroFile(MAX_EMBED_BYTES / 2, "second"),
  ]);
  const html = await (await write.mock.calls[0][0][0].getType("text/html")).text();
  const pasted = messageFilesFromClipboard({ getData: () => html });
  expect(pasted?.map((file) => file.size)).toEqual([MAX_EMBED_BYTES / 2, MAX_EMBED_BYTES / 2]);
});

it("rejects too many copied files before touching the clipboard", async () => {
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  await expect(
    copyMessage(
      "Files",
      Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => zeroFile(0, `${i}`)),
    ),
  ).rejects.toThrow(`up to ${MAX_ATTACHMENTS} files`);
  expect(write).not.toHaveBeenCalled();
});

it("uses the native text clipboard if WebView permissions reject a long copy", async () => {
  const text = "bycoda — ortak üretim\n".repeat(1000);
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("NotAllowedError"));
  vi.mocked(invoke).mockResolvedValue(undefined);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  try {
    await copyText(text);
    expect(invoke).toHaveBeenCalledWith("copy_text_to_clipboard", { text });
    expect(document.querySelector("textarea")).toBeNull();
  } finally {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
});

it("cleans up failed legacy copying and preserves focus and text selection", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  const original = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(document, "execCommand", {
    value: () => {
      throw new Error("denied");
    },
    configurable: true,
  });
  const input = document.createElement("input");
  const text = document.createElement("pre");
  text.textContent = "selected markdown";
  document.body.append(input, text);
  input.focus();
  const range = document.createRange();
  range.selectNodeContents(text);
  window.getSelection()!.addRange(range);
  try {
    await expect(copyText("full document")).rejects.toThrow("denied");
    expect(document.activeElement).toBe(input);
    expect(window.getSelection()!.toString()).toBe("selected markdown");
    expect(document.querySelector("textarea")).toBeNull();
  } finally {
    input.remove();
    text.remove();
    window.getSelection()!.removeAllRanges();
    if (original) Object.defineProperty(document, "execCommand", original);
    else delete (document as unknown as Record<string, unknown>).execCommand;
  }
});

it("copies fresh disk images but leaves their restored placeholders alone", async () => {
  vi.mocked(invoke).mockResolvedValue(btoa("<svg></svg>"));
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  const files = displayAttachments([
    {
      id: "svg",
      name: "diagram.svg",
      mimeType: "image/svg+xml",
      kind: "image",
      size: 11,
      path: "/diagram.svg",
    },
  ]);
  await copyMessage("Diagram", files);
  expect(write).toHaveBeenCalledOnce();
  const html = await (await write.mock.calls[0][0][0].getType("text/html")).text();
  const pasted = messageFilesFromClipboard({ getData: () => html });
  expect(await pasted![0].text()).toBe("<svg></svg>");
  write.mockClear();
  vi.mocked(invoke).mockClear();
  await copyMessage("Diagram", files.map(persistableAttachment));
  expect(write).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  expect(await navigator.clipboard.readText()).toBe("Diagram");
});

it("copies a message with multiple attachments and preserves names and bytes on paste", async () => {
  let written: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    written = items;
  });
  await copyMessage("Look at these", [
    {
      id: "1",
      name: "screen.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      data: "YWJj",
    },
    {
      id: "2",
      name: "report.pdf",
      mimeType: "application/pdf",
      kind: "file",
      size: 3,
      data: "ZGVm",
    },
  ]);
  expect(await (await written[0].getType("text/plain")).text()).toBe("Look at these");
  const html = await (await written[0].getType("text/html")).text();
  const files = messageFilesFromClipboard({
    getData: (type) => (type === "text/html" ? html : ""),
  });
  expect(files?.map((file) => file.name)).toEqual(["screen.png", "report.pdf"]);
  expect(await files![0].text()).toBe("abc");
  expect(await files![1].text()).toBe("def");
  expect(
    Array.from(new Uint8Array(await (await written[0].getType("image/png")).arrayBuffer())),
  ).toEqual([97, 98, 99]);
});

it("rejects clipboard files whose decoded bytes exceed the attachment limit", () => {
  const base64Length = Math.ceil((MAX_EMBED_BYTES + 1) / 3) * 4;
  const payload = encodeURIComponent(
    JSON.stringify([
      {
        name: "oversized.bin",
        mimeType: "application/octet-stream",
        data: "A".repeat(base64Length),
      },
    ]),
  );
  const html = `<div data-bycoda-files="${payload}"></div>`;

  expect(
    messageFilesFromClipboard({
      getData: (type) => (type === "text/html" ? html : ""),
    }),
  ).toBeNull();
});

it("skips restored images without live content while keeping the text", async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { path: string }).path === "/old.png") return "YWJj";
    throw new Error("File no longer exists");
  });
  await copyMessage("Old message", [
    {
      id: "1",
      name: "old.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      path: "/old.png",
    },
  ]);
  expect(await navigator.clipboard.readText()).toBe("Old message");
  expect(invoke).not.toHaveBeenCalledWith("read_file_base64", {
    path: "/old.png",
  });
});

it("keeps the existing clipboard when a message has no copyable content", async () => {
  await navigator.clipboard.writeText("Previous clipboard");

  await expect(
    copyMessage("", [
      {
        id: "restored",
        name: "old.png",
        mimeType: "image/png",
        kind: "image",
        size: 3,
        path: "/old.png",
      },
    ]),
  ).rejects.toThrow("No copyable content");

  expect(await navigator.clipboard.readText()).toBe("Previous clipboard");
});

it("copies a folder path, including when the message is only that folder", async () => {
  const folder = {
    id: "dir",
    name: "reports",
    mimeType: "inode/directory",
    kind: "file" as const,
    size: 0,
    path: "/home/dev/reports",
  };
  await copyMessage("", [folder]);
  expect(await navigator.clipboard.readText()).toBe("/home/dev/reports");

  await copyMessage("See the reports", [folder]);
  expect(await navigator.clipboard.readText()).toBe("See the reports\n/home/dev/reports");

  let written: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    written = items;
  });
  await copyMessage("See the reports", [
    folder,
    {
      id: "1",
      name: "shot.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      data: "YWJj",
    },
  ]);
  expect(await (await written[0].getType("text/plain")).text()).toBe(
    "See the reports\n/home/dev/reports",
  );
});

it("copies available disk attachments including empty files", async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) =>
    (args as { path: string }).path === "/empty.txt" ? "" : "cGRm",
  );
  let written: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    written = items;
  });
  await copyMessage("Files", [
    {
      id: "1",
      name: "doc.pdf",
      mimeType: "application/pdf",
      kind: "file",
      size: 3,
      path: "/doc.pdf",
    },
    {
      id: "2",
      name: "empty.txt",
      mimeType: "text/plain",
      kind: "file",
      size: 0,
      path: "/empty.txt",
    },
  ]);
  const html = await (await written[0].getType("text/html")).text();
  const files = messageFilesFromClipboard({ getData: () => html });
  expect(files?.map((file) => file.name)).toEqual(["doc.pdf", "empty.txt"]);
  expect(await files![0].text()).toBe("pdf");
  expect(files![1].size).toBe(0);
  vi.mocked(invoke).mockResolvedValue("/pasted.txt");
  const pasted = await attachmentsFromFiles(files!);
  expect(pasted.map((file) => file.name)).toEqual(["doc.pdf", "empty.txt"]);
});

it.each(["File is too large to attach inline (maximum 20 MB).", "File no longer exists"])(
  "does not replace the clipboard with a partial message when a file cannot be read: %s",
  async (reason) => {
    vi.mocked(invoke).mockRejectedValue(new Error(reason));
    await navigator.clipboard.writeText("Previous clipboard");
    await expect(
      copyMessage("New message", [
        {
          id: "pdf",
          name: "report.pdf",
          mimeType: "application/pdf",
          kind: "file",
          size: 21 * 1024 * 1024,
          path: "/report.pdf",
        },
      ]),
    ).rejects.toThrow("report.pdf");
    expect(await navigator.clipboard.readText()).toBe("Previous clipboard");
  },
);
