import { afterEach, expect, it, vi } from "vitest";
import type { Attachment } from "../../sessions/model/session";
import {
  readVoiceDraftAttachment,
  readVoiceDraftContext,
  registerVoiceDraftReader,
  VOICE_DRAFT_MAX_FILE_BYTES,
  VOICE_DRAFT_MAX_TEXT,
  type VoiceDraftInput,
} from "./voiceDraftContext";

const { cached, readBinaryFile, extractDocument } = vi.hoisted(() => ({
  cached: new Map<string, VoiceDraftInput>(),
  readBinaryFile: vi.fn(),
  extractDocument: vi.fn(),
}));
vi.mock("../../sessions/model/draftCache", () => ({
  composerDraftOf: (id: string) => cached.get(id) ?? { text: "", attachments: [] },
}));
vi.mock("../../../platform/tauri/fs", () => ({ readBinaryFile }));
vi.mock("./voiceDocumentContext", async (original) => ({
  ...(await original<typeof import("./voiceDocumentContext")>()),
  extractVoiceDocument: extractDocument,
}));

const releases: (() => void)[] = [];
function mount(input: VoiceDraftInput, id = "draft-session") {
  releases.push(registerVoiceDraftReader(id, () => input));
  return input;
}
function attachment(partial: Partial<Attachment> = {}): Attachment {
  return {
    id: "file-1",
    name: "notes.txt",
    kind: "file",
    mimeType: "text/plain",
    size: 5,
    data: btoa("hello"),
    ...partial,
  };
}
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  cached.clear();
  vi.clearAllMocks();
});

it("reads exact live text and IME state without changing the draft or committing input", () => {
  const input = mount({
    text: "  Türkçe\r\n未確定 🐈  ",
    attachments: [attachment()],
    composing: true,
    attachmentsPending: true,
  });
  cached.set("draft-session", { text: "older saved text", attachments: [] });
  const before = JSON.stringify(input);
  const draft = readVoiceDraftContext("draft-session");
  expect(draft).toMatchObject({
    text: input.text,
    source: "mounted",
    composing: true,
    attachmentsPending: true,
    unsent: true,
    textTruncated: false,
  });
  expect(JSON.stringify(input)).toBe(before);
  expect(Object.isFrozen(draft.attachments[0])).toBe(true);
  expect(readBinaryFile).not.toHaveBeenCalled();
});

it("keeps sessions separate and falls back to retained cache after a pane unmount", () => {
  cached.set("other-session", { text: "other draft", attachments: [attachment()] });
  const stop = registerVoiceDraftReader("other-session", () => ({ text: "live", attachments: [] }));
  expect(readVoiceDraftContext("draft-session").text).toBe("");
  expect(readVoiceDraftContext("other-session").text).toBe("live");
  stop();
  expect(readVoiceDraftContext("other-session")).toMatchObject({
    text: "other draft",
    source: "cache",
  });
});

it("does not let a retired reader unregister its replacement", () => {
  const stopOld = registerVoiceDraftReader("draft-session", () => ({
    text: "old",
    attachments: [],
  }));
  releases.push(
    registerVoiceDraftReader("draft-session", () => ({ text: "new", attachments: [] })),
  );
  stopOld();
  expect(readVoiceDraftContext("draft-session").text).toBe("new");
});

it("bounds context and identifies truncation without publishing attachment bytes or paths", () => {
  mount({
    text: "x".repeat(VOICE_DRAFT_MAX_TEXT + 1),
    attachments: Array.from({ length: 21 }, (_, i) =>
      attachment({ id: `file-${i}`, path: "C:/private/file.txt" }),
    ),
  });
  const context = readVoiceDraftContext("draft-session");
  expect(context.text).toHaveLength(VOICE_DRAFT_MAX_TEXT);
  expect(context).toMatchObject({
    textTruncated: true,
    attachmentCount: 21,
    attachmentsTruncated: true,
  });
  expect(context.attachments).toHaveLength(20);
  expect(context.attachments[0]).toMatchObject({ content: "not_read", readableAs: "text" });
  expect(JSON.stringify(context)).not.toContain("C:/private");
  expect(JSON.stringify(context)).not.toContain(btoa("hello"));
});

it("returns real image data and text contents for attachments already in the draft", async () => {
  mount({
    text: "",
    attachments: [
      attachment(),
      attachment({ id: "image", kind: "image", name: "capture.png", mimeType: "image/png" }),
    ],
  });
  expect(await readVoiceDraftAttachment("draft-session", "file-1")).toMatchObject({
    kind: "text",
    text: "hello",
    truncated: false,
  });
  expect(await readVoiceDraftAttachment("draft-session", "image")).toMatchObject({
    kind: "image",
    dataUrl: `data:image/png;base64,${btoa("hello")}`,
  });
});

it("cannot read an arbitrary model-supplied path or another session's file", async () => {
  mount({ text: "", attachments: [attachment()] });
  expect(await readVoiceDraftAttachment("draft-session", "C:/secret.txt")).toMatchObject({
    kind: "unavailable",
    reason: "not_in_draft",
  });
  expect(await readVoiceDraftAttachment("other-session", "file-1")).toMatchObject({
    reason: "not_in_draft",
  });
  expect(readBinaryFile).not.toHaveBeenCalled();
});

