import { describe, expect, it, vi } from "vitest";
import type { HTMLInputElement } from "happy-dom";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SocialPrincipal, SocialService } from "./social";
import { XBrowserSessions } from "./social-browser-x";
import { account, fixture, recipe } from "./social-browser-publishing-test-support";
import {
  SnapchatProfileActions,
  parseSnapchatProfilePatch,
} from "./social-browser-snapchat-profile";

const profileId = "11111111-1111-1111-1111-111111111111";
const otherId = "22222222-2222-2222-2222-222222222222";
const profile = account("snapchat", "web:snapchat:public_profile:" + profileId, "public_profile");
const member = account("snapchat", "web:snapchat:owner");
const manager = (body: string, id: string = profileId) =>
  '<main data-testid="public-profile-manager" data-owner-username="owner" data-profile-username="owner"' +
  (id ? ' data-profile-id="' + id + '"' : "") +
  ">" +
  body +
  "</main>";
const editor = (mode: "create" | "update", name: string, extra = "") =>
  '<form data-testid="public-profile-form"><input name="name" type="text" value="' +
  name +
  '">' +
  extra +
  '<button type="submit">' +
  (mode === "create" ? "Create Public Profile" : "Save") +
  "</button></form>";

function setup(render: () => string, subject = profile, click?: () => void) {
  const f = fixture(recipe("snapchat"), subject, "", { render, click });
  vi.mocked(f.page.fill).mockImplementation(async (selector, value) => {
    const input = f.window.document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error("Missing input");
    input.value = value;
  });
  const mark = vi.fn(async () => {});
  const actions = new SnapchatProfileActions(f.page, subject, async () => {}, f.ctx.waitFor, mark);
  return { ...f, actions, mark };
}

