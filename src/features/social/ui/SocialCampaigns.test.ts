// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount, SocialSnapshot } from "../model/social";
import { SOCIAL_ACCOUNT_TYPES } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { Campaigns } from "./SocialCampaigns";

vi.mock("./SocialPrograms", () => ({ SocialPrograms: () => null }));

const Component = withQueryClient(Campaigns);
let element: HTMLDivElement, root: Root;
const tiktokCreator = vi.fn();
const request = vi.fn(),
  upload = vi.fn(),
  uploadVideo = vi.fn();
const client = { request, tiktokCreator, upload, uploadVideo } as unknown as SocialClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  tiktokCreator.mockReset().mockResolvedValue({
    nickname: "Owner",
    privacyOptions: ["SELF_ONLY"],
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxDurationSeconds: 60,
  });
  request.mockReset().mockImplementation(async (action, input) => {
    if (action === "policy.get") return { effective: {} };
    if (action === "campaigns.create")
      return { id: "saved-channel-campaign", revision: 1, ...input };
    return undefined;
  });
  upload.mockReset().mockResolvedValue({ uploadId: "channel-image" });
  uploadVideo.mockReset().mockResolvedValue({ uploadId: "channel-video" });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("requires explicit Facebook Reel selection and preserves verified metadata with an optional caption when saving", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:facebook-reel");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const form = await mount("facebook", "oauth");
  await setCampaignValue(
    form.querySelector<HTMLInputElement>('input:not([type="file"]):not([type="checkbox"])')!,
    "Brand Reel",
  );
  expect(form.querySelector('input[type="file"]')).toBeNull();
  expect(form.textContent).toContain("Add image URL");
  const reel = [...form.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (button) => button.textContent === "Reel",
  )!;
  await act(async () => reel.click());
  expect(form.textContent).not.toContain("Add image URL");
  const file = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(file.accept).toBe("video/mp4");
  expect(file.multiple).toBe(false);
  await selectCampaignFiles(file, [new File(["mp4"], "reel.mp4", { type: "video/mp4" })]);
  const video = form.querySelector("video")!;
  Object.defineProperties(video, {
    duration: { value: 12 },
    videoWidth: { value: 1080 },
    videoHeight: { value: 1920 },
  });
  await act(async () => video.dispatchEvent(new Event("loadedmetadata", { bubbles: true })));
  const frameRate = form.querySelector<HTMLInputElement>('input[type="number"]')!;
  expect(frameRate.value).toBe("");
  expect(saveCampaignButton(form).disabled).toBe(true);
  await setCampaignValue(frameRate, "22");
  expect(saveCampaignButton(form).disabled).toBe(true);
  await setCampaignValue(frameRate, "29.97");
  expect(form.querySelector<HTMLTextAreaElement>("textarea")!.required).toBe(false);
  expect(saveCampaignButton(form).disabled).toBe(false);
  const caption = form.querySelector<HTMLTextAreaElement>("textarea")!;
  await setCampaignValue(caption, "😀".repeat(1100));
  expect(form.textContent).toContain("2200 / 2200");
  expect(saveCampaignButton(form).disabled).toBe(false);
  await setCampaignValue(caption, "😀".repeat(1101));
  expect(saveCampaignButton(form).disabled).toBe(true);
  await setCampaignValue(caption, "");
  const submissionForm = form.querySelector("form") ?? form.closest("form");
  await act(async () =>
    submissionForm!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(
    request.mock.calls.find(([action]) => action === "campaigns.create")?.[1].variants,
  ).toEqual([
    expect.objectContaining({
      text: "",
      media: [{ kind: "video", uploadId: "channel-video" }],
      facebook: {
        target: "reel",
        durationSeconds: 12,
        width: 1080,
        height: 1920,
        frameRate: 29.97,
      },
    }),
  ]);
  expect(
    request.mock.calls.some(([action]) =>
      ["campaigns.approve", "campaigns.publish"].includes(action),
    ),
  ).toBe(false);
});

