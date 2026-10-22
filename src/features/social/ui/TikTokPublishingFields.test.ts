// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { CampaignVariant } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { TikTokPublishingFields } from "./TikTokPublishingFields";
let element: HTMLDivElement, root: Root;
let latest: CampaignVariant;
const read = vi.fn();
const client = { tiktokCreator: read } as unknown as SocialClient;
function Editor() {
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
    onChange: (patch) => setVariant((value) => ({ ...value, ...patch })),
  });
}
const Component = withQueryClient(Editor);
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
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
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
