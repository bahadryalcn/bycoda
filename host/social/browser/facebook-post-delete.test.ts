import { afterEach, expect, it, vi } from "vitest";
import { account, fixture, recipe } from "../social-browser-publishing-test-support";
import { deleteFacebookPagePost, facebookPageDeleteTarget } from "./facebook-post-delete";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";

const pageAccount = account("facebook", "123", "page");
const post = "https://www.facebook.com/permalink.php?story_fbid=456&id=123";
const windows: ReturnType<typeof fixture>["window"][] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function deletion({
  author = "123",
  receipt = true,
  readback = true,
  quoteOnly = false,
  immediate = false,
} = {}) {
  let state = "post";
  const banner = '<header role="banner"><button aria-label="Account">Page</button></header>';
  const link = '<a href="/permalink.php?story_fbid=456&amp;id=123">April 9</a>';
  const article = `<div role="article"><h2><a href="/profile.php?id=${author}">Page</a></h2>
    ${quoteOnly ? "<blockquote>" + link + "</blockquote>" : link}
    <button aria-label="Actions for this post" data-action="options">…</button></div>`;
  const render = () => {
    if (state === "deleted")
      return (
        banner +
        (readback ? "<main><h1>This content isn't available right now</h1></main>" : article)
      );
    return banner + article;
  };
  const target = fixture(
    { ...recipe("facebook"), identity: async () => pageAccount },
    pageAccount,
    "",
    {
      render,
      click: (el) => {
        const node = target.window.document.body;
        const action = el.getAttribute("data-action");
        if (action === "options") {
          node.insertAdjacentHTML(
            "beforeend",
            '<div role="menu"><button role="menuitem" data-action="remove">Delete post</button></div>',
          );
        } else if (action === "confirm" || (action === "remove" && immediate)) {
          state = "deleted";
          node.innerHTML = banner + (receipt ? '<div role="status">Post deleted.</div>' : "");
        } else if (action === "remove") {
          node.querySelector('[role="menu"]')?.remove();
          node.insertAdjacentHTML(
            "beforeend",
            '<section role="dialog"><h2>Delete post?</h2><button data-action="confirm">Delete</button></section>',
          );
        }
      },
    },
  );
  windows.push(target.window);
  return target;
}

it("requires a direct Page post with the matching author and reopens it after the receipt", async () => {
  const { ctx, page } = deletion();
  const guard = vi.fn(async () => {});
  await expect(deleteFacebookPagePost(ctx, post, guard)).resolves.toBeUndefined();
  expect(page.goto).toHaveBeenCalledTimes(2);
  expect(page.goto).toHaveBeenNthCalledWith(2, post);
  expect(page.click).toHaveBeenCalledTimes(3);
  expect(guard).toHaveBeenCalledTimes(2);
  expect(guard.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(page.click).mock.invocationCallOrder[1]!,
  );
  expect(guard.mock.invocationCallOrder[1]).toBeLessThan(
    vi.mocked(page.click).mock.invocationCallOrder[2]!,
  );
});

it("rechecks authority before the menu action that can delete without a dialog", async () => {
  const { ctx, page } = deletion({ immediate: true });
  const guard = vi.fn(async () => {});
  await expect(deleteFacebookPagePost(ctx, post, guard)).resolves.toBeUndefined();
  expect(page.goto).toHaveBeenCalledTimes(2);
  expect(page.click).toHaveBeenCalledTimes(2);
  expect(guard).toHaveBeenCalledOnce();
  expect(guard.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(page.click).mock.invocationCallOrder[1]!,
  );
});

it.each([{ author: "999" }, { quoteOnly: true }])(
  "never opens the owner menu with an unrelated author or quote-only match (%o)",
  async (options) => {
    const { ctx, page } = deletion(options);
    await expect(deleteFacebookPagePost(ctx, post, vi.fn())).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(page.click).not.toHaveBeenCalled();
  },
);

it("stops before the delete click if owner authority changes", async () => {
  const { ctx, page } = deletion();
  const guard = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new SocialPlatformError("denied"));
  await expect(deleteFacebookPagePost(ctx, post, guard)).rejects.toMatchObject({ code: "denied" });
  expect(page.click).toHaveBeenCalledTimes(2);
});

it.each([{ receipt: false }, { readback: false }])(
  "keeps the result uncertain without both pieces of evidence (%o)",
  async (options) => {
    const { ctx, page } = deletion(options);
    await expect(deleteFacebookPagePost(ctx, post, vi.fn())).rejects.toMatchObject({
      code: "unknown",
    });
    expect(page.click).toHaveBeenCalledTimes(3);
  },
);

it("refuses profiles, external URLs and explicit URLs of another Page", () => {
  expect(() => facebookPageDeleteTarget({ ...pageAccount, accountType: "member" }, post)).toThrow(
    expect.objectContaining({ code: "unsupported" }),
  );
  expect(() =>
    facebookPageDeleteTarget(pageAccount, post.replace("facebook.com", "example.com")),
  ).toThrow(expect.objectContaining({ code: "unsupported" }));
  expect(() => facebookPageDeleteTarget(pageAccount, post.replace("id=123", "id=999"))).toThrow(
    expect.objectContaining({ code: "denied" }),
  );
  expect(() => facebookPageDeleteTarget(pageAccount, post + "&story_fbid=999")).toThrow(
    expect.objectContaining({ code: "rejected" }),
  );
});
