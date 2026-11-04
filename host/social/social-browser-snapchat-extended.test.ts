import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import {
  readSnapchatPublicProfileIdentity,
  selectSnapchatPublishDestination,
  snapchatPostingAcknowledgement,
  verifySnapchatPublishDestination,
} from "./social-browser-snapchat-extended";

const profileId = "52c732d6-7b5a-4110-96d2-2cc456356c23";
const otherId = "99c732d6-7b5a-4110-96d2-2cc456356c23";
const prefix = "web:snapchat:public_profile:";
const name = "Bycoda Official";

/** Source-derived snapPosterForm/SDS structure, not live website acceptance. */
function fixture(
  options: { duplicateName?: boolean; selected?: string[]; pickerOpen?: boolean } = {},
) {
  const window = new Window({ url: "https://profile.snapchat.com/snap-posting-web" });
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  const selected = options.selected ?? [name];
  const chips = () =>
    selected
      .map(
        (value) =>
          `<span class="sds-dropdown-input-selection-item"><span class="sds-dropdown-input-selection-item-content">${value}</span></span>`,
      )
      .join("");
  const pickerMenu = () =>
    `<div id="picker-menu"><input data-testid="profile-selection-dropdown-input"><div data-testid="profile-selection-dropdown-option-${profileId}">${name}</div><div data-testid="profile-selection-dropdown-option-${otherId}">${options.duplicateName ? name : "Other Profile"}</div></div>`;
  const target = (id: string, checked: boolean) =>
    `<section><div><label><input id="${id}" type="checkbox" ${checked ? "checked" : ""}>${id}</label></div><div><div class="sds-dropdown-input-multiple"><div class="sds-dropdown-input-selector">${chips()}</div></div>${id === "publicStory" ? '<div class="sds-dropdown-input"><span class="sds-dropdown-input-selection-item">24 hours</span></div>' : ""}</div></section>`;
  window.document.body.innerHTML = `<div data-testid="profile-selection-dropdown"><button aria-expanded="${!!options.pickerOpen}">${name}</button>${options.pickerOpen ? pickerMenu() : ""}</div><form><div data-testid="app.profileManager.snapPoster.uploadCard"><input type="file"></div>${target("spotlight", true)}${target("publicStory", false)}${target("publicProfile", true)}<button data-testid="app.profileMgr.snapPoster.postSnap">Post</button></form>`;
  const clicks: string[] = [];
  const page: BrowserPage = {
    goto: vi.fn(),
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    click: vi.fn(async (selector: string) => {
      const element = window.document.querySelector(selector)!;
      if (!element) throw new Error("Missing control");
      clicks.push(selector);
      if (element.matches('[data-bycoda-snap-profile-picker="true"]')) {
        const expanded = element.getAttribute("aria-expanded") === "true";
        element.setAttribute("aria-expanded", String(!expanded));
        if (expanded) window.document.getElementById("picker-menu")?.remove();
        else element.parentElement!.insertAdjacentHTML("beforeend", pickerMenu());
      } else if (element.matches('input[type="checkbox"]')) {
        (element as unknown as HTMLInputElement).checked = !(element as unknown as HTMLInputElement)
          .checked;
      } else if (element.matches('[data-bycoda-snap-destination-profiles="true"]')) {
        const menu = window.document.getElementById("destination-menu");
        if (menu) menu.remove();
        else
          element.insertAdjacentHTML(
            "afterend",
            `<div id="destination-menu"><div class="sds-dropdown-input-item-option"><span class="sds-dropdown-input-item-option-content">${name}</span></div></div>`,
          );
      } else if (element.matches('[data-bycoda-snap-profile-option="true"]')) {
        const select = window.document.querySelector(
          '[data-bycoda-snap-destination-profiles="true"]',
        )!;
        select.innerHTML = `<span class="sds-dropdown-input-selection-item"><span class="sds-dropdown-input-selection-item-content">${name}</span></span>`;
      }
    }),
    insertText: vi.fn(),
    fill: vi.fn(),
    setFiles: vi.fn(),
    cookies: vi.fn(async () => {
      throw new Error("Credentials are not identity evidence");
    }),
    watchResponse: vi.fn(),
  };
  const ctx: BrowserRecipeContext = {
    page,
    account: {
      id: "account",
      platform: "snapchat",
      platformId: prefix + profileId,
      accountType: "public_profile",
      name: "An arbitrary owner label",
    } as BrowserRecipeContext["account"],
    now: () => 1000,
    files: [],
    waitFor: async <T>(expression: string) => page.evaluate<T>(expression),
    verifyIdentity: vi.fn(async () => {}),
    markSubmitted: vi.fn(),
  };
  return { window, page, ctx, clicks };
}

