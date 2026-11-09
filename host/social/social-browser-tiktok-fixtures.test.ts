import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UnexpectedScreen } from "./browser-layers/types";
import { tiktokCollectAudience } from "./social-browser-tiktok";
import { account, fixture, job, recipe } from "./social-browser-publishing-test-support";

const handle = "web:tiktok:bycoda";
const post = "1234567890123";
const owner = () => account("tiktok", handle);

/** Synthetic body fragments (hand-written, not recorded from TikTok). */
function page(name: string): string {
  return readFileSync(new URL(`./fixtures/tiktok/${name}`, import.meta.url), "utf8").replace(
    /^<!--[\s\S]*?-->\s*/,
    "",
  );
}

const publish = () =>
  job("publish", {
    text: "A Bycoda update",
    media: [{ kind: "video", uploadId: "id" }],
    tiktok: {
      privacy: "SELF_ONLY",
      durationSeconds: 30,
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      brandContent: false,
      brandOrganic: false,
      isAigc: false,
      consent: true,
    },
  });

describe("recorded-layout TikTok Studio pages (synthetic fixtures)", () => {
  it("treats a visible captcha during upload as NEEDS_HUMAN and never attaches or clicks", async () => {
    const html = page("studio-captcha.html");
    const f = fixture(recipe("tiktok"), owner(), html, { render: () => html });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(recipe("tiktok").send(f.ctx, publish())).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(f.page.setFiles).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });

  it("hands a changed upload layout to the next layer before any file is attached", async () => {
    const html = page("studio-upload-changed.html");
    const f = fixture(recipe("tiktok"), owner(), html, { render: () => html });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    const error = (await recipe("tiktok")
      .send(f.ctx, publish())
      .catch((caught: unknown) => caught)) as UnexpectedScreen;
    expect(error).toBeInstanceOf(UnexpectedScreen);
    expect(error.snapshot.headings).toEqual(["New upload experience"]);
    expect(f.page.setFiles).not.toHaveBeenCalled();
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });

  it("does not read a captcha page as an empty comment list", async () => {
    const html = page("studio-captcha.html");
    const f = fixture(recipe("tiktok"), owner(), html, { render: () => html });
    await expect(recipe("tiktok").poll(f.ctx, [post])).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("hands a comment response that no longer matches the video to the next layer", async () => {
    const html = page("profile-comments-changed.html");
    const wrongVideo = JSON.stringify({
      status_code: 0,
      comments: [
        { cid: "1", aweme_id: "999", text: "x", create_time: 1, user: { unique_id: "v" } },
      ],
    });
    const f = fixture(recipe("tiktok"), owner(), html, {
      render: () => html,
      response: wrongVideo,
    });
    const error = (await recipe("tiktok")
      .poll(f.ctx, [post])
      .catch((caught: unknown) => caught)) as UnexpectedScreen;
    expect(error).toBeInstanceOf(UnexpectedScreen);
    expect(error.snapshot.headings).toEqual(["Comments moved"]);
  });

  it("collects commenters from the owner's recent video comments without interacting", async () => {
    const html = page("profile-comments-changed.html");
    const response = readFileSync(
      new URL("./fixtures/tiktok/comment-list.json", import.meta.url),
      "utf8",
    );
    const f = fixture(recipe("tiktok"), owner(), html, { render: () => html, response });
    const result = await tiktokCollectAudience(f.ctx, [post]);
    expect(result.people).toEqual([
      {
        platformId: "web:tiktok:viewer_one",
        name: "Viewer One",
        username: "viewer_one",
        kind: "comment",
        text: "Where can I buy this?",
        ref: post,
        at: 1767225600000,
      },
      {
        platformId: "web:tiktok:viewer_two",
        name: "Viewer Two",
        username: "viewer_two",
        kind: "comment",
        text: "Great update",
        ref: post,
        at: 1767225660000,
      },
    ]);
    expect(result.next).toBe("0");
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });

  it("refuses inbox drafts in the browser before opening Studio", async () => {
    const html = page("studio-upload-changed.html");
    const f = fixture(recipe("tiktok"), owner(), html, { render: () => html });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    const draft = publish();
    draft.payload.tiktok = {
      ...draft.payload.tiktok!,
      mode: "inbox",
    } as typeof draft.payload.tiktok;
    await expect(recipe("tiktok").send(f.ctx, draft)).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(f.page.goto).not.toHaveBeenCalled();
  });
});
