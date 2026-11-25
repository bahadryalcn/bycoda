import { type HTMLElement, type HTMLTextAreaElement, Window } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import { socialBrowserUrl } from "../../src/features/social/model/socialBrowser";
import { deleteInstagramPostOnce, instagramPostDeletion } from "./browser/instagram-post-deletion";
import type { BrowserPage } from "./social-browser";
import {
  instagramFollow,
  instagramFollowers,
  openInstagramRecipientProfile,
  parseInstagramFollowChange,
} from "./social-browser-instagram-audience";
import {
  instagramLikeComment,
  parseInstagramCommentLike,
} from "./social-browser-instagram-comment-like";
import { openInstagramDirectThread } from "./social-browser-instagram-dm";
import { changeInstagramPost, parseInstagramPostChange } from "./social-browser-instagram-posts";
import { metaBrowserRecipes } from "./social-browser-meta";
import { job } from "./social-browser-publishing-test-support";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function fixture() {
  const window = new Window({ url: "https://www.instagram.com/" });
  windows.push(window);
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  const document = window.document;
  const render = (html: string) => {
    document.body.innerHTML = html;
  };
  const page = {
    goto: vi.fn(async (url: string) => {
      window.location.href = url;
    }),
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    click: vi.fn(async (selector: string) =>
      document.querySelector<HTMLElement>(selector)!.click(),
    ),
    fill: vi.fn(async (selector: string, value: string) => {
      document.querySelector<HTMLTextAreaElement>(selector)!.value = value;
    }),
    watchResponse: vi.fn(),
  } as unknown as BrowserPage;
  const verifyIdentity = vi.fn(async () => {});
  const context: BrowserRecipeContext = {
    page,
    account: { platformId: "111" } as SocialAccount,
    files: [],
    now: () => 0,
    waitFor: async <T>(expression: string) => (await page.evaluate<T>(expression)) || undefined,
    verifyIdentity,
  };
  return { window, document, page, render, context, verifyIdentity };
}

const postUrl = "https://www.instagram.com/p/Test123/";
const caption = parseInstagramPostChange({
  action: "caption",
  postUrl,
  caption: "New",
  confirm: "EDIT_INSTAGRAM_CAPTION",
});
const remove = {
  action: "delete",
  postUrl,
  confirm: "DELETE_INSTAGRAM_POST",
} as const;

