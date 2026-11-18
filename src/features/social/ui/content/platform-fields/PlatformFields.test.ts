// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, TikTokCreatorInfo } from "../../../model/social";
import type { ContentMedia } from "../contentDraft";
import { PlatformFields, type PlatformFieldProps } from "./PlatformFields";

let element: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

const creator: TikTokCreatorInfo = {
  nickname: "studio",
  privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxDurationSeconds: 60,
};

const video = (probe: ContentMedia["probe"] = {}): ContentMedia => ({
  localId: "v1",
  name: "clip.mp4",
  media: { kind: "video", uploadId: "v1" },
  probe,
});

function render(platform: SocialAccount["platform"], patch: Partial<PlatformFieldProps> = {}) {
  act(() =>
    root.render(
      createElement(PlatformFields, {
        account: { id: "a1", platform, name: "Studio" } as unknown as SocialAccount,
        value: {},
        media: [],
        disabled: false,
        onChange,
        ...patch,
      }),
    ),
  );
}

const text = () => element.textContent ?? "";

function setValue(field: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

function checkbox(label: string): HTMLInputElement {
  const found = [...element.querySelectorAll("label")].find((item) =>
    item.textContent?.includes(label),
  );
  return found!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

function field(label: string): HTMLInputElement {
  const found = [...element.querySelectorAll("label")].find((item) =>
    item.textContent?.trim().startsWith(label),
  );
  return document.getElementById(found!.htmlFor) as HTMLInputElement;
}

function openSelect(label: string) {
  const trigger = field(label) as unknown as HTMLButtonElement;
  act(() => trigger.click());
  return [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

function pick(label: string, option: string) {
  const choice = openSelect(label).find((item) => item.textContent?.trim() === option);
  expect(choice).toBeDefined();
  act(() => choice!.click());
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  onChange.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

describe("platforms without options", () => {
  it("shows the media rule for X and Instagram and nothing for other platforms", () => {
    render("x");
    expect(text()).toContain("X posts take either up to four images or one video.");
    render("instagram");
    expect(text()).toContain("Attach either one video or up to four images.");
    render("linkedin");
    expect(element.textContent).toBe("");
  });
});

describe("Facebook destination", () => {
  it("defaults to a Page post and offers the Reel", () => {
    render("facebook");
    const select = element.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("feed");
    expect(element.textContent).not.toContain("Video frame rate");
  });

  it("switches to Reel and keeps a frame rate that was already typed", () => {
    render("facebook", { value: { facebook: { target: "feed", frameRate: 30 } } });
    setValue(element.querySelector("select")!, "reel");
    expect(onChange).toHaveBeenCalledWith({ facebook: { target: "reel", frameRate: 30 } });
  });

  it("shows the video length and size read from the file, and asks for the frame rate", () => {
    render("facebook", {
      value: { facebook: { target: "reel" } },
      media: [video({ durationSeconds: 30.4, width: 1080, height: 1920 })],
    });
    expect(text()).toContain("Video length 30 seconds.");
    expect(text()).toContain("1080 × 1920");
    expect(text()).toContain("Enter the frame rate, at least 23 fps.");
  });

  it("asks to attach a video when none is attached", () => {
    render("facebook", { value: { facebook: { target: "reel" } } });
    expect(text()).toContain("Attach one 9:16 video to continue.");
  });

  it("accepts a frame rate of 23 or more without an error", () => {
    render("facebook", {
      value: { facebook: { target: "reel", frameRate: 30 } },
      media: [video({ durationSeconds: 20 })],
    });
    expect(text()).not.toContain("Enter the frame rate");
    render("facebook", {
      value: { facebook: { target: "reel", frameRate: 22 } },
      media: [video({ durationSeconds: 20 })],
    });
    expect(text()).toContain("Enter the frame rate");
  });

  it("is locked as a whole when the editor is locked", () => {
    render("facebook", { disabled: true });
    expect(element.querySelector("fieldset")!.disabled).toBe(true);
  });
});

describe("TikTok options", () => {
  it("keeps format available while waiting for the creator's privacy options", () => {
    render("tiktok");
    expect(text()).toContain("Loading your TikTok options…");
    expect(text()).not.toContain("Who can see this video");
    pick("TikTok post format", "Photos");
    expect(onChange).toHaveBeenLastCalledWith({ tiktok: { mediaType: "photo", consent: false } });
  });

  it("starts with no privacy chosen and no consent given", () => {
    render("tiktok", { creator, media: [video({ durationSeconds: 25 })] });
    expect(element.querySelector("fieldset")!.disabled).toBe(false);
    expect(field("Who can see this video").textContent).toContain("Choose who can see this video");
    expect(checkbox("I confirm the consent").checked).toBe(false);
    expect(text()).toContain("Video length 25 seconds.");
  });

  it("offers only the privacy choices the creator's account allows", () => {
    render("tiktok", { creator });
    const options = openSelect("Who can see this video").map((option) => option.textContent?.trim());
    expect(options).toEqual(["Choose who can see this video", "Everyone", "Only me"]);
  });

  it("reports a privacy choice and the consent as explicit changes", () => {
    render("tiktok", { creator });
    pick("Who can see this video", "Only me");
    expect(onChange).toHaveBeenLastCalledWith({ tiktok: { privacy: "SELF_ONLY" } });
    act(() => checkbox("I confirm the consent").click());
    expect(onChange).toHaveBeenLastCalledWith({ tiktok: { consent: true } });
  });

  it("turns off an interaction the creator disabled in TikTok and shows why", () => {
    render("tiktok", { creator, value: { tiktok: { allowDuet: true } } });
    const duet = checkbox("Allow duets");
    expect(duet.disabled).toBe(true);
    expect(duet.checked).toBe(false);
    expect(text()).toContain("Turned off in your TikTok settings");
    expect(checkbox("Allow comments").disabled).toBe(false);
  });

  it("lets photo posts choose a cover and music without exposing video interactions", () => {
    render("tiktok", {
      creator,
      media: [
        { localId: "first", name: "first.jpg", media: { kind: "image" } },
        { localId: "second", name: "second.jpg", media: { kind: "image" } },
      ],
      value: { tiktok: { mediaType: "photo" } },
    });
    expect(text()).not.toContain("Allow duets");
    expect(text()).not.toContain("Allow stitches");
    pick("TikTok cover photo", "Photo 2");
    expect(onChange).toHaveBeenLastCalledWith({ tiktok: { mediaType: "photo", photoCoverIndex: 1 } });
    act(() => checkbox("Add TikTok-recommended music").click());
    expect(onChange).toHaveBeenLastCalledWith({ tiktok: { mediaType: "photo", autoAddMusic: true } });
  });

  it("offers a TikTok inbox handoff only for an API account with video.upload", () => {
    render("tiktok", {
      creator,
      account: {
        platform: "tiktok",
        connection: "oauth",
        scopes: ["video.upload"],
      } as SocialAccount,
    });
    pick("TikTok publishing mode", "Send draft to TikTok inbox");
    expect(onChange).toHaveBeenLastCalledWith({ tiktok: { mode: "inbox", consent: false } });
    render("tiktok", { value: { tiktok: { mode: "inbox" } } });
    expect(text()).not.toContain("I confirm the consent");
    expect(element.querySelector("fieldset")!.disabled).toBe(false);
    expect(openSelect("TikTok publishing mode").find((option) =>
      option.textContent?.trim() === "Send draft to TikTok inbox",
    )?.disabled).toBe(true);
  });
});

describe("YouTube options", () => {
  it("counts the title in characters against the limit of 100", () => {
    render("youtube", { value: { youtube: { title: "😀😀😀" } } });
    expect(text()).toContain("3 of 100 characters");
  });

  it("starts with no privacy chosen and the kids question unanswered as 'not for kids'", () => {
    render("youtube");
    expect(element.querySelector<HTMLSelectElement>("select")!.value).toBe("");
    expect(checkbox("Made for kids").checked).toBe(false);
    expect(checkbox("Contains altered or synthetic content").checked).toBe(false);
  });

  it("reports the title, privacy and kids answer", () => {
    render("youtube");
    setValue(field("Title"), "Launch day");
    expect(onChange).toHaveBeenLastCalledWith({ youtube: { title: "Launch day" } });
    setValue(element.querySelector("select")!, "unlisted");
    expect(onChange).toHaveBeenLastCalledWith({ youtube: { privacy: "unlisted" } });
    act(() => checkbox("Made for kids").click());
    expect(onChange).toHaveBeenLastCalledWith({ youtube: { madeForKids: true } });
  });
});

describe("Reddit options", () => {
  it("stores the subreddit without a leading r/", () => {
    render("reddit", { value: { reddit: { subreddit: "", flair: "" } } });
    setValue(field("Subreddit"), "r/launches");
    expect(onChange).toHaveBeenLastCalledWith({ reddit: { subreddit: "launches", flair: "" } });
  });

  it("keeps the flair when the subreddit changes", () => {
    render("reddit", { value: { reddit: { subreddit: "launches", flair: "News" } } });
    setValue(field("Subreddit"), "launch");
    expect(onChange).toHaveBeenLastCalledWith({ reddit: { subreddit: "launch", flair: "News" } });
  });
});
