import { afterEach, expect, it, vi } from "vitest";
import { account, fixture, recipe } from "../social-browser-publishing-test-support";
import { PlatformBrowserSessions } from "../social-browser-platforms";
import { deleteRedditBrowserPost } from "./reddit-post-delete";

const member = account("reddit", "web:reddit:t2_owner");
const id = "t3_abcd";
const url = "https://www.reddit.com/comments/abcd/";
const windows: ReturnType<typeof fixture>["window"][] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function post({
  author = "t2_owner",
  deletion = true,
  profile = false,
  dialogLabel = "Delete post?",
} = {}) {
  const current = fixture({ ...recipe("reddit"), identity: async () => member }, member, "");
  windows.push(current.window);
  const { document } = current.window;
  const clicks: string[] = [];
  let deleted = false;
  function render() {
    if (deleted && deletion) {
      document.body.innerHTML = profile
        ? `<shreddit-post id="${id}" author="[deleted]" is-author-deleted post-title="Retained title"></shreddit-post>`
        : `<shreddit-post id="${id}" author="[deleted]">
          <p>Sorry, this post was deleted by the person who originally posted it.</p></shreddit-post>`;
      return;
    }
    document.body.innerHTML = `<shreddit-post id="${id}" author-id="${author}">
      <shreddit-post-overflow-menu post-id="${id}" author-id="${author}">
        <button aria-label="Open user actions">…</button>
      </shreddit-post-overflow-menu></shreddit-post>`;
    const menu = document.querySelector("shreddit-post-overflow-menu")!;
    const shadow = menu.attachShadow({ mode: "open" });
    menu.querySelector("button")!.addEventListener("click", () => {
      clicks.push("menu");
      shadow.innerHTML = '<button role="menuitem">Delete</button>';
      shadow.querySelector("button")!.addEventListener("click", () => {
        clicks.push("delete");
        document.body.insertAdjacentHTML(
          "beforeend",
          profile
            ? '<div id="post-deletion-confirmation-modal"><rpl-modal-card><div>Delete post?</div><button id="deleteBtn" slot="primary-button">Yes, Delete</button></rpl-modal-card></div>'
            : '<section role="dialog"><h2>Delete post?</h2><button>Yes, Delete</button></section>',
        );
        if (profile) {
          const shell = document.querySelector("#post-deletion-confirmation-modal")!;
          vi.spyOn(shell, "getClientRects").mockReturnValue(
            [] as unknown as ReturnType<typeof shell.getClientRects>,
          );
          shell.attachShadow({
            mode: "open",
          }).innerHTML = `<div role="dialog" aria-modal="true" aria-label="${dialogLabel}"><slot></slot></div>`;
        }
        document
          .querySelector(profile ? "#deleteBtn" : '[role="dialog"] button')!
          .addEventListener("click", () => {
            clicks.push("confirm");
            deleted = true;
            render();
          });
      });
    });
  }
  vi.mocked(current.page.goto).mockImplementation(async (path) => {
    current.window.location.href = profile
      ? "https://www.reddit.com/user/bycoda/comments/abcd/retained_title/"
      : path;
    render();
  });
  vi.mocked(current.page.click).mockImplementation(async (selector) => {
    const button = document.querySelector(selector);
    if (!(button instanceof current.window.HTMLButtonElement))
      throw new Error("Missing fixture button");
    button.click();
  });
  const guard = vi.fn(async () => {
    clicks.push("guard");
  });
  return { ...current, guard, clicks };
}

it("opens only the owned post and rereads its author-deletion tombstone", async () => {
  const { ctx, page, guard, clicks } = post();
  await deleteRedditBrowserPost(ctx, id, guard);
  expect(clicks).toEqual(["menu", "guard", "delete", "guard", "confirm"]);
  expect(vi.mocked(page.goto).mock.calls).toEqual([[url], [url]]);
});

it("accepts the author-deletion marker on the canonical profile permalink", async () => {
  const { ctx, guard, clicks } = post({ profile: true });
  await deleteRedditBrowserPost(ctx, id, guard);
  expect(clicks).toEqual(["menu", "guard", "delete", "guard", "confirm"]);
});

it("leaves the post in review when the portal labels a different deletion", async () => {
  const { ctx, guard, clicks } = post({ profile: true, dialogLabel: "Delete comment?" });
  await expect(deleteRedditBrowserPost(ctx, id, guard)).rejects.toMatchObject({ code: "unknown" });
  expect(clicks).toEqual(["menu", "guard", "delete"]);
});

it("rejects another author before any control is opened", async () => {
  const { ctx, guard, clicks } = post({ author: "t2_other" });
  await expect(deleteRedditBrowserPost(ctx, id, guard)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(clicks).toEqual([]);
});

it("uses the locked browser adapter without recording a submission before verifying the author", async () => {
  const { page, guard, clicks } = post({ author: "t2_other" });
  let now = 0;
  const sessions = new PlatformBrowserSessions(
    ".",
    [{ ...recipe("reddit"), identity: async () => member }],
    async () => ({ page, closed: Promise.resolve(), close: async () => {} }),
    undefined,
    () => "fixture",
    async (_accountId, action) => await action(),
    () => (now += 13_000),
    async () => {},
    true,
  );
  await expect(sessions.adapter().deletePost!(member, "", id, guard)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(clicks).toEqual([]);
  expect(guard).not.toHaveBeenCalled();
});

it("does not confirm deletion if the original post is still present", async () => {
  const { ctx, guard } = post({ deletion: false });
  await expect(deleteRedditBrowserPost(ctx, id, guard)).rejects.toMatchObject({ code: "unknown" });
});
