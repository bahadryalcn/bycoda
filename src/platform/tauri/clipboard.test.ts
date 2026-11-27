// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  clipboardTextWithAttachments,
  copyMessage,
  copyText,
  messageFilesFromClipboard,
  messageFromClipboard,
  readClipboardImage,
} from "./clipboard";
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

function requireCompleteClipboardWrite() {
  const write = navigator.clipboard.write.bind(navigator.clipboard);
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    // Happy DOM normally stores the items before resolving their representations.
    await Promise.all(items.flatMap((item) => item.types.map((type) => item.getType(type))));
    await write(items);
  });
}

it("reads an empty clipboard as no image rather than as a failure", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("The clipboard does not contain an image.");
  await expect(readClipboardImage()).resolves.toBeNull();
  vi.mocked(invoke).mockResolvedValueOnce(new ArrayBuffer(0));
  await expect(readClipboardImage()).resolves.toBeNull();
});

it("reports a real clipboard read failure instead of treating it as empty", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("Pasteboard is locked");
  await expect(readClipboardImage()).rejects.toThrow("Pasteboard is locked");
});

it("returns clipboard bytes as a PNG file", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(new Uint8Array([137, 80, 78, 71]).buffer);
  const file = await readClipboardImage();
  expect(file?.name).toBe("clipboard-image.png");
  expect(file?.type).toBe("image/png");
  expect(file?.size).toBe(4);
});

it("copies lazy remote images and documents through their authorized readers", async () => {
  vi.mocked(invoke).mockClear();
  let userGesture = true;
  const write = vi.spyOn(navigator.clipboard, "write").mockImplementation(async ([item]) => {
    if (!userGesture) throw new DOMException("Clipboard write denied", "NotAllowedError");
    await Promise.all(item.types.map((type) => item.getType(type)));
  });
  const imageReader = vi.fn(async () => {
    userGesture = false;
    return btoa("remote image");
  });
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
  const item = write.mock.calls[0][0][0];
  expect(await (await item.getType("text/plain")).text()).toBe("Remote files");
  expect(item.types).toEqual(["text/plain", "text/html"]);
  const html = await (await item.getType("text/html")).text();
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
    requireCompleteClipboardWrite();
    vi.mocked(invoke).mockClear();
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
  requireCompleteClipboardWrite();
  await expect(
    copyMessage("Large pair", [
      zeroFile(MAX_EMBED_BYTES / 2 + 1, "first"),
      zeroFile(MAX_EMBED_BYTES / 2 + 1, "second"),
    ]),
  ).rejects.toThrow("combined 20 MB clipboard limit");
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
  // Encodes 20 MiB of file data; allow headroom when the full suite runs in parallel.
}, 20_000);

