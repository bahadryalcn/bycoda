import { Window } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserPage } from "./social-browser";
import {
  LinkedInProfileActions,
  parseLinkedInProfilePatch,
} from "./social-browser-linkedin-profile";

const oldLogo = "https://media.licdn.com/dms/image/v2/old/company-logo_100_100/bycoda_logo";
const newLogo = "https://media.licdn.com/dms/image/v2/new/company-logo_100_100/bycoda_logo";
const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});
function fixture(
  options: { persist?: boolean; logo?: string; ack?: boolean; redirect?: string } = {},
) {
  const window = new Window({ url: "https://www.linkedin.com/" });
  windows.push(window);
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  let stored = { name: "Bycoda", bio: "Old tagline", logo: oldLogo };
  const render = () => {
    window.document.body.innerHTML = `<input id="organization-name-field"><textarea id="organization-tagline-field"></textarea><input id="organization-public-url-field" value="bycoda"><div class="org-logo-input__container"><img><input id="organization-logo-field" type="file"></div>`;
    window.document.querySelector<HTMLInputElement>("#organization-name-field")!.value =
      stored.name;
    window.document.querySelector<HTMLTextAreaElement>("#organization-tagline-field")!.value =
      stored.bio;
    window.document.querySelector("img")!.setAttribute("src", stored.logo);
  };
  const enable = () => {
    if (!window.document.querySelector("button"))
      window.document.body.insertAdjacentHTML(
        "beforeend",
        '<button id="org-page-edit-modal-banner__save-button">Save</button>',
      );
    window.document.querySelector<HTMLButtonElement>("button")!.disabled = false;
  };
  const page = {
    goto: vi.fn(async (url: string) => {
      window.location.href = options.redirect ?? url;
      render();
    }),
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    fill: vi.fn(async (selector: string, value: string) => {
      window.document.querySelector<HTMLInputElement>(selector)!.value = value;
      enable();
    }),
    setFiles: vi.fn(async () => {
      window.document
        .querySelector("img")!
        .setAttribute("src", "blob:https://www.linkedin.com/preview");
      enable();
    }),
    click: vi.fn(async () => {
      if (options.persist !== false)
        stored = {
          name: window.document.querySelector<HTMLInputElement>("#organization-name-field")!.value,
          bio: window.document.querySelector<HTMLTextAreaElement>("#organization-tagline-field")!
            .value,
          logo: options.logo ?? newLogo,
        };
      window.document.querySelector<HTMLButtonElement>("button")!.disabled = true;
      if (options.ack !== false)
        window.document.body.insertAdjacentHTML("beforeend", "<p>Değişiklikler kaydedildi.</p>");
    }),
  } as unknown as BrowserPage;
  const authorize = vi.fn(async () => undefined);
  const until = async <T>(expression: string) => page.evaluate<T>(expression);
  return {
    window,
    page,
    authorize,
    actions: new LinkedInProfileActions(page, "web:linkedin:company:145372363", authorize, until),
  };
}
it("only accepts observed Page fields and bounded owner image IDs", () => {
  expect(
    parseLinkedInProfilePatch({
      name: "Bycoda",
      bio: "",
      avatarUploadId: "11111111-1111-1111-1111-111111111111",
    }),
  ).toMatchObject({ bio: "" });
  for (const patch of [
    { name: "" },
    { name: "x".repeat(101) },
    { bio: "x".repeat(121) },
    { bannerUploadId: "11111111-1111-1111-1111-111111111111" },
    { website: "https://example.com" },
    { username: "other" },
    { password: "secret" },
    { avatarUploadId: "C:/private.png" },
    {},
  ])
    expect(() => parseLinkedInProfilePatch(patch)).toThrow();
});
it("requires a numeric canonical browser organization identity", () => {
  const s = fixture();
  for (const id of [
    "145372363",
    "web:linkedin:in:owner",
    "web:linkedin:company:bycoda",
    "web:linkedin:company:0",
    "web:linkedin:company:145372363/other",
  ])
    expect(
      () => new LinkedInProfileActions(s.page, id, s.authorize, async () => undefined),
    ).toThrow();
});
it("reads only the exact organization editor and persisted logo", async () => {
  const s = fixture();
  expect(await s.actions.read()).toEqual({
    name: "Bycoda",
    bio: "Old tagline",
    location: "",
    website: "",
    avatarUrl: oldLogo,
  });
  expect(s.page.goto).toHaveBeenCalledWith(
    "https://www.linkedin.com/company/145372363/admin/edit/?editPageActiveTab=info",
  );
  expect(s.window.document.querySelector("button")).toBeNull();
});
it("uploads to the observed logo input and verifies text and a new persisted company image after navigation", async () => {
  const s = fixture();
  expect(
    await s.actions.update(
      {
        name: "Bycoda New",
        bio: "Open source",
        avatarUploadId: "11111111-1111-1111-1111-111111111111",
      },
      { avatar: "C:/staged/avatar.png" },
    ),
  ).toMatchObject({ name: "Bycoda New", bio: "Open source", avatarUrl: newLogo });
  expect(s.page.setFiles).toHaveBeenCalledWith("#organization-logo-field", [
    "C:/staged/avatar.png",
  ]);
  expect(s.page.click).toHaveBeenCalledExactlyOnceWith("#org-page-edit-modal-banner__save-button");
  expect(s.page.goto).toHaveBeenCalledTimes(2);
  expect(
    s.window.document.querySelector<HTMLInputElement>("#organization-public-url-field")!.value,
  ).toBe("bycoda");
});
it.each([
  "https://www.linkedin.com/company/99/admin/edit/",
  "https://www.linkedin.com/login",
  "https://example.com/company/145372363/admin/edit/",
])("does not mutate a redirected editor: %s", async (redirect) => {
  const s = fixture({ redirect });
  await expect(s.actions.update({ bio: "New" }, {})).rejects.toMatchObject({ code: "unsupported" });
  expect(s.page.fill).not.toHaveBeenCalled();
  expect(s.page.click).not.toHaveBeenCalled();
});
it("reauthorizes immediately before Save and never clicks after authorization is revoked", async () => {
  const s = fixture();
  s.authorize.mockImplementation(async () => {
    if (s.window.document.querySelector<HTMLTextAreaElement>("textarea")?.value === "New")
      throw new Error("Revoked");
  });
  await expect(s.actions.update({ bio: "New" }, {})).rejects.toThrow("Revoked");
  expect(s.page.click).not.toHaveBeenCalled();
});
it.each([
  oldLogo,
  `${oldLogo}?signature=changed`,
  "blob:https://www.linkedin.com/new",
  "https://evil.example/company-logo_100_100/new",
  "https://media.licdn.com/dms/image/v2/new/profile-displayphoto_100_100/new",
])("holds unproved persisted logo outcomes: %s", async (logo) => {
  const s = fixture({ logo });
  await expect(
    s.actions.update(
      { avatarUploadId: "11111111-1111-1111-1111-111111111111" },
      { avatar: "C:/staged/avatar.png" },
    ),
  ).rejects.toMatchObject({ code: "unknown" });
  expect(s.page.click).toHaveBeenCalledTimes(1);
});
it("does not report optimistic text or a missing acknowledgement as saved", async () => {
  for (const options of [{ persist: false }, { ack: false }]) {
    const s = fixture(options);
    await expect(s.actions.update({ bio: "New" }, {})).rejects.toMatchObject({ code: "unknown" });
    expect(s.page.click).toHaveBeenCalledTimes(1);
  }
});
it("rejects banner files and unbound avatar files before navigation", async () => {
  const s = fixture();
  await expect(s.actions.update({ bio: "New" }, { banner: "C:/cover.png" })).rejects.toMatchObject({
    code: "rejected",
  });
  await expect(s.actions.update({ bio: "New" }, { avatar: "C:/avatar.png" })).rejects.toMatchObject(
    { code: "rejected" },
  );
  expect(s.page.goto).not.toHaveBeenCalled();
});
