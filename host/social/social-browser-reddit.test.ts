import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { redditBrowserRecipe, redditCreatedId } from "./social-browser-reddit";
import { account, fixture, job, now } from "./social-browser-publishing-test-support";

/**
 * Reddit page fixtures are synthetic (no live Reddit page was recorded). They exercise the shared
 * challenge probe on Reddit-shaped markup. The probe is read-only: the page offers no interaction.
 */
async function fixturePage(name: string, url: string): Promise<BrowserPage> {
  const html = await readFile(
    fileURLToPath(new URL(`./fixtures/reddit/${name}`, import.meta.url)),
    "utf8",
  );
  const window = new Window({ url });
  window.document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  return {
    evaluate: async <T>(expression: string): Promise<T> => window.eval(expression) as T,
  } as unknown as BrowserPage;
}

it("recognizes the synthetic login page as a login screen without interacting", async () => {
  const page = await fixturePage("login.html", "https://www.reddit.com/login/");
  await expect(detectChallenge(page)).resolves.toEqual({
    kind: "login",
    url: "https://www.reddit.com/login/",
  });
});

it("recognizes a robot check as captcha and maps it to needs_human", async () => {
  const page = await fixturePage("captcha.html", "https://www.reddit.com/login/");
  const hit = await detectChallenge(page);
  expect(hit?.kind).toBe("captcha");
  const error = needsHumanError(hit!);
  expect(error).toBeInstanceOf(SocialPlatformError);
  expect(error.code).toBe("needs_human");
});

it("recognizes a one-time code field as verification", async () => {
  const page = await fixturePage("verification.html", "https://www.reddit.com/login/");
  await expect(detectChallenge(page)).resolves.toMatchObject({ kind: "verification" });
});

it("returns no challenge for an ordinary subreddit listing", async () => {
  const page = await fixturePage("subreddit.html", "https://www.reddit.com/r/bycodatest/");
  await expect(detectChallenge(page)).resolves.toBeNull();
});

const own = () => account("reddit", "web:reddit:t2_owner1");
const SUBMIT = "https://www.reddit.com/r/bycodatest/submit/?type=TEXT";
const composer = `<textarea name="title"></textarea><div contenteditable="true" name="body"></div><button id="submit-post-button" type="button">Post</button>`;
const created = JSON.stringify({ data: { createPost: { ok: true, post: { id: "t3_abc123" } } } });
const published = (title = "Hello", body = "A Bycoda update", author = "t2_owner1") =>
  `<shreddit-post id="t3_abc123" author-id="${author}" post-title="${title}"><div slot="text-body">${body}</div></shreddit-post>`;
const redditJob = (reddit: Record<string, unknown> = {}, text = "A Bycoda update") =>
  job("publish", { text, reddit: { subreddits: ["bycodatest"], title: "Hello", ...reddit } });
const meFetch = (inbox: unknown[] = [], extra: Record<string, unknown> = {}) =>
  vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.startsWith("/api/me.json")
        ? { data: { name: "BycodaOwner", id: "owner1" } }
        : { data: { children: inbox, ...extra } },
  }));
function reddit(
  html: string,
  options: Parameters<typeof fixture>[3] & { inbox?: unknown[]; after?: string } = {},
) {
  const f = fixture(redditBrowserRecipe, own(), html, options);
  Object.assign(f.window, { fetch: meFetch(options.inbox, { after: options.after ?? null }) });
  return f;
}

it("reads the member from the session /api/me.json under a namespaced id", async () => {
  const f = reddit("");
  await f.page.goto("https://www.reddit.com/r/test/");
  await expect(redditBrowserRecipe.identity(f.page)).resolves.toEqual({
    platformId: "web:reddit:t2_owner1",
    name: "BycodaOwner",
  });
  Object.assign(f.window, { fetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })) });
  await expect(redditBrowserRecipe.identity(f.page)).resolves.toBeUndefined();
  await f.page.goto("https://www.reddit.com/login/");
  Object.assign(f.window, { fetch: meFetch() });
  await expect(redditBrowserRecipe.identity(f.page)).resolves.toBeUndefined();
});