it("clears incompatible Facebook attachments and options when changing the explicit target", async () => {
  const form = await mount("facebook", "oauth");
  const add = [...form.querySelectorAll("button")].find(
    (button) => button.textContent === "Add image URL",
  )!;
  await act(async () => add.click());
  expect(form.textContent).toContain("Image URL 1");
  const choose = async (label: string) =>
    act(async () =>
      [...form.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .find((button) => button.textContent === label)!
        .click(),
    );
  await choose("Reel");
  expect(form.textContent).not.toContain("Image URL 1");
  expect(form.querySelector('input[type="number"]')).not.toBeNull();
  await choose("Page feed");
  expect(form.querySelector('input[type="number"]')).toBeNull();
  expect(form.querySelector('input[type="file"]')).toBeNull();
  expect(form.textContent).toContain("Add image URL");
  expect(form.textContent).not.toContain("Image URL 1");
});

async function mount(
  platform: SocialAccount["platform"],
  connection: SocialAccount["connection"],
  available = true,
  accountType?: SocialAccount["accountType"],
) {
  const account: SocialAccount = {
    id: "account",
    platform,
    name: "Brand account",
    connection,
    connected: true,
    paused: false,
    accountType: accountType ?? SOCIAL_ACCOUNT_TYPES[platform][0],
    platformId: "fixture",
    scopes: [],
    accessApproved: true,
    executorId: "host",
    createdAt: 1,
    grants: { project: ["read", "draft"] },
  };
  const snapshot = {
    executorId: "host",
    hostOnline: true,
    sendingEnabled: false,
    stopped: false,
    pollingEnabled: false,
    accounts: [account],
    campaigns: [],
    contacts: [],
    threads: [],
    segments: [],
    rules: [],
    jobs: [],
    drafts: [],
    profiles: [],
    capabilities: {
      account: available
        ? [
            { operation: "publish", status: "available" },
            { operation: "media", status: "available" },
          ]
        : [],
    },
  } as unknown as SocialSnapshot;
  await act(async () =>
    root.render(
      createElement(Component, {
        client,
        snapshot,
        projects: [{ id: "project", name: "Project", cwd: "G:/project" }],
        initialProject: "project",
        run: async (work) => {
          await work();
          return true;
        },
      }),
    ),
  );
  const open = [...element.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "New campaign",
  )!;
  await act(async () => open.click());
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Social accounts"]')!.click(),
  );
  await act(async () => document.body.querySelector<HTMLElement>('[role="option"]')!.click());
  return document.body.querySelector<HTMLElement>(
    '[data-social-composer][aria-label="New campaign"]',
  )!;
}

it("offers owner host uploads for browser campaigns without forcing an HTTPS image API URL", async () => {
  const form = await mount("instagram", "browser");
  expect(form.textContent).toContain("Instagram attachments");
  expect(form.textContent).not.toContain("HTTPS image URL");
  const file = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(file.accept).toBe("image/jpeg,image/png,video/mp4");
  expect(file.multiple).toBe(true);
});

it("offers ordered official API image/video URLs and preserves the image URL workflow", async () => {
  const form = await mount("instagram", "oauth");
  const add = [...form.querySelectorAll("button")].find(
    (button) => button.textContent === "Add image URL",
  )!;
  await act(async () => add.click());
  expect(form.textContent).toContain("Image URL 1");
  expect(form.querySelector<HTMLInputElement>('input[type="url"][required]')).not.toBeNull();
  expect(form.querySelector('input[type="file"]')).toBeNull();
});

it("does not expose media upload for a browser platform without publishing/media capability", async () => {
  const form = await mount("telegram", "browser", false);
  expect(form.querySelector('input[type="file"]')).toBeNull();
  expect(form.textContent).not.toContain("HTTPS image URL");
});

