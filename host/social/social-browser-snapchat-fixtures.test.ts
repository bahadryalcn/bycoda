import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UnexpectedScreen } from "./browser-layers/types";
import { account, fixture, recipe } from "./social-browser-publishing-test-support";
import { snapchatCollectAudience } from "./social-browser-snapchat-audience";

const own = () => account("snapchat", "web:snapchat:bycoda");
const webHome = "https://web.snapchat.com/";

/** Body markup of a saved page (the test DOM takes the body content only). */
function recorded(name: string): string {
  const raw = readFileSync(new URL(`./fixtures/snapchat/${name}`, import.meta.url), "utf8");
  return raw.replace(/^[\s\S]*<body>/i, "").replace(/<\/body>[\s\S]*$/i, "");
}

describe("saved Snapchat web pages (synthetic fixtures)", () => {
  it("collects existing chat contacts from the visible chat list, once each", async () => {
    const html = recorded("chat-list.html");
    const f = fixture(recipe("snapchat"), own(), html, { render: () => html });
    const result = await snapchatCollectAudience(f.ctx, {
      kind: "dm_senders",
      accountId: "synthetic",
    });
    expect(result.people.map((person) => [person.platformId, person.ref, person.kind])).toEqual([
      ["web:snapchat:friend_one", "thread-abcdef12", "dm"],
      ["web:snapchat:friend_two", "thread-bcdefg23", "dm"],
    ]);
    expect(result.people[0]).toMatchObject({
      name: "friend_one",
      username: "friend_one",
      profileUrl: "https://www.snapchat.com/add/friend_one",
    });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });

  it("rejects other audience sources without opening the browser", async () => {
    const html = recorded("chat-list.html");
    const f = fixture(recipe("snapchat"), own(), html, { render: () => html });
    await expect(
      snapchatCollectAudience(f.ctx, { kind: "followers", accountId: "synthetic" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.goto).not.toHaveBeenCalled();
  });

  it("hands a changed chat-list layout to the next layer without guessing contacts", async () => {
    const html = recorded("chat-list-changed-layout.html");
    const f = fixture(recipe("snapchat"), own(), html, { render: () => html });
    const error = (await snapchatCollectAudience(f.ctx, {
      kind: "dm_senders",
      accountId: "synthetic",
    }).catch((caught: unknown) => caught)) as UnexpectedScreen;
    expect(error).toBeInstanceOf(UnexpectedScreen);
    expect(error.snapshot.url).toBe(webHome);
    expect(error.snapshot.headings).toEqual(["Chats moved"]);
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("recognizes a two-factor page as NEEDS_HUMAN and never types a code or clicks", async () => {
    const html = recorded("two-factor.html");
    const f = fixture(recipe("snapchat"), own(), html, { render: () => html });
    await expect(
      snapchatCollectAudience(f.ctx, { kind: "dm_senders", accountId: "synthetic" }),
    ).rejects.toMatchObject({ code: "needs_human" });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.page.insertText).not.toHaveBeenCalled();
  });
});
