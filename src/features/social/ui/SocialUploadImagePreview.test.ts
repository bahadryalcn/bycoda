// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../model/socialClient";
import { SocialUploadImagePreview } from "./SocialUploadImagePreview";

const png = {
  mime: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8zUAAAAASUVORK5CYII=",
};
const jpeg = { mime: "image/jpeg", base64: btoa(String.fromCharCode(255, 216, 255, 0)) };
let element: HTMLDivElement, root: Root;
const request = vi.fn();
const client = { request } as unknown as SocialClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset().mockResolvedValue(png);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});
const render = async (uploadId = "owned-image", selectedClient = client, active = true) =>
  act(async () =>
    root.render(
      createElement(SocialUploadImagePreview, {
        client: selectedClient,
        uploadId,
        alt: "Owner image",
        active,
      }),
    ),
  );

it("automatically reads only the owner upload and renders its actual bounded PNG data", async () => {
  await render();
  expect(request).toHaveBeenCalledExactlyOnceWith("programs.media-preview", {
    uploadId: "owned-image",
  });
  expect(element.querySelector("img")?.getAttribute("src")).toBe(
    `data:image/png;base64,${png.base64}`,
  );
  expect(element.querySelector("img")?.alt).toBe("Owner image");
  expect(request.mock.calls.every(([action]) => action === "programs.media-preview")).toBe(true);
});
it("supports validated JPEG media and contains large image presentation", async () => {
  request.mockResolvedValue(jpeg);
  await render();
  const image = element.querySelector("img")!;
  expect(image.getAttribute("src")).toBe(`data:image/jpeg;base64,${jpeg.base64}`);
  expect(image.style.maxWidth).toBe("100%");
  expect(image.style.maxHeight).toBe("320px");
});
it("shows local loading state and ignores an old upload response after replacement", async () => {
  let resolve!: (value: typeof png) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render("old-image");
  expect(element.querySelector('[role="status"]')?.textContent).toContain("Loading image preview");
  request.mockResolvedValue(jpeg);
  await render("new-image");
  expect(element.querySelector("img")?.src).toContain("image/jpeg");
  await act(async () => resolve(png));
  expect(element.querySelector("img")?.src).toContain("image/jpeg");
});
it("clears the previous bitmap immediately when a different upload is loading", async () => {
  await render("first");
  expect(element.querySelector("img")).toBeTruthy();
  let resolve!: (value: typeof jpeg) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render("second");
  expect(element.querySelector("img")).toBeNull();
  expect(element.querySelector('[role="status"]')).toBeTruthy();
  await act(async () => resolve(jpeg));
  expect(element.querySelector("img")?.src).toContain("image/jpeg");
});
it("scopes identical upload IDs to the selected client and ignores the old machine response", async () => {
  let resolve!: (value: typeof png) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  const otherRequest = vi.fn().mockResolvedValue(jpeg);
  const other = { request: otherRequest } as unknown as SocialClient;
  await render("owned-image", other);
  await act(async () => resolve(png));
  expect(element.querySelector("img")?.src).toContain("image/jpeg");
  expect(otherRequest).toHaveBeenCalledExactlyOnceWith("programs.media-preview", {
    uploadId: "owned-image",
  });
});
it("keeps owner authorization rejection local and retries the same read without approving anything", async () => {
  request.mockRejectedValueOnce(new Error("owner-device-secret"));
  await render();
  expect(element.querySelector("img")).toBeNull();
  expect(element.querySelector('[role="alert"]')?.textContent).toBe(
    "Image preview could not be loaded.",
  );
  expect(element.textContent).not.toContain("owner-device-secret");
  await act(async () => element.querySelector<HTMLButtonElement>("button")!.click());
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]).toEqual(["programs.media-preview", { uploadId: "owned-image" }]);
  expect(element.querySelector("img")).toBeTruthy();
});
it("exposes local retry after the browser cannot decode a returned image", async () => {
  await render();
  await act(async () => element.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(element.querySelector("img")).toBeNull();
  expect(element.querySelector('[role="alert"]')).toBeTruthy();
  await act(async () => element.querySelector<HTMLButtonElement>("button")!.click());
  expect(request).toHaveBeenCalledTimes(2);
  expect(element.querySelector("img")).toBeTruthy();
});
it.each([
  { mime: "image/svg+xml", base64: btoa("<svg/>") },
  { mime: "text/html", base64: btoa("<html>") },
  { mime: "image/png", base64: "https://example.test/preview.png" },
  { mime: "image/png", base64: "iVBORw0KGgo=\n" },
  { mime: "image/png", base64: jpeg.base64 },
  { mime: "image/jpeg", base64: png.base64 },
  { mime: "image/png", base64: "" },
  { mime: "image/png", base64: "A===" },
  { mime: "image/png", base64: "A".repeat(Math.ceil((5 * 1024 * 1024) / 3) * 4 + 4) },
  null,
])("rejects invalid, mismatched or oversized preview data %#", async (value) => {
  request.mockResolvedValue(value);
  await render();
  expect(element.querySelector("img")).toBeNull();
  expect(element.querySelector('[role="alert"]')).toBeTruthy();
});
it("does not load hidden reviews and ignores an in-flight response after deactivation", async () => {
  await render("owned-image", client, false);
  expect(request).not.toHaveBeenCalled();
  let resolve!: (value: typeof png) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await render("owned-image", client, false);
  await act(async () => resolve(png));
  expect(element.querySelector("img")).toBeNull();
  expect(element.textContent).toBe("");
});
it("never sends arbitrary paths or remote URLs as upload identifiers", async () => {
  await render("../../secret");
  expect(request).not.toHaveBeenCalled();
  expect(element.querySelector('[role="alert"]')).toBeTruthy();
});
