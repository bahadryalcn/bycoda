import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { youtubeCommentReaction } from "./browser/youtube-comment-actions";
import { account, fixture, recipe } from "./social-browser-publishing-test-support";
import { parseYouTubeCommunityPost, youtubePublishCommunity } from "./social-browser-youtube-community";
import { youtubeBrowserEarnings } from "./social-browser-youtube-earnings";
import { parseYouTubeBrowserProfilePatch, youtubeUpdateBrowserProfile } from "./social-browser-youtube-profile";

const channel = "UCabcdefghijklmnopqrstuv";
const author = "UC1234567890123456789012";
const owner = () => account("youtube", `web:youtube:${channel}`, "channel");
const imageId = "49355315-80db-457e-960d-cdb370d17a80";
const recorded = (name: string) => readFileSync(new URL(`./fixtures/youtube/${name}`, import.meta.url), "utf8")
  .replace(/^[\s\S]*<body>/i, "").replace(/<\/body>[\s\S]*$/i, "");

describe("YouTube Studio comment reactions", () => {
  it.each(["like", "heart"] as const)("changes only the bound comment's %s and verifies the saved state", async (reaction) => {
    const html = recorded("studio-comment-actions.html");
    let persisted = html;
    const f = fixture(recipe("youtube"), owner(), html, {
      render: () => persisted,
      click: (control) => {
        expect(control.closest("ytcp-comment-thread")?.textContent).toContain("First author");
        expect(control.id).toBe(`${reaction}-button`);
        control.setAttribute("aria-pressed", "true");
        persisted = f.window.document.body.innerHTML;
      },
    });
    const input = { commentId: "UgxFixtureComment01", authorChannelId: author, enabled: true, reaction };
    await expect(youtubeCommentReaction(f.ctx, input)).resolves.toEqual({ commentId: input.commentId, enabled: true, reaction, changed: true });
    await expect(youtubeCommentReaction(f.ctx, input)).resolves.toMatchObject({ changed: false });
    expect(f.page.click).toHaveBeenCalledOnce();
  });

  it("fails closed on changed layout and mismatched target author", async () => {
    const html = recorded("studio-comment-actions.html");
    const f = fixture(recipe("youtube"), owner(), html, { render: () => html });
    const target = { commentId: "UgxFixtureComment01", reaction: "heart", enabled: true } as const;
    await expect(youtubeCommentReaction(f.ctx, { ...target, authorChannelId: channel })).rejects.toMatchObject({ code: "unsupported" });
    const changed = recorded("studio-comments-changed-layout.html");
    const g = fixture(recipe("youtube"), owner(), changed, { render: () => changed });
    await expect(youtubeCommentReaction(g.ctx, target)).rejects.toMatchObject({ code: "unsupported" });
    expect(g.page.click).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
  });
});

describe("YouTube Studio profile and earnings", () => {
  it("patches profile fields, keeps omitted fields and verifies after reload", async () => {
    const html = recorded("studio-customization.html");
    let persisted = html;
    const f = fixture(recipe("youtube"), owner(), html, {
      render: () => persisted,
      click: (button) => {
        if (button.id === "publish-button") {
          for (const input of f.window.document.querySelectorAll("input:not([type=file])")) input.setAttribute("value", input.value);
          button.setAttribute("aria-disabled", "true");
          persisted = f.window.document.body.innerHTML;
        }
        if (button.id === "add-link") button.insertAdjacentHTML("beforebegin", '<ytcp-channel-link><span id="link-title"><input></span><span id="link-url"><input></span></ytcp-channel-link>');
      },
    });
    vi.mocked(f.page.fill).mockImplementation(async (selector, value) => {
      const input = f.window.document.querySelector<HTMLInputElement>(selector);
      if (!input) throw new Error("Missing fixture editor");
      input.value = value;
    });
    const links = [{ title: "Website", url: "https://example.test/" }];
    await expect(youtubeUpdateBrowserProfile(f.ctx, { name: "New channel", links })).resolves.toMatchObject({
      name: "New channel", handle: "@original", links, avatarUrl: "https://yt3.googleusercontent.com/old-avatar",
    });
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
  });

  it("blocks invalid patches and defers human verification without interaction", async () => {
    expect(() => parseYouTubeBrowserProfilePatch({ links: [{ title: "Bad", url: "https://other:pass@example.test/" }] })).toThrow();
    expect(() => parseYouTubeBrowserProfilePatch({ email: "unrelated" })).toThrow();
    const html = recorded("studio-human-verification.html");
    const f = fixture(recipe("youtube"), owner(), html, { render: () => html });
    await expect(youtubeUpdateBrowserProfile(f.ctx, { handle: "@strong_name" })).rejects.toMatchObject({ code: "needs_human" });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });

  it("reads only Studio's eligibility state, never eligibility actions or payout text", async () => {
    const html = `<ytcp-app><a id="channel-link" href="https://www.youtube.com/channel/${channel}">YouTube</a><ytcp-monetization-page><button id="apply-button">Apply Now</button><p>Private payout details</p></ytcp-monetization-page></ytcp-app>`;
    const f = fixture(recipe("youtube"), owner(), html, { render: () => html });
    await expect(youtubeBrowserEarnings(f.ctx)).resolves.toEqual({ status: "eligible", url: `https://studio.youtube.com/channel/${channel}/monetization` });
    expect(f.page.click).not.toHaveBeenCalled();
  });
});