describe("Snapchat profile manager contracts", () => {
  it("reads saved fields from one exact profile and excludes editor-only draft values", async () => {
    const data =
      '<span data-testid="profile-name">Current name</span>' +
      editor("update", "Unsaved name", '<textarea name="bio">Unsaved bio</textarea>');
    const f = setup(() => manager(data));
    await expect(f.actions.read()).resolves.toEqual({
      hasPublicProfile: true,
      profileId,
      name: "Current name",
    });
    expect(f.page.click).not.toHaveBeenCalled();
    await expect(setup(() => manager(data, otherId)).actions.read()).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(setup(() => manager(data) + manager(data)).actions.read()).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it("reports only explicit monetization status for the exact profile", async () => {
    const daily = '<p data-testid="daily-rewards-eligibility">Eligible</p>';
    for (const status of ["eligible", "ineligible", "unavailable"]) {
      const program = '<p data-testid="monetization-program-status">' + status + "</p>";
      await expect(setup(() => manager(daily + program)).actions.monetization()).resolves.toEqual({
        status,
        dailyRewardsEligible: true,
      });
    }
    await expect(setup(() => manager(daily)).actions.monetization()).resolves.toEqual({
      status: "unknown",
      dailyRewardsEligible: true,
    });
    await expect(setup(() => manager(daily, otherId)).actions.monetization()).resolves.toEqual({
      status: "unknown",
    });
  });

  it("creates a profile for the exact member and verifies saved fields after reopening", async () => {
    let created = false;
    const f = setup(
      () =>
        created
          ? manager('<span data-testid="profile-name">New name</span>')
          : manager('<p data-testid="no-public-profile"></p>' + editor("create", ""), ""),
      member,
      () => {
        created = true;
      },
    );
    await expect(f.actions.create({ name: "New name" })).resolves.toMatchObject({
      profileId,
      name: "New name",
    });
    expect(f.mark).toHaveBeenCalledOnce();
    expect(f.page.click).toHaveBeenCalledOnce();
    expect(f.page.goto).toHaveBeenCalledTimes(2);
  });

  it("updates the exact profile and verifies each requested field on the refreshed page", async () => {
    let saved = false;
    const f = setup(
      () =>
        manager(
          saved
            ? '<span data-testid="profile-name">New name</span><span data-testid="profile-bio">New bio</span>'
            : '<span data-testid="profile-name">Old name</span><span data-testid="profile-bio">Old bio</span>' +
                editor("update", "Old name", '<textarea name="bio">Old bio</textarea>'),
        ),
      profile,
      () => {
        saved = true;
      },
    );
    await expect(f.actions.update({ name: "New name", bio: "New bio" })).resolves.toMatchObject({
      profileId,
      name: "New name",
      bio: "New bio",
    });
    expect(f.page.fill).toHaveBeenCalledTimes(2);
    expect(f.page.click).toHaveBeenCalledOnce();
    expect(f.mark).toHaveBeenCalledOnce();
  });

  it.each(["unpersisted", "changed-profile", "click-error"])(
    "holds %s after one submit",
    async (outcome) => {
      let submitted = false;
      const f = setup(
        () =>
          manager(
            '<span data-testid="profile-name">Old name</span>' + editor("update", "Old name"),
            submitted && outcome === "changed-profile" ? otherId : profileId,
          ),
        profile,
        () => {
          submitted = true;
          if (outcome === "click-error") throw new Error("Connection closed");
        },
      );
      await expect(f.actions.update({ name: "New name" })).rejects.toMatchObject({
        code: "unknown",
      });
      expect(f.page.click).toHaveBeenCalledOnce();
      expect(f.mark).toHaveBeenCalledOnce();
    },
  );

  it.each([
    '<p><a href="/terms">Terms of Service</a></p>',
    '<input autocomplete="one-time-code">',
    '<input type="password">',
    '<iframe src="https://example.test/captcha"></iframe>',
  ])("leaves owner-only steps untouched", async (blocker) => {
    const f = setup(() => manager(editor("update", "Old name", blocker)));
    await expect(f.actions.update({ name: "New name" })).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.mark).not.toHaveBeenCalled();
  });

  it("revalidates the exact profile after recording the submission marker", async () => {
    const f = setup(() => manager(editor("update", "Old name")));
    f.mark.mockImplementation(async () => {
      f.window.document.querySelector("main")?.setAttribute("data-profile-id", otherId);
    });
    await expect(f.actions.update({ name: "New name" })).rejects.toMatchObject({ code: "denied" });
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("confirms deletion only for the exact story and verifies the completed list after reopening", async () => {
    const storyId = "story-12345";
    const listing = (content: string) =>
      '<div data-testid="public-story-list" aria-busy="false" data-complete="true">' +
      content +
      "</div>";
    const row =
      '<div data-public-story-id="' +
      storyId +
      '">' +
      '<button data-testid="delete-public-story" aria-haspopup="dialog">Delete</button></div>';
    let deleted = false;
    const f = setup(
      () => manager(listing(deleted ? "" : row)),
      profile,
      () => {
        if (f.window.document.querySelector("[data-bycoda-snap-story-confirm]")) deleted = true;
        else
          f.window.document
            .querySelector("main")
            ?.insertAdjacentHTML(
              "beforeend",
              '<div role="dialog" data-public-story-id="' +
                storyId +
                '">' +
                '<button data-testid="confirm-delete-public-story">Delete</button></div>',
            );
      },
    );
    await expect(f.actions.deleteStory("another-story")).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(f.page.click).not.toHaveBeenCalled();
    await expect(f.actions.deleteStory(storyId)).resolves.toEqual({ storyId, deleted: true });
    expect(f.page.click).toHaveBeenCalledTimes(2);
    expect(f.mark).toHaveBeenCalledOnce();
  });

  it("validates explicit fields and HTTPS URLs before opening the browser", () => {
    expect(parseSnapchatProfilePatch({ bio: "", website: "https://example.test" })).toEqual({
      bio: "",
      website: "https://example.test/",
    });
    expect(() => parseSnapchatProfilePatch({ password: "secret" })).toThrow();
    expect(() =>
      parseSnapchatProfilePatch({ website: "https://user:pass@example.test" }),
    ).toThrow();
  });

  it("keeps an uncertain mutation fenced across browser manager restarts", async () => {
    const subject = { ...profile, id: randomUUID() };
    const f = setup(
      () => manager(editor("update", "Old name")),
      subject,
      () => {
        throw new Error("Connection closed after dispatch");
      },
    );
    const launch = vi.fn(async () => ({
      page: f.page,
      closed: Promise.resolve(),
      close: async () => {},
    }));
    const settings = new Map<string, string>();
    const service = {
      accountForBrowserManagement: async () => subject,
      setting: async (key: string) => settings.get(key),
      setSetting: async (key: string, value: string) => {
        settings.set(key, value);
      },
      store: {
        environmentId: subject.executorId,
        transaction: async (task: () => Promise<void>) => task(),
      },
    } as unknown as SocialService;
    const principal: SocialPrincipal = { kind: "owner", actorId: "owner", provider: "owner" };
    const directory = join(tmpdir(), "bycoda-snapchat-profile-" + randomUUID());
    const run = () =>
      new XBrowserSessions(directory, launch).snapchatProfileAction(
        service,
        principal,
        subject.id,
        "update",
        { patch: { name: "New name" }, confirm: "UPDATE_SNAPCHAT_PROFILE" },
      );
    await expect(run()).rejects.toMatchObject({ code: "unknown" });
    await expect(run()).rejects.toMatchObject({ code: "unknown" });
    expect(f.page.click).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledOnce();
  });
});
