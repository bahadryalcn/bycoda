import { describe, expect, it } from "vitest";
import {
  tiktokCommentCreatedId,
  tiktokCommentRows,
  tiktokVideoCreatedId,
} from "./social-browser-publishing";
import { UnexpectedScreen } from "./browser-layers/types";
import { account, fixture, job, now, recipe } from "./social-browser-publishing-test-support";
describe("TikTok recognized response boundaries", () => {
  const post = "1234567890123";
  const comment = {
    cid: "4567890123456",
    aweme_id: post,
    text: "Hello",
    create_time: now / 1000,
    user: { unique_id: "viewer", nickname: "Viewer" },
  };
  it("parses a bounded comment response tied to the opened video", () => {
    expect(
      tiktokCommentRows(JSON.stringify({ status_code: 0, comments: [comment] }), post),
    ).toEqual([
      {
        id: comment.cid,
        postId: post,
        contactId: "web:tiktok:viewer",
        name: "Viewer",
        text: "Hello",
        at: now,
      },
    ]);
    expect(tiktokCommentRows(JSON.stringify({ status_code: 0, comments: [] }), post)).toEqual([]);
  });
  it("rejects wrong-video and unrecognized payloads instead of empty reads", () => {
    expect(
      tiktokCommentRows(
        JSON.stringify({ status_code: 0, comments: [{ ...comment, aweme_id: "999" }] }),
        post,
      ),
    ).toBeUndefined();
    expect(tiktokCommentRows(JSON.stringify({ status_code: 0 }), post)).toBeUndefined();
    expect(
      tiktokCommentRows(JSON.stringify({ status_code: 1, comments: [] }), post),
    ).toBeUndefined();
  });
  it("binds comment delivery to sender, exact text and video", () => {
    const raw = JSON.stringify({ status_code: 0, comment });
    expect(tiktokCommentCreatedId(raw, post, "Hello", "web:tiktok:viewer")).toBe(comment.cid);
    expect(tiktokCommentCreatedId(raw, post, "Hello", "web:tiktok:other")).toBeUndefined();
    expect(tiktokCommentCreatedId(raw, "999", "Hello", "web:tiktok:viewer")).toBeUndefined();
    expect(tiktokCommentCreatedId(raw, post, "Different", "web:tiktok:viewer")).toBeUndefined();
  });
  it("does not treat a media-upload ID or a failed create response as a published video ID", () => {
    expect(
      tiktokVideoCreatedId(JSON.stringify({ status_code: 0, data: { upload_id: "123" } })),
    ).toBeUndefined();
    expect(
      tiktokVideoCreatedId(JSON.stringify({ status_code: 5, data: { video_id: "123" } })),
    ).toBeUndefined();
    expect(
      tiktokVideoCreatedId(JSON.stringify({ status_code: 0, data: { video_id: "123" } })),
    ).toBe("123");
  });
  it("does not take a viewed creator profile as authenticated identity", async () => {
    const f = fixture(
      recipe("tiktok"),
      account("tiktok", "web:tiktok:bycoda"),
      '<main><a href="/@bycoda">Bycoda profile</a></main>',
    );
    await expect(recipe("tiktok").identity(f.page)).resolves.toBeUndefined();
  });
  it("requires explicit music consent and valid privacy before uploading", async () => {
    const f = fixture(
      recipe("tiktok"),
      account("tiktok", "web:tiktok:bycoda"),
      '<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header>',
    );
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("tiktok").send(
        f.ctx,
        job("publish", {
          media: [{ kind: "video", uploadId: "id" }],
          tiktok: {
            privacy: "SELF_ONLY",
            durationSeconds: 30,
            allowComment: true,
            allowDuet: false,
            allowStitch: false,
            brandContent: false,
            brandOrganic: false,
            isAigc: false,
            consent: false,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
});

describe("authenticated uploaded video journeys", () => {
  it("reads TikTok creator choices from visible upload controls instead of assuming all privacy settings", async () => {
    const html =
      '<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header><button data-e2e="privacy-select">Only you</button><div role="option">Only you</div><div data-e2e="upload-info">Videos up to 10 minutes</div><input name="comment" type="checkbox"><input name="duet" type="checkbox" disabled><input name="stitch" type="checkbox">';
    const f = fixture(recipe("tiktok"), account("tiktok", "web:tiktok:bycoda"), html, {
      render: () => html,
    });
    await expect(recipe("tiktok").creatorInfo!(f.ctx)).resolves.toEqual({
      nickname: "Bycoda",
      privacyOptions: ["SELF_ONLY"],
      maxDurationSeconds: 600,
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: false,
    });
  });
  it("does not invent a TikTok duration limit when the uploader exposes none", async () => {
    const html =
      '<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header><button data-e2e="privacy-select">Only you</button><div role="option">Only you</div>';
    const f = fixture(recipe("tiktok"), account("tiktok", "web:tiktok:bycoda"), html, {
      render: () => html,
    });
    // A missing required Studio element hands the page to the next layer; it is not a silent unsupported.
    const error = (await recipe("tiktok").creatorInfo!(f.ctx).catch(
      (caught: unknown) => caught,
    )) as UnexpectedScreen;
    expect(error).toBeInstanceOf(UnexpectedScreen);
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
  it("requires every requested TikTok switch and confirms the acknowledged video on the owner's profile", async () => {
    let published = false;
    const post = "123456789012345";
    const html = () =>
      `<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header>${
        published
          ? `<div data-e2e="user-post-item"><a href="/@bycoda/video/${post}">Video</a><div data-e2e="user-post-item-desc">A Bycoda update</div></div>`
          : `
      <input type="file" accept="video/*"><div data-e2e="caption-editor" contenteditable="true"></div><button data-e2e="privacy-select">Only you</button><div role="option">Only you</div>
      ${["allow-comment", "allow-duet", "allow-stitch", "content-disclosure", "ai-generated-content", "music-usage-confirmation"].map((name) => `<input type="checkbox" name="${name}">`).join("")}<button data-e2e="post_video_button">Post</button>`
      }`;
    const f = fixture(recipe("tiktok"), account("tiktok", "web:tiktok:bycoda"), html(), {
      render: html,
      response: JSON.stringify({ status_code: 0, data: { video_id: post } }),
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.getAttribute("data-e2e") === "post_video_button") published = true;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("tiktok").send(
        f.ctx,
        job("publish", {
          media: [{ kind: "video", uploadId: "id" }],
          tiktok: {
            privacy: "SELF_ONLY",
            durationSeconds: 30,
            allowComment: true,
            allowDuet: false,
            allowStitch: false,
            brandContent: false,
            brandOrganic: false,
            isAigc: false,
            consent: true,
          },
        }),
      ),
    ).resolves.toEqual({ platformId: post, url: `https://www.tiktok.com/@bycoda/video/${post}` });
    expect(f.page.setFiles).toHaveBeenCalledOnce();
  });
});