function deletionSettings() {
  const values = new Map<string, string>();
  return {
    async setting(key: string) {
      return values.get(key);
    },
    async setSetting(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function posts(
  options: {
    owned?: boolean;
    persisted?: boolean;
    receipt?: boolean;
    staleReceipt?: boolean;
    readback?: "present" | "other-post" | "login" | "turkish";
  } = {},
) {
  const f = fixture();
  const submit = vi.fn();
  let saved = "Old";
  let deleted = false;
  const main = () => {
    f.render(
      '<main><article><a href="/p/Test123/">Date</a><button aria-label="More options">...</button></article></main>' +
        (options.staleReceipt ? '<div role="status">Post deleted</div>' : ""),
    );
    f.document.querySelector("button")!.addEventListener("click", menu);
  };
  const menu = () => {
    f.document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog">${options.owned === false ? "" : "<button>Edit</button><button>Delete</button>"}<button>Cancel</button></div>`,
    );
    const dialog = f.document.querySelector('[role="dialog"]')!;
    const buttons = dialog.querySelectorAll("button");
    if (options.owned === false) return;
    buttons[0].addEventListener("click", () => {
      dialog.innerHTML =
        '<textarea aria-label="Write a caption..."></textarea><button>Done</button>';
      const editor = dialog.querySelector("textarea")!;
      editor.value = saved;
      dialog.querySelector("button")!.addEventListener("click", () => {
        submit();
        if (options.persisted !== false) saved = editor.value;
        dialog.remove();
      });
    });
    buttons[1].addEventListener("click", () => {
      dialog.innerHTML = "<h2>Delete post?</h2><button>Delete</button><button>Cancel</button>";
      dialog.querySelector("button")!.addEventListener("click", () => {
        submit();
        deleted = true;
        f.render(options.receipt === false ? "" : '<div role="status">Post deleted</div>');
      });
    });
  };
  vi.mocked(f.page.goto).mockImplementation(async (url) => {
    f.window.location.href = url;
    if (!deleted || options.readback === "present") {
      main();
      return;
    }
    if (options.readback === "other-post")
      f.window.location.href = "https://www.instagram.com/p/Other567/";
    if (options.readback === "login") {
      f.window.location.href = "https://www.instagram.com/accounts/login/";
      f.render('<main><input type="password"></main>');
      return;
    }
    const unavailable =
      options.readback === "turkish" ? "Post mevcut değil" : "Post isn't available";
    f.document.title = `${unavailable} • Instagram`;
    f.render(`<main><span>${unavailable}</span></main>`);
  });
  return { ...f, submit };
}

it("saves the Instagram deletion review state before the final click", async () => {
  const f = posts({ receipt: false });
  const beforeDelete = vi.fn(async () => expect(f.submit).not.toHaveBeenCalled());
  await expect(changeInstagramPost(f.context, remove, beforeDelete)).rejects.toMatchObject({
    code: "unknown",
  });
  expect(beforeDelete).toHaveBeenCalledOnce();
  expect(f.submit).toHaveBeenCalledOnce();
});

it("holds an uncertain delete across browser sessions and permalink aliases for the same actor", async () => {
  const settings = deletionSettings();
  const initial = posts({ receipt: false });
  await expect(
    deleteInstagramPostOnce(settings, "111", remove, (beforeDelete) =>
      changeInstagramPost(initial.context, remove, beforeDelete),
    ),
  ).resolves.toMatchObject({ changed: false, deletion: "review" });
  const alias = { ...remove, postUrl: "https://www.instagram.com/reel/Test123/" };
  const runAgain = vi.fn();
  await expect(deleteInstagramPostOnce(settings, "111", alias, runAgain)).resolves.toEqual({
    postUrl: alias.postUrl,
    changed: false,
    deletion: "review",
  });
  expect(runAgain).not.toHaveBeenCalled();
  await expect(instagramPostDeletion(settings, "222", alias.postUrl)).resolves.toBeUndefined();
  await expect(
    instagramPostDeletion(settings, "111", "https://www.instagram.com/p/Other456/"),
  ).resolves.toBeUndefined();
});

it("allows a retry after a pre-click failure and saves a verified delete", async () => {
  const settings = deletionSettings();
  const first = posts({ owned: false });
  await expect(
    deleteInstagramPostOnce(settings, "111", remove, (beforeDelete) =>
      changeInstagramPost(first.context, remove, beforeDelete),
    ),
  ).rejects.toMatchObject({ code: "unsupported" });
  await expect(instagramPostDeletion(settings, "111", postUrl)).resolves.toBeUndefined();
  expect(first.submit).not.toHaveBeenCalled();
  const retry = posts();
  await expect(
    deleteInstagramPostOnce(settings, "111", remove, (beforeDelete) =>
      changeInstagramPost(retry.context, remove, beforeDelete),
    ),
  ).resolves.toMatchObject({ changed: true, deletion: "deleted" });
  await expect(instagramPostDeletion(settings, "111", postUrl)).resolves.toBe("deleted");
  expect(retry.submit).toHaveBeenCalledOnce();
});

it("requires exact Instagram post and explicit consequence confirmation", () => {
  for (const input of [
    { action: "delete", postUrl },
    {
      action: "delete",
      postUrl: "https://evil.example/p/Test123/",
      confirm: "DELETE_INSTAGRAM_POST",
    },
    { action: "caption", postUrl, caption: "x".repeat(2201), confirm: "EDIT_INSTAGRAM_CAPTION" },
  ])
    expect(() => parseInstagramPostChange(input)).toThrow();
});

it("edits the owned caption once and verifies a fresh editor", async () => {
  const f = posts();
  await expect(changeInstagramPost(f.context, caption)).resolves.toEqual({
    postUrl,
    changed: true,
  });
  expect(f.submit).toHaveBeenCalledTimes(1);
  expect(f.page.goto).toHaveBeenCalledTimes(2);
});

it("holds an unpersisted edit and an unacknowledged delete after one submission", async () => {
  for (const [f, change] of [
    [posts({ persisted: false }), caption],
    [posts({ receipt: false }), remove],
  ] as const) {
    await expect(changeInstagramPost(f.context, change)).rejects.toMatchObject({ code: "unknown" });
    expect(f.submit).toHaveBeenCalledTimes(1);
  }
});

it("verifies the delete receipt on the same post and refuses a missing owner menu", async () => {
  const f = posts();
  await expect(changeInstagramPost(f.context, remove)).resolves.toEqual({ postUrl, changed: true });
  expect(f.submit).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.page.goto).mock.calls).toEqual([[postUrl], [postUrl]]);
  const other = posts({ owned: false });
  await expect(changeInstagramPost(other.context, remove)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(other.submit).not.toHaveBeenCalled();
});

it("confirms the observed Turkish unavailable state on the deleted post", async () => {
  const f = posts({ readback: "turkish" });
  await expect(changeInstagramPost(f.context, remove)).resolves.toEqual({ postUrl, changed: true });
  expect(vi.mocked(f.page.goto).mock.calls).toEqual([[postUrl], [postUrl]]);
});

it.each(["present", "other-post", "login"] as const)(
  "holds a deletion with a receipt when the exact post readback is %s",
  async (readback) => {
    const f = posts({ readback });
    await expect(changeInstagramPost(f.context, remove)).rejects.toMatchObject({ code: "unknown" });
    expect(f.submit).toHaveBeenCalledOnce();
  },
);

it("does not submit using a deletion notice already displayed before confirmation", async () => {
  const f = posts({ staleReceipt: true });
  await expect(changeInstagramPost(f.context, remove)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.submit).not.toHaveBeenCalled();
});

function postComment({
  initialPath = "/p/Test123/",
  pathAtSubmit,
  parentPath = "/p/Test123/c/456/",
}: { initialPath?: string; pathAtSubmit?: string; parentPath?: string } = {}) {
  const f = fixture();
  const reply = vi.fn();
  const submit = vi.fn();
  const submitted = vi.fn();
  f.context.markSubmitted = submitted;
  vi.mocked(f.page.goto).mockImplementation(async () => {
    f.window.location.href = new URL(initialPath, postUrl).href;
    f.render(`<main>
      <ul><li><a href="${parentPath}">Date</a><button>Reply</button></li></ul>
      <textarea aria-label="Add a comment..."></textarea><button>Post</button>
    </main>`);
    f.document.querySelector("li button")!.addEventListener("click", reply);
    f.document.querySelector("main > button")!.addEventListener("click", submit);
  });
  f.verifyIdentity.mockImplementation(async () => {
    if (pathAtSubmit && f.document.querySelector("textarea")?.value === "Bycoda test reply")
      f.window.location.href = new URL(pathAtSubmit, postUrl).href;
  });
  vi.mocked(f.page.watchResponse).mockReturnValue({
    body: async () =>
      JSON.stringify({
        status: "ok",
        comment: {
          pk: "222",
          user: { pk: "111" },
          text: "Bycoda test reply",
          parent_comment_id: "456",
        },
      }),
    stop: vi.fn(),
  });
  return { ...f, reply, submit, submitted };
}

const postCommentJob = job("reply", {
  postId: "ig:Test123:123",
  threadId: "456",
  text: "Bycoda test reply",
});

const instagramSend = metaBrowserRecipes.find((recipe) => recipe.platform === "instagram")!.send;

it("sends the comment reply on the same post after a Reel URL redirect", async () => {
  const f = postComment({ initialPath: "/reel/Test123/", parentPath: "/reel/Test123/c/456/" });
  await expect(instagramSend(f.context, postCommentJob)).resolves.toEqual({ platformId: "222" });
  expect(f.reply).toHaveBeenCalledOnce();
  expect(f.submit).toHaveBeenCalledOnce();
  expect(f.submitted).toHaveBeenCalledOnce();
});

it("requires a parent for a reply before opening the post", async () => {
  const f = postComment();
  const request = {
    ...postCommentJob,
    payload: { ...postCommentJob.payload, threadId: undefined },
  };
  await expect(instagramSend(f.context, request)).rejects.toMatchObject({ code: "unsupported" });
  expect(f.page.goto).not.toHaveBeenCalled();
  expect(f.submit).not.toHaveBeenCalled();
});

it.each([
  ["redirects to another post", { initialPath: "/p/Other567/" }],
  ["shows a parent link from another post", { parentPath: "/p/Other567/c/456/" }],
  ["changes the post during the final identity check", { pathAtSubmit: "/p/Other567/" }],
] as const)("leaves a reply unsent when Instagram %s", async (_scenario, options) => {
  const f = postComment(options);
  await expect(instagramSend(f.context, postCommentJob)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.submit).not.toHaveBeenCalled();
  expect(f.submitted).not.toHaveBeenCalled();
});

it("reports NEEDS_HUMAN without clicking challenge controls", async () => {
  const f = fixture();
  vi.mocked(f.page.goto).mockImplementation(async () => {
    f.window.location.href = "https://www.instagram.com/challenge/";
    f.render('<main><input autocomplete="one-time-code"><button>Continue</button></main>');
  });
  await expect(changeInstagramPost(f.context, caption)).rejects.toMatchObject({
    code: "needs_human",
  });
  expect(f.page.click).not.toHaveBeenCalled();
});

it("opens and bounds the follower sample without scrolling or mutating", async () => {
  const f = fixture();
  f.render('<main><header><a href="/example/followers/">Followers</a></header></main>');
  f.document.querySelector("a")!.addEventListener("click", (event) => {
    event.preventDefault();
    const rows = Array.from({ length: 70 }, (_, i) => `<a href="/person${i}/">person${i}</a>`).join(
      "",
    );
    f.render(
      `<div role="dialog"><h2>Followers</h2><a href="/irrelevant/">wrong text</a>${rows}</div>`,
    );
  });
  const result = await instagramFollowers(f.context, "Example");
  expect(result.partial).toBe(true);
  expect(result.followers).toHaveLength(50);
  expect(result.followers[0]).toEqual({ username: "person0" });
});

function profileFixture(
  label: string,
  click: (f: ReturnType<typeof fixture>) => void,
  recipient = "222",
) {
  const f = fixture();
  vi.mocked(f.page.watchResponse).mockImplementation((_path, accept) => {
    const body = JSON.stringify({ data: { user: { username: "example", id: recipient } } });
    return { stop: vi.fn(), body: async () => (!accept || accept(body) ? body : undefined) };
  });
  const display = () => {
    f.render(`<main><header><button>${label}</button></header></main>`);
    f.document.querySelector("button")!.addEventListener("click", () => click(f));
  };
  vi.mocked(f.page.goto).mockImplementation(async (url) => {
    f.window.location.href = url;
    display();
  });
  return f;
}

it("requires numeric target proof before opening a new DM thread", async () => {
  const f = profileFixture("Message", (f) => {
    f.window.location.href = "https://www.instagram.com/direct/t/3344/";
  });
  await expect(openInstagramDirectThread(f.context, "example", "222")).resolves.toBe("3344");
  expect(f.page.click).toHaveBeenCalledTimes(1);
  const different = profileFixture("Message", () => {});
  await expect(
    openInstagramDirectThread(different.context, "example", "333"),
  ).rejects.toMatchObject({ code: "denied" });
  expect(different.page.click).not.toHaveBeenCalled();
  expect(different.page.fill).not.toHaveBeenCalled();
});

it("resolves only a visible exact Instagram profile with a different account ID", async () => {
  const f = profileFixture("Message", () => {});
  await expect(openInstagramRecipientProfile(f.context, "Example")).resolves.toBe("222");
  expect(f.page.click).not.toHaveBeenCalled();
  const own = profileFixture("Message", () => {}, "111");
  await expect(openInstagramRecipientProfile(own.context, "example")).rejects.toMatchObject({
    code: "denied",
  });
});

const directJob: SocialJob = {
  id: "instagram-direct-job",
  operationId: "instagram-direct-operation",
  dedupeKey: "instagram-direct-attempt",
  accountId: "111",
  projectIds: [],
  provider: "owner",
  kind: "message",
  payload: {
    text: "Approved message",
    media: [],
    recipientId: "222",
    instagramRecipientHandle: "example",
  },
  status: "running",
  scheduledAt: 0,
  attempts: 1,
  createdAt: 0,
  actorId: "owner",
};

function directFixture(options: { wrongRecipient?: boolean; persisting?: boolean } = {}) {
  const f = fixture();
  const submitted = vi.fn();
  const sendCheck = vi.fn();
  const markSubmitted = vi.fn();
  f.context.markSubmitted = markSubmitted;
  f.verifyIdentity.mockImplementation(async () => {
    if (f.document.querySelector("textarea")?.value === directJob.payload.text) sendCheck();
  });
  vi.mocked(f.page.goto).mockImplementation(async (url) => {
    f.window.location.href = url;
    if (url.endsWith("/example/")) {
      f.render("<main><header><button>Message</button></header></main>");
      f.document.querySelector("button")!.addEventListener("click", () => {
        f.window.location.href = "https://www.instagram.com/direct/t/3344/";
      });
    } else {
      f.render('<main><textarea placeholder="Message..."></textarea><button>Send</button></main>');
      f.document.querySelector("button")!.addEventListener("click", () => submitted());
    }
  });
  vi.mocked(f.page.watchResponse).mockImplementation((path, accept) => {
    const body = async () => {
      const body = JSON.stringify(
        path.source.includes("web_profile_info")
          ? { data: { user: { username: "example", id: "222" } } }
          : path.source.includes("broadcast")
            ? { status: "ok", payload: { thread_id: "3344", item_id: "5566" } }
            : {
                status: "ok",
                viewer_id: "111",
                thread: {
                  thread_id: "3344",
                  users: [{ pk: options.wrongRecipient ? "999" : "222" }],
                  items:
                    submitted.mock.calls.length && options.persisting !== false
                      ? [
                          {
                            item_id: "5566",
                            user_id: "111",
                            item_type: "text",
                            text: directJob.payload.text,
                          },
                        ]
                      : [],
                },
              },
      );
      return !accept || accept(body) ? body : undefined;
    };
    return { stop: vi.fn(), body };
  });
  return { ...f, submitted, sendCheck, markSubmitted };
}

it("sends a verified new single-recipient DM once and confirms the persisted exact message", async () => {
  const f = directFixture();
  const recipe = metaBrowserRecipes.find(({ platform }) => platform === "instagram")!;
  await expect(recipe.send(f.context, directJob)).resolves.toEqual({
    platformId: "5566",
  });
  expect(f.submitted).toHaveBeenCalledTimes(1);
  expect(f.sendCheck.mock.invocationCallOrder[0]).toBeLessThan(
    f.markSubmitted.mock.invocationCallOrder[0],
  );
  expect(f.markSubmitted.mock.invocationCallOrder[0]).toBeLessThan(
    f.submitted.mock.invocationCallOrder[0],
  );
});

it("rejects a changed recipient or changed approval and holds a missing DM receipt", async () => {
  const recipe = metaBrowserRecipes.find(({ platform }) => platform === "instagram")!;
  const wrong = directFixture({ wrongRecipient: true });
  await expect(recipe.send(wrong.context, directJob)).rejects.toMatchObject({
    code: "denied",
  });
  expect(wrong.page.fill).not.toHaveBeenCalled();
  expect(wrong.submitted).not.toHaveBeenCalled();
  const revoked = directFixture();
  revoked.sendCheck.mockImplementation(() => {
    throw new Error("Suppressed");
  });
  await expect(recipe.send(revoked.context, directJob)).rejects.toThrow("Suppressed");
  expect(revoked.submitted).not.toHaveBeenCalled();
  const unknown = directFixture({ persisting: false });
  await expect(recipe.send(unknown.context, directJob)).rejects.toMatchObject({
    code: "unknown",
  });
  expect(unknown.submitted).toHaveBeenCalledTimes(1);
});

it("checks suppression and pacing with the resolved numeric profile before following", async () => {
  const input = parseInstagramFollowChange({
    handle: "example",
    follow: true,
    confirm: "FOLLOW_INSTAGRAM_ACCOUNT",
  });
  const allowed = profileFixture("Follow", (f) => {
    f.document.querySelector("button")!.textContent = "Requested";
    const goto = vi.mocked(f.page.goto).getMockImplementation()!;
    vi.mocked(f.page.goto).mockImplementation(async (...args) => {
      await goto(...args);
      f.document.querySelector("button")!.textContent = "Requested";
    });
  });
  const authorize = vi.fn(async () => {});
  await expect(instagramFollow(allowed.context, input, authorize)).resolves.toMatchObject({
    requested: true,
    changed: true,
  });
  expect(authorize).toHaveBeenCalledWith("222", true);
  expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(allowed.page.click).mock.invocationCallOrder[0],
  );
  const denied = profileFixture("Follow", () => {});
  await expect(
    instagramFollow(denied.context, input, async () => {
      throw new Error("suppressed");
    }),
  ).rejects.toThrow("suppressed");
  expect(denied.page.click).not.toHaveBeenCalled();
});

