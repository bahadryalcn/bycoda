import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";
import { SocialPlatformError } from "../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import {
  metaBrowserRecipes,
  parseFacebookBrowserCommented,
  parseFacebookBrowserComments,
  parseFacebookBrowserMessageSent,
  parseFacebookBrowserPublished,
  parseInstagramBrowserCommented,
  parseInstagramBrowserInbox,
  parseInstagramBrowserPublished,
} from "./social-browser-meta";

const actor = "123",
  recipient = "456",
  now = 1_792_962_000_000;
const ig = metaBrowserRecipes.find((entry) => entry.platform === "instagram")!;
const fb = metaBrowserRecipes.find((entry) => entry.platform === "facebook")!;
const postUrl = "https://www.facebook.com/123/posts/789/";
const feedback = Buffer.from("feedback:789").toString("base64");
const json = (value: unknown) => JSON.stringify(value);

it("holds partial mutation data with an error instead of retrying a possibly completed write", () => {
  expect(() =>
    parseFacebookBrowserPublished(
      json({ data: { story_create: { story: { id: "candidate" } } }, errors: [{ code: 4 }] }),
      actor,
      "Exact approved caption",
      [],
    ),
  ).toThrow(expect.objectContaining({ code: "unknown" }));
});

function account(platform: "instagram" | "facebook"): SocialAccount {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Local label is not identity",
    platform,
    platformId: actor,
    connection: "browser",
    accountType: "member",
    connected: true,
    accessApproved: true,
    scopes: [],
    paused: false,
    executorId: "executor",
    grants: {},
    createdAt: now,
  };
}
function job(platform: "instagram" | "facebook", changes: Partial<SocialJob> = {}): SocialJob {
  return {
    id: "job",
    accountId: account(platform).id,
    operationId: "operation",
    dedupeKey: "unique",
    projectIds: ["project"],
    provider: "owner",
    actorId: "owner",
    kind: "publish",
    payload: { text: "Exact approved caption", media: [] },
    status: "running",
    scheduledAt: now,
    attempts: 1,
    createdAt: now,
    ...changes,
  };
}
function browser(platform: "instagram" | "facebook", bodies: string[] = []) {
  const snapshot = { origin: `https://www.${platform}.com`, path: "/", authenticated: true };
  const cookies =
    platform === "instagram"
      ? [
          { name: "ds_user_id", value: actor },
          { name: "sessionid", value: "private-credential" },
        ]
      : [
          { name: "c_user", value: actor },
          { name: "xs", value: "private-credential" },
        ];
  const stopped = vi.fn();
  const page = {
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async () => snapshot),
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    insertText: vi.fn(async () => {}),
    setFiles: vi.fn(async () => {}),
    cookies: vi.fn(async () => cookies),
    watchResponse: vi.fn((_path: RegExp, acceptBody?: (body: string) => boolean) => ({
      body: async () => {
        while (bodies.length) {
          const next = bodies.shift()!;
          if (!acceptBody || acceptBody(next)) return next;
        }
        return undefined;
      },
      stop: stopped,
    })),
  } as unknown as BrowserPage;
  const context = {
    page,
    account: account(platform),
    files: [],
    now: () => now,
    waitFor: vi.fn(async () => true),
    verifyIdentity: vi.fn(async () => {}),
    markSubmitted: vi.fn(),
  } as unknown as BrowserRecipeContext;
  return { page, context, cookies, snapshot, stopped };
}

const instagramMedia = (changes: Record<string, unknown> = {}) => ({
  status: "ok",
  media: {
    pk: "789",
    code: "AbC_123",
    user: { pk: actor },
    caption: { text: "Exact approved caption" },
    ...changes,
  },
});
const facebookStory = (changes: Record<string, unknown> = {}) => ({
  data: {
    story_create: {
      story: {
        legacy_fbid: "789",
        url: postUrl,
        actors: [{ id: actor }],
        message: { text: "Exact approved caption" },
        ...changes,
      },
    },
  },
});

