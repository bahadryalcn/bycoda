import { describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { UnexpectedScreen } from "./browser-layers/types";
import { snapchatBrowserConnectionUrl } from "./social-browser-publishing";
import { account, fixture, job, now, recipe } from "./social-browser-publishing-test-support";
import { snapchatVerifiedSpotlight } from "./social-browser-snapchat";
describe("Snapchat existing-chat boundaries", () => {
  const own = account("snapchat", "web:snapchat:bycoda");
  const header =
    '<nav data-testid="chat-list"></nav><div data-testid="my-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>';
  it("uses an own-profile surface and rejects a friend's profile as sender", async () => {
    const f = fixture(recipe("snapchat"), own, header);
    await expect(recipe("snapchat").identity(f.page)).resolves.toEqual({
      platformId: own.platformId,
      name: "@bycoda",
      accountType: "member",
    });
    f.window.document.body.innerHTML =
      '<nav data-testid="chat-list"></nav><div data-testid="friend-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>';
    await expect(recipe("snapchat").identity(f.page)).resolves.toBeUndefined();
  });
  it("accepts the current Snapchat Web redirect while rejecting a public marketing route", async () => {
    const f = fixture(recipe("snapchat"), own, header);
    f.window.location.href = "https://www.snapchat.com/web/";
    await expect(recipe("snapchat").identity(f.page, own)).resolves.toMatchObject({
      platformId: own.platformId,
    });
    f.window.location.href = "https://www.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, own)).resolves.toBeUndefined();
  });
  it("requires an observed existing conversation and exact recipient before editing", async () => {
    const f = fixture(
      recipe("snapchat"),
      own,
      header.replace(
        '<nav data-testid="chat-list"></nav>',
        '<nav data-testid="chat-list"><a href="/?chatId=thread-12345" data-username="friend">Friend</a></nav>',
      ),
    );
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("message", { recipientId: "web:snapchat:different", threadId: "thread-12345" }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
  });
  it("does not report an empty inbox for an unrecognized chat list", async () => {
    const f = fixture(recipe("snapchat"), own, header);
    await expect(recipe("snapchat").poll(f.ctx, [])).rejects.toBeInstanceOf(UnexpectedScreen);
    expect(f.page.click).not.toHaveBeenCalled();
  });
  it("treats a two-factor screen as NEEDS_HUMAN during identity and never interacts with it", async () => {
    const f = fixture(
      recipe("snapchat"),
      own,
      "<main><h1>Two-Factor Authentication</h1><p>Enter the code we sent you.</p></main>",
    );
    f.window.location.href = "https://accounts.snapchat.com/accounts/two-factor";
    await expect(recipe("snapchat").identity(f.page, own)).rejects.toMatchObject({
      code: "needs_human",
      detail: { url: "https://accounts.snapchat.com/accounts/two-factor" },
    });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });
  it("supports the host's kind=reply existing-DM job and verifies persistence after reopening", async () => {
    let sent = false,
      submissions = 0;
    const message = (id: string, sender: string, to: string, text: string) =>
      `<div data-message-id="${id}" data-sender-username="${sender}" data-recipient-username="${to}"><span data-message-text>${text}</span><time datetime="${new Date(now).toISOString()}"></time></div>`;
    const html =
      () => `<nav data-testid="chat-list"><a href="/?chatId=thread-12345" data-username="friend">Friend</a></nav><div data-testid="my-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>
      <div data-conversation-id="thread-12345"><span data-participant-username="bycoda"></span><span data-participant-username="friend"></span>
      ${message("old-message-123", "friend", "bycoda", "Hello")}${sent ? message("new-message-456", "bycoda", "friend", "A Bycoda update") : ""}
      <textarea aria-label="Send a chat"></textarea><button aria-label="Send">Send</button></div>`;
    const f = fixture(recipe("snapchat"), own, html(), {
      render: html,
      click: (el) => {
        if (el.getAttribute("aria-label") === "Send") {
          sent = true;
          submissions++;
        }
      },
    });
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("reply", { recipientId: "web:snapchat:friend", threadId: "thread-12345" }),
      ),
    ).resolves.toEqual({ platformId: "new-message-456" });
    expect(submissions).toBe(1);
  });

  describe("new chat from a verified friend", () => {
    const target = "web:snapchat:friend";
    const threadId = "thread-12345";
    const sendJob = job("message", { recipientId: target });
    const friend =
      '<div data-username="friend" data-relationship="friend"><button data-testid="open-chat">Chat</button></div>';
    const friends = (rows: string) =>
      header + '<div data-testid="my-friends-list">' + rows + "</div>";
    const conversation = (extra = "", recipient = "friend") =>
      header +
      `
      <div data-conversation-id="${threadId}">
        <span data-participant-username="bycoda"></span><span data-participant-username="${recipient}"></span>
        <span data-testid="empty-conversation"></span>
        <div data-testid="chat-input" contenteditable="true"></div><button data-testid="send-chat">Send</button>
        ${extra}
      </div>`;
    const receipt = `<div data-message-id="message-sent" data-sender-username="bycoda" data-recipient-username="friend">
      <span data-message-text>A Bycoda update</span><time datetime="${new Date(now).toISOString()}"></time></div>`;
    function openFriend(
      rows = friend,
      afterOpen = conversation(),
      outcome: "persisted" | "missing" | "click-error" = "persisted",
    ) {
      let submissions = 0;
      const f = fixture(recipe("snapchat"), own, header, {
        render: (url) =>
          url.includes("chatId=")
            ? conversation(submissions && outcome === "persisted" ? receipt : "")
            : friends(rows),
        click: (el) => {
          if (el.matches('[data-testid="open-chat"]')) f.window.document.body.innerHTML = afterOpen;
          if (el.matches('[data-testid="send-chat"]')) {
            submissions++;
            if (outcome === "click-error") throw new Error("Connection closed after dispatch");
          }
        },
      });
      return { ...f, submissions: () => submissions };
    }

    it("opens an exact friend and returns a receipt only after reopening the chat", async () => {
      const f = openFriend(
        friend + friend.replace('data-username="friend"', 'data-username="friend-other"'),
      );
      await expect(recipe("snapchat").send(f.ctx, sendJob)).resolves.toEqual({
        platformId: "message-sent",
      });
      expect(f.submissions()).toBe(1);
      expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
      expect(f.page.goto).toHaveBeenLastCalledWith(`https://web.snapchat.com/?chatId=${threadId}`);
    });

    it.each([
      friend + friend,
      friend.replace('data-relationship="friend"', 'data-relationship="pending"'),
      friend.replace('data-username="friend"', 'data-username="friend-other"'),
      friend.replace(
        ">Chat</button>",
        '>Chat</button><button data-testid="add-friend">Add Friend</button>',
      ),
    ])("refuses an ambiguous or non-friend row before clicking", async (rows) => {
      const f = openFriend(rows);
      await expect(recipe("snapchat").send(f.ctx, sendJob)).rejects.toMatchObject({
        code: "denied",
      });
      expect(f.page.click).not.toHaveBeenCalled();
      expect(f.page.fill).not.toHaveBeenCalled();
    });

    it.each([
      conversation("", "other"),
      conversation('<span data-participant-username="other"></span>'),
      conversation() + "<h1>Enter the verification code</h1>",
      conversation() + '<form><input type="password"></form>',
    ])("leaves the composer untouched when the opened screen is unsafe", async (screen) => {
      const f = openFriend(friend, screen);
      await expect(recipe("snapchat").send(f.ctx, sendJob)).rejects.toMatchObject({
        code:
          screen.includes("<h1>") || screen.includes('type="password"') ? "needs_human" : "denied",
      });
      expect(f.page.fill).not.toHaveBeenCalled();
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    });

    it("obeys the Host send gate again after filling and before submission", async () => {
      const f = openFriend();
      const verify = f.ctx.verifyIdentity;
      f.ctx.verifyIdentity = async () => {
        await verify();
        if (vi.mocked(f.page.fill).mock.calls.length) throw new SocialPlatformError("denied");
      };
      await expect(recipe("snapchat").send(f.ctx, sendJob)).rejects.toMatchObject({
        code: "denied",
      });
      expect(f.page.fill).toHaveBeenCalledOnce();
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
      expect(f.submissions()).toBe(0);
    });

    it.each(["missing", "click-error"] as const)(
      "holds %s delivery after one click",
      async (outcome) => {
        const f = openFriend(friend, conversation(), outcome);
        await expect(recipe("snapchat").send(f.ctx, sendJob)).rejects.toMatchObject({
          code: "unknown",
        });
        expect(f.submissions()).toBe(1);
        expect(f.ctx.markSubmitted).toHaveBeenCalledOnce();
      },
    );
  });
});

