// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { CampaignVariant, SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { TikTokPublishingFields } from "./TikTokPublishingFields";
let element: HTMLDivElement, root: Root;
let latest: CampaignVariant;
const read = vi.fn();
const uploadVideo = vi.fn();
const client = { tiktokCreator: read, uploadVideo } as unknown as SocialClient;
function Editor({ connection }: { connection?: SocialAccount["connection"] } = {}) {
  const [variant, setVariant] = useState<CampaignVariant>({
    accountId: "tiktok",
    text: "Caption",
    media: [],
    factIds: [],
    scheduledAt: 1,
  });
  latest = variant;
  return createElement(TikTokPublishingFields, {
    variant,
    client,
    connection,
    onChange: (patch) => setVariant((value) => ({ ...value, ...patch })),
  });
}
const Component = withQueryClient(Editor);
async function enterUrl(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  read.mockReset().mockResolvedValue({
    nickname: "Owner",
    privacyOptions: ["SELF_ONLY"],
    commentDisabled: true,
    duetDisabled: false,
    stitchDisabled: false,
    maxDurationSeconds: 60,
  });
  uploadVideo.mockReset().mockResolvedValue({ uploadId: "local-video" });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses local browser video uploads and preview consent without requiring a developer API URL", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-video");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  await act(async () => root.render(createElement(Component, { connection: "browser" })));
  expect(element.querySelector('input[type="url"]')).toBeNull();
  const file = element.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(file.accept).toBe("video/mp4");
  const privacy = element.querySelector<HTMLSelectElement>("select")!;
  await act(async () => {
    privacy.value = "SELF_ONLY";
    privacy.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const consent = () =>
    [...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
  expect(consent().disabled).toBe(true);
  Object.defineProperty(file, "files", {
    configurable: true,
    value: [new File(["video"], "local.mp4", { type: "video/mp4" })],
  });
  await act(async () => file.dispatchEvent(new Event("change", { bubbles: true })));
  expect(latest.media).toEqual([{ kind: "video", uploadId: "local-video" }]);
  expect(JSON.stringify(latest)).not.toContain("blob:");
  const video = element.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 25 });
  await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
  expect(latest.tiktok?.durationSeconds).toBe(25);
  expect(consent().disabled).toBe(false);
  await act(async () => consent().click());
  expect(latest.tiktok?.consent).toBe(true);
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Remove attachments")!
      .click(),
  );
  expect(latest.media).toEqual([]);
  expect(latest.tiktok?.consent).toBe(false);
  expect(latest.tiktok?.durationSeconds).toBe(0);
  expect(revoke).toHaveBeenCalledWith("blob:local-video");
});
it("uses current creator privacy choices without defaults, blocks disabled interactions and requires preview plus explicit consent", async () => {
  await act(async () => root.render(createElement(Component)));
  expect(read).toHaveBeenCalledExactlyOnceWith("tiktok");
  const privacy = element.querySelector<HTMLSelectElement>("select")!;
  expect(privacy.value).toBe("");
  expect([...privacy.options].map((option) => option.value)).toEqual(["", "SELF_ONLY"]);
  const boxes = () => [...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes().every((box) => !box.checked)).toBe(true);
  expect(boxes()[0].disabled).toBe(true);
  expect(boxes().at(-1)!.disabled).toBe(true);
  await act(async () => {
    privacy.value = "SELF_ONLY";
    privacy.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const url = element.querySelector<HTMLInputElement>('input[type="url"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      url,
      "https://verified.example/video.mp4",
    );
    url.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const video = element.querySelector("video")!;
  expect(video).toBeTruthy();
  Object.defineProperty(video, "duration", { configurable: true, value: 30 });
  await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
  expect(latest.tiktok?.durationSeconds).toBe(30);
  expect(boxes().at(-1)!.disabled).toBe(false);
  await act(async () => boxes().at(-1)!.click());
  expect(latest.tiktok?.consent).toBe(true);
  expect(latest.tiktok?.allowComment).toBe(false);
  expect(element.querySelector('a[href*="music-usage-confirmation"]')).toBeTruthy();
});

it("requires every API photo preview, explicit cover/music choice and renewed consent after editing", async () => {
  await act(async () => root.render(createElement(Component)));
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Photos")!
      .click(),
  );
  expect(latest.media).toEqual([]);
  expect(latest.tiktok).toMatchObject({
    mediaType: "photo",
    durationSeconds: 0,
    photoCoverIndex: 0,
    autoAddMusic: false,
    consent: false,
    allowDuet: false,
    allowStitch: false,
  });
  expect(element.textContent).not.toContain("Allow Duet");
  expect(element.querySelector("video")).toBeNull();
  const privacy = element.querySelector<HTMLSelectElement>('select[aria-label="Visibility"]')!;
  await act(async () => {
    privacy.value = "SELF_ONLY";
    privacy.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const consent = () =>
    [...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
  await enterUrl(
    element.querySelector<HTMLInputElement>('input[type="url"]')!,
    "https://verified.example/one.jpg",
  );
  expect(consent().disabled).toBe(true);
  await act(async () => element.querySelector("img")!.dispatchEvent(new Event("load")));
  expect(consent().disabled).toBe(false);
  await act(async () => consent().click());
  expect(latest.tiktok?.consent).toBe(true);
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Photos")!
      .click(),
  );
  expect(latest.media).toEqual([{ kind: "image", url: "https://verified.example/one.jpg" }]);
  expect(latest.tiktok?.consent).toBe(true);
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Add photo")!
      .click(),
  );
  expect(latest.tiktok?.consent).toBe(false);
  await enterUrl(
    element.querySelectorAll<HTMLInputElement>('input[type="url"]')[1],
    "https://verified.example/two.png",
  );
  expect(consent().disabled).toBe(true);
  await act(async () => element.querySelectorAll("img")[1].dispatchEvent(new Event("load")));
  expect(consent().disabled).toBe(false);
  const cover = element.querySelector<HTMLSelectElement>('select[aria-label="Cover photo"]')!;
  await act(async () => {
    cover.value = "1";
    cover.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(latest.tiktok?.photoCoverIndex).toBe(1);
  expect(latest.tiktok?.autoAddMusic).toBe(false);
  await act(async () => consent().click());
  expect(latest.tiktok?.consent).toBe(true);
  await act(async () => element.querySelectorAll("img")[1].dispatchEvent(new Event("error")));
  expect(consent().disabled).toBe(true);
  expect(latest.tiktok?.consent).toBe(false);
  expect(latest.media).toEqual([
    { kind: "image", url: "https://verified.example/one.jpg" },
    { kind: "image", url: "https://verified.example/two.png" },
  ]);
  expect(element.textContent).toContain("Could not load the photo preview");
  expect(uploadVideo).not.toHaveBeenCalled();
});

it("clears API photo approval and media when switching back to video, and exposes no photo mode for browser connections", async () => {
  await act(async () => root.render(createElement(Component)));
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Photos")!
      .click(),
  );
  await enterUrl(
    element.querySelector<HTMLInputElement>('input[type="url"]')!,
    "https://verified.example/one.jpg",
  );
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Video")!
      .click(),
  );
  expect(latest.media).toEqual([]);
  expect(latest.tiktok).toMatchObject({ mediaType: "video", durationSeconds: 0, consent: false });
  expect(element.textContent).toContain("HTTPS video URL");
  await act(async () => root.render(createElement(Component, { connection: "browser" })));
  expect(
    [...element.querySelectorAll("button")].some((button) => button.textContent === "Photos"),
  ).toBe(false);
  expect(element.querySelector('input[type="file"]')).toBeTruthy();
  expect(element.querySelector('input[type="url"]')).toBeNull();
});