describe("Snapchat Public Profile picker identity", () => {
  it("maps the platform's selected display name to one stable UUID and restores the picker", async () => {
    const f = fixture();
    await expect(readSnapchatPublicProfileIdentity(f.page)).resolves.toEqual({
      platformId: prefix + profileId,
      name,
      accountType: "public_profile",
    });
    expect(f.window.document.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
    expect(f.page.cookies).not.toHaveBeenCalled();
  });
  it("preserves an already-open owner picker", async () => {
    const f = fixture({ pickerOpen: true });
    expect(await readSnapchatPublicProfileIdentity(f.page)).toBeTruthy();
    expect(f.clicks).toEqual([]);
    expect(f.window.document.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  });
  it("rejects duplicate platform names instead of picking the first available profile", async () => {
    const f = fixture({ duplicateName: true });
    await expect(readSnapchatPublicProfileIdentity(f.page)).resolves.toBeUndefined();
    expect(f.window.document.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  });
  it("rejects another origin or an unauthenticated page without uploader controls", async () => {
    const f = fixture();
    f.window.location.href = "https://example.com/snap-posting-web";
    await expect(readSnapchatPublicProfileIdentity(f.page)).resolves.toBeUndefined();
    f.window.location.href = "https://profile.snapchat.com/snap-posting-web";
    f.window.document.querySelector('input[type="file"]')!.remove();
    await expect(readSnapchatPublicProfileIdentity(f.page)).resolves.toBeUndefined();
    expect(f.clicks).toEqual([]);
  });
});

describe("reviewed Snapchat publishing destination", () => {
  it.each(["story", "spotlight"] as const)(
    "selects only %s and clears the automatic Saved Story side effect",
    async (target) => {
      const f = fixture();
      const selection = await selectSnapchatPublishDestination(f.ctx, target);
      expect(selection).toEqual({ target, profileId, name });
      for (const id of ["spotlight", "publicStory", "publicProfile"])
        expect((f.window.document.getElementById(id) as unknown as HTMLInputElement).checked).toBe(
          id === (target === "story" ? "publicStory" : "spotlight"),
        );
      expect(f.ctx.verifyIdentity).toHaveBeenCalled();
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
      expect(f.clicks.some((item) => item.includes("postSnap"))).toBe(false);
    },
  );
  it("selects a unique exact platform profile when no profile is currently selected", async () => {
    const f = fixture({ selected: [] });
    await expect(selectSnapchatPublishDestination(f.ctx, "story")).resolves.toEqual({
      target: "story",
      profileId,
      name,
    });
    expect(f.window.document.getElementById("destination-menu")).toBeNull();
  });
  it.each([["Other Profile"], [name, "Other Profile"]])(
    "rejects a mismatched or multi-profile selection: %j",
    async (...selected) => {
      const f = fixture({ selected: selected.flat() });
      await expect(selectSnapchatPublishDestination(f.ctx, "story")).rejects.toThrow("changed");
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    },
  );
  it("rejects changed identity before altering destination controls", async () => {
    const f = fixture();
    f.ctx.account.platformId = prefix + otherId;
    await expect(selectSnapchatPublishDestination(f.ctx, "story")).rejects.toThrow("changed");
    expect(f.clicks.every((item) => item.includes("profile-picker"))).toBe(true);
  });
  it("rechecks the selected destination and profile immediately before submission", async () => {
    const f = fixture();
    const selection = await selectSnapchatPublishDestination(f.ctx, "story");
    (f.window.document.getElementById("publicProfile") as unknown as HTMLInputElement).checked =
      true;
    await expect(verifySnapchatPublishDestination(f.ctx, selection)).rejects.toThrow("changed");
    (f.window.document.getElementById("publicProfile") as unknown as HTMLInputElement).checked =
      false;
    f.window.document
      .querySelector("#publicStory")!
      .closest("section")!
      .querySelector(".sds-dropdown-input-selection-item-content")!.textContent = "Other Profile";
    await expect(verifySnapchatPublishDestination(f.ctx, selection)).rejects.toThrow("changed");
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
  });
  it("does not apply a legacy username identity to a UUID-selected profile", async () => {
    const f = fixture();
    f.ctx.account.platformId = prefix + "bycoda";
    await expect(selectSnapchatPublishDestination(f.ctx, "story")).rejects.toThrow("changed");
    expect(f.clicks).toEqual([]);
  });
  it.each(["2 days", "3 days", "7 days", ""])(
    "rejects unreviewed or missing Public Story duration: %s",
    async (duration) => {
      const f = fixture();
      const item = f.window.document
        .querySelector("#publicStory")!
        .closest("section")!
        .querySelector(".sds-dropdown-input > .sds-dropdown-input-selection-item")!;
      item.textContent = duration;
      await expect(selectSnapchatPublishDestination(f.ctx, "story")).rejects.toThrow("changed");
      expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    },
  );
});

describe("Snapchat posting acknowledgement", () => {
  it("keeps the actual EmptyResponse acceptance distinct from a durable posted Snap ID", () => {
    expect(
      snapchatPostingAcknowledgement(
        JSON.stringify({
          data: { postProfileMedia: { __typename: "EmptyResponse", _empty: true } },
        }),
      ),
    ).toBe("acceptedWithoutId");
  });
  it("rejects partial/error-bearing output and never invents a message ID", () => {
    expect(
      snapchatPostingAcknowledgement(
        JSON.stringify({
          errors: [{}],
          data: { postProfileMedia: { __typename: "EmptyResponse" } },
        }),
      ),
    ).toBe("rejected");
    expect(
      snapchatPostingAcknowledgement(
        JSON.stringify({
          data: {
            postProfileMedia: {
              __typename: "FailedPostProfileMediaOutput",
              publicStoryMetadata: [{ profileId, mediaId: "media" }],
            },
          },
        }),
      ),
    ).toBe("rejected");
    expect(snapchatPostingAcknowledgement('{"data":{"unrelated":{}}}')).toBeUndefined();
    expect(snapchatPostingAcknowledgement("Success! Your Snap is now live!")).toBeUndefined();
  });
});