it("restricts Snapchat browser publishing to one local video", async () => {
  const form = await mount("snapchat", "browser");
  const file = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(file.accept).toBe("video/mp4");
  expect(file.multiple).toBe(false);
});

it("passes browser mode through to TikTok local uploads and current publishing settings", async () => {
  const form = await mount("tiktok", "browser");
  expect(tiktokCreator).toHaveBeenCalledExactlyOnceWith("account");
  expect(form.textContent).toContain("No TikTok API URL is needed");
  expect(form.textContent).not.toContain("HTTPS video URL on a verified domain");
  expect(form.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe("video/mp4");
});

async function setCampaignValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectCampaignFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
const saveCampaignButton = (form: HTMLElement) =>
  [...form.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Save campaign draft",
  )!;

it("saves an API Telegram channel media-only campaign through one host uploader without a required caption", async () => {
  const form = await mount("telegram", "token", true, "channel");
  await setCampaignValue(
    form.querySelector<HTMLInputElement>('input:not([type="file"]):not([type="checkbox"])')!,
    "Channel announcement",
  );
  const files = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(files.accept).toBe("image/jpeg,image/png,video/mp4");
  expect(files.multiple).toBe(false);
  expect(form.textContent).toContain("MP4 up to 50 MiB");
  expect(form.textContent).not.toContain("X attachments");
  await selectCampaignFiles(files, [
    new File(["image"], "announcement.png", { type: "image/png" }),
  ]);
  const caption = form.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(caption.value).toBe("");
  expect(caption.required).toBe(false);
  expect(form.textContent).toContain("0 / 1024");
  expect(saveCampaignButton(form).disabled).toBe(false);
  const submissionForm = form.querySelector("form") ?? form.closest("form");
  expect(submissionForm).not.toBeNull();
  await act(async () =>
    submissionForm!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const saved = request.mock.calls.find(([action]) => action === "campaigns.create")?.[1];
  expect(saved?.variants).toEqual([
    expect.objectContaining({
      accountId: "account",
      text: "",
      media: [{ kind: "image", uploadId: "channel-image" }],
    }),
  ]);
  expect(
    request.mock.calls.some(([action]) =>
      ["campaigns.approve", "campaigns.publish"].includes(action),
    ),
  ).toBe(false);
});

it("counts Telegram channel media captions as UTF-16 including links and rejects oversized videos before upload", async () => {
  const form = await mount("telegram", "token", true, "channel");
  await setCampaignValue(
    form.querySelector<HTMLInputElement>('input:not([type="file"]):not([type="checkbox"])')!,
    "Channel limits",
  );
  const files = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  await selectCampaignFiles(files, [
    new File(["image"], "announcement.png", { type: "image/png" }),
  ]);
  const caption = form.querySelector<HTMLTextAreaElement>("textarea")!;
  await setCampaignValue(caption, "😀".repeat(512));
  expect(form.textContent).toContain("1024 / 1024");
  expect(saveCampaignButton(form).disabled).toBe(false);
  await setCampaignValue(caption, "😀".repeat(513));
  expect(form.textContent).toContain("1026 / 1024");
  expect(saveCampaignButton(form).disabled).toBe(true);
  await setCampaignValue(caption, "😀".repeat(500));
  const link = form.querySelector<HTMLInputElement>('input[type="url"]')!;
  await setCampaignValue(link, "https://example.test/long");
  expect(form.textContent).toContain(`${1000 + 1 + "https://example.test/long".length} / 1024`);
  expect(saveCampaignButton(form).disabled).toBe(true);
  const tooLarge = new File(["mp4"], "oversized.mp4", { type: "video/mp4" });
  Object.defineProperty(tooLarge, "size", { value: 50 * 1024 * 1024 + 1 });
  await selectCampaignFiles(files, [tooLarge]);
  expect(uploadVideo).not.toHaveBeenCalled();
  expect(form.textContent).toContain("Videos can be at most 50 MiB.");
  expect(form.textContent).not.toContain("64 MiB");
});
