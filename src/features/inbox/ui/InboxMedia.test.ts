// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxMedia } from "./InboxMedia";
import { fetchInboxMedia } from "../model/inboxMedia";
import { invalidateInboxMedia } from "../model/inboxMedia";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";

vi.mock("../model/inboxMedia", async (original) => ({
  ...(await original<typeof import("../model/inboxMedia")>()),
  fetchInboxMedia: vi.fn(),
  invalidateInboxMedia: vi.fn(),
}));
vi.mock("../../../shared/lib/openUrlSafely", () => ({ openUrlSafely: vi.fn() }));
vi.mock("../../files/public/PdfViewer", () => ({
  default: ({ bytes }: { bytes: Uint8Array }) =>
    createElement("div", { "data-pdf-bytes": bytes.length }),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const source = "https://acme.atlassian.net/rest/api/3/attachment/content/12";
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:attachment");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it.each([
  ["image", [137, 80, 78, 71, 13, 10, 26, 10]],
  ["video", [0, 0, 0, 32, 102, 116, 121, 112, 105, 115, 111, 109]],
])("invalidates failed %s bytes before retry", async (kind, signature) => {
  vi.mocked(fetchInboxMedia).mockResolvedValue(new Uint8Array(signature as number[]));
  await render();
  await act(async () =>
    container.querySelector(kind === "image" ? "img" : "video")!.dispatchEvent(new Event("error")),
  );
  await act(async () => container.querySelector("button")!.click());
  const retry = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((button) => button.textContent?.includes("Retry"))!;
  await act(async () => retry.click());
  expect(invalidateInboxMedia).toHaveBeenCalledExactlyOnceWith(source);
  expect(fetchInboxMedia).toHaveBeenCalledTimes(2);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(createElement(InboxMedia, { src: source, alt: "screen.png" })));
}

it("opens authenticated image bytes in the shared lightbox instead of leaving the app", async () => {
  vi.mocked(fetchInboxMedia).mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  await render();
  expect(container.querySelector("img")?.src).toBe("blob:attachment");
  await act(async () => container.querySelector("button")!.click());
  expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe(
    "blob:attachment",
  );
  expect(openUrlSafely).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment");
  root = createRoot(container);
});

it("opens unsupported files in a dialog with an explicit external action", async () => {
  vi.mocked(fetchInboxMedia).mockResolvedValue(new TextEncoder().encode("unknown format"));
  await render();
  await act(async () => container.querySelector("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Preview unavailable");
  const open = Array.from(dialog.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Open in browser"),
  )!;
  await act(async () => open.click());
  expect(openUrlSafely).toHaveBeenCalledWith(source);
});

it("keeps failed downloads retryable inside the dialog", async () => {
  vi.mocked(fetchInboxMedia)
    .mockRejectedValueOnce(new Error("401"))
    .mockResolvedValueOnce(new TextEncoder().encode("unknown"));
  await render();
  await act(async () => container.querySelector("button")!.click());
  const retry = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((button) => button.textContent?.includes("Retry")) as HTMLButtonElement;
  expect(retry).toBeTruthy();
  await act(async () => retry.click());
  expect(fetchInboxMedia).toHaveBeenCalledTimes(2);
});

it("renders PDF bytes with the existing document viewer in a dialog", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7 fixture");
  vi.mocked(fetchInboxMedia).mockResolvedValue(bytes);
  await render();
  await act(async () => container.querySelector("button")!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(
    document.querySelector('[role="dialog"] [data-pdf-bytes]')?.getAttribute("data-pdf-bytes"),
  ).toBe(String(bytes.length));
  const retry = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((button) => button.textContent?.includes("Retry"))!;
  await act(async () => retry.click());
  expect(invalidateInboxMedia).toHaveBeenCalledWith(source);
});

it("offers recovery when the expanded image fails to decode", async () => {
  vi.mocked(fetchInboxMedia).mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  await render();
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    document.querySelector('[role="dialog"] img')!.dispatchEvent(new Event("error")),
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Preview unavailable");
  const retry = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((button) => button.textContent?.includes("Retry"))!;
  await act(async () => retry.click());
  expect(invalidateInboxMedia).toHaveBeenCalledWith(source);
});

it("discards late responses when attachment identity changes", async () => {
  let resolve!: (bytes: Uint8Array<ArrayBuffer>) => void;
  vi.mocked(fetchInboxMedia)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce(new TextEncoder().encode("unknown"));
  await render();
  await act(async () =>
    root.render(createElement(InboxMedia, { src: `${source}3`, alt: "next.txt" })),
  );
  await act(async () => resolve(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(container.textContent).toContain("next.txt");
});
