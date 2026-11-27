import { describe, expect, it, vi } from "vitest";
import { account, fixture } from "./social-browser-publishing-test-support";
import { deleteXPost } from "./social-browser-x-delete";
import { SocialPlatformError } from "../../src/integrations/social/adapter";

const owner = account("x", "42");
const postUrl = "https://x.com/i/web/status/123";
const canonicalPostUrl = "https://x.com/bycoda/status/123";
const profile = '<a data-testid="AppTabBar_Profile_Link" href="/bycoda">Profile</a>';
const deleteReceipt = JSON.stringify({ data: { delete_tweet: { tweet_results: {} } } });
const missingPost =
  '<div data-testid="primaryColumn"><div data-testid="error-detail"><span>Hmm...this page doesn’t exist. Try searching for something else.</span></div></div>';
const post = (author: string, id: string) => `
  <article data-testid="tweet">
    <div data-testid="User-Name"><a href="/${author}">${author}</a></div>
    <a href="/${author}/status/${id}"><time>4:00</time></a>
    <button data-testid="caret">More</button>
  </article>`;

function setup(
  options: {
    author?: string;
    receipt?: boolean;
    response?: string;
    gone?: boolean;
    goneHtml?: string;
    quoted?: boolean;
    menuCoveredFor?: number;
  } = {},
) {
  const html =
    profile +
    (options.quoted
      ? post("another", "123").replace(
          "</article>",
          '<div data-testid="quoteTweet"><a href="/bycoda/status/123"><time>4:00</time></a></div></article>',
        )
      : post(options.author ?? "bycoda", "123")) +
    post("another", "456");
  const close = vi.fn(async () => {});
  const identity = vi.fn(async () => {});
  const authorize = vi.fn(async () => {});
  const clicked: string[] = [];
  let submitted = false;
  let menuHitChecks = 0;
  const { page, window } = fixture(
    { loginUrl: "https://x.com/home", identity: async () => undefined },
    owner,
    html,
    {
      response: options.response,
      render: () =>
        submitted && options.gone !== false
          ? profile +
            (options.goneHtml ?? '<p data-testid="emptyState">This post is unavailable.</p>')
          : html,
      click(element) {
        const dom = window.document;
        const step = element.getAttribute("data-testid") ?? element.getAttribute("role")!;
        if (step === "menuitem" && menuHitChecks <= (options.menuCoveredFor ?? -1))
          throw new Error("Page element is missing.");
        clicked.push(step);
        if (step === "caret")
          dom.body.insertAdjacentHTML(
            "beforeend",
            '<div role="menu"><button role="menuitem">Delete</button></div>',
          );
        if (step === "menuitem") {
          dom.querySelector('[role="menu"]')!.remove();
          dom.body.insertAdjacentHTML(
            "beforeend",
            '<div role="alertdialog"><h2>Delete post?</h2><button data-testid="confirmationSheetConfirm">Delete</button></div>',
          );
        }
        if (step === "confirmationSheetConfirm") {
          submitted = true;
          if (options.receipt !== false)
            dom.body.insertAdjacentHTML(
              "beforeend",
              '<div data-testid="toast">Your post was deleted.</div>',
            );
        }
      },
    },
  );
  Object.defineProperty(window.document, "elementFromPoint", {
    value: () => {
      const dom = window.document;
      const confirm = dom.querySelector('[data-testid="confirmationSheetConfirm"]');
      if (confirm) return confirm;
      const menu = dom.querySelector('[role="menuitem"]');
      if (menu) {
        menuHitChecks++;
        return menuHitChecks <= (options.menuCoveredFor ?? 0) ? dom.body : menu;
      }
      return dom.querySelector('[data-testid="caret"]');
    },
  });
  const deps = {
    directory: "unused",
    profile: () => "unused",
    identity,
    launcher: async () => ({ page, close, closed: Promise.resolve() }),
    until: async <T>(_page: typeof page, expression: string) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await page.evaluate<T>(expression);
        if (result) return result;
      }
      return undefined;
    },
  };
  return {
    page,
    identity,
    close,
    authorize,
    clicked,
    run: () => deleteXPost(deps, owner, "123", authorize),
  };
}

describe("X browser post deletion", () => {
  it("confirms the selected owned post and reads it again before reporting success", async () => {
    const f = setup();
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.page.goto).toHaveBeenNthCalledWith(1, postUrl);
    expect(f.page.goto).toHaveBeenNthCalledWith(2, canonicalPostUrl);
    expect(f.clicked).toEqual(["caret", "menuitem", "confirmationSheetConfirm"]);
    expect(f.authorize).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("confirms the current X deletion receipt and reads the owner permalink without a toast", async () => {
    const f = setup({ receipt: false, response: deleteReceipt, goneHtml: missingPost });
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.page.goto).toHaveBeenNthCalledWith(2, canonicalPostUrl);
    expect(vi.mocked(f.page.watchResponse).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(f.page.click).mock.invocationCallOrder[2],
    );
    expect(f.clicked).toEqual(["caret", "menuitem", "confirmationSheetConfirm"]);
    expect(f.authorize).toHaveBeenCalledOnce();
  });

  it("waits through the X menu transition before clicking its delete entry", async () => {
    const f = setup({
      menuCoveredFor: 2,
      receipt: false,
      response: deleteReceipt,
      goneHtml: missingPost,
    });
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.clicked).toEqual(["caret", "menuitem", "confirmationSheetConfirm"]);
    expect(f.authorize).toHaveBeenCalledOnce();
  });

  it("stops before authorization if the delete menu stays covered", async () => {
    const f = setup({ menuCoveredFor: 10 });
    await expect(f.run()).rejects.toMatchObject({ code: "unsupported" });
    expect(f.clicked).toEqual(["caret"]);
    expect(f.authorize).not.toHaveBeenCalled();
  });

  it.each([
    { response: '{"data":{"delete_tweet":null}}', goneHtml: missingPost },
    { response: '{"errors":[{"code":144}]}', goneHtml: missingPost },
    { response: deleteReceipt, goneHtml: missingPost.replace('data-testid="error-detail"', "") },
    { response: deleteReceipt, gone: false },
  ])(
    "keeps deletion in review when the response or exact readback does not match",
    async (options) => {
      const f = setup({ receipt: false, ...options });
      await expect(f.run()).rejects.toMatchObject({ code: "unknown" });
      expect(f.clicked.filter((step) => step === "confirmationSheetConfirm")).toHaveLength(1);
    },
  );

  it("refuses another user's post before opening its menu", async () => {
    const f = setup({ author: "another" });
    await expect(f.run()).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("does not treat an owner's quoted permalink as proof of authorship", async () => {
    const f = setup({ quoted: true });
    await expect(f.run()).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("stops if the session changes or the final authorization is revoked", async () => {
    const changed = setup();
    changed.identity.mockRejectedValueOnce(new SocialPlatformError("denied"));
    await expect(changed.run()).rejects.toMatchObject({ code: "denied" });
    expect(changed.page.click).not.toHaveBeenCalled();
    const revoked = setup();
    revoked.authorize.mockRejectedValueOnce(new SocialPlatformError("denied"));
    await expect(revoked.run()).rejects.toMatchObject({ code: "denied" });
    expect(revoked.clicked).toEqual(["caret", "menuitem"]);
  });

  it.each([{ receipt: false }, { gone: false }])(
    "reports unknown without full evidence %j",
    async (options) => {
      const f = setup(options);
      await expect(f.run()).rejects.toMatchObject({ code: "unknown" });
      expect(f.clicked.filter((step) => step === "confirmationSheetConfirm")).toHaveLength(1);
    },
  );
});
