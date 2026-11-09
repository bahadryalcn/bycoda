import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UnexpectedScreen } from "./browser-layers/types";
import { account, fixture, job, recipe } from "./social-browser-publishing-test-support";

const channel = "UCabcdefghijklmnopqrstuv";
const inboxUrl = `https://studio.youtube.com/channel/${channel}/comments/inbox`;
const owner = () => account("youtube", `web:youtube:${channel}`, "channel");

/** Body markup of a recorded Studio page (the test DOM takes the body content only). */
function recorded(name: string): string {
  const raw = readFileSync(new URL(`./fixtures/youtube/${name}`, import.meta.url), "utf8");
  return raw.replace(/^[\s\S]*<body>/i, "").replace(/<\/body>[\s\S]*$/i, "");
}

describe("recorded YouTube Studio pages", () => {
  it("reads the saved comment inbox into inbound comments", async () => {
    const html = recorded("studio-comments-inbox.html");
    const f = fixture(recipe("youtube"), owner(), html, { render: () => html });
    f.window.location.href = inboxUrl;
    const result = await recipe("youtube").poll(f.ctx, []);
    expect(result.events.map((event) => [event.eventId, event.contactId, event.text])).toEqual([
      ["UgxFixtureComment01", "web:youtube:UCfanoneabcdefghijklmnop", "Great video, thanks"],
      ["UgxFixtureComment02", "web:youtube:UCfantwoabcdefghijklmnop", "How much does it cost?"],
    ]);
    expect(result.coverage).toEqual([{ channel: "comments", status: "read" }]);
  });

  it("hands a changed comment layout to the next layer without guessing rows", async () => {
    const html = recorded("studio-comments-changed-layout.html");
    const f = fixture(recipe("youtube"), owner(), html, { render: () => html });
    f.window.location.href = inboxUrl;
    const error = (await recipe("youtube")
      .poll(f.ctx, [])
      .catch((caught: unknown) => caught)) as UnexpectedScreen;
    expect(error).toBeInstanceOf(UnexpectedScreen);
    expect(error.snapshot.url).toBe(inboxUrl);
    expect(error.snapshot.headings).toEqual(["Comment inbox redesigned"]);
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("treats a visible human-verification page as NEEDS_HUMAN and never interacts with it", async () => {
    const html = recorded("studio-human-verification.html");
    const f = fixture(recipe("youtube"), owner(), html, { render: () => html });
    f.window.location.href = inboxUrl;
    await expect(recipe("youtube").poll(f.ctx, [])).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });

  it("stops an upload before any file is attached when the Studio upload control is missing", async () => {
    const html = `<ytcp-app><a id="channel-link" href="https://www.youtube.com/channel/${channel}">Bycoda Fixture</a><h2>New Studio layout</h2></ytcp-app>`;
    const f = fixture(recipe("youtube"), owner(), html, { render: () => html });
    f.ctx.files = [{ kind: "video", path: "synthetic.mp4" }];
    const sent = job("publish", {
      text: "A product video",
      media: [{ kind: "video", uploadId: "id" }],
      youtube: {
        title: "Bycoda release",
        privacy: "private",
        madeForKids: false,
        containsSyntheticMedia: false,
      },
    });
    const error = (await recipe("youtube")
      .send(f.ctx, sent)
      .catch((caught: unknown) => caught)) as UnexpectedScreen;
    expect(error).toBeInstanceOf(UnexpectedScreen);
    expect(error.snapshot.headings).toEqual(["New Studio layout"]);
    expect(f.page.setFiles).not.toHaveBeenCalled();
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });
});