it("recognizes only a response that names exactly one created thing", () => {
  expect(redditCreatedId(created, "t3")).toBe("t3_abc123");
  expect(redditCreatedId(created, "t1")).toBeUndefined();
  expect(redditCreatedId(JSON.stringify({ json: { data: { name: "t3_x1" } } }), "t3")).toBe(
    "t3_x1",
  );
  expect(
    redditCreatedId(
      JSON.stringify({ json: { errors: [["RATELIMIT"]], data: { name: "t3_x1" } } }),
      "t3",
    ),
  ).toBeUndefined();
  expect(redditCreatedId("not json", "t3")).toBeUndefined();
});

it("publishes a text post and returns it only after the persisted readback", async () => {
  const f = reddit(composer, {
    response: created,
    render: (url) => (url.includes("/comments/") ? published() : composer),
  });
  await expect(redditBrowserRecipe.send(f.ctx, redditJob())).resolves.toEqual({
    platformId: "t3_abc123",
    url: "https://www.reddit.com/comments/abc123/",
  });
  expect(f.page.goto).toHaveBeenCalledWith(SUBMIT);
  expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
});

it("publishes a link post with the link field", async () => {
  const link = "https://example.com/a";
  const html = `<input name="title"><input name="link"><button id="submit-post-button">Post</button>`;
  const f = reddit(html, {
    response: created,
    render: (url) =>
      url.includes("/comments/")
        ? `<shreddit-post id="t3_abc123" author-id="t2_owner1" post-title="Hello" content-href="${link}"></shreddit-post>`
        : html,
  });
  await expect(
    redditBrowserRecipe.send(f.ctx, {
      ...redditJob({ kind: "link" }, ""),
      payload: { ...redditJob({ kind: "link" }, "").payload, link },
    }),
  ).resolves.toMatchObject({ platformId: "t3_abc123" });
  expect(f.page.goto).toHaveBeenCalledWith(SUBMIT.replace("TEXT", "LINK"));
});

it("reports uncertain delivery when the post is not found by readback or has another author", async () => {
  const f = reddit(composer, {
    response: created,
    render: (url) =>
      url.includes("/comments/") ? published("Hello", "A Bycoda update", "t2_other") : composer,
  });
  await expect(redditBrowserRecipe.send(f.ctx, redditJob())).rejects.toMatchObject({
    code: "unknown",
  });
  expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
  const silent = reddit(composer);
  await expect(redditBrowserRecipe.send(silent.ctx, redditJob())).rejects.toMatchObject({
    code: "unknown",
  });
});

it("refuses a required flair the job does not name before anything is submitted", async () => {
  const f = reddit(`<div flair-required></div>${composer}`, { response: created });
  await expect(redditBrowserRecipe.send(f.ctx, redditJob())).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  expect(f.page.click).not.toHaveBeenCalled();
});

it("rejects an invalid submission before opening any page", async () => {
  const f = reddit(composer);
  await expect(
    redditBrowserRecipe.send(f.ctx, redditJob({ subreddits: ["abc", "bycodatest"] })),
  ).rejects.toMatchObject({ code: "rejected" });
  await expect(redditBrowserRecipe.send(f.ctx, redditJob({ title: "" }))).rejects.toMatchObject({
    code: "rejected",
  });
  expect(f.page.goto).not.toHaveBeenCalled();
});

it("refuses to submit when the identity differs and never clicks", async () => {
  const f = reddit(composer, { response: created });
  Object.assign(f.window, {
    fetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { name: "Other", id: "zzz9" } }),
    })),
  });
  await expect(redditBrowserRecipe.send(f.ctx, redditJob())).rejects.toMatchObject({
    code: "denied",
  });
  expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
});

const commentBox = `<comment-composer-host><div contenteditable="true"></div><button type="submit">Comment</button></comment-composer-host>`;
const commentRow = (id: string, author: string, text: string, tail = "") =>
  `<shreddit-comment thingid="${id}" author-id="${author}"><div slot="comment">${text}</div>${tail}</shreddit-comment>`;

it("comments on a known post and verifies the persisted comment", async () => {
  const f = reddit(commentBox, {
    response: JSON.stringify({ data: { createComment: { comment: { id: "t1_new1" } } } }),
    render: (url) =>
      url.includes("/comment/new1") ? commentRow("t1_new1", "t2_owner1", "Thanks") : commentBox,
  });
  await expect(
    redditBrowserRecipe.send(f.ctx, job("comment", { text: "Thanks", postId: "t3_abc123" })),
  ).resolves.toEqual({
    platformId: "t1_new1",
    url: "https://www.reddit.com/comments/abc123/comment/new1/",
  });
  expect(f.ctx.markSubmitted).toHaveBeenCalledTimes(1);
});