it("uses the attached authorized reader before any raw Host path", async () => {
  const loadPreview = vi.fn(async () => btoa("remote"));
  mount({
    text: "",
    attachments: [
      attachment({
        path: "/private/remote.txt",
        hostEnvironmentId: "remote-host",
        data: undefined,
        loadPreview,
      }),
    ],
  });
  expect(await readVoiceDraftAttachment("draft-session", "file-1")).toMatchObject({
    text: "remote",
  });
  expect(loadPreview).toHaveBeenCalledOnce();
  expect(readBinaryFile).not.toHaveBeenCalled();
});

it("routes owned Host paths through the remote-aware filesystem", async () => {
  readBinaryFile.mockResolvedValue(new TextEncoder().encode("remote text"));
  mount({
    text: "",
    attachments: [
      attachment({ data: undefined, path: "/tmp/a.txt", hostEnvironmentId: "machine-1" }),
    ],
  });
  expect(await readVoiceDraftAttachment("draft-session", "file-1")).toMatchObject({
    text: "remote text",
  });
  expect(readBinaryFile).toHaveBeenCalledWith("remote://machine-1/tmp/a.txt");
});

it("refuses a stale image when its source was replaced while the read was pending", async () => {
  let resolve!: (value: string) => void;
  const loadPreview = () =>
    new Promise<string>((done) => {
      resolve = done;
    });
  const input = mount({ text: "", attachments: [attachment({ data: undefined, loadPreview })] });
  const pending = readVoiceDraftAttachment("draft-session", "file-1");
  input.attachments = [attachment({ data: btoa("new") })];
  resolve(btoa("old"));
  expect(await pending).toMatchObject({ kind: "unavailable", reason: "draft_changed" });
});

it("labels missing, oversized and unsupported files honestly before reading them", async () => {
  const loadPreview = vi.fn();
  mount({
    text: "",
    attachments: [
      attachment({ id: "missing", missing: true, loadPreview }),
      attachment({ id: "big", size: VOICE_DRAFT_MAX_FILE_BYTES + 1, loadPreview }),
      attachment({
        id: "binary",
        mimeType: "application/octet-stream",
        name: "archive.bin",
        loadPreview,
      }),
    ],
  });
  for (const [id, reason] of [
    ["missing", "missing"],
    ["big", "too_large"],
    ["binary", "unsupported_format"],
  ])
    expect(await readVoiceDraftAttachment("draft-session", id)).toMatchObject({
      kind: "unavailable",
      reason,
    });
  expect(loadPreview).not.toHaveBeenCalled();
});

it("extracts bounded document text and labels its text-only coverage", async () => {
  mount({
    text: "",
    attachments: [attachment({ name: "report.pdf", mimeType: "application/pdf" })],
  });
  extractDocument.mockResolvedValue({
    text: "Page 1\nFacts",
    textLength: 12,
    truncated: true,
    format: "pdf",
    coverage: "text-only",
  });
  expect(readVoiceDraftContext("draft-session").attachments[0]).toMatchObject({
    content: "not_read",
    readableAs: "text",
  });
  expect(await readVoiceDraftAttachment("draft-session", "file-1")).toMatchObject({
    kind: "text",
    text: "Page 1\nFacts",
    truncated: true,
    coverage: "text-only",
    format: "pdf",
  });
  expect(extractDocument).toHaveBeenCalledWith(new TextEncoder().encode("hello"), "pdf");
});

it("rejects document results whose attachment changed during extraction", async () => {
  let done!: (value: unknown) => void;
  extractDocument.mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const input = mount({
    text: "",
    attachments: [
      attachment({
        name: "report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ],
  });
  const pending = readVoiceDraftAttachment("draft-session", "file-1");
  await vi.waitFor(() => expect(extractDocument).toHaveBeenCalledOnce());
  input.attachments = [];
  done({
    text: "Old document",
    textLength: 12,
    truncated: false,
    format: "docx",
    coverage: "text-only",
  });
  expect(await pending).toMatchObject({ kind: "unavailable", reason: "draft_changed" });
});

it("checks actual decoded size and does not expose raw read errors", async () => {
  const loadPreview = vi.fn(async () =>
    "A".repeat(Math.ceil(VOICE_DRAFT_MAX_FILE_BYTES / 3) * 4 + 4),
  );
  const input = mount({ text: "", attachments: [attachment({ data: undefined, loadPreview })] });
  expect(await readVoiceDraftAttachment("draft-session", "file-1")).toMatchObject({
    kind: "unavailable",
  });
  input.attachments = [attachment({ data: undefined, path: "C:/private/key.txt" })];
  readBinaryFile.mockRejectedValue(new Error("Bearer secret-token C:/private/key.txt"));
  expect(await readVoiceDraftAttachment("draft-session", "file-1")).toEqual({
    sessionId: "draft-session",
    attachmentId: "file-1",
    kind: "unavailable",
    reason: "read_failed",
  });
});
