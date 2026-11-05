import { Window } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserPage } from "./social-browser";
import {
  InstagramProfileActions,
  parseInstagramProfilePatch,
} from "./social-browser-instagram-profile";

const oldPhoto = "https://instagram.example.fbcdn.net/v/t51.2885-19/111_n.jpg?token=old";
const newPhoto = "https://instagram.example.fbcdn.net/v/t51.2885-19/222_n.jpg?token=new";
const imagePatch = { avatarUploadId: "11111111-1111-4111-8111-111111111111" };
const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((w) => w.happyDOM.close()));
});

function fixture(
  options: {
    synced?: boolean;
    persistBio?: boolean;
    persistAvatar?: boolean;
    photo?: string;
    stayOpen?: boolean;
    keepSubmitEnabled?: boolean;
    multiple?: boolean;
    duplicateInput?: boolean;
    redirect?: string;
    english?: boolean;
  } = {},
) {
  const window = new Window({ url: "https://www.instagram.com/" });
  windows.push(window);
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  let stored = { bio: "Old bio", photo: oldPhoto };
  const labels =
    options.english === false
      ? {
          title: "Profil fotoğrafını değiştir",
          submit: "Gönder",
          upload: "Fotoğraf Yükle",
          cancel: "İptal",
        }
      : {
          title: "Change profile photo",
          submit: "Submit",
          upload: "Upload Photo",
          cancel: "Cancel",
        };
  const render = () => {
    window.document.body.innerHTML = `<main><button title="${labels.title}"><img></button><textarea id="pepBio" aria-label="Bio"></textarea><input aria-label="Website" disabled value="https://unchanged.example"><button role="switch" aria-checked="true">Show Threads badge</button><div role="button" aria-disabled="true"><span>${labels.submit}</span></div></main>`;
    window.document.querySelector("img")!.setAttribute("src", stored.photo);
    window.document.querySelector<HTMLTextAreaElement>("textarea")!.value = stored.bio;
    window.document.querySelector('[role="button"]')!.addEventListener("click", () => {
      if (options.persistBio !== false)
        stored.bio = window.document.querySelector<HTMLTextAreaElement>("textarea")!.value;
      if (!options.keepSubmitEnabled)
        window.document.querySelector('[role="button"]')!.setAttribute("aria-disabled", "true");
    });
    window.document.querySelector("button[title]")!.addEventListener("click", () => {
      window.document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog"><h3>${options.synced ? "Synced profile photo" : "Change Profile Photo"}</h3>${options.synced ? "<p>Instagram, Facebook</p><button>Manage sync settings</button>" : ""}<button>${labels.upload}</button><button>${labels.cancel}</button><input type="file" accept="image/jpeg,image/png" ${options.multiple ? "multiple" : ""}>${options.duplicateInput ? '<input type="file" accept="image/jpeg,image/png">' : ""}</div>`,
      );
      [...window.document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find((b) => b.textContent === labels.cancel)!
        .addEventListener("click", () =>
          window.document.querySelector('[role="dialog"]')!.remove(),
        );
    });
  };
  const page = {
    goto: vi.fn(async (url: string) => {
      window.location.href = options.redirect ?? url;
      render();
    }),
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    fill: vi.fn(async (selector: string, value: string) => {
      window.document.querySelector<HTMLTextAreaElement>(selector)!.value = value;
      window.document.querySelector('[role="button"]')!.setAttribute("aria-disabled", "false");
    }),
    click: vi.fn(async (selector: string) =>
      window.document.querySelector<HTMLElement>(selector)!.click(),
    ),
    setFiles: vi.fn(async () => {
      const photo = options.photo ?? newPhoto;
      window.document.querySelector("main img")!.setAttribute("src", photo);
      if (options.persistAvatar !== false) stored.photo = photo;
      if (!options.stayOpen) window.document.querySelector('[role="dialog"]')!.remove();
    }),
  } as unknown as BrowserPage;
  const authorize = vi.fn(async () => undefined),
    identity = vi.fn(async () => undefined);
  const actions = new InstagramProfileActions(
    page,
    authorize,
    identity,
    async <T>(expression: string) => {
      for (let i = 0; i < 3; i++) {
        const value = await page.evaluate<T>(expression);
        if (value) return value;
      }
      return undefined;
    },
  );
  return { window, page, authorize, identity, actions };
}

