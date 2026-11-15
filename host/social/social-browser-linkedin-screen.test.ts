import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UnexpectedScreen } from "./browser-layers/types";
import { linkedinBrowserRecipe } from "./social-browser-linkedin";
import { account, fixture, job } from "./social-browser-publishing-test-support";

const fixtureHtml = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/linkedin/${name}`, import.meta.url)), "utf8");
const owner = `<div class="feed-identity-module__actor-meta"><a href="/in/bycoda-owner/">Owner</a></div>`;
const memberAccount = () => account("linkedin", "web:linkedin:in:bycoda-owner");
const emptyComments = `${owner}<div class="comments-comments-list"><div class="comments-empty-state">No comments yet</div></div>`;

describe("LinkedIn browser screen handling", () => {
  it("hands a missing required control on an unexpected page to the layered driver", async () => {
    const f = fixture(
      linkedinBrowserRecipe,
      memberAccount(),
      `${owner}<main><button>Something else</button></main>`,
    );
    const error = await linkedinBrowserRecipe.send(f.ctx, job()).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(UnexpectedScreen);
    const summary = (error as UnexpectedScreen).snapshot;
    expect(summary.buttons).toContain("Something else");
    expect(summary.url).not.toContain("?");
  });

  it("escalates a captcha on a page with a readable identity to NEEDS_HUMAN", async () => {
    const f = fixture(linkedinBrowserRecipe, memberAccount(), fixtureHtml("captcha-feed.html"));
    await expect(linkedinBrowserRecipe.send(f.ctx, job())).rejects.toMatchObject({
      code: "needs_human",
    });
  });

  it("refuses a commentary over the platform limit before any browser action", async () => {
    const f = fixture(linkedinBrowserRecipe, memberAccount(), owner);
    await expect(
      linkedinBrowserRecipe.send(f.ctx, job("publish", { text: "x".repeat(3001) })),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.goto).not.toHaveBeenCalled();
  });

  it("reports a bounded comment window as partial and reads mentions from notifications", async () => {
    const f = fixture(linkedinBrowserRecipe, memberAccount(), owner, {
      render: (url) =>
        url.includes("/notifications/")
          ? fixtureHtml("notifications-mention.html")
          : url.includes("/feed/update/")
            ? emptyComments
            : owner,
    });
    const result = await linkedinBrowserRecipe.poll(f.ctx, [
      "urn:li:activity:1",
      "urn:li:activity:2",
      "urn:li:activity:3",
    ]);
    expect(result.coverage).toContainEqual({
      channel: "comments",
      status: "unavailable",
      reason: "response_unavailable",
    });
    expect(result.coverage).toContainEqual({ channel: "mentions", status: "read" });
    expect(result.events.map((event) => event.eventId)).toEqual([
      "mention:urn:li:activity:111:web:linkedin:in:ada-example",
      "mention:urn:li:activity:222:web:linkedin:in:grace-example",
    ]);
    // The page only shows relative times ("2 saat"), converted when read.
    expect(Math.abs(result.events[0].at - (Date.now() - 7_200_000))).toBeLessThan(60_000);
    expect(result.events[0]).toMatchObject({
      kind: "comment",
      contactId: "web:linkedin:in:ada-example",
      postId: "urn:li:activity:111",
    });
  });

  it("reports mentions as unavailable when the Mentions filter is not the active one", async () => {
    const f = fixture(linkedinBrowserRecipe, memberAccount(), owner, {
      render: (url) =>
        url.includes("/notifications/")
          ? fixtureHtml("notifications-mention.html").replace(
              'aria-checked="true">Bahsetmeler',
              'aria-checked="false">Bahsetmeler',
            )
          : url.includes("/feed/update/")
            ? emptyComments
            : owner,
    });
    const result = await linkedinBrowserRecipe.poll(f.ctx, ["urn:li:activity:1"]);
    expect(result.coverage).toContainEqual({
      channel: "mentions",
      status: "unavailable",
      reason: "response_unavailable",
    });
    expect(result.events).toEqual([]);
  });

  it("keeps a fully read comment window as read", async () => {
    const f = fixture(linkedinBrowserRecipe, memberAccount(), owner, {
      render: (url) => (url.includes("/feed/update/") ? emptyComments : owner),
    });
    const result = await linkedinBrowserRecipe.poll(f.ctx, ["urn:li:activity:1"]);
    expect(result.coverage).toContainEqual({ channel: "comments", status: "read" });
  });
});