describe("Snapchat official web Spotlight upload", () => {
  const own = account("snapchat", "web:snapchat:public_profile:bycoda", "public_profile");
  const options = (
    terms: boolean,
    extraProfile = false,
  ) => `<header><div data-testid="profile-menu"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div></header><main>
    <input type="file" accept="video/*"><label><input type="checkbox" name="selectedProfiles" checked><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></label>
    ${extraProfile ? '<label><input type="checkbox" name="selectedProfiles" checked><a href="https://www.snapchat.com/add/other">Other</a></label>' : ""}
    <label><input type="checkbox" name="spotlight">Spotlight Snaps</label><textarea name="caption"></textarea><label><input type="checkbox" name="creatorTerms" ${terms ? "checked" : ""}>Creator Terms</label><button>Post to Snapchat</button></main>`;
  it("does not accept Creator Terms on the owner's behalf", async () => {
    let submissions = 0;
    const f = fixture(recipe("snapchat"), own, options(false), {
      render: () => options(false),
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.textContent === "Post to Snapchat") submissions++;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(submissions).toBe(0);
  });
  it("refuses an upload selecting another Public Profile in addition to this account", async () => {
    let submissions = 0;
    const f = fixture(recipe("snapchat"), own, options(true, true), {
      render: () => options(true, true),
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.textContent === "Post to Snapchat") submissions++;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(submissions).toBe(0);
  });
  it("requires one newly persisted Spotlight with exact owner/text and a recent remote timestamp", async () => {
    let submitted = false;
    const publicUrl = "https://www.snapchat.com/spotlight/post_12345678";
    const html = () =>
      options(true) +
      (submitted
        ? `<article><a href="${publicUrl}">Spotlight</a><a href="https://www.snapchat.com/add/bycoda">Bycoda</a><div class="caption">A Bycoda update</div><time datetime="${new Date(now).toISOString()}"></time></article>`
        : "");
    const f = fixture(recipe("snapchat"), own, html(), {
      render: html,
      click: (el) => {
        if (el.matches('input[type="checkbox"]'))
          (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked;
        if (el.textContent === "Post to Snapchat") submitted = true;
      },
    });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).resolves.toEqual({ platformId: "post_12345678", url: publicUrl });
  });
});

describe("separate Snapchat browser subjects", () => {
  const member = account("snapchat", "web:snapchat:bycoda", "member");
  const profile = account("snapchat", "web:snapchat:public_profile:bycoda", "public_profile");
  const selected = (username = "bycoda") =>
    `<form data-testid="upload-form"><input type="file" accept="video/*"><label><input type="checkbox" name="selectedProfiles" checked><a href="https://www.snapchat.com/add/${username}">${username}</a></label></form>`;
  it("starts Public Profile setup on the documented uploader and preserves the member chat route", () => {
    expect(snapchatBrowserConnectionUrl(profile)).toBe("https://my.snapchat.com");
    expect(snapchatBrowserConnectionUrl(member)).toBe("https://web.snapchat.com");
    expect(() => snapchatBrowserConnectionUrl(account("snapchat", "", "business"))).toThrow(
      "member account or Public Profile",
    );
  });
  it("cannot verify a Public Profile from a generic chat username", async () => {
    const f = fixture(
      recipe("snapchat"),
      profile,
      '<nav data-testid="chat-list"></nav><div data-testid="my-profile"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div>',
    );
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toBeUndefined();
    expect(f.page.click).not.toHaveBeenCalled();
  });
  it("requires exactly one selected uploader profile rather than the generic account header", async () => {
    const f = fixture(
      recipe("snapchat"),
      profile,
      `<header><div data-testid="profile-menu"><a href="https://www.snapchat.com/add/account-owner">Account owner</a></div></header>${selected()}`,
    );
    f.window.location.href = "https://my.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toEqual({
      platformId: profile.platformId,
      name: "@bycoda",
      accountType: "public_profile",
    });
    f.window.document.body.innerHTML =
      '<header><div data-testid="profile-menu"><a href="https://www.snapchat.com/add/bycoda">Bycoda</a></div></header><input type="file">';
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toBeUndefined();
  });
  it("rejects two selected profiles and a selected profile different from the saved subject", async () => {
    const f = fixture(recipe("snapchat"), profile, selected() + selected("other-profile"));
    f.window.location.href = "https://my.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, profile)).resolves.toBeUndefined();
    f.window.document.body.innerHTML = selected("other-profile");
    await expect(f.ctx.verifyIdentity()).rejects.toMatchObject({ code: "denied" });
  });
  it("keeps the same username's member and Public Profile namespaces separate", async () => {
    const f = fixture(recipe("snapchat"), member, selected());
    f.window.location.href = "https://my.snapchat.com/";
    await expect(recipe("snapchat").identity(f.page, member)).resolves.toBeUndefined();
    await expect(recipe("snapchat").poll({ ...f.ctx, account: profile }, [])).rejects.toMatchObject(
      { code: "unsupported" },
    );
    await expect(
      recipe("snapchat").send(
        f.ctx,
        job("publish", { media: [{ kind: "video", uploadId: "id" }] }),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.setFiles).not.toHaveBeenCalled();
  });
});

describe("Snapchat Public Profile Spotlight read-back", () => {
  const profile = account(
    "snapchat",
    "web:snapchat:public_profile:11111111-1111-1111-1111-111111111111",
    "public_profile",
  );
  const stamp = new Date(now).toISOString();
  const spotlight = (id: string, text = "A Bycoda update", when = stamp) =>
    `<article><a href="https://www.snapchat.com/spotlight/${id}">Spotlight</a><a href="https://www.snapchat.com/add/bycoda">Bycoda</a><div class="caption">${text}</div><time datetime="${when}"></time></article>`;
  const submitted = { at: now, text: "A Bycoda update" };
  // Read-back runs on the uploader page; the identity check is covered by the uploader tests above.
  const readBack = (render: string) => {
    const f = fixture(recipe("snapchat"), profile, "<main></main>", { render: () => render });
    f.ctx.verifyIdentity = async () => {};
    return f;
  };

  it("returns the one new Spotlight whose caption and time match the submission", async () => {
    const f = readBack(spotlight("post_12345678"));
    await expect(snapchatVerifiedSpotlight(f.ctx, { before: [], ...submitted })).resolves.toEqual({
      platformId: "post_12345678",
      url: "https://www.snapchat.com/spotlight/post_12345678",
    });
  });
  it("stays unknown when the list cannot be read back", async () => {
    const f = readBack("<main><p>Nothing here</p></main>");
    await expect(
      snapchatVerifiedSpotlight(f.ctx, { before: [], ...submitted }),
    ).rejects.toMatchObject({ code: "unknown" });
  });
  it("never reports a Spotlight that was already listed before the submission", async () => {
    const f = readBack(spotlight("post_12345678"));
    await expect(
      snapchatVerifiedSpotlight(f.ctx, {
        before: [
          {
            id: "post_12345678",
            owner: "web:snapchat:public_profile:bycoda",
            text: "A Bycoda update",
            at: now,
            url: "https://www.snapchat.com/spotlight/post_12345678",
          },
        ],
        ...submitted,
      }),
    ).rejects.toMatchObject({ code: "unknown" });
  });
  it("stays unknown for two matching rows or a stale remote timestamp", async () => {
    const twice = readBack(spotlight("post_12345678") + spotlight("post_87654321"));
    await expect(
      snapchatVerifiedSpotlight(twice.ctx, { before: [], ...submitted }),
    ).rejects.toMatchObject({ code: "unknown" });
    const stale = readBack(
      spotlight("post_12345678", "A Bycoda update", new Date(now - 10 * 60_000).toISOString()),
    );
    await expect(
      snapchatVerifiedSpotlight(stale.ctx, { before: [], ...submitted }),
    ).rejects.toMatchObject({ code: "unknown" });
  });
});