it("bounds desktop bio and owner image IDs without accepting mobile-only fields or secrets", () => {
  expect(parseInstagramProfilePatch({ bio: "", ...imagePatch })).toEqual({
    bio: "",
    ...imagePatch,
  });
  expect(parseInstagramProfilePatch({ bio: "😀".repeat(150) }).bio).toHaveLength(300);
  for (const raw of [
    null,
    [],
    {},
    { bio: "a".repeat(151) },
    { bio: "\0" },
    { name: "Bycoda" },
    { website: "https://example.com" },
    { bannerUploadId: imagePatch.avatarUploadId },
    { password: "secret" },
    { avatarUploadId: "C:/secret.png" },
  ])
    expect(() => parseInstagramProfilePatch(raw)).toThrow();
});
it("reads only observed public fields without changing account preferences", async () => {
  const f = fixture();
  await expect(f.actions.read()).resolves.toMatchObject({
    name: "",
    bio: "Old bio",
    website: "",
    location: "",
    avatarUrl: oldPhoto,
  });
  expect(f.page.click).not.toHaveBeenCalled();
  expect(f.page.fill).not.toHaveBeenCalled();
  expect(f.window.document.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe(
    "true",
  );
});
it.each([true, false])(
  "saves bio using the unique semantic Submit and verifies fresh readback, English=%s",
  async (english) => {
    const f = fixture({ english });
    await expect(f.actions.update({ bio: "Bycoda open source" }, {})).resolves.toMatchObject({
      bio: "Bycoda open source",
    });
    expect(f.page.fill).toHaveBeenCalledExactlyOnceWith("textarea#pepBio", "Bycoda open source");
    expect(f.page.click).toHaveBeenCalledTimes(1);
    expect(f.page.setFiles).not.toHaveBeenCalled();
    expect(f.window.document.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe(
      "true",
    );
  },
);
it("does not submit an unchanged bio", async () => {
  const f = fixture();
  await f.actions.update({ bio: "Old bio" }, {});
  expect(f.page.click).not.toHaveBeenCalled();
  expect(f.page.fill).not.toHaveBeenCalled();
});
it.each([{ persistBio: false }, { keepSubmitEnabled: true }])(
  "holds unverifiable bio after one Submit: %j",
  async (options) => {
    const f = fixture(options);
    await expect(f.actions.update({ bio: "New" }, {})).rejects.toMatchObject({ code: "unknown" });
    expect(f.page.click).toHaveBeenCalledTimes(1);
  },
);
it("rejects synced photo before uploading or changing a combined bio", async () => {
  const f = fixture({ synced: true });
  await expect(
    f.actions.update({ ...imagePatch, bio: "Must not apply" }, { avatar: "/owner/logo.png" }),
  ).rejects.toMatchObject({ code: "unsupported" });
  expect(f.page.fill).not.toHaveBeenCalled();
  expect(f.page.setFiles).not.toHaveBeenCalled();
  expect(f.page.click).toHaveBeenCalledTimes(1);
  expect(f.window.document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Old bio");
});
it("uploads one non-synced photo and verifies the same stable asset after reopening", async () => {
  const f = fixture();
  await expect(f.actions.update(imagePatch, { avatar: "/owner/logo.png" })).resolves.toMatchObject({
    avatarUrl: newPhoto,
  });
  expect(f.page.setFiles).toHaveBeenCalledExactlyOnceWith('[data-bycoda-ig-profile-file="true"]', [
    "/owner/logo.png",
  ]);
  expect(f.page.goto).toHaveBeenCalledTimes(2);
  expect(f.page.click).toHaveBeenCalledTimes(3); // preflight, Cancel, actual chooser
});
it("preflights an independent avatar before applying both supported fields", async () => {
  const f = fixture();
  await expect(
    f.actions.update({ ...imagePatch, bio: "New bio" }, { avatar: "/owner/logo.png" }),
  ).resolves.toMatchObject({ bio: "New bio", avatarUrl: newPhoto });
  expect(f.page.setFiles).toHaveBeenCalledTimes(1);
  expect(f.page.fill).toHaveBeenCalledTimes(1);
  expect(f.page.click).toHaveBeenCalledTimes(4);
});
it("holds a partial bio save when photo sync expands after the first preflight", async () => {
  const options = { synced: false };
  const f = fixture(options);
  const click = vi.mocked(f.page.click).getMockImplementation()!;
  let submits = 0;
  vi.mocked(f.page.click).mockImplementation(async (selector) => {
    const submitting = f.window.document.querySelector(selector)?.textContent?.trim() === "Submit";
    await click(selector);
    if (submitting) {
      submits++;
      options.synced = true;
    }
  });
  await expect(
    f.actions.update({ ...imagePatch, bio: "Already saved" }, { avatar: "/owner/logo.png" }),
  ).rejects.toMatchObject({ code: "unknown" });
  expect(f.window.document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "Already saved",
  );
  expect(submits).toBe(1);
  expect(f.page.fill).toHaveBeenCalledTimes(1);
  expect(f.page.setFiles).not.toHaveBeenCalled();
});
it.each([false, true])(
  "holds upload transport failure after a potentially applied mutation, combined=%s",
  async (combined) => {
    const f = fixture();
    vi.mocked(f.page.setFiles).mockRejectedValue(new Error("Upload connection lost"));
    await expect(
      f.actions.update(
        { ...imagePatch, ...(combined ? { bio: "Already saved" } : {}) },
        { avatar: "/owner/logo.png" },
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(f.page.setFiles).toHaveBeenCalledTimes(1);
    if (combined) {
      expect(f.window.document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
        "Already saved",
      );
      expect(f.page.fill).toHaveBeenCalledTimes(1);
    }
  },
);
it.each([
  { persistAvatar: false },
  { stayOpen: true },
  { photo: oldPhoto + "&new=2" },
  { photo: "https://evil.invalid/v/t51.2885-19/new.jpg" },
  { photo: "http://instagram.example.fbcdn.net/v/t51.2885-19/new.jpg" },
])("holds unverifiable images without repeating upload: %j", async (options) => {
  const f = fixture(options);
  await expect(f.actions.update(imagePatch, { avatar: "/owner/logo.png" })).rejects.toMatchObject({
    code: "unknown",
  });
  expect(f.page.setFiles).toHaveBeenCalledTimes(1);
});
it.each([{ multiple: true }, { duplicateInput: true }])(
  "rejects ambiguous file controls before any profile write: %j",
  async (options) => {
    const f = fixture(options);
    await expect(
      f.actions.update({ ...imagePatch, bio: "New" }, { avatar: "/owner/logo.png" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.setFiles).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  },
);
it("rechecks actor after editing bio before Submit", async () => {
  const f = fixture();
  const fill = vi.mocked(f.page.fill).getMockImplementation()!;
  vi.mocked(f.page.fill).mockImplementation(async (...args) => {
    await fill(...args);
    f.identity.mockRejectedValue(new Error("Actor changed"));
  });
  await expect(f.actions.update({ bio: "New" }, {})).rejects.toThrow("Actor changed");
  expect(f.page.click).not.toHaveBeenCalled();
});
it("rechecks sync scope after asynchronous authorization immediately before upload", async () => {
  const f = fixture();
  f.identity.mockImplementation(async () => {
    if (f.window.document.querySelector("[data-bycoda-ig-profile-file]"))
      f.window.document
        .querySelector('[role="dialog"]')!
        .insertAdjacentHTML("afterbegin", "<h3>Synced profile photo</h3>");
  });
  await expect(f.actions.update(imagePatch, { avatar: "/owner/logo.png" })).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.page.setFiles).not.toHaveBeenCalled();
});
it("requires the exact editor origin and path", async () => {
  for (const redirect of [
    "https://www.instagram.com/accounts/login/",
    "https://evil.invalid/accounts/edit/",
  ]) {
    const f = fixture({ redirect });
    await expect(f.actions.read()).rejects.toMatchObject({ code: "unsupported" });
    expect(f.page.click).not.toHaveBeenCalled();
  }
});