it("replies to a known comment inside that comment only", async () => {
  const thread = `${commentRow("t1_other", "t2_x", "Other", `<button aria-label="Reply">Reply</button>${commentBox}`)}${commentRow("t1_parent", "t2_x", "Question", `<button aria-label="Yanıtla">Yanıtla</button>${commentBox}`)}`;
  const f = reddit(thread, {
    response: JSON.stringify({
      json: { errors: [], data: { things: [{ data: { name: "t1_new2" } }] } },
    }),
    render: (url) =>
      url.includes("/comment/new2") ? commentRow("t1_new2", "t2_owner1", "Answer") : thread,
  });
  await expect(
    redditBrowserRecipe.send(
      f.ctx,
      job("reply", { text: "Answer", postId: "t1_parent", threadId: "t3_abc123" }),
    ),
  ).resolves.toMatchObject({ platformId: "t1_new2" });
  expect(f.page.goto).toHaveBeenCalledWith(
    "https://www.reddit.com/comments/abc123/comment/parent/",
  );
});

it("treats a comment without a persisted match as uncertain and rejects unsafe targets", async () => {
  const f = reddit(commentBox, {
    response: JSON.stringify({ data: { createComment: { comment: { id: "t1_new1" } } } }),
    render: (url) =>
      url.includes("/comment/new1") ? commentRow("t1_new1", "t2_owner1", "Different") : commentBox,
  });
  await expect(
    redditBrowserRecipe.send(f.ctx, job("comment", { text: "Thanks", postId: "t3_abc123" })),
  ).rejects.toMatchObject({ code: "unknown" });
  await expect(
    redditBrowserRecipe.send(f.ctx, job("comment", { text: "x", postId: "javascript:alert(1)" })),
  ).rejects.toMatchObject({ code: "denied" });
  await expect(
    redditBrowserRecipe.send(f.ctx, job("message", { text: "hi", threadId: "t4_abc" })),
  ).rejects.toMatchObject({ code: "unsupported" });
});

const child = (kind: string, name: string, author: string, at: number, extra = {}) => ({
  kind,
  data: {
    name,
    author,
    body: `text ${name}`,
    created_utc: at / 1000,
    link_id: "t3_abc123",
    ...extra,
  },
});

it("polls comment replies and mentions, skipping own items and private messages", async () => {
  const inbox = [
    child("t1", "t1_c", "alice", now - 1000, { type: "comment_reply" }),
    child("t1", "t1_b", "bob", now - 2000, { type: "username_mention" }),
    child("t1", "t1_o", "bycodaowner", now - 3000, { type: "post_reply" }),
    child("t4", "t4_m", "carol", now - 4000),
    child("t1", "t1_old", "dave", now - 90_000, { type: "post_reply" }),
  ];
  const f = reddit("", { inbox });
  const first = await redditBrowserRecipe.poll(f.ctx, []);
  expect(first.events.map((event) => [event.eventId, event.contactId, event.threadId])).toEqual([
    ["t1_c", "alice", "t3_abc123"],
    ["t1_b", "bob", "t3_abc123"],
    ["t1_old", "dave", "t3_abc123"],
  ]);
  expect(first.coverage).toEqual([
    { channel: "comments", status: "read" },
    { channel: "mentions", status: "read" },
  ]);
  expect(first.cursor).toBe(String(now - 1000));
  const next = await redditBrowserRecipe.poll(f.ctx, [], String(now - 2000));
  expect(next.events.map((event) => event.eventId)).toEqual(["t1_c"]);
});

it("keeps the old cursor and reports partial coverage when the window is not exhausted", async () => {
  const f = reddit("", {
    inbox: [child("t1", "t1_c", "alice", now - 1000, { type: "post_reply" })],
    after: "t1_next",
  });
  const result = await redditBrowserRecipe.poll(f.ctx, [], String(now - 5000));
  expect(result.cursor).toBe(String(now - 5000));
  expect(result.coverage?.every((item) => item.status === "read")).toBe(false);
});

it("escalates a captcha page to needs_human instead of reporting an unexpected screen", async () => {
  const f = reddit(`<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>`);
  await expect(redditBrowserRecipe.send(f.ctx, redditJob())).rejects.toMatchObject({
    code: "needs_human",
  });
  expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
});