describe("YouTube community publishing", () => {
  function composer(eligible = true, receipt = true) {
    const html = recorded("channel-community.html");
    const f = fixture(recipe("youtube"), owner(), html, {
      render: () => html,
      click: (control) => {
        const token = control.getAttribute("data-bycoda-web-control");
        const body = f.window.document.body;
        if (token === "community-create" && eligible) body.insertAdjacentHTML("beforeend", '<ytd-menu-popup-renderer><ytd-menu-service-item-renderer>Create post</ytd-menu-service-item-renderer></ytd-menu-popup-renderer>');
        if (token === "community-create-post") body.insertAdjacentHTML("beforeend", '<ytd-backstage-post-dialog-renderer><div id="contenteditable-root" contenteditable="true"></div><button id="submit-button">Post</button><button id="poll-button">Poll</button><button id="image-button">Image</button></ytd-backstage-post-dialog-renderer>');
        if (token === "community-poll") control.insertAdjacentHTML("afterend", '<button id="text-poll-button">Text poll</button>');
        if (token === "community-text-poll") control.insertAdjacentHTML("afterend", '<ytd-backstage-poll-editor-renderer><ytd-backstage-poll-option-editor-renderer><input></ytd-backstage-poll-option-editor-renderer><ytd-backstage-poll-option-editor-renderer><input></ytd-backstage-poll-option-editor-renderer><button id="add-option-button">Add another option</button></ytd-backstage-poll-editor-renderer>');
        if (token === "community-image") control.insertAdjacentHTML("afterend", '<input type="file" accept="image/jpeg" hidden><ytd-backstage-image-editor-renderer><img></ytd-backstage-image-editor-renderer>');
        if (token === "community-add-option") control.insertAdjacentHTML("beforebegin", '<ytd-backstage-poll-option-editor-renderer><input></ytd-backstage-poll-option-editor-renderer>');
        if (token === "community-submit" && receipt) {
          const dialog = control.closest("ytd-backstage-post-dialog-renderer")!;
          const value = dialog.querySelector("#contenteditable-root")?.textContent ?? "";
          dialog.remove();
          body.insertAdjacentHTML("beforeend", `<ytd-notification-action-renderer><span id="text">Post created</span></ytd-notification-action-renderer><ytd-backstage-post-thread-renderer><a id="author-text" href="/channel/${channel}">Bycoda Fixture</a><a href="/post/UgFixturePost001">Permalink</a><span id="content-text"></span></ytd-backstage-post-thread-renderer>`);
          body.querySelector("#content-text")!.textContent = value;
        }
      },
    });
    vi.mocked(f.page.setFiles).mockImplementation(async () => {
      const preview = f.window.document.querySelector("ytd-backstage-image-editor-renderer img")!;
      Object.defineProperty(preview, "complete", { value: true });
      Object.defineProperty(preview, "naturalWidth", { value: 100 });
    });
    return f;
  }

  it.each([
    { kind: "text", text: "Release announcement" },
    { kind: "image", text: "Preview", imageUploadIds: [imageId] },
    { kind: "poll", text: "Choose a topic", choices: ["Live", "Shorts", "Playlists"] },
  ])("publishes $kind once and returns the provider post ID", async (post) => {
    const f = composer();
    if (post.imageUploadIds) f.ctx.files = [{ kind: "image", path: "preview.jpg" }];
    await expect(youtubePublishCommunity(f.ctx, post)).resolves.toEqual({ platformId: "UgFixturePost001", url: "https://www.youtube.com/post/UgFixturePost001", visibility: "public" });
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
    expect(vi.mocked(f.page.setFiles).mock.calls).toHaveLength(post.imageUploadIds ? 1 : 0);
  });

  it("rejects ineligible accounts, validates poll choices and preserves uncertainty after submission", async () => {
    expect(() => parseYouTubeCommunityPost({ kind: "poll", text: "Question?", choices: ["Same", "Same"] })).toThrow();
    const g = composer(false);
    const post = { kind: "text", text: "Release" };
    await expect(youtubePublishCommunity(g.ctx, post)).rejects.toMatchObject({ code: "unsupported" });
    expect(g.ctx.markSubmitted).not.toHaveBeenCalled();
    const f = composer(true, false);
    await expect(youtubePublishCommunity(f.ctx, post)).rejects.toMatchObject({ code: "unknown" });
    expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
  });
});
