import { expect, it, vi } from "vitest";
import { XProfileActions, parseXProfilePatch } from "./social-browser-profile";
import type { BrowserPage } from "./social-browser";
import { Window } from "happy-dom";
import { SocialPlatformError } from "../src/integrations/social/adapter";

function fixture(persist = true) {
  let stored = { name: "bycoda", bio: "Old bio", location: "", website: "" };
  let editor = { ...stored };
  const page = {
    goto: vi.fn(async () => {
      editor = { ...stored };
    }),
    evaluate: vi.fn(async (expression: string) =>
      expression.includes("const read = name") ? { ...editor } : true,
    ),
    fill: vi.fn(async (selector: string, value: string) => {
      const field = Object.entries({
        name: "displayName",
        bio: "description",
        location: "location",
        website: "url",
      }).find(([, name]) => selector.includes(`"${name}"`))![0];
      (editor as Record<string, string>)[field] = value;
    }),
    click: vi.fn(async () => {
      if (persist) stored = { ...editor };
    }),
    setFiles: vi.fn(),
  } as unknown as BrowserPage;
  const verify = vi.fn(async () => undefined);
  const until = vi.fn(async <T>(expression: string) => page.evaluate<T>(expression));
  return { page, verify, until, actions: new XProfileActions(page, verify, until) };
}
it("accepts only public profile fields, bounded images and HTTPS websites", () => {
  expect(parseXProfilePatch({ bio: "", location: "", website: "" })).toEqual({
    bio: "",
    location: "",
    website: "",
  });
  for (const patch of [
    { password: "synthetic" },
    { name: "" },
    { bio: "a".repeat(161) },
    { website: "http://example.com" },
    { website: "https://user:synthetic@example.com" },
    { avatarUploadId: "C:/private.png" },
    { constructor: "unexpected" },
  ])
    expect(() => parseXProfilePatch(patch)).toThrow();
});
it("updates fields and verifies persistence by reopening instead of trusting optimistic values", async () => {
  const s = fixture();
  const saved = await s.actions.update({ bio: "New bio", website: "https://example.com" }, {});
  expect(saved).toMatchObject({ bio: "New bio", website: "https://example.com" });
  expect(s.page.goto).toHaveBeenCalledTimes(2);
  expect(s.page.click).toHaveBeenCalledWith('[data-testid="Profile_Save_Button"]');
  expect(s.verify).toHaveBeenCalledTimes(6);
  const lost = fixture(false);
  await expect(lost.actions.update({ bio: "Not persisted" }, {})).rejects.toMatchObject({
    code: "unknown",
  });
});
it("does not click Save after the current account identity changes", async () => {
  const s = fixture();
  s.verify
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Identity changed"));
  await expect(s.actions.update({ bio: "New" }, {})).rejects.toThrow("Identity changed");
  expect(s.page.click).not.toHaveBeenCalled();
});
it("follows only the resolved numeric target, is idempotent, and requires visible acknowledgement", async () => {
  const s = fixture();
  s.until
    .mockResolvedValueOnce({ id: "123", following: false } as never)
    .mockResolvedValueOnce(true as never);
  expect(await s.actions.follow("github")).toMatchObject({ platformId: "123", changed: true });
  expect(s.page.click).toHaveBeenCalledWith('[data-testid="123-follow"]');
  s.until.mockResolvedValueOnce({ id: "123", following: true } as never);
  expect(await s.actions.follow("github")).toMatchObject({ changed: false });
  expect(s.page.click).toHaveBeenCalledTimes(1);
  s.until
    .mockResolvedValueOnce({ id: "123", following: false } as never)
    .mockResolvedValueOnce(undefined);
  await expect(s.actions.follow("github")).rejects.toMatchObject({ code: "unknown" });
  await expect(s.actions.follow("github?other=1")).rejects.toThrow("username");
});

