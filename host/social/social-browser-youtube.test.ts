import { describe, expect, it, vi } from "vitest";
import { youtubeCommentCreatedId } from "./social-browser-publishing";
import { account, fixture, job, recipe } from "./social-browser-publishing-test-support";
describe("YouTube channel and comment acknowledgement", () => {
  const channel = "UCabcdefghijklmnopqrstuv";
  const replyId = "UgxyzReply_12345";
  const ack = (owner = channel, text = "A Bycoda update") =>
    JSON.stringify({
      actions: [
        {
          createCommentReplyAction: {
            commentRenderer: {
              commentId: replyId,
              contentText: { runs: [{ text }] },
              authorEndpoint: { browseEndpoint: { browseId: owner } },
            },
          },
        },
      ],
    });
  it("accepts only the exact comment text and selected author channel", () => {
    expect(youtubeCommentCreatedId(ack(), "A Bycoda update", channel)).toBe(replyId);
    expect(
      youtubeCommentCreatedId(ack("UCwrongabcdefghijklmnopq"), "A Bycoda update", channel),
    ).toBeUndefined();
    expect(
      youtubeCommentCreatedId(ack(channel, "Other text"), "A Bycoda update", channel),
    ).toBeUndefined();
  });
  it("ignores unrelated player/guide actions and malformed envelopes", () => {
    expect(
      youtubeCommentCreatedId(
        JSON.stringify({ actions: [{ commentId: replyId }] }),
        "A Bycoda update",
        channel,
      ),
    ).toBeUndefined();
    expect(youtubeCommentCreatedId("not JSON", "A Bycoda update", channel)).toBeUndefined();
  });
  it("requires the authenticated Studio channel to match the navigation link", async () => {
    const f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      `<ytcp-app><a id="channel-link" href="https://www.youtube.com/channel/${channel}">Bycoda</a></ytcp-app>`,
    );
    f.window.location.href = `https://studio.youtube.com/channel/${channel}/videos/upload`;
    await expect(recipe("youtube").identity(f.page)).resolves.toEqual({
      platformId: `web:youtube:${channel}`,
      name: "Bycoda",
    });
    f.window.location.href =
      "https://studio.youtube.com/channel/UC0000000000000000000000/videos/upload";
    await expect(recipe("youtube").identity(f.page)).resolves.toBeUndefined();
  });
  it("rejects incomplete audience/synthetic declarations before uploading a file", async () => {
    const f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      "<ytcp-app></ytcp-app>",
    );
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("youtube").send(f.ctx, job("publish", { media: [{ kind: "video", uploadId: "id" }] })),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
  it("rejects forbidden description characters before media upload", async () => {
    const f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      "<ytcp-app></ytcp-app>",
    );
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("youtube").send(
        f.ctx,
        job("publish", {
          text: "bad <description>",
          media: [{ kind: "video", uploadId: "id" }],
          youtube: {
            title: "Bycoda",
            privacy: "private",
            madeForKids: false,
            containsSyntheticMedia: false,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
});

describe("authenticated uploaded video journeys", () => {
  it("carries explicit YouTube declarations through the wizard and reopens the saved channel row", async () => {
    const channel = "UCabcdefghijklmnopqrstuv",
      video = "abcDEF123_-";
    let saved = false,
      next = 0;
    const html =
      () => `<ytcp-app><a id="channel-link" href="https://www.youtube.com/channel/${channel}">Bycoda</a>
      ${
        saved
          ? `<ytcp-video-row><a id="video-title" href="/video/${video}/edit">Bycoda release</a><span id="visibility">Private</span><span id="status">Checks complete</span></ytcp-video-row>`
          : `
      <ytcp-button id="create-icon">Create</ytcp-button><tp-yt-paper-item>Upload videos</tp-yt-paper-item><ytcp-uploads-dialog>
      <input type="file"><div id="title-textarea"><div id="textbox" contenteditable="true"></div></div><div id="description-textarea"><div id="textbox" contenteditable="true"></div></div>
      <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_NOT_MFK"></tp-yt-paper-radio-button><ytcp-video-metadata-editor-advanced><ytcp-form-section><h3>Altered content</h3><div role="radio">Yes</div><div role="radio">No</div></ytcp-form-section></ytcp-video-metadata-editor-advanced>
      <ytcp-button id="next-button">Next</ytcp-button><ytcp-button id="done-button">Save</ytcp-button></ytcp-uploads-dialog>`
      }</ytcp-app>`;
    let f: ReturnType<typeof fixture>;
    f = fixture(
      recipe("youtube"),
      account("youtube", `web:youtube:${channel}`, "channel"),
      html(),
      {
        render: html,
        click: (el) => {
          if (el.id === "next-button" && ++next === 3)
            f.window.document
              .querySelector("ytcp-uploads-dialog")!
              .insertAdjacentHTML(
                "beforeend",
                '<tp-yt-paper-radio-button name="PRIVATE"></tp-yt-paper-radio-button>',
              );
          if (el.matches('tp-yt-paper-radio-button,[role="radio"]')) el.setAttribute("checked", "");
          if (el.id === "done-button") {
            saved = true;
            f.window.document.body.innerHTML = html();
          }
        },
      },
    );
    vi.mocked(f.page.setFiles).mockImplementation(async () => {
      f.window.document
        .querySelector("ytcp-uploads-dialog")!
        .insertAdjacentHTML("beforeend", `<a href="https://youtu.be/${video}">Uploaded video</a>`);
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    const sent = job("publish", {
      text: "A product video",
      media: [{ kind: "video", uploadId: "id" }],
      youtube: {
        title: "Bycoda release",
        privacy: "private",
        madeForKids: false,
        containsSyntheticMedia: false,
      },
    });
    await expect(recipe("youtube").send(f.ctx, sent)).resolves.toEqual({
      platformId: video,
      url: `https://www.youtube.com/watch?v=${video}`,
      visibility: "private",
    });
    expect(next).toBe(3);
    expect(f.page.setFiles).toHaveBeenCalledOnce();
    expect(f.page.fill).toHaveBeenCalledWith(expect.any(String), "Bycoda release");
    expect(f.page.fill).toHaveBeenCalledWith(expect.any(String), "A product video");
  });
});
