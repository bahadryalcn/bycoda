import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { account, fixture, job, recipe } from "../social-browser-publishing-test-support";
import { selectTikTokPostMedia, tiktokDeletePost, tiktokEditPost } from "./browser-publish-ext";

const managePost = readFileSync(
  new URL("../fixtures/tiktok/manage-post.html", import.meta.url),
  "utf8",
);
const owner = account("tiktok", "web:tiktok:bycoda");

describe("TikTok post management", () => {
  function setup(click: (name: string | null) => void = () => {}) {
    let caption = "Original caption";
    let deleted = false;
    const result = fixture(recipe("tiktok"), owner, managePost, {
      render: () =>
        deleted
          ? '<header><a data-e2e="nav-profile" href="/@bycoda">Profile</a></header><p data-e2e="post-not-available">Unavailable</p>'
          : managePost.replaceAll("Original caption", caption),
      click(element) {
        const name = element.getAttribute("data-e2e");
        click(name);
        const dom = result.window.document;
        if (name === "browse-more-menu") {
          dom.querySelector('[data-e2e="browse-edit"]')?.removeAttribute("hidden");
          dom.querySelector('[data-e2e="browse-delete"]')?.removeAttribute("hidden");
        }
        if (name === "browse-edit")
          dom.querySelector('[data-fixture="edit"]')?.removeAttribute("hidden");
        if (name === "browse-delete")
          dom.querySelector('[data-fixture="delete"]')?.removeAttribute("hidden");
        if (name === "edit-post-save") {
          caption = dom.querySelector('[data-e2e="caption-editor"]')!.textContent!;
          dom.querySelector('[data-e2e="browse-video-desc"]')!.textContent = caption;
        }
        if (name === "confirm-delete") {
          deleted = true;
          dom.body.insertAdjacentHTML("beforeend", '<p role="status">Post deleted.</p>');
        }
      },
    });
    return result;
  }

  it("edits only the selected post and checks the saved caption after reloading", async () => {
    const { ctx, page } = setup();
    const authorize = vi.fn(async () => {});
    await expect(
      tiktokEditPost(ctx, { postId: "123", caption: "Revised caption" }, authorize),
    ).resolves.toEqual({ postId: "123" });
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.goto).toHaveBeenLastCalledWith("https://www.tiktok.com/@bycoda/video/123");
    expect(authorize).toHaveBeenCalledBefore(vi.mocked(ctx.markSubmitted!));
    expect(ctx.markSubmitted).toHaveBeenCalledOnce();
  });

  it("does not click the confirmed delete when owner authorization is revoked", async () => {
    const clicks = vi.fn();
    const { ctx } = setup(clicks);
    await expect(
      tiktokDeletePost(ctx, { postId: "123" }, async () => {
        throw new Error("Approval changed.");
      }),
    ).rejects.toThrow("Approval changed.");
    expect(clicks).not.toHaveBeenCalledWith("confirm-delete");
    expect(ctx.markSubmitted).not.toHaveBeenCalled();
  });

  it("verifies both deletion confirmation and disappearance", async () => {
    const { ctx, page } = setup();
    await expect(tiktokDeletePost(ctx, { postId: "123" }, async () => {})).resolves.toEqual({
      postId: "123",
    });
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(ctx.markSubmitted).toHaveBeenCalledOnce();
  });

  it("waits for the owner on a challenge before clicking anything", async () => {
    const { ctx, page } = fixture(recipe("tiktok"), owner, "<h1>Security verification</h1>");
    await expect(tiktokDeletePost(ctx, { postId: "123" }, async () => {})).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(page.click).not.toHaveBeenCalled();
  });
});

it("attaches local photos, fills their title and applies the exact selected cover", async () => {
  const studio = [
    '<a data-e2e="nav-profile" href="/@bycoda">Profile</a>',
    '<input type="file" accept="image/jpeg,image/png" multiple>',
    '<textarea data-e2e="photo-title"></textarea>',
    '<button data-e2e="photo-cover-option" data-index="0" aria-pressed="false">First</button>',
    '<button data-e2e="photo-cover-option" data-index="1" aria-pressed="false">Second</button>',
  ].join("");
  const { ctx, page, window } = fixture(recipe("tiktok"), owner, studio, {
    click: (element) => {
      element.setAttribute("aria-pressed", "true");
    },
  });
  ctx.files = [
    { path: "first.jpg", kind: "image" },
    { path: "second.jpg", kind: "image" },
  ];
  const request = job("publish", {
    tiktok: {
      mediaType: "photo",
      photoTitle: "Launch photos",
      photoCoverIndex: 1,
      autoAddMusic: false,
      privacy: "SELF_ONLY",
      durationSeconds: 0,
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      brandContent: false,
      brandOrganic: false,
      isAigc: false,
      consent: true,
    },
  });
  await selectTikTokPostMedia(ctx, request, true);
  expect(page.setFiles).toHaveBeenCalledExactlyOnceWith('[data-bycoda-web-control="media"]', [
    "first.jpg",
    "second.jpg",
  ]);
  expect(window.document.querySelector('[data-e2e="photo-title"]')!.textContent).toBe(
    "Launch photos",
  );
  expect(window.document.querySelector('[data-index="0"]')!.getAttribute("aria-pressed")).toBe(
    "false",
  );
  expect(window.document.querySelector('[data-index="1"]')!.getAttribute("aria-pressed")).toBe(
    "true",
  );
});