describe("Meta browser identity", () => {
  it("recognizes the observed compound Facebook header label and keeps selected Page identity distinct from its administrator", async () => {
    const window = new Window({ url: "https://www.facebook.com/profile.php?id=456" });
    const { page, cookies } = browser("facebook");
    try {
      window.document.body.innerHTML =
        '<div role="banner"><button aria-label="Account, your profile"></button></div>';
      vi.mocked(page.evaluate).mockImplementation(
        async <T>(expression: string) => window.eval(expression) as T,
      );
      await expect(fb.identity(page)).resolves.toEqual({
        platformId: actor,
        name: `Facebook ${actor}`,
        accountType: "member",
      });
      cookies.push({ name: "i_user", value: recipient });
      await expect(fb.identity(page)).resolves.toEqual({
        platformId: recipient,
        name: `Facebook ${recipient}`,
        accountType: "page",
      });
      cookies[cookies.length - 1].value = actor;
      await expect(fb.identity(page)).resolves.toMatchObject({
        platformId: actor,
        accountType: "member",
      });
    } finally {
      await window.happyDOM.close();
    }
  });
  it("does not recognize unrelated account controls or labels outside the Facebook header", async () => {
    const window = new Window({ url: "https://www.facebook.com/" });
    const { page } = browser("facebook");
    try {
      vi.mocked(page.evaluate).mockImplementation(
        async <T>(expression: string) => window.eval(expression) as T,
      );
      for (const html of [
        '<div role="banner"><button aria-label="Account settings"></button></div>',
        '<main><button aria-label="Account, your profile"></button></main>',
        '<div role="banner"><button aria-label="Account, your profile settings"></button></div>',
      ]) {
        window.document.body.innerHTML = html;
        await expect(fb.identity(page)).resolves.toBeUndefined();
      }
    } finally {
      await window.happyDOM.close();
    }
  });
  it("rejects stale login/checkpoint UI and conflicting or invalid cookies even with the observed Facebook header", async () => {
    const window = new Window({ url: "https://www.facebook.com/" });
    const { page, cookies } = browser("facebook");
    try {
      window.document.body.innerHTML =
        '<div role="banner"><button aria-label="Account, your profile"></button></div>';
      vi.mocked(page.evaluate).mockImplementation(
        async <T>(expression: string) => window.eval(expression) as T,
      );
      for (const path of ["/login/", "/checkpoint/"]) {
        window.location.href = `https://www.facebook.com${path}`;
        await expect(fb.identity(page)).resolves.toBeUndefined();
      }
      window.location.href = "https://www.facebook.com/";
      cookies.push({ name: "c_user", value: recipient });
      await expect(fb.identity(page)).resolves.toBeUndefined();
      cookies.pop();
      cookies.push({ name: "i_user", value: "not-numeric" });
      await expect(fb.identity(page)).resolves.toBeUndefined();
      cookies.pop();
      cookies.splice(
        cookies.findIndex((cookie) => cookie.name === "xs"),
        1,
      );
      await expect(fb.identity(page)).resolves.toBeUndefined();
    } finally {
      await window.happyDOM.close();
    }
  });
  it("binds Instagram to an authenticated same-origin UI and the saved-session numeric actor", async () => {
    const { page } = browser("instagram");
    await expect(ig.identity(page)).resolves.toEqual({
      platformId: actor,
      name: "Instagram 123",
    });
    expect(page.cookies).toHaveBeenCalledWith(["https://www.instagram.com"]);
  });

  it("does not misclassify an existing professional Instagram web account as a personal member", async () => {
    const { page } = browser("instagram");
    const existing = { ...account("instagram"), accountType: "professional" as const };
    const connected = await ig.identity(page, existing);
    expect(connected).toMatchObject({ platformId: existing.platformId });
    expect(connected).not.toHaveProperty("accountType");
  });

  it("rejects a logged-out/checkpoint UI even when stale session cookies remain", async () => {
    const { page, snapshot } = browser("instagram");
    snapshot.path = "/challenge/";
    await expect(ig.identity(page)).resolves.toBeUndefined();
    snapshot.path = "/";
    snapshot.authenticated = false;
    await expect(ig.identity(page)).resolves.toBeUndefined();
  });

  it("uses Facebook's selected Page actor rather than the underlying personal user", async () => {
    const { page, cookies } = browser("facebook");
    cookies.push({ name: "i_user", value: recipient });
    await expect(fb.identity(page)).resolves.toEqual({
      platformId: recipient,
      name: "Facebook 456",
      accountType: "page",
    });
    expect(page.cookies).toHaveBeenCalledWith(["https://www.facebook.com"]);
  });

  it("does not connect a duplicate or invalid actor cookie or an off-origin page", async () => {
    const { page, cookies, snapshot } = browser("facebook");
    snapshot.origin = "https://attacker.example";
    await expect(fb.identity(page)).resolves.toBeUndefined();
    snapshot.origin = "https://www.facebook.com";
    cookies.push({ name: "i_user", value: "not-an-id" });
    await expect(fb.identity(page)).resolves.toBeUndefined();
  });
});

