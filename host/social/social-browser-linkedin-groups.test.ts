import { expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { linkedInGroupAction, linkedInReadGroups } from "./social-browser-linkedin-groups";
import { linkedinBrowserRecipe } from "./social-browser-linkedin";
import { account, fixture } from "./social-browser-publishing-test-support";

const own = account("linkedin", "web:linkedin:in:bycoda-owner");
const identity =
  '<div class="feed-identity-module__actor-meta"><a href="/in/bycoda-owner/">Owner</a></div>';
const groupId = "web:linkedin:group:12345";
const groupUrl = "https://www.linkedin.com/groups/12345/";
const groupHeader = (label: string) =>
  `${identity}<main><header><button>${label}</button></header></main>`;
function limiter() {
  return {
    reserve: vi.fn(async () => undefined),
    record: vi.fn(async () => undefined),
    beforeSubmit: vi.fn(async () => undefined),
  };
}

it("reads only identity-bound groups from the Your groups section", async () => {
  const f = fixture(
    linkedinBrowserRecipe,
    own,
    `${identity}<main><section><h1>Your groups</h1>
    <a href="/groups/12345/">Fixture Group</a>
    <a href="https://example.com/groups/123/">Wrong origin</a>
    <a href="/groups/12345/">Duplicate</a>
    </section><aside><a href="/groups/23456/">Unrelated</a></aside></main>`,
  );
  await expect(linkedInReadGroups(f.ctx)).resolves.toEqual({
    groups: [{ platformId: groupId, url: groupUrl, name: "Fixture Group" }],
    complete: false,
  });
  expect(f.page.click).not.toHaveBeenCalled();
});

it("blocks the join click before charging when approval or suppression is refused", async () => {
  const f = fixture(linkedinBrowserRecipe, own, groupHeader("Request to join"));
  const gate = limiter();
  gate.beforeSubmit.mockRejectedValueOnce(new SocialPlatformError("denied"));
  await expect(linkedInGroupAction(f.ctx, { kind: "join", groupId }, gate)).rejects.toMatchObject({
    code: "denied",
  });
  expect(gate.beforeSubmit).toHaveBeenCalledExactlyOnceWith(own.id, groupId);
  expect(gate.record).not.toHaveBeenCalled();
  expect(f.page.click).not.toHaveBeenCalled();
});

it("counts one click and verifies a pending join request", async () => {
  const f = fixture(linkedinBrowserRecipe, own, groupHeader("Request to join"), {
    click: (element) => {
      element.ownerDocument.body.innerHTML = groupHeader("Request pending");
    },
  });
  const gate = limiter();
  await expect(linkedInGroupAction(f.ctx, { kind: "join", groupId }, gate)).resolves.toEqual({
    groupId,
    url: groupUrl,
    status: "membership_pending",
  });
  expect(gate.record).toHaveBeenCalledExactlyOnceWith(own.id);
  expect(f.page.click).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "requires a fresh exact group-post receipt (received %s)",
  async (received) => {
    const launch = `${identity}<main><button>Start a post</button></main>`;
    const composer = `${identity}<dialog open><div role="textbox" contenteditable="true"></div><button>Post</button></dialog>`;
    const published = `${identity}<main><article data-urn="urn:li:activity:4321" data-id="4321">
    <a class="update-components-actor__meta-link" href="/in/bycoda-owner/">Owner</a>
    <p class="feed-shared-update-v2__description">Fixture post</p>
    </article></main>`;
    const f = fixture(linkedinBrowserRecipe, own, launch, {
      click: (element) => {
        if (element.textContent === "Start a post") element.ownerDocument.body.innerHTML = composer;
        if (element.textContent === "Post")
          element.ownerDocument.body.innerHTML = received ? published : launch;
      },
    });
    const gate = limiter();
    const submission = linkedInGroupAction(
      f.ctx,
      { kind: "post", groupId, text: "Fixture post" },
      gate,
    );
    if (received)
      await expect(submission).resolves.toEqual({
        groupId,
        url: groupUrl,
        status: "published",
        platformId: "urn:li:activity:4321",
      });
    else await expect(submission).rejects.toMatchObject({ code: "unknown" });
    expect(f.page.fill).toHaveBeenCalledTimes(1);
    expect(gate.beforeSubmit).toHaveBeenCalledTimes(1);
    expect(gate.record).toHaveBeenCalledTimes(1);
    expect(f.page.click).toHaveBeenCalledTimes(2);
  },
);
