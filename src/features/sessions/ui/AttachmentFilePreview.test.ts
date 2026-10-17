// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../model/session";
import { MAX_DOCUMENT_BYTES } from "../../files/model/documentViewer";
import { AttachmentChip } from "./AttachmentChip";
import { AttachmentTokenText } from "./AttachmentTokenText";

const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), open: vi.fn() }));
vi.mock("../../../integrations/harness", () => ({
  canRunHarnessTextPrompt: () => false,
  runHarnessTextPrompt: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split(/[/\\]/).at(-1) ?? path,
  readBinaryFile: mocks.read,
  prepareLocalFile: mocks.prepare,
  openPathWithDefaultApp: mocks.open,
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../files/model/fileWatch", () => ({ watchFile: () => () => {} }));
// Exercise the real routing, modal and asynchronous readers; stub only heavyweight parsers.
vi.mock("../../files/ui/PdfViewer", () => ({
  default: ({ bytes }: { bytes: Uint8Array }) =>
    createElement("div", { "data-viewer": "pdf" }, new TextDecoder().decode(bytes)),
}));
vi.mock("../../files/ui/SheetViewer", () => ({
  default: ({ bytes, format }: { bytes: Uint8Array; format?: string }) =>
    createElement("div", { "data-viewer": format ?? "excel" }, new TextDecoder().decode(bytes)),
}));

let container: HTMLDivElement;
let root: Root;

const file = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: "file-1",
  kind: "file",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 5,
  path: "/host/attachments/opaque-id",
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.read.mockReset();
  mocks.prepare.mockReset();
  mocks.open.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:attachment-media");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function clickPreview() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click();
    await vi.dynamicImportSettled();
  });
}

function closePreview() {
  act(() =>
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!
      .click(),
  );
}

describe("document attachment integration", () => {
  it.each([
    ["report.pdf", "application/pdf", "pdf"],
    ["report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "excel"],
    ["report.csv", "text/csv", "csv"],
  ])(
    "opens %s lazily with its document viewer and authorized host reader",
    async (name, mimeType, viewer) => {
      const loadPreview = vi.fn(async () => btoa("owner"));
      act(() =>
        root.render(
          createElement(AttachmentChip, { attachment: file({ name, mimeType, loadPreview }) }),
        ),
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(loadPreview).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      await clickPreview();
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(name);
      expect(document.querySelector(`[data-viewer="${viewer}"]`)?.textContent).toBe("owner");
      expect(loadPreview).toHaveBeenCalledOnce();
      expect(mocks.read).not.toHaveBeenCalled();
      expect(document.querySelector('[title="Open in default app"]')).toBeNull();
      expect(document.querySelector('[title="Open on this computer"]')).toBeNull();
    },
  );

  it("opens file tokens through the same lazy reader", async () => {
    const loadPreview = vi.fn(async () => btoa("table"));
    const attachment = file({ name: "data.csv", mimeType: "text/csv", loadPreview });
    act(() =>
      root.render(
        createElement(AttachmentTokenText, { text: "Read [file1]", attachments: [attachment] }),
      ),
    );
    expect(loadPreview).not.toHaveBeenCalled();
    expect(container.textContent).toBe("Read [file1]");
    await clickPreview();
    expect(document.querySelector('[data-viewer="csv"]')?.textContent).toBe("table");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("routes a saved host path using its machine identity", async () => {
    mocks.read.mockResolvedValue(new TextEncoder().encode("owner"));
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: file({ path: "C:\\project\\report.pdf", hostEnvironmentId: "windows-peer" }),
        }),
      ),
    );
    expect(mocks.read).not.toHaveBeenCalled();
    await clickPreview();
    expect(mocks.read).toHaveBeenCalledWith("remote://windows-peer/C:/project/report.pdf");
    expect(mocks.read).not.toHaveBeenCalledWith("C:\\project\\report.pdf");
  });

  it("does not reopen after a pending document is closed", async () => {
    let finish!: (data: string) => void;
    const loadPreview = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    act(() => root.render(createElement(AttachmentChip, { attachment: file({ loadPreview }) })));
    await clickPreview();
    closePreview();
    await act(async () => {
      finish(btoa("stale"));
      await vi.dynamicImportSettled();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("[data-viewer]")).toBeNull();
  });

  it.each(["chip", "token"])(
    "closes a %s before reading a replacement attachment",
    async (surface) => {
      let finish!: (data: string) => void;
      const oldReader = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
      const nextReader = vi.fn(async () => btoa("newer"));
      const render = (attachment: Attachment) =>
        act(() =>
          root.render(
            surface === "chip"
              ? createElement(AttachmentChip, { attachment })
              : createElement(AttachmentTokenText, {
                  text: "Read [file1]",
                  attachments: [attachment],
                }),
          ),
        );
      render(file({ loadPreview: oldReader }));
      await clickPreview();
      render(
        file({
          path: "/other-host/report.pdf",
          hostEnvironmentId: "linux-peer",
          loadPreview: nextReader,
        }),
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(nextReader).not.toHaveBeenCalled();
      await act(async () => finish(btoa("stale")));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await clickPreview();
      expect(document.querySelector('[data-viewer="pdf"]')?.textContent).toBe("newer");
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized metadata before reading bytes", async () => {
    const loadPreview = vi.fn(async () => btoa("small"));
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: file({ size: MAX_DOCUMENT_BYTES + 1, loadPreview }),
        }),
      ),
    );
    await clickPreview();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("maximum 25 MB");
    expect(loadPreview).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("rejects a dishonest oversized base64 payload before decoding", async () => {
    const oversized = "a".repeat(Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4);
    const loadPreview = vi.fn(async () => oversized);
    const decode = vi.spyOn(globalThis, "atob");
    act(() => root.render(createElement(AttachmentChip, { attachment: file({ loadPreview }) })));
    await clickPreview();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("maximum 25 MB");
    expect(decode).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});

describe("media attachment integration", () => {
  it("uses session bytes for remote video and releases its object URL on close", async () => {
    const loadPreview = vi.fn(async () => btoa("video"));
    act(() =>
      root.render(
        createElement(AttachmentChip, {
          attachment: file({ name: "demo.mp4", mimeType: "video/mp4", loadPreview }),
        }),
      ),
    );
    expect(loadPreview).not.toHaveBeenCalled();
    await clickPreview();
    const video = document.querySelector("video");
    expect(video?.getAttribute("src")).toBe("blob:attachment-media");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.hasAttribute("autoplay")).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    closePreview();
    await vi.waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment-media"),
    );
  });
});