/** Rendered synthetic DOM, not evidence of the current external X website. */
function imageFixture(options: { turkish?: boolean; persist?: boolean; duplicate?: boolean } = {}) {
  const window = new Window({ url: "https://x.com/home" });
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  let actor = "bycoda";
  let stored = { avatar: "old-avatar", banner: "old-banner" };
  let pending = { ...stored };
  let editing: "avatar" | "banner" | undefined;
  const order: string[] = [];
  const identity = () => '<a data-testid="AppTabBar_Profile_Link" href="/bycoda">Profile</a>';
  const imageUrl = (kind: "avatar" | "banner", value: string) =>
    `https://pbs.twimg.com/profile_${kind === "avatar" ? "images" : "banners"}/${value}.png`;
  const render = (url: string) => {
    window.location.href = url;
    if (url.endsWith("/settings/profile")) {
      pending = { ...stored };
      const slot = (kind: "avatar" | "banner") =>
        `<div><button aria-label="${options.turkish ? (kind === "avatar" ? "Profil fotoğrafı ekle" : "Başlık fotoğrafı ekle") : `Add ${kind} photo`}">Upload</button><input type="file" data-testid="fileInput" data-slot="${kind}"></div>`;
      window.document.body.innerHTML = `${identity()}<input name="displayName" value="Bycoda"><textarea name="description">Bio</textarea><input name="location" value=""><input name="url" value="">${slot("banner")}${slot("avatar")}${options.duplicate ? slot("avatar") : ""}<button data-testid="Profile_Save_Button">Save</button>`;
    } else {
      window.document.body.innerHTML = `${identity()}<div data-testid="UserName">Bycoda</div><a href="/bycoda/photo"><img src="${imageUrl("avatar", stored.avatar)}"></a><a href="/bycoda/header_photo"><img src="${imageUrl("banner", stored.banner)}"></a>`;
    }
  };
  render("https://x.com/home");
  const page = {
    goto: vi.fn(async (url: string) => {
      order.push(`goto:${url}`);
      render(url);
    }),
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => window.eval(expression)),
    fill: vi.fn(),
    setFiles: vi.fn(async (selector: string, paths: string[]) => {
      const input = window.document.querySelector(selector);
      if (!input) throw new Error("Missing upload slot");
      editing = input.getAttribute("data-slot") as "avatar" | "banner";
      order.push(`upload:${editing}:${paths[0]}`);
      window.document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog"><button>${options.turkish ? "Uygula" : "Apply"}</button></div>`,
      );
    }),
    click: vi.fn(async (selector: string) => {
      const button = window.document.querySelector(selector);
      if (!button) throw new Error("Missing action");
      if (button.hasAttribute("data-bycoda-profile-apply")) {
        order.push(`crop:${editing}`);
        pending[editing!] = `new-${editing}`;
        editing = undefined;
        button.closest('[role="dialog"]')!.remove();
      } else if (button.getAttribute("data-testid") === "Profile_Save_Button") {
        order.push("save");
        if (options.persist !== false) stored = { ...pending };
        render("https://x.com/home");
      }
    }),
  } as unknown as BrowserPage;
  const verify = vi.fn(async () => {
    if (actor !== "bycoda") throw new SocialPlatformError("denied");
  });
  const until = async <T>(expression: string) => (await page.evaluate<T>(expression)) || undefined;
  return {
    window,
    page,
    order,
    verify,
    imageUrl,
    switchActor: () => {
      actor = "other";
    },
    actions: new XProfileActions(page, verify, until),
  };
}

it.each([false, true])(
  "uploads distinct banner/avatar slots, applies crops, saves and reads persisted images (Turkish=%s)",
  async (turkish) => {
    const s = imageFixture({ turkish });
    const result = await s.actions.update(
      {},
      { avatar: "C:/owner/avatar.png", banner: "C:/owner/banner.png" },
    );
    expect(s.order.filter((entry) => !entry.startsWith("goto:"))).toEqual([
      "upload:banner:C:/owner/banner.png",
      "crop:banner",
      "upload:avatar:C:/owner/avatar.png",
      "crop:avatar",
      "save",
    ]);
    expect(result).toMatchObject({
      avatarUrl: s.imageUrl("avatar", "new-avatar"),
      bannerUrl: s.imageUrl("banner", "new-banner"),
    });
    expect(s.page.goto).toHaveBeenLastCalledWith("https://x.com/settings/profile");
  },
);

it("does not mistake an unchanged persisted image URL for a successful update", async () => {
  const s = imageFixture({ persist: false });
  await expect(s.actions.update({}, { avatar: "C:/owner/avatar.png" })).rejects.toMatchObject({
    code: "unknown",
  });
  expect(s.order.filter((entry) => entry === "save")).toHaveLength(1);
});

it("rejects ambiguous image slots before uploading or saving", async () => {
  const s = imageFixture({ duplicate: true });
  await expect(s.actions.update({}, { avatar: "C:/owner/avatar.png" })).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(s.page.setFiles).not.toHaveBeenCalled();
  expect(s.page.click).not.toHaveBeenCalled();
});

it("denies an actor switch after upload before crop or Save", async () => {
  const s = imageFixture();
  const upload = vi.mocked(s.page.setFiles).getMockImplementation()!;
  vi.mocked(s.page.setFiles).mockImplementationOnce(async (...args) => {
    await upload(...args);
    s.switchActor();
  });
  await expect(s.actions.update({}, { avatar: "C:/owner/avatar.png" })).rejects.toMatchObject({
    code: "denied",
  });
  expect(s.page.click).not.toHaveBeenCalled();
});