it("checks the verified comment author's suppression before like and verifies persisted state", async () => {
  const input = parseInstagramCommentLike({
    postId: "ig:Test123:789",
    commentId: "456",
    confirm: "LIKE_INSTAGRAM_COMMENT",
  });
  const f = fixture();
  let liked = false;
  vi.mocked(f.page.watchResponse).mockImplementation(() => ({
    stop: vi.fn(),
    body: async () =>
      JSON.stringify({
        status: "ok",
        comments: [{ pk: "456", user: { pk: "222" }, has_liked_comment: liked }],
      }),
  }));
  f.render(
    '<main><ul><li><a href="/p/Test123/c/456/">Time</a><button aria-label="Like">♡</button></li></ul></main>',
  );
  f.document.querySelector("button")!.addEventListener("click", () => {
    liked = true;
  });
  const authorize = vi.fn(async () => {});
  await expect(instagramLikeComment(f.context, input, authorize)).resolves.toEqual({
    liked: true,
    changed: true,
  });
  expect(authorize).toHaveBeenCalledWith("222");
  expect(f.page.click).toHaveBeenCalledTimes(1);
});

it("resolves Instagram owner handoffs to fixed routes and never accepts an entered live URL", () => {
  expect(socialBrowserUrl("instagram", "instagram-profile")).toBe(
    "https://www.instagram.com/accounts/edit/",
  );
  expect(socialBrowserUrl("instagram", "instagram-live", "https://evil.example")).toBe(
    "https://www.instagram.com/",
  );
  expect(() => socialBrowserUrl("facebook", "instagram-live")).toThrow();
});