describe("Meta browser authoritative write evidence", () => {
  it("accepts an Instagram post only when actor, exact caption, media ID and shortcode agree", () => {
    expect(
      parseInstagramBrowserPublished(json(instagramMedia()), actor, "Exact approved caption"),
    ).toEqual({ platformId: "ig:AbC_123:789", url: "https://www.instagram.com/p/AbC_123/" });
    expect(() =>
      parseInstagramBrowserPublished(
        json(instagramMedia({ user: { pk: recipient } })),
        actor,
        "Exact approved caption",
      ),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
    expect(() =>
      parseInstagramBrowserPublished(json({ status: "ok" }), actor, "Exact approved caption"),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
  });

  it("does not accept an Instagram reply acknowledged under a different parent comment", () => {
    const comment = {
      status: "ok",
      comment: { pk: "900", user: { pk: actor }, text: "Reply", parent_comment_id: "100" },
    };
    expect(parseInstagramBrowserCommented(json(comment), actor, "Reply", "100")).toEqual({
      platformId: "900",
    });
    expect(() => parseInstagramBrowserCommented(json(comment), actor, "Reply", "101")).toThrowError(
      expect.objectContaining({ code: "unknown" }),
    );
    expect(() => parseInstagramBrowserCommented(json(comment), actor, "Reply")).toThrowError(
      expect.objectContaining({ code: "unknown" }),
    );
  });

  it("does not accept an Instagram media acknowledgement missing approved carousel items", () => {
    const response = instagramMedia({ media_type: 1 });
    expect(
      parseInstagramBrowserPublished(json(response), actor, "Exact approved caption", ["image"]),
    ).toMatchObject({ platformId: "ig:AbC_123:789" });
    expect(() =>
      parseInstagramBrowserPublished(json(response), actor, "Exact approved caption", [
        "image",
        "image",
      ]),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
    expect(() =>
      parseInstagramBrowserPublished(json(response), actor, "Exact approved caption", ["video"]),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
  });

  it("accepts a Facebook post only with the actor and canonical persisted post URL", () => {
    expect(
      parseFacebookBrowserPublished(
        `for (;;);${json(facebookStory())}`,
        actor,
        "Exact approved caption",
      ),
    ).toEqual({ platformId: postUrl, url: postUrl });
    expect(() =>
      parseFacebookBrowserPublished(
        json(facebookStory({ actors: [{ id: recipient }] })),
        actor,
        "Exact approved caption",
      ),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
    expect(() =>
      parseFacebookBrowserPublished(
        json(facebookStory({ url: "https://attacker.example/123/posts/789/" })),
        actor,
        "Exact approved caption",
      ),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
  });

  it("binds a Facebook comment to the selected post feedback, actor, body and parent", () => {
    const result = {
      data: {
        comment_create: {
          comment: {
            legacy_fbid: "900",
            author: { id: actor },
            body: { text: "Reply" },
            feedback: { id: feedback },
            parent_comment: { legacy_fbid: "800" },
          },
        },
      },
    };
    expect(parseFacebookBrowserCommented(json(result), actor, "Reply", postUrl, "800")).toEqual({
      platformId: "900",
    });
    expect(() =>
      parseFacebookBrowserCommented(
        json(result),
        actor,
        "Reply",
        "https://www.facebook.com/123/posts/790/",
        "800",
      ),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
  });

  it("does not accept a text-only Facebook story when an uploaded image was approved", () => {
    expect(() =>
      parseFacebookBrowserPublished(json(facebookStory()), actor, "Exact approved caption", [
        "image",
      ]),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
    expect(
      parseFacebookBrowserPublished(
        json(facebookStory({ attachments: [{ media: { id: "photo-1", __typename: "Photo" } }] })),
        actor,
        "Exact approved caption",
        ["image"],
      ),
    ).toEqual({ platformId: postUrl, url: postUrl });
  });

  it("requires the exact legacy Messenger sender, recipient, thread and message body", () => {
    const response = {
      payload: {
        actions: [
          {
            message_id: "mid.$abc.123",
            author: "fbid:123",
            other_user_fbid: recipient,
            thread_fbid: "777",
            body: "Message",
          },
        ],
      },
    };
    expect(
      parseFacebookBrowserMessageSent(json(response), actor, recipient, "777", "Message"),
    ).toEqual({ platformId: "mid.$abc.123" });
    expect(() =>
      parseFacebookBrowserMessageSent(json(response), actor, "457", "777", "Message"),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
    expect(() =>
      parseFacebookBrowserMessageSent(json(response), actor, recipient, "777", "Different"),
    ).toThrowError(expect.objectContaining({ code: "unknown" }));
  });
});

describe("Meta browser inbound formats", () => {
  it("reads directed Instagram text messages and excludes own sent messages", () => {
    const result = parseInstagramBrowserInbox(
      json({
        status: "ok",
        viewer_id: actor,
        inbox: {
          threads: [
            {
              thread_id: "777",
              users: [{ pk: recipient, username: "contact" }],
              items: [
                {
                  item_id: "900",
                  user_id: recipient,
                  item_type: "text",
                  text: "Incoming",
                  timestamp: now * 1000,
                },
                {
                  item_id: "901",
                  user_id: actor,
                  item_type: "text",
                  text: "Sent",
                  timestamp: now * 1000,
                },
              ],
            },
          ],
        },
      }),
      actor,
      now,
    );
    expect(result).toEqual([
      expect.objectContaining({
        eventId: "ig:message:900",
        threadId: "777",
        contactId: recipient,
        text: "Incoming",
        at: now,
      }),
    ]);
  });

  it("distinguishes a recognized empty Instagram inbox from unknown/encrypted/group formats", () => {
    expect(
      parseInstagramBrowserInbox(json({ status: "ok", inbox: { threads: [] } }), actor, now),
    ).toEqual([]);
    expect(() =>
      parseInstagramBrowserInbox(
        json({ status: "ok", inbox: { encrypted_threads: [] } }),
        actor,
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: "unsupported" }));
    expect(() =>
      parseInstagramBrowserInbox(
        json({
          status: "ok",
          inbox: {
            threads: [{ thread_id: "777", users: [{ pk: "456" }, { pk: "457" }], items: [] }],
          },
        }),
        actor,
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: "unsupported" }));
  });

  it("binds Facebook comments to the exact saved post rather than an unrelated GraphQL response", () => {
    const response = {
      data: {
        node: {
          feedback: {
            id: feedback,
            display_comments: {
              edges: [
                {
                  node: {
                    legacy_fbid: "900",
                    author: { id: recipient, name: "Contact" },
                    body: { text: "Comment" },
                    created_time: now / 1000,
                  },
                },
                {
                  node: {
                    legacy_fbid: "901",
                    author: { id: actor },
                    body: { text: "Own" },
                    created_time: now / 1000,
                  },
                },
              ],
            },
          },
        },
      },
    };
    expect(parseFacebookBrowserComments(json(response), actor, postUrl, now)).toEqual([
      expect.objectContaining({
        eventId: "fb:comment:900",
        contactId: recipient,
        postId: postUrl,
        text: "Comment",
      }),
    ]);
    expect(() =>
      parseFacebookBrowserComments(
        json(response),
        actor,
        "https://www.facebook.com/123/posts/790/",
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: "denied" }));
  });
});

describe("Meta browser submission boundaries", () => {
  it("never opens a composer or submits when the connected identity fails verification", async () => {
    const fixture = browser("facebook", [json(facebookStory())]);
    vi.mocked(fixture.context.verifyIdentity).mockRejectedValue(new SocialPlatformError("denied"));
    await expect(fb.send(fixture.context, job("facebook"))).rejects.toMatchObject({
      code: "denied",
    });
    expect(fixture.page.click).not.toHaveBeenCalled();
    expect(fixture.page.fill).not.toHaveBeenCalled();
    expect(fixture.context.markSubmitted).not.toHaveBeenCalled();
  });

  it("ignores unrelated GraphQL responses and submits an approved Facebook post once", async () => {
    const fixture = browser("facebook", [
      json({ data: { unrelated: { id: "other" } } }),
      json(facebookStory()),
    ]);
    await expect(fb.send(fixture.context, job("facebook"))).resolves.toEqual({
      platformId: postUrl,
      url: postUrl,
    });
    expect(fixture.page.click).toHaveBeenCalledTimes(2); // open composer, one submit
    expect(fixture.context.verifyIdentity).toHaveBeenCalledTimes(3);
    expect(fixture.context.markSubmitted).toHaveBeenCalledOnce();
    expect(vi.mocked(fixture.context.markSubmitted!).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.page.click).mock.invocationCallOrder[1],
    );
    expect(fixture.stopped).toHaveBeenCalledOnce();
  });

  it("holds missing/ambiguous acknowledgement without clicking Submit twice", async () => {
    const fixture = browser("facebook", [json({ data: { story_create: { story: null } } })]);
    await expect(fb.send(fixture.context, job("facebook"))).rejects.toMatchObject({
      code: "unknown",
    });
    expect(fixture.page.click).toHaveBeenCalledTimes(2);
    expect(fixture.stopped).toHaveBeenCalledOnce();
  });

  it("holds an identity change after acknowledged submission as an uncertain outcome", async () => {
    const fixture = browser("facebook", [json(facebookStory())]);
    vi.mocked(fixture.context.verifyIdentity)
      .mockResolvedValueOnce()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new SocialPlatformError("denied"));
    await expect(fb.send(fixture.context, job("facebook"))).rejects.toMatchObject({
      code: "unknown",
    });
    expect(fixture.page.click).toHaveBeenCalledTimes(2);
  });

  it("rejects remote upload URLs and mixed image/video before changing the page", async () => {
    const fixture = browser("instagram");
    const request = job("instagram", {
      payload: { text: "Image", media: [{ kind: "image", url: "https://example.com/image.jpg" }] },
    });
    await expect(ig.send(fixture.context, request)).rejects.toMatchObject({ code: "unsupported" });
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.page.setFiles).not.toHaveBeenCalled();
  });

  it("requires an existing recipient-bound thread before preparing a direct message", async () => {
    const fixture = browser("instagram");
    await expect(
      ig.send(
        fixture.context,
        job("instagram", {
          kind: "message",
          payload: { text: "Message", media: [], recipientId: recipient },
        }),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fixture.page.goto).not.toHaveBeenCalled();
    expect(fixture.page.fill).not.toHaveBeenCalled();
  });

  it("does not send into an Instagram thread belonging to another recipient", async () => {
    const fixture = browser("instagram", [
      json({ status: "ok", thread: { thread_id: "777", users: [{ pk: "457" }], items: [] } }),
    ]);
    await expect(
      ig.send(
        fixture.context,
        job("instagram", {
          kind: "message",
          payload: { text: "Message", media: [], recipientId: recipient, threadId: "777" },
        }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fixture.page.fill).not.toHaveBeenCalled();
    expect(fixture.page.click).not.toHaveBeenCalled();
  });

  it("verifies an Instagram DM's persisted item after the acknowledgement", async () => {
    const before = {
      status: "ok",
      thread: { thread_id: "777", users: [{ pk: recipient }], items: [] },
    };
    const accepted = { status: "ok", payload: { item_id: "900", thread_id: "777" } };
    const after = {
      status: "ok",
      thread: {
        thread_id: "777",
        users: [{ pk: recipient }],
        items: [{ item_id: "900", user_id: actor, item_type: "text", text: "Message" }],
      },
    };
    const fixture = browser("instagram", [json(before), json(accepted), json(after)]);
    await expect(
      ig.send(
        fixture.context,
        job("instagram", {
          kind: "message",
          payload: { text: "Message", media: [], recipientId: recipient, threadId: "777" },
        }),
      ),
    ).resolves.toEqual({ platformId: "900" });
    expect(fixture.page.goto).toHaveBeenCalledTimes(2);
    expect(fixture.page.click).toHaveBeenCalledOnce();
    expect(fixture.context.markSubmitted).toHaveBeenCalledOnce();
    expect(vi.mocked(fixture.context.markSubmitted!).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.page.click).mock.invocationCallOrder[0],
    );
  });

  it("holds an Instagram DM accepted under an ID but missing from persisted readback", async () => {
    const thread = {
      status: "ok",
      thread: { thread_id: "777", users: [{ pk: recipient }], items: [] },
    };
    const fixture = browser("instagram", [
      json(thread),
      json({ status: "ok", payload: { item_id: "900", thread_id: "777" } }),
      json(thread),
    ]);
    await expect(
      ig.send(
        fixture.context,
        job("instagram", {
          kind: "message",
          payload: { text: "Message", media: [], recipientId: recipient, threadId: "777" },
        }),
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fixture.page.click).toHaveBeenCalledOnce();
  });

  it("reports total unsupported polling instead of inventing an empty healthy inbox", async () => {
    const fixture = browser("facebook", []);
    await expect(fb.poll(fixture.context, [])).rejects.toMatchObject({ code: "unsupported" });
  });
});
