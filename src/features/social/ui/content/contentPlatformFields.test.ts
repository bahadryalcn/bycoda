// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, TikTokCreatorInfo } from "../../model/social";
import type { ContentMedia, PlatformDraft } from "./contentDraft";
import { FacebookReelFields } from "./platform-fields/FacebookReelFields";
import { MetaFields } from "./platform-fields/MetaFields";
import { PlatformFields, type PlatformFieldProps } from "./platform-fields/PlatformFields";
import { RedditFields } from "./platform-fields/RedditFields";
import { privacyLabel, TikTokFields } from "./platform-fields/TikTokFields";
import { XFields } from "./platform-fields/XFields";
import { YouTubeFields } from "./platform-fields/YouTubeFields";

let element: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

function account(platform: SocialAccount["platform"]): SocialAccount {
  return { id: `${platform}1`, platform, name: `${platform} account` } as SocialAccount;
}

function video(probe: ContentMedia["probe"] = {}): ContentMedia {
  return { localId: "v1", name: "clip.mp4", media: { kind: "video", uploadId: "v1" }, probe };
}

const creator: TikTokCreatorInfo = {
  nickname: "studio",
  privacyOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxDurationSeconds: 60,
};

function props(
  platform: SocialAccount["platform"],
  patch: Partial<PlatformFieldProps> = {},
): PlatformFieldProps {
  return { account: account(platform), value: {}, media: [], disabled: false, onChange, ...patch };
}

