// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BinaryFileView } from "./BinaryFileView";
import { DocumentView } from "./DocumentView";
import { MediaView } from "./MediaView";

const mocks = vi.hoisted(() => ({
  readBinary: vi.fn(),
  prepare: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: false, IS_WIN: true }));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  readBinaryFile: mocks.readBinary,
  prepareLocalFile: mocks.prepare,
  preparedFileSize: vi.fn(async () => 1024),
  openPathWithDefaultApp: mocks.open,
}));
vi.mock("../model/fileWatch", () => ({ watchFile: () => () => {} }));
// The PDF parser is lazy and heavy; the footer under test does not depend on it.
vi.mock("./PdfViewer", () => ({ default: () => null }));
vi.mock("../../sessions/public/SurfaceSelection", async () => {
  const { createElement } = await import("react");
  return {
    SurfaceSelection: ({ children }: { children: unknown }) => createElement("div", null, children),
  };
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  URL.createObjectURL = vi.fn(() => "blob:viewer");
  URL.revokeObjectURL = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.readBinary.mockReset().mockResolvedValue(PNG);
  mocks.prepare.mockReset().mockResolvedValue("C:/cache/clip.mp4");
  mocks.open.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function findButton(scope: ParentNode, text: string) {
  const button = [...scope.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) throw new Error(`no button "${text}"`);
  return button;
}

it("shows the image name and an open-in-default-app action in the shared footer", async () => {
  await act(async () =>
    root.render(createElement(BinaryFileView, { path: "C:/project/shot.png", cwd: "C:/project" })),
  );
  const footer = container.querySelector("footer")!;
  expect(footer.textContent).toContain("shot.png");
  await act(async () => findButton(footer, "Open in default app").click());
  expect(mocks.open).toHaveBeenCalledWith("C:/project/shot.png");
});

it("keeps a failed image open visible until the next open attempt succeeds", async () => {
  mocks.open.mockRejectedValueOnce(new Error("Application unavailable"));
  await act(async () =>
    root.render(createElement(BinaryFileView, { path: "C:/project/shot.png", cwd: "C:/project" })),
  );
  await act(async () => findButton(container, "Open in default app").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Application unavailable",
  );
  await act(async () => findButton(container, "Open in default app").click());
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("shows the PDF name and open action in the shared footer rather than a PDF toolbar", async () => {
  await act(async () =>
    root.render(
      createElement(DocumentView, {
        path: "C:/project/report.pdf",
        cwd: "C:/project",
        readBytes: async () => new Uint8Array([1, 2, 3]),
      }),
    ),
  );
  const footers = container.querySelectorAll("footer");
  expect(footers).toHaveLength(1);
  expect(footers[0].textContent).toContain("report.pdf");
  await act(async () => findButton(footers[0], "Open in default app").click());
  expect(mocks.open).toHaveBeenCalledWith("C:/project/report.pdf");
});

it("shows the media name and open action in the shared footer and opens the owning path", async () => {
  await act(async () =>
    root.render(createElement(MediaView, { path: "C:/project/clip.mp4" })),
  );
  const footer = container.querySelector("footer")!;
  expect(footer.textContent).toContain("clip.mp4");
  await act(async () => findButton(footer, "Open in default app").click());
  expect(mocks.open).toHaveBeenCalledWith("C:/project/clip.mp4");
});
