import { Window, type HTMLElement, type HTMLInputElement } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserPage } from "./social-browser";
import {
  FacebookProfileActions,
  parseFacebookProfilePatch,
} from "./social-browser-facebook-profile";

const actor = "61595536696896";
const oldLogo = "https://scontent.example.fbcdn.net/v/t39.30808-1/111_222_333_n.jpg?token=old";
const newLogo = "https://scontent.example.fbcdn.net/v/t39.30808-1/444_555_666_n.jpg?token=new";
const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function fixture(
  options: {
    english?: boolean;
    persist?: boolean;
    logo?: string;
    stayOpen?: boolean;
    preview?: string;
    multiple?: boolean;
    staleLogoReads?: number;
  } = {},
) {
  const window = new Window({ url: "https://www.facebook.com/" });
  windows.push(window);
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  let stored = oldLogo;
  let staleLogoReads = options.staleLogoReads ?? 0;
  const labels = options.english
    ? { avatar: "Profile picture actions", dialog: "Select profile picture", save: "Save" }
    : { avatar: "Profil resmi işlemleri", dialog: "Profil resmi seç", save: "Kaydet" };
  const render = () => {
    window.document.body.innerHTML = `<div role="button" aria-label="${labels.avatar}"><svg><image></image></svg></div>`;
    window.document
      .querySelector("image")!
      .setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", stored);
    window.document.querySelector('[role="button"]')!.addEventListener("click", () => {
      window.document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="menu"><div role="menuitem">${labels.dialog}</div><a role="menuitem">View picture</a></div>`,
      );
      window.document.querySelector('[role="menuitem"]')!.addEventListener("click", () => {
        window.document.querySelector('[role="menu"]')!.remove();
        window.document.body.insertAdjacentHTML(
          "beforeend",
          `<div role="dialog" aria-label="${labels.dialog}"><input type="file" accept="image/*,image/heif,image/heic" ${options.multiple ? "multiple" : ""}></div>`,
        );
      });
    });
  };
  const page = {
    goto: vi.fn(async (url: string) => {
      window.location.href = url;
      render();
    }),
    evaluate: vi.fn(async <T>(expression: string) => {
      const stale =
        stored === newLogo && staleLogoReads > 0 && expression.includes("const raw=images[0]");
      const image = window.document.querySelector("image");
      if (stale) {
        staleLogoReads--;
        image?.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", oldLogo);
      }
      try {
        return window.eval(expression) as T;
      } finally {
        if (stale) image?.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", stored);
      }
    }),
    click: vi.fn(async (selector: string) =>
      window.document.querySelector<HTMLElement>(selector)!.click(),
    ),
    setFiles: vi.fn(async () => {
      const dialog = window.document.querySelector('[role="dialog"]')!;
      const preview =
        options.preview ??
        "https://scontent.example.fbcdn.net/v/t39.30808-6/444_555_666_n.jpg?preview=1";
      dialog.insertAdjacentHTML(
        "beforeend",
        `<img src="${preview}"><img src="${preview}"><div role="button" aria-label="${labels.save}">${labels.save}</div>`,
      );
      dialog.querySelector('[role="button"]')!.addEventListener("click", () => {
        if (options.persist !== false) stored = options.logo ?? newLogo;
        if (!options.stayOpen) dialog.remove();
      });
    }),
  } as unknown as BrowserPage;
  const authorize = vi.fn(async () => undefined),
    identity = vi.fn(async () => undefined);
  const actions = new FacebookProfileActions(
    page,
    actor,
    authorize,
    identity,
    async <T>(expression: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const value = await page.evaluate<T>(expression);
        if (value) return value;
      }
      return undefined;
    },
  );
  return { window, page, authorize, identity, actions };
}
const patch = { avatarUploadId: "11111111-1111-4111-8111-111111111111" };

it("accepts one valid Page name, username or uploaded logo", () => {
  expect(parseFacebookProfilePatch(patch)).toEqual(patch);
  expect(parseFacebookProfilePatch({ name: "  Bycoda Page  " })).toEqual({ name: "Bycoda Page" });
  expect(parseFacebookProfilePatch({ username: "bycoda.page" })).toEqual({
    username: "bycoda.page",
  });
  for (const value of [
    {},
    { name: "Bycoda\nPage" },
    { username: "@bycoda" },
    { bio: "test" },
    { bannerUploadId: patch.avatarUploadId },
    { ...patch, name: "Bycoda" },
    { avatarUploadId: "C:/secret.png" },
    null,
  ])
    expect(() => parseFacebookProfilePatch(value)).toThrow();
});

function settingsFixture(field: "name" | "username", passwordRequired = false, persist = true) {
  const f = fixture();
  let saved = field === "name" ? "Old Name" : "old.username";
  const label = field === "name" ? "Page name" : "Username";
  const action = field === "name" ? "Review Change" : "Save Changes";
  const route = `https://www.facebook.com/settings/?tab=profile&section=${field}&view`;
  vi.mocked(f.page.goto).mockImplementation(async (url) => {
    f.window.location.href = url;
    f.window.document.body.innerHTML = `<main><input type="text" aria-label="${label}"><button>${action}</button></main>`;
    const input = f.window.document.querySelector("input")!;
    input.value = saved;
    f.window.document.querySelector("button")!.addEventListener("click", () => {
      if (field === "username") {
        if (persist) saved = input.value;
        return;
      }
      f.window.document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog">
        <p></p>${passwordRequired ? '<input type="password" aria-label="Password">' : ""}
        <button>Request Change</button></div>`,
      );
      const dialog = f.window.document.querySelector('[role="dialog"]')!;
      dialog.querySelector("p")!.textContent = input.value;
      dialog.querySelector("button")!.addEventListener("click", () => {
        if (persist) saved = input.value;
        dialog.remove();
      });
    });
  });
  f.page.fill = vi.fn(async (selector, value) => {
    f.window.document.querySelector<HTMLInputElement>(selector)!.value = value;
  });
  return { ...f, route };
}

it.each(["name", "username"] as const)(
  "updates the exact Page %s and verifies it on reload",
  async (field) => {
    const f = settingsFixture(field);
    const value = field === "name" ? "New Name" : "new.username";
    await expect(f.actions.update({ [field]: value }, {})).resolves.toMatchObject({
      [field]: value,
    });
    expect(f.page.goto).toHaveBeenNthCalledWith(1, f.route);
    expect(f.page.goto).toHaveBeenNthCalledWith(2, f.route);
    expect(f.page.click).toHaveBeenCalledTimes(field === "name" ? 2 : 1);
  },
);

it("pauses at a name-change password prompt before clicking its request button", async () => {
  const f = settingsFixture("name", true);
  await expect(f.actions.update({ name: "New Name" }, {})).rejects.toMatchObject({
    code: "needs_human",
  });
  expect(f.page.fill).toHaveBeenCalledTimes(1);
  expect(f.window.document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(
    "",
  );
  expect(f.page.click).toHaveBeenCalledTimes(1);
});

it("leaves an unverified username write uncertain without another Save", async () => {
  const f = settingsFixture("username", false, false);
  await expect(f.actions.update({ username: "new.username" }, {})).rejects.toMatchObject({
    code: "unknown",
  });
  expect(f.page.click).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "uploads a scoped logo and reads the exact saved asset back, English=%s",
  async (english) => {
    const f = fixture({ english });
    await expect(f.actions.update(patch, { avatar: "/owner/logo.png" })).resolves.toMatchObject({
      avatarUrl: newLogo,
    });
    expect(f.page.setFiles).toHaveBeenCalledExactlyOnceWith(
      '[data-bycoda-fb-profile-file="true"]',
      ["/owner/logo.png"],
    );
    expect(f.page.click).toHaveBeenCalledTimes(3);
    expect(f.page.goto).toHaveBeenCalledTimes(2);
    expect(f.identity.mock.calls.length).toBeGreaterThan(6);
  },
);
it("reads a Page SVG logo without attempting a mutation", async () => {
  const f = fixture();
  await expect(f.actions.read()).resolves.toMatchObject({ avatarUrl: oldLogo });
  expect(f.page.click).not.toHaveBeenCalled();
  expect(f.page.setFiles).not.toHaveBeenCalled();
});
it("polls a stale read until the exact new asset appears without another Save", async () => {
  const f = fixture({ staleLogoReads: 1 });
  await expect(f.actions.update(patch, { avatar: "/owner/logo.png" })).resolves.toMatchObject({
    avatarUrl: newLogo,
  });
  expect(f.page.click).toHaveBeenCalledTimes(3);
  expect(f.page.setFiles).toHaveBeenCalledTimes(1);
  expect(
    vi
      .mocked(f.page.evaluate)
      .mock.calls.filter(([expression]) => expression.includes("const raw=images[0]")).length,
  ).toBe(3);
});
it.each([
  { persist: false },
  { stayOpen: true },
  { logo: oldLogo + "&newSignedToken=2" },
  { logo: "https://scontent.example.fbcdn.net/v/t39.30808-1/different_n.jpg" },
  { logo: "http://scontent.example.fbcdn.net/v/t39.30808-1/444_555_666_n.jpg" },
  { logo: "https://evil.invalid/v/t39.30808-1/444_555_666_n.jpg" },
])("holds uncertain, unchanged or unrelated saved assets: %j", async (options) => {
  const f = fixture(options);
  await expect(f.actions.update(patch, { avatar: "/owner/logo.png" })).rejects.toMatchObject({
    code: "unknown",
  });
  expect(f.page.click).toHaveBeenCalledTimes(3);
});
it("rejects remote/ambiguous preview media before final Save", async () => {
  const f = fixture({ preview: "https://evil.invalid/444_555_666_n.jpg" });
  await expect(f.actions.update(patch, { avatar: "/owner/logo.png" })).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.page.click).toHaveBeenCalledTimes(2);
});
it("rejects a multiple-file input before uploading", async () => {
  const f = fixture({ multiple: true });
  await expect(f.actions.update(patch, { avatar: "/owner/logo.png" })).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.page.setFiles).not.toHaveBeenCalled();
});
it("rechecks actor identity after upload and before final Save", async () => {
  const f = fixture();
  const original = vi.mocked(f.page.setFiles).getMockImplementation()!;
  vi.mocked(f.page.setFiles).mockImplementation(async (...args) => {
    await original(...args);
    f.identity.mockRejectedValue(new Error("Selected actor changed"));
  });
  await expect(f.actions.update(patch, { avatar: "/owner/logo.png" })).rejects.toThrow(
    "Selected actor changed",
  );
  expect(f.page.click).toHaveBeenCalledTimes(2);
});
it("requires exact profile resource and canonical numeric actor", async () => {
  const f = fixture();
  expect(
    () =>
      new FacebookProfileActions(
        f.page,
        "web:facebook:page:1",
        f.authorize,
        f.identity,
        async () => undefined,
      ),
  ).toThrow();
  const original = vi.mocked(f.page.goto).getMockImplementation()!;
  vi.mocked(f.page.goto).mockImplementation(async (url) => {
    await original(url);
    f.window.location.href = "https://www.facebook.com/profile.php?id=99";
  });
  await expect(f.actions.read()).rejects.toMatchObject({ code: "unsupported" });
});