it("rejects too many copied files without replacing the clipboard", async () => {
  await navigator.clipboard.writeText("Previous clipboard");
  requireCompleteClipboardWrite();
  await expect(
    copyMessage(
      "Files",
      Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => zeroFile(0, `${i}`)),
    ),
  ).rejects.toThrow(`up to ${MAX_ATTACHMENTS} files`);
  expect(await navigator.clipboard.readText()).toBe("Previous clipboard");
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

it("falls back to the native clipboard when the WebView write never settles", async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator.clipboard, "writeText").mockReturnValue(new Promise<void>(() => {}));
  vi.mocked(invoke).mockResolvedValue(undefined);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  try {
    const copied = copyText("stuck");
    await vi.advanceTimersByTimeAsync(1500);
    await copied;
    expect(invoke).toHaveBeenCalledWith("copy_text_to_clipboard", { text: "stuck" });
  } finally {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.useRealTimers();
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

it("copies fresh and restored disk images", async () => {
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
  expect(invoke).toHaveBeenCalledWith("read_file_base64", { path: "/diagram.svg" });
  expect(write).toHaveBeenCalledOnce();
  const restoredHtml = await (await write.mock.calls[0][0][0].getType("text/html")).text();
  expect(await messageFilesFromClipboard({ getData: () => restoredHtml })![0].text()).toBe(
    "<svg></svg>",
  );
});

it("copies multiple attachments and restores their positions and numbers in the receiving draft", async () => {
  let written: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    written = items;
  });
  await copyMessage("[Image 1 · 3 B] Look at these [File 1 · 3 B]", [
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
  const text = await (await written[0].getType("text/plain")).text();
  expect(text).toBe("Look at these");
  const html = await (await written[0].getType("text/html")).text();
  const files = messageFilesFromClipboard({
    getData: (type) => (type === "text/html" ? html : ""),
  });
  expect(files?.map((file) => file.name)).toEqual(["screen.png", "report.pdf"]);
  expect(await files![0].text()).toBe("abc");
  expect(await files![1].text()).toBe("def");
  expect(written[0].types).toEqual(["text/plain", "text/html"]);
  const message = messageFromClipboard({
    getData: (type) => (type === "text/html" ? html : text),
  })!;
  const pasted = message.files.map((file, index) => ({
    id: `pasted-${index}`,
    name: file.name,
    mimeType: file.type,
    kind: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
    size: file.size,
  }));
  expect(
    clipboardTextWithAttachments(message, pasted, [
      { ...pasted[0], id: "existing-image", name: "existing.png" },
      ...pasted,
    ]),
  ).toBe("[Image 2 · screen.png · 3 B] Look at these [File 1 · report.pdf · 3 B]");
});

it("pastes attachment bytes and names copied by an older Bycoda build", async () => {
  const name = 'Quarterly "Özet".pdf';
  const payload = encodeURIComponent(
    JSON.stringify([{ name, mimeType: "application/pdf", data: "+/8=" }]),
  );
  const html = `<div data-bycoda-files="${payload}"><pre>Report</pre></div>`;

  const files = messageFilesFromClipboard({ getData: () => html });

  expect(files?.map((file) => [file.name, file.type])).toEqual([[name, "application/pdf"]]);
  expect(new Uint8Array(await files![0].arrayBuffer())).toEqual(Uint8Array.of(251, 255));
});

it.each([
  "%",
  encodeURIComponent(
    JSON.stringify([{ name: "local.txt", mimeType: "text/plain", path: "/local.txt" }]),
  ),
  encodeURIComponent(JSON.stringify([{ name: "bad.txt", mimeType: "text/plain", data: "!!!!" }])),
])("rejects malformed or path-only legacy clipboard data", (payload) => {
  const html = `<div data-bycoda-files="${payload}"></div>`;
  expect(messageFilesFromClipboard({ getData: () => html })).toBeNull();
});

it("rejects clipboard files whose decoded bytes exceed the attachment limit", () => {
  const base64Length = Math.ceil((MAX_EMBED_BYTES + 1) / 3) * 4;
  const html =
    `<div><a data-bycoda-file="oversized.bin" href="data:application/octet-stream;base64,` +
    `${"A".repeat(base64Length)}" download="oversized.bin">oversized.bin</a></div>`;

  expect(
    messageFilesFromClipboard({
      getData: (type) => (type === "text/html" ? html : ""),
    }),
  ).toBeNull();
});

it("embeds each attachment once and keeps escaped names and text intact", async () => {
  let written: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    written = items;
  });
  const text = `<b>"quoted"</b> data-bycoda-file="x" & more`;
  await copyMessage(text, [
    {
      id: "1",
      name: `a "<&>" 'b'.bin`,
      mimeType: "application/octet-stream",
      kind: "file",
      size: 3,
      data: "+/+/",
    },
  ]);
  expect(await (await written[0].getType("text/plain")).text()).toBe(text);
  const html = await (await written[0].getType("text/html")).text();
  expect(html.split("+/+/")).toHaveLength(2);
  expect(html).not.toContain("%2B");
  expect(html.split('data-bycoda-file="')).toHaveLength(2);
  const files = messageFilesFromClipboard({ getData: () => html });
  expect(files?.map((file) => file.name)).toEqual([`a "<&>" 'b'.bin`]);
  expect(Array.from(new Uint8Array(await files![0].arrayBuffer()))).toEqual([251, 255, 191]);
});

it.each([
  {},
  { path: "/old.png", hostEnvironmentId: "other-host" },
  { path: "remote://other-host/old.png" },
])("keeps the clipboard when a restored image has no readable source (%j)", async (source) => {
  vi.mocked(invoke).mockClear();
  await navigator.clipboard.writeText("Previous clipboard");
  requireCompleteClipboardWrite();
  const image = persistableAttachment({
    id: "restored",
    name: "old.png",
    mimeType: "image/png",
    kind: "image",
    size: 3,
    ...source,
  });

  await expect(copyMessage("Old message", [image])).rejects.toThrow(
    "Could not copy old.png: File content is no longer available.",
  );
  expect(invoke).not.toHaveBeenCalled();
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

  await copyMessage("Open [file1] first", [folder]);
  expect(await navigator.clipboard.readText()).toBe("Open /home/dev/reports first");

  let written: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
    written = items;
  });
  await copyMessage("[image1] See [file1] first", [
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
  const text = await (await written[0].getType("text/plain")).text();
  const html = await (await written[0].getType("text/html")).text();
  expect(text).toBe("See /home/dev/reports first");
  const message = messageFromClipboard({
    getData: (type) => (type === "text/html" ? html : text),
  })!;
  expect(message.files.map((file) => file.name)).toEqual(["shot.png"]);
  expect(message.referenceText).toBe(
    "[Image: Attachment; ref=clipboard-0] See /home/dev/reports first",
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
    requireCompleteClipboardWrite();
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