function render(node: ReactNode) {
  act(() => root.render(node));
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelect(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function select(label: string): HTMLSelectElement {
  return element.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
}

function checkbox(label: string): HTMLInputElement | undefined {
  const row = [...element.querySelectorAll("label.content-check")].find((item) =>
    item.textContent?.includes(label),
  );
  return row?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? undefined;
}

function textInput(label: string): HTMLInputElement | undefined {
  const field = [...element.querySelectorAll("label")].find((item) =>
    item.textContent?.includes(label),
  );
  const id = field?.getAttribute("for");
  return (
    (id
      ? element.querySelector<HTMLInputElement>(`input[id="${id}"]`)
      : field?.querySelector("input")) ?? undefined
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  onChange.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

describe("MetaFields", () => {
  it("shows only the attachment hint for Instagram", () => {
    render(createElement(MetaFields, props("instagram")));
    expect(element.querySelector("select")).toBeNull();
    expect(element.textContent).toContain("Attach either one video or up to four images.");
  });

  it("defaults Facebook to a page post and offers the explicit Reel choice", () => {
    render(createElement(MetaFields, props("facebook")));
    const destination = element.querySelector("select")!;
    expect(destination.value).toBe("feed");
    expect([...destination.options].map((option) => option.value)).toEqual(["feed", "reel"]);
  });

  it("switches to Reel and back while keeping the entered frame rate", () => {
    render(
      createElement(
        MetaFields,
        props("facebook", { value: { facebook: { target: "feed", frameRate: 30 } } }),
      ),
    );
    setSelect(element.querySelector("select")!, "reel");
    expect(onChange).toHaveBeenLastCalledWith({ facebook: { target: "reel", frameRate: 30 } });
    render(
      createElement(
        MetaFields,
        props("facebook", { value: { facebook: { target: "reel", frameRate: 30 } } }),
      ),
    );
    setSelect(element.querySelector("select")!, "feed");
    expect(onChange).toHaveBeenLastCalledWith({ facebook: { target: "feed", frameRate: 30 } });
  });

  it("disables the destination when the editor is locked", () => {
    render(createElement(MetaFields, props("facebook", { disabled: true })));
    expect(element.querySelector("fieldset")?.disabled).toBe(true);
  });
});

describe("FacebookReelFields", () => {
  it("reads the length and size from the attached video", () => {
    render(
      createElement(
        FacebookReelFields,
        props("facebook", { media: [video({ durationSeconds: 29.6, width: 1080, height: 1920 })] }),
      ),
    );
    expect(element.textContent).toContain("Video length 30 seconds.");
    expect(element.textContent).toContain("1080 × 1920");
  });

  it("asks for a video when none is attached", () => {
    render(createElement(FacebookReelFields, props("facebook")));
    expect(element.textContent).toContain("Attach one 9:16 video to continue.");
  });

  it("marks the frame rate invalid when empty or below 23 and valid from 23", () => {
    const rate = () => element.querySelector<HTMLInputElement>('input[type="number"]')!;
    render(createElement(FacebookReelFields, props("facebook")));
    expect(rate().getAttribute("aria-invalid")).toBe("true");
    expect(element.textContent).toContain("Enter the frame rate, at least 23 fps.");
    render(
      createElement(
        FacebookReelFields,
        props("facebook", { value: { facebook: { target: "reel", frameRate: 22 } } }),
      ),
    );
    expect(rate().getAttribute("aria-invalid")).toBe("true");
    render(
      createElement(
        FacebookReelFields,
        props("facebook", { value: { facebook: { target: "reel", frameRate: 23 } } }),
      ),
    );
    expect(rate().getAttribute("aria-invalid")).toBeNull();
    expect(rate().value).toBe("23");
  });

  it("stores the typed frame rate on the Reel draft and clears it when emptied", () => {
    render(
      createElement(
        FacebookReelFields,
        props("facebook", { value: { facebook: { target: "reel", frameRate: 24 } } }),
      ),
    );
    const rate = element.querySelector<HTMLInputElement>('input[type="number"]')!;
    setInput(rate, "29.97");
    expect(onChange).toHaveBeenLastCalledWith({ facebook: { target: "reel", frameRate: 29.97 } });
    setInput(rate, "");
    expect(onChange).toHaveBeenLastCalledWith({
      facebook: { target: "reel", frameRate: undefined },
    });
  });
});

describe("TikTokFields", () => {
  it("waits for the creator options and keeps the form locked until they load", () => {
    render(createElement(TikTokFields, props("tiktok")));
    expect(element.textContent).toContain("Loading your TikTok options…");
    expect(element.querySelector("fieldset")?.disabled).toBe(true);
  });

  it("offers only the privacy choices the creator allows, with none selected", () => {
    render(createElement(TikTokFields, props("tiktok", { creator })));
    const privacy = select("Who can see this video");
    expect(privacy.value).toBe("");
    const options = [...privacy.options];
    expect(options[0]!.disabled).toBe(true);
    expect(options.slice(1).map((option) => option.value)).toEqual([
      "SELF_ONLY",
      "PUBLIC_TO_EVERYONE",
    ]);
    expect(options.slice(1).map((option) => option.textContent)).toEqual(["Only me", "Everyone"]);
    expect(element.querySelector("fieldset")?.disabled).toBe(false);
  });

  it("writes the chosen privacy without touching the other options", () => {
    render(
      createElement(
        TikTokFields,
        props("tiktok", { creator, value: { tiktok: { allowComment: true } } }),
      ),
    );
    setSelect(select("Who can see this video"), "SELF_ONLY");
    expect(onChange).toHaveBeenLastCalledWith({
      tiktok: { allowComment: true, privacy: "SELF_ONLY" },
    });
  });

  it("blocks an interaction the creator turned off, even when the draft had it on", () => {
    render(
      createElement(
        TikTokFields,
        props("tiktok", { creator, value: { tiktok: { allowDuet: true } } }),
      ),
    );
    const duet = checkbox("Allow duets")!;
    expect(duet.disabled).toBe(true);
    expect(duet.checked).toBe(false);
    expect(element.textContent).toContain("Turned off in your TikTok settings");
    expect(checkbox("Allow comments")!.disabled).toBe(false);
  });

  it("never pre-selects consent or branded content and writes them only on a click", () => {
    render(createElement(TikTokFields, props("tiktok", { creator })));
    const consent = checkbox("I confirm the consent needed to post this video to TikTok.")!;
    expect(consent.checked).toBe(false);
    expect(checkbox("Branded content (paid partnership)")!.checked).toBe(false);
    expect(checkbox("Contains AI-generated content")!.checked).toBe(false);
    act(() => consent.click());
    expect(onChange).toHaveBeenLastCalledWith({ tiktok: { consent: true } });
  });

  it("shows the attached video length and labels unknown privacy codes as they are", () => {
    render(
      createElement(
        TikTokFields,
        props("tiktok", { creator, media: [video({ durationSeconds: 20 })] }),
      ),
    );
    expect(element.textContent).toContain("Video length 20 seconds.");
    expect(privacyLabel("FOLLOWER_OF_CREATOR")).toBe("Followers");
    expect(privacyLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("YouTubeFields", () => {
  it("counts title characters against the 100 limit and has no default privacy", () => {
    render(
      createElement(YouTubeFields, props("youtube", { value: { youtube: { title: "Launch" } } })),
    );
    expect(element.textContent).toContain("6 of 100 characters");
    expect(select("Privacy").value).toBe("");
    expect(checkbox("Made for kids")!.checked).toBe(false);
  });

  it("writes title, privacy and the kids and synthetic-media answers into the YouTube draft", () => {
    render(createElement(YouTubeFields, props("youtube")));
    setInput(textInput("Title")!, "Launch day");
    expect(onChange).toHaveBeenLastCalledWith({ youtube: { title: "Launch day" } });
    setSelect(select("Privacy"), "unlisted");
    expect(onChange).toHaveBeenLastCalledWith({ youtube: { privacy: "unlisted" } });
    act(() => checkbox("Made for kids")!.click());
    expect(onChange).toHaveBeenLastCalledWith({ youtube: { madeForKids: true } });
    act(() => checkbox("Contains altered or synthetic content")!.click());
    expect(onChange).toHaveBeenLastCalledWith({ youtube: { containsSyntheticMedia: true } });
  });
});

describe("RedditFields", () => {
  it("removes a leading r/ from the subreddit and keeps the flair", () => {
    const value: PlatformDraft = { reddit: { subreddit: "", flair: "News" } };
    render(createElement(RedditFields, props("reddit", { value })));
    setInput(textInput("Subreddit")!, "r/launches");
    expect(onChange).toHaveBeenLastCalledWith({ reddit: { subreddit: "launches", flair: "News" } });
  });

  it("writes the optional flair without changing the subreddit", () => {
    render(
      createElement(
        RedditFields,
        props("reddit", { value: { reddit: { subreddit: "launches", flair: "" } } }),
      ),
    );
    setInput(textInput("Flair (optional)")!, "Showcase");
    expect(onChange).toHaveBeenLastCalledWith({
      reddit: { subreddit: "launches", flair: "Showcase" },
    });
  });
});

describe("XFields and PlatformFields", () => {
  it("explains the X media rule", () => {
    render(createElement(XFields));
    expect(element.textContent).toContain("X posts take either up to four images or one video.");
  });

  it("shows the Reel fields only for a Facebook account set to Reel", () => {
    render(
      createElement(PlatformFields, props("facebook", { value: { facebook: { target: "feed" } } })),
    );
    expect(element.textContent).not.toContain("Video frame rate (fps)");
    render(
      createElement(PlatformFields, props("facebook", { value: { facebook: { target: "reel" } } })),
    );
    expect(element.textContent).toContain("Video frame rate (fps)");
    render(
      createElement(
        PlatformFields,
        props("instagram", { value: { facebook: { target: "reel" } } }),
      ),
    );
    expect(element.textContent).not.toContain("Video frame rate (fps)");
  });

  it("picks the field set that matches the account platform", () => {
    render(createElement(PlatformFields, props("x")));
    expect(element.textContent).toContain("X posts take either up to four images or one video.");
    render(createElement(PlatformFields, props("tiktok", { creator })));
    expect(element.textContent).toContain("TikTok");
    expect(element.querySelector('select[aria-label="Who can see this video"]')).not.toBeNull();
    render(createElement(PlatformFields, props("youtube")));
    expect(element.querySelector('select[aria-label="Privacy"]')).not.toBeNull();
    render(createElement(PlatformFields, props("reddit")));
    expect(element.textContent).toContain("Subreddit");
  });

  it("renders nothing for a platform without options", () => {
    render(createElement(PlatformFields, props("linkedin")));
    expect(element.innerHTML).toBe("");
  });
});
