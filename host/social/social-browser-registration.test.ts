import { Window } from "happy-dom";
import type {
  HTMLButtonElement,
  HTMLElement,
  HTMLInputElement,
  HTMLSelectElement,
} from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { BrowserPage } from "./social-browser";
import {
  advanceSocialRegistration,
  inspectSocialRegistration,
  parseRegistrationProfile,
  reviewLinkedInPageRegistration,
  readExistingLinkedInPageRegistration,
  submitLinkedInPageRegistration,
} from "./social-browser-registration";

// Public LinkedIn signup HTML retrieved 2026-10-26; TikTok controls were inspected
// in the connected browser on that date. These are executed DOM contracts, not
// evidence that an external account was registered or authenticated.
const linkedin = `<form class="join-form" action="/signup/api/cors/createAccount" method="post">
  <input id="email-address" name="email-address" type="email" required>
  <input id="password" name="password" type="password" autocomplete="new-password">
  <input id="first-name" name="first-name" type="text" required>
  <input id="last-name" name="last-name" type="text" required>
  <input id="remember-me-checkbox" type="checkbox" checked>
  <p>By clicking Agree &amp; Join or Continue, you agree to the LinkedIn User Agreement.</p>
  <button id="join-form-submit" type="submit">Agree &amp; Join</button>
</form>`;
const tiktokEmail = `<main>
  <input type="text" name="email" autocomplete="email" placeholder="Email address">
  <input type="password" autocomplete="new-password" placeholder="Password">
  <input type="text" placeholder="Enter 6-digit code">
  <button type="button" disabled>Send code</button><button type="submit" disabled>Next</button>
  <input type="checkbox" name="newsletter">
  <div role="combobox" aria-label="Month. Double-tap for more options" aria-controls="" aria-expanded="false">Month</div>
  <div role="combobox" aria-label="Day. Double-tap for more options" aria-controls="" aria-expanded="false">Day</div>
  <div role="combobox" aria-label="Year. Double-tap for more options" aria-controls="" aria-expanded="false">Year</div>
</main>`;
const facebookPage = `<main>
  <h1>Bir Sayfa Oluştur</h1>
  <label>Sayfa adı (zorunlu)<input type="text"><span>Sayfa adı (zorunlu) girişi geçerli.</span></label>
  <label>Kategori (zorunlu)<input type="search" role="combobox" aria-label="Kategori (zorunlu)"></label>
  <span role="list" aria-label="Seçilen değerler"></span>
  <label>Biyografi (isteğe bağlı)<textarea>Owner biography draft</textarea></label>
  <p><a href="https://www.facebook.com/policies_center/pages_groups_events/">Sayfalar, Gruplar ve Etkinlikler İlkeleri</a></p>
  <div role="button">Sayfa Oluştur</div>
</main>`;
const linkedinPage = `<main>
  <label>Ad*<input id="single-line-text-form-component-urn-li-fsu-pageCreationFormItem-NAME"></label>
  <label>linkedin.com/company/*<input id="single-line-text-form-component-urn-li-fsu-pageCreationFormItem-UNIVERSAL-NAME"></label>
  <label>Sektör*<input id="single-typeahead-entity-form-component-urn-li-fsu-pageCreationFormItem-INDUSTRY" role="combobox" aria-autocomplete="list" aria-expanded="false"></label>
  <select id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-SIZE"><option value="">Select size</option><option value="SIZE_2_10">2–10</option></select>
  <select id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-TYPE"><option value="">Select type</option><option value="PRIVATE">Private</option></select>
  <label><input type="checkbox" name="authority">I have the right to act on behalf of this company</label>
  <button>Create page</button>
</main>`;

function fixture(url: string, html: string) {
  const window = new Window({ url });
  window.document.body.innerHTML = html;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return this.hidden ? [] : [{ width: 100, height: 30 }];
    },
  });
  let omitYear = false;
  const click = vi.fn(async (selector: string) => {
    const element = window.document.querySelector(selector);
    if (!element) throw new Error("The target changed.");
    if (element.tagName === "A") {
      const target = new URL(element.getAttribute("href")!, window.location.href);
      window.location.href = target.href;
      if (target.pathname === "/signup")
        window.document.body.innerHTML = '<a href="/signup/phone-or-email">Use phone or email</a>';
      else if (target.pathname === "/signup/phone-or-email") {
        window.location.href = "https://www.tiktok.com/signup/phone-or-email/phone";
        window.document.body.innerHTML =
          '<input placeholder="Enter 6-digit code"><a href="/signup/phone-or-email/email">Sign up with email</a>';
      } else if (target.pathname === "/signup/phone-or-email/email")
        window.document.body.innerHTML = tiktokEmail;
      return;
    }
    if (
      element.tagName === "LI" &&
      element.getAttribute("role") === "option" &&
      window.location.origin === "https://www.facebook.com"
    ) {
      const selected = window.document.querySelector(
          '[role="list"][aria-label="Seçilen değerler"]',
        )!,
        remove = window.document.createElement("div");
      remove.setAttribute("role", "button");
      remove.setAttribute("aria-label", ` ${element.textContent}  Kaldır`);
      selected.append(remove);
      window.document.querySelector<HTMLInputElement>(
        'input[aria-label="Kategori (zorunlu)"]',
      )!.value = "";
      element.parentElement!.remove();
      return;
    }
    if (
      element.getAttribute("role") === "option" &&
      window.location.origin === "https://www.linkedin.com"
    ) {
      const input = window.document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
      input.value = element.textContent!.trim();
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-controls");
      element.parentElement!.remove();
      return;
    }
    if (element.getAttribute("role") === "combobox") {
      const part = element.getAttribute("aria-label")!.split(".")[0];
      const id = `${part}-options-list-container`,
        previous = window.document.getElementById(id);
      if (previous) {
        previous.remove();
        element.setAttribute("aria-expanded", "false");
        element.setAttribute("aria-controls", "");
        return;
      }
      const list = window.document.createElement("div");
      list.id = id;
      list.setAttribute("role", "listbox");
      const values =
        part === "Month"
          ? [
              "January",
              "February",
              "March",
              "April",
              "May",
              "June",
              "July",
              "August",
              "September",
              "October",
              "November",
              "December",
            ]
          : part === "Day"
            ? Array.from({ length: 31 }, (_, index) => String(index + 1))
            : omitYear
              ? ["2025", "2024", "2023"]
              : ["2025", "1991", "2024", "1993", "2023"];
      for (const [index, value] of values.entries()) {
        const option = window.document.createElement("div");
        option.id = `${part}-options-item-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.textContent = value;
        list.append(option);
      }
      element.setAttribute("aria-expanded", "true");
      element.setAttribute("aria-controls", id);
      window.document.body.append(list);
    } else if (element.getAttribute("role") === "option") {
      const list = element.parentElement!,
        owner = window.document.querySelector(`[aria-controls="${list.id}"]`)!;
      owner.textContent = element.textContent;
      owner.setAttribute("aria-expanded", "false");
      owner.setAttribute("aria-controls", "");
      list.remove();
    } else throw new Error("A registration submit or unexpected control was clicked.");
  });
  const fill = vi.fn(async (selector: string, value: string) => {
    const input = window.document.querySelector(selector) as HTMLInputElement;
    if (
      !input ||
      input.type === "password" ||
      input.getAttribute("placeholder") === "Enter 6-digit code"
    )
      throw new Error("A secret or missing field was touched.");
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    if (
      input.getAttribute("role") === "combobox" &&
      window.location.origin === "https://www.linkedin.com"
    ) {
      const list = window.document.createElement("div");
      list.id = "triggered-expanded-fixture";
      list.setAttribute("role", "listbox");
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", list.id);
      for (const [index, category] of [
        "Yazılım Geliştirme",
        "Bilgisayar ve Ağ Güvenliği",
      ].entries()) {
        const option = window.document.createElement("div");
        option.id = `basic-result-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        const label = window.document.createElement("span");
        label.textContent = category;
        option.append(label);
        list.append(option);
      }
      window.document.body.append(list);
    }
    if (input.type === "search" && window.location.origin === "https://www.facebook.com") {
      window.document.querySelector('ul[role="listbox"]')?.remove();
      const list = window.document.createElement("ul");
      list.setAttribute("role", "listbox");
      for (const category of ["Yazılım", "Yazılım Şirketi"]) {
        const option = window.document.createElement("li");
        option.setAttribute("role", "option");
        option.textContent = category;
        list.append(option);
      }
      window.document.body.append(list);
    }
  });
  const page: BrowserPage = {
    evaluate: vi.fn(
      async <T>(expression: string) => window.eval(expression) as T,
    ) as BrowserPage["evaluate"],
    click,
    fill,
    goto: vi.fn(async (target) => {
      if (
        window.location.origin === "https://www.facebook.com" &&
        target === "https://www.facebook.com/pages/creation/"
      ) {
        window.location.href = target;
        window.document.body.innerHTML = facebookPage;
        return;
      }
      throw new Error("Only observed links or the exact Page setup route may navigate.");
    }),
    insertText: vi.fn(async () => {
      throw new Error("No unscoped typing.");
    }),
    setFiles: vi.fn(async () => {
      throw new Error("No uploads during registration.");
    }),
    cookies: vi.fn(async () => {
      throw new Error("No credential access.");
    }),
    watchResponse: vi.fn(() => {
      throw new Error("No auth response capture.");
    }),
  };
  return {
    window,
    page,
    click,
    fill,
    omitYear: () => {
      omitYear = true;
    },
  };
}

describe("registration profile input", () => {
  it.each(["password", "verificationCode", "otp", "token", "__proto__"])(
    "rejects %s instead of accepting a secret transport",
    (key) => {
      const profile = JSON.parse(
        `{"email":"owner@example.com",${JSON.stringify(key)}:"do-not-transport"}`,
      );
      expect(() => parseRegistrationProfile(profile)).toThrow("Only nonsecret");
    },
  );
  it.each(["2023-02-29", "2000-13-01", "2999-01-01", "1993-1-01"])(
    "does not invent or repair an invalid birthdate %s",
    (birthdate) =>
      expect(() => parseRegistrationProfile({ birthdate })).toThrow("actual birth date"),
  );
});

describe("specific observed registration contracts", () => {
  it("prepares the observed LinkedIn Page name and public username without choosing organization details or accepting authority", async () => {
    const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "brand",
      displayName: "Bycoda",
      username: "bycoda",
      category: "Yazılım Geliştirme",
    });
    expect(state).toMatchObject({
      status: "needs_fields",
      step: "admin_setup",
      filledFields: ["displayName", "username", "category"],
      canAdvance: false,
    });
    expect(state.message).toContain("organization size and type");
    expect(f.fill).toHaveBeenCalledTimes(3);
    expect([...f.window.document.querySelectorAll("select")].map((el) => el.value)).toEqual([
      "",
      "",
    ]);
    expect(
      f.window.document.querySelector<HTMLInputElement>('input[name="authority"]')!.checked,
    ).toBe(false);
    expect(f.window.document.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe(
      "Yazılım Geliştirme",
    );
    expect(f.click).toHaveBeenCalledExactlyOnceWith('[data-bycoda-linkedin-industry="true"]');
    expect(f.window.document.querySelector('[role="listbox"]')).toBeNull();
  });
  it("preserves a different existing LinkedIn Page name and all existing organization choices", async () => {
    const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
    f.window.document.querySelector<HTMLInputElement>('input[id$="-NAME"]')!.value =
      "Owner's existing draft";
    const choices = [...f.window.document.querySelectorAll("select")];
    choices[0].value = "SIZE_2_10";
    choices[1].value = "PRIVATE";
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "brand",
      displayName: "Bycoda",
      username: "bycoda",
    });
    expect(state).toMatchObject({ status: "changed", filledFields: [] });
    expect(f.fill).not.toHaveBeenCalled();
    expect(choices.map((el) => el.value)).toEqual(["SIZE_2_10", "PRIVATE"]);
    expect(f.click).not.toHaveBeenCalled();
  });
  it("does not replace a previously selected different LinkedIn industry", async () => {
    const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
    f.window.document.querySelector<HTMLInputElement>('input[role="combobox"]')!.value =
      "Owner's different industry";
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "brand",
      displayName: "Bycoda",
      username: "bycoda",
      category: "Yazılım Geliştirme",
    });
    expect(state).toMatchObject({ status: "changed", filledFields: ["displayName", "username"] });
    expect(f.window.document.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe(
      "Owner's different industry",
    );
    expect(f.fill).toHaveBeenCalledTimes(2);
    expect(f.click).not.toHaveBeenCalled();
  });
  it("keeps an already matching collapsed industry without extra input or selection", async () => {
    const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
    f.window.document.querySelector<HTMLInputElement>('input[role="combobox"]')!.value =
      "Yazılım Geliştirme";
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "brand",
      displayName: "Bycoda",
      username: "bycoda",
      category: "Yazılım Geliştirme",
    });
    expect(state.filledFields).toEqual(["displayName", "username", "category"]);
    expect(state.message).toContain("Verify the industry");
    expect(f.fill).toHaveBeenCalledTimes(2);
    expect(f.click).not.toHaveBeenCalled();
  });
  it("does not choose a partial industry match or invent a selected backend industry", async () => {
    const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "brand",
      displayName: "Bycoda",
      username: "bycoda",
      category: "Yazılım",
    });
    expect(state).toMatchObject({ status: "changed", filledFields: ["displayName", "username"] });
    expect(f.click).not.toHaveBeenCalled();
    expect(f.window.document.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe(
      "Yazılım",
    );
  });
  it("does not click an exact industry option after authority is revoked", async () => {
    const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
    const beforeAction = vi.fn(async () => {});
    beforeAction
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error("Revoked");
      });
    await expect(
      advanceSocialRegistration(
        f.page,
        "linkedin",
        {
          accountKind: "brand",
          displayName: "Bycoda",
          username: "bycoda",
          category: "Yazılım Geliştirme",
        },
        { beforeAction },
      ),
    ).rejects.toThrow("Revoked");
    expect(f.click).not.toHaveBeenCalled();
  });
  it.each(["missing-industry", "duplicate-name", "wrong-path"])(
    "does not guess a LinkedIn Page form for %s",
    async (change) => {
      const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
      if (change === "missing-industry")
        f.window.document.querySelector('input[role="combobox"]')!.remove();
      else if (change === "duplicate-name")
        f.window.document.body.append(
          f.window.document.querySelector('input[id$="-NAME"]')!.cloneNode(),
        );
      else f.window.location.pathname = "/signup";
      const state = await advanceSocialRegistration(f.page, "linkedin", {
        accountKind: "brand",
        displayName: "Bycoda",
        username: "bycoda",
      });
      expect(state).toMatchObject({ step: "admin_setup", canAdvance: false });
      expect(f.fill).not.toHaveBeenCalled();
      expect(f.click).not.toHaveBeenCalled();
    },
  );
  it("stops LinkedIn Page preparation before any fill when authority is revoked", async () => {
    const f = fixture("https://www.linkedin.com/company/setup/new/", linkedinPage);
    await expect(
      advanceSocialRegistration(
        f.page,
        "linkedin",
        { accountKind: "brand", displayName: "Bycoda", username: "bycoda" },
        {
          beforeAction: async () => {
            throw new Error("Revoked");
          },
        },
      ),
    ).rejects.toThrow("Revoked");
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("opens only the observed YouTube create-channel link and holds the administrator/terms confirmation", async () => {
    const f = fixture(
      "https://www.youtube.com/account",
      `<h1>Tüm kanallar</h1>
      <a href="/channel/UCexisting">Personal channel</a>
      <a href="/create_channel?channel_creation_token=ephemeral-private-nonce">Kanal oluştur</a>`,
    );
    f.click.mockImplementationOnce(async (selector) => {
      const link = f.window.document.querySelector(selector)!;
      expect(link.getAttribute("href")).toBe(
        "/create_channel?channel_creation_token=ephemeral-private-nonce",
      );
      f.window.document.body.innerHTML = `<div role="dialog"><h2>Nasıl görüneceksiniz?</h2>
        <input aria-label="Ad" value="Owner draft"><input aria-label="Herkese Açık Kullanıcı Adı">
        <p>A new Brand Account will be managed by personal@example.com</p>
        <button>Kanal oluştur</button><button>İptal</button></div>`;
    });
    const beforeAction = vi.fn(async () => {});
    const state = await advanceSocialRegistration(
      f.page,
      "youtube",
      {
        accountKind: "brand",
        email: "bycoda@example.com",
        displayName: "Bycoda",
      },
      { beforeAction },
    );
    expect(state).toMatchObject({ status: "awaiting_owner", step: "terms", canAdvance: false });
    expect(state.message).toContain("administrator");
    expect(f.click).toHaveBeenCalledTimes(1);
    expect(f.fill).not.toHaveBeenCalled();
    expect(beforeAction).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(state)).not.toMatch(/ephemeral-private-nonce|personal@example.com/);
    expect(f.window.document.querySelector<HTMLInputElement>('input[aria-label="Ad"]')!.value).toBe(
      "Owner draft",
    );
  });
  it.each([
    '<h1>Tüm kanallar</h1><a href="https://attacker.invalid/create_channel">Kanal oluştur</a>',
    '<h1>Tüm kanallar</h1><a href="/create_channel?next=https://attacker.invalid">Kanal oluştur</a>',
    '<h1>Tüm kanallar</h1><a href="/create_channel#submit">Kanal oluştur</a>',
    '<h1>Tüm kanallar</h1><a href="/create_channel">Kanal oluştur</a><a href="/create_channel">Kanal oluştur</a>',
    '<a href="/create_channel">Kanal oluştur</a>',
    "<h1>Tüm kanallar</h1><button>Kanal oluştur</button>",
  ])(
    "does not guess a YouTube channel action for ambiguous or unrecognized navigation %s",
    async (html) => {
      const f = fixture("https://www.youtube.com/account", html);
      const state = await advanceSocialRegistration(f.page, "youtube", { accountKind: "brand" });
      expect(state).toMatchObject({ step: "admin_setup", canAdvance: false });
      expect(f.click).not.toHaveBeenCalled();
      expect(f.fill).not.toHaveBeenCalled();
    },
  );
  it("stops before navigating an observed YouTube link when authority is revoked", async () => {
    const f = fixture(
      "https://www.youtube.com/account",
      '<h1>Tüm kanallar</h1><a href="/create_channel?channel_creation_token=opaque">Kanal oluştur</a>',
    );
    await expect(
      advanceSocialRegistration(
        f.page,
        "youtube",
        { accountKind: "brand" },
        {
          beforeAction: async () => {
            throw new Error("Revoked");
          },
        },
      ),
    ).rejects.toThrow("Revoked");
    expect(f.click).not.toHaveBeenCalled();
  });
  it("reports the current Google sign-in password boundary without creating a Google account or reading credentials", async () => {
    const f = fixture(
      "https://accounts.google.com/v3/signin/challenge/pwd",
      '<input type="password" value="never-read"><button>Next</button>',
    );
    const state = await advanceSocialRegistration(f.page, "youtube", {
      email: "brand@example.com",
    });
    expect(state).toMatchObject({
      status: "awaiting_owner",
      step: "password",
      blockers: ["password"],
      canAdvance: false,
    });
    expect(JSON.stringify(state)).not.toContain("never-read");
    expect(f.click).not.toHaveBeenCalled();
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("opens an observed LinkedIn Company Page link for brand setup without registering a company as a member", async () => {
    const f = fixture(
      "https://www.linkedin.com/feed/",
      '<a href="https://www.linkedin.com/company/setup/new/">Şirket Sayfası Oluştur</a>',
    );
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "brand",
      displayName: "Bycoda",
    });
    expect(f.click).toHaveBeenCalledTimes(1);
    expect(f.window.location.pathname).toBe("/company/setup/new/");
    expect(state).toMatchObject({ step: "admin_setup", canAdvance: false });
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.page.goto).not.toHaveBeenCalled();
  });
  it("does not interpret a LinkedIn personal signup as company setup", async () => {
    const f = fixture("https://www.linkedin.com/signup", linkedin);
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "brand",
      displayName: "Bycoda",
    });
    expect(state.step).toBe("password");
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("does not mask LinkedIn brand verification behind a generic administrator instruction", async () => {
    const f = fixture(
      "https://www.linkedin.com/checkpoint/challenge",
      "<h1>Security verification</h1>",
    );
    const state = await inspectSocialRegistration(f.page, "linkedin", { accountKind: "brand" });
    expect(state).toMatchObject({ status: "awaiting_owner", step: "challenge", canAdvance: false });
    expect(f.click).not.toHaveBeenCalled();
  });
  it("navigates only verified TikTok signup method links and prepares email without sending a code", async () => {
    const f = fixture("https://www.tiktok.com/login", '<a href="/signup">Sign up</a>');
    for (let index = 0; index < 3; index++) {
      const state = await advanceSocialRegistration(f.page, "tiktok", {
        email: "bycoda@example.com",
      });
      expect(state.status).not.toBe("changed");
    }
    const state = await advanceSocialRegistration(f.page, "tiktok", {
      email: "bycoda@example.com",
    });
    expect(state.requiredFields).toEqual(["birthdate"]);
    expect(state.filledFields).toEqual(["email"]);
    expect(state.blockers).toEqual(["password", "verification"]);
    expect(state.canAdvance).toBe(false);
    expect(f.fill.mock.calls).toHaveLength(1);
    expect(f.click.mock.calls).toHaveLength(3);
    expect(
      f.window.document.querySelector<HTMLInputElement>('input[name="newsletter"]')!.checked,
    ).toBe(false);
    expect(JSON.stringify(state)).not.toContain("bycoda@example.com");
  });
  it("selects the exact owner birthdate by visible option text, never by an inferred year index", async () => {
    const f = fixture("https://www.tiktok.com/signup/phone-or-email/email", tiktokEmail);
    for (const secret of f.window.document.querySelectorAll(
      'input[type="password"],input[placeholder="Enter 6-digit code"]',
    ))
      Object.defineProperty(secret, "value", {
        get: () => {
          throw new Error("Secret value read");
        },
        set: () => {
          throw new Error("Secret value write");
        },
      });
    const state = await advanceSocialRegistration(f.page, "tiktok", {
      email: "owner@example.com",
      birthdate: "1993-08-17",
    });
    expect(state.filledFields).toEqual(["email", "birthdate"]);
    expect(state.status).toBe("awaiting_owner");
    expect(state.blockers).toEqual(["password", "verification"]);
    expect(
      [...f.window.document.querySelectorAll('[role="combobox"]')].map((el) => el.textContent),
    ).toEqual(["August", "17", "1993"]);
    expect(f.fill).toHaveBeenCalledTimes(1);
    expect(f.click.mock.calls).toHaveLength(6);
    expect(JSON.stringify(state)).not.toMatch(/1993|owner@example/);
  });
  it("preserves a different owner-entered email without overwriting it", async () => {
    const f = fixture("https://www.tiktok.com/signup/phone-or-email/email", tiktokEmail);
    f.window.document.querySelector<HTMLInputElement>('input[name="email"]')!.value =
      "other@example.com";
    const state = await advanceSocialRegistration(f.page, "tiktok", { email: "owner@example.com" });
    expect(state.status).toBe("changed");
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("does not replace a previously selected different birth month", async () => {
    const f = fixture("https://www.tiktok.com/signup/phone-or-email/email", tiktokEmail);
    f.window.document.querySelector('[role="combobox"]')!.textContent = "February";
    const state = await advanceSocialRegistration(f.page, "tiktok", {
      email: "owner@example.com",
      birthdate: "1993-08-17",
    });
    expect(state).toMatchObject({ status: "changed", step: "birthdate", filledFields: ["email"] });
    expect(f.click).not.toHaveBeenCalled();
  });
  it("reports an unavailable year instead of choosing a different age", async () => {
    const f = fixture("https://www.tiktok.com/signup/phone-or-email/email", tiktokEmail);
    f.omitYear();
    const state = await advanceSocialRegistration(f.page, "tiktok", {
      email: "owner@example.com",
      birthdate: "1993-08-17",
    });
    expect(state).toMatchObject({ status: "changed", step: "birthdate" });
    expect(
      f.window.document.querySelector('[aria-label="Year. Double-tap for more options"]')!
        .textContent,
    ).toBe("Year");
    expect(f.window.document.querySelector('[role="listbox"]')).toBeNull();
  });
  it.each(["facebook", "youtube", "linkedin"] as const)(
    "does not create a company as a %s personal member",
    async (platform) => {
      const f = fixture("https://www.linkedin.com/signup", linkedin);
      const state = await advanceSocialRegistration(f.page, platform, {
        email: "brand@example.com",
        displayName: "Bycoda",
      });
      expect(state.step).toBe(platform === "linkedin" ? "password" : "admin_setup");
      expect(f.fill).not.toHaveBeenCalled();
      expect(f.click).not.toHaveBeenCalled();
    },
  );
  it("prepares an explicitly personal LinkedIn form and stops before its password and legal agreement", async () => {
    const f = fixture("https://www.linkedin.com/signup", linkedin);
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "person",
      email: "owner@example.com",
      givenName: "Aylin",
      familyName: "Yilmaz",
    });
    expect(state).toMatchObject({
      status: "awaiting_owner",
      blockers: ["password", "terms"],
      filledFields: ["email", "givenName", "familyName"],
      canAdvance: false,
    });
    expect(f.fill).toHaveBeenCalledTimes(3);
    expect(f.click).not.toHaveBeenCalled();
    expect(
      f.window.document.querySelector<HTMLInputElement>("#remember-me-checkbox")!.checked,
    ).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/Aylin|Yilmaz|owner@example/);
  });
  it("refuses a changed signup endpoint and duplicate field layout", async () => {
    const f = fixture(
      "https://www.linkedin.com/signup",
      linkedin.replace("/signup/api/cors/createAccount", "/another-endpoint"),
    );
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "person",
      email: "owner@example.com",
    });
    expect(state.canAdvance).toBe(false);
    expect(f.fill).not.toHaveBeenCalled();
    const tt = fixture(
      "https://www.tiktok.com/signup/phone-or-email/email",
      tiktokEmail +
        '<input type="text" name="email" autocomplete="email" placeholder="Email address">',
    );
    expect(
      (await advanceSocialRegistration(tt.page, "tiktok", { email: "owner@example.com" }))
        .canAdvance,
    ).toBe(false);
    expect(tt.fill).not.toHaveBeenCalled();
  });
  it("does not fill fields through an active challenge", async () => {
    const f = fixture(
      "https://www.linkedin.com/signup",
      linkedin + '<iframe src="https://www.google.com/recaptcha/challenge"></iframe>',
    );
    const state = await advanceSocialRegistration(f.page, "linkedin", {
      accountKind: "person",
      email: "owner@example.com",
    });
    expect(state).toMatchObject({ status: "awaiting_owner", step: "challenge" });
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("rechecks cancellation after inspecting a field and before entering data", async () => {
    const f = fixture("https://www.tiktok.com/signup/phone-or-email/email", tiktokEmail);
    const beforeAction = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Cancelled"));
    await expect(
      advanceSocialRegistration(f.page, "tiktok", { email: "owner@example.com" }, { beforeAction }),
    ).rejects.toThrow("Cancelled");
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it.each(["value", "type"])(
    "preserves an owner field or secret-type change during the authorization await: %s",
    async (change) => {
      const f = fixture("https://www.tiktok.com/signup/phone-or-email/email", tiktokEmail);
      let checks = 0;
      const beforeAction = async () => {
        if (++checks !== 2) return;
        const input = f.window.document.querySelector<HTMLInputElement>('input[name="email"]')!;
        if (change === "value") input.value = "owner-edited@example.com";
        else input.type = "password";
      };
      const state = await advanceSocialRegistration(
        f.page,
        "tiktok",
        { email: "prepared@example.com" },
        { beforeAction },
      );
      expect(state.status).toBe("changed");
      expect(f.fill).not.toHaveBeenCalled();
      expect(f.click).not.toHaveBeenCalled();
    },
  );
  it("rejects an expanded birthday popup whose controls identity changed", async () => {
    const f = fixture("https://www.tiktok.com/signup/phone-or-email/email", tiktokEmail);
    const month = f.window.document.querySelector(
      '[aria-label="Month. Double-tap for more options"]',
    )!;
    month.setAttribute("aria-expanded", "true");
    month.setAttribute("aria-controls", "Other-options-list-container");
    const state = await advanceSocialRegistration(f.page, "tiktok", {
      email: "owner@example.com",
      birthdate: "1993-08-17",
    });
    expect(state).toMatchObject({ status: "changed", step: "birthdate" });
    expect(f.click).not.toHaveBeenCalled();
  });
  it.each([
    "https://www.tiktok.com.evil.test/signup/phone-or-email/email",
    "https://www.tiktok.com/settings",
  ])("refuses a different origin or unrelated route: %s", async (url) => {
    const f = fixture(url, tiktokEmail);
    const state = await advanceSocialRegistration(f.page, "tiktok", { email: "owner@example.com" });
    expect(state.canAdvance).toBe(false);
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("does not interpret Instagram's signed-in redirect as account registration", async () => {
    const f = fixture("https://www.instagram.com/", '<a href="/direct/inbox/">Messages</a>');
    const state = await inspectSocialRegistration(f.page, "instagram", { displayName: "Bycoda" });
    expect(state).toMatchObject({ status: "unsupported", step: "unknown", canAdvance: false });
    expect(JSON.stringify(state)).not.toMatch(/created|authenticated|success/);
  });
  it("prepares an observed Facebook Page brand form and pauses at its legal create button", async () => {
    const f = fixture("https://www.facebook.com/pages/creation/", facebookPage);
    const state = await advanceSocialRegistration(f.page, "facebook", {
      displayName: "Bycoda",
      category: "Yazılım",
    });
    expect(state).toMatchObject({
      status: "awaiting_owner",
      step: "terms",
      blockers: ["terms"],
      filledFields: ["displayName", "category"],
      canAdvance: false,
    });
    expect(f.window.document.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe(
      "Bycoda",
    );
    expect(f.window.document.querySelector("textarea")!.value).toBe("Owner biography draft");
    expect(
      f.window.document
        .querySelector('[role="list"][aria-label="Seçilen değerler"] [role="button"]')!
        .getAttribute("aria-label"),
    ).toBe(" Yazılım  Kaldır");
    expect(f.click.mock.calls).toHaveLength(1);
    expect(JSON.stringify(state)).not.toMatch(/Bycoda|Yazılım|biography/);
  });
  it("opens the known Facebook Page setup route without creating a person and prepares its fields", async () => {
    const f = fixture(
      "https://www.facebook.com/r.php",
      '<form><input name="firstname"><button>Kaydol</button></form>',
    );
    const state = await advanceSocialRegistration(f.page, "facebook", {
      displayName: "Bycoda",
      category: "Yazılım",
    });
    expect(f.page.goto).toHaveBeenCalledExactlyOnceWith("https://www.facebook.com/pages/creation/");
    expect(state.filledFields).toEqual(["displayName", "category"]);
    expect(state.step).toBe("terms");
    expect(f.click.mock.calls).toHaveLength(1);
  });
  it("does not repeatedly navigate a Facebook sign-in redirect or select an administrator", async () => {
    const f = fixture("https://www.facebook.com/", '<a href="/login">Giriş yap</a>');
    vi.mocked(f.page.goto).mockImplementationOnce(async () => {
      f.window.location.href = "https://www.facebook.com/login/";
      f.window.document.body.innerHTML = '<input type="password">';
    });
    const state = await advanceSocialRegistration(f.page, "facebook", {
      displayName: "Bycoda",
      category: "Yazılım",
    });
    expect(state).toMatchObject({ status: "needs_fields", step: "admin_setup", canAdvance: false });
    expect(f.page.goto).toHaveBeenCalledTimes(1);
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("does not replace an existing different Page category or append another one", async () => {
    const f = fixture("https://www.facebook.com/pages/creation/", facebookPage);
    f.window.document.querySelector('[role="list"][aria-label="Seçilen değerler"]')!.innerHTML =
      '<div role="button" aria-label=" Restoran Kaldır"></div>';
    const state = await advanceSocialRegistration(f.page, "facebook", {
      displayName: "Bycoda",
      category: "Yazılım",
    });
    expect(state.status).toBe("changed");
    expect(f.click).not.toHaveBeenCalled();
    expect(f.fill.mock.calls).toHaveLength(1);
    expect(f.window.document.querySelector('[aria-label=" Restoran Kaldır"]')).not.toBeNull();
  });
  it("keeps already matching Page fields and selected category without extra input", async () => {
    const f = fixture("https://www.facebook.com/pages/creation/", facebookPage);
    f.window.document.querySelector<HTMLInputElement>('input[type="text"]')!.value = "Bycoda";
    f.window.document.querySelector('[role="list"][aria-label="Seçilen değerler"]')!.innerHTML =
      '<div role="button" aria-label=" Yazılım  Kaldır"></div>';
    const state = await advanceSocialRegistration(f.page, "facebook", {
      displayName: "Bycoda",
      category: "Yazılım",
    });
    expect(state).toMatchObject({ step: "terms", filledFields: ["displayName", "category"] });
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("fills the supplied Page name but reports a missing category without choosing one", async () => {
    const f = fixture("https://www.facebook.com/pages/creation/", facebookPage);
    const state = await advanceSocialRegistration(f.page, "facebook", { displayName: "Bycoda" });
    expect(state).toMatchObject({
      status: "needs_fields",
      requiredFields: ["category"],
      filledFields: ["displayName"],
    });
    expect(f.fill).toHaveBeenCalledTimes(1);
    expect(f.click).not.toHaveBeenCalled();
  });
});

const finalPrefix = "single-line-text-form-component-urn-li-fsu-pageCreationFormItem-";
const finalTermsId = "urn:li:fsu_pageCreationFormItem:TERMS_AND_CONDITIONS-0";
function finalRegistrationFixture() {
  const window = new Window({ url: "https://www.linkedin.com/company/setup/new/" });
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return this.hidden || this.closest("[hidden]") ? [] : [{ width: 100, height: 30 }];
    },
  });
  const navigation = `<div class="global-nav__me"><button aria-expanded="false">Me</button><div class="global-nav__me-content" hidden><header><a href="/in/fixture-admin/">Fixture administrator</a></header><a href="/in/fixture-admin/">View profile</a></div></div>`;
  window.document.body.innerHTML = `${navigation}<form>
    <input id="${finalPrefix}NAME" value="Bycoda"><input id="${finalPrefix}UNIVERSAL-NAME" value="bycoda">
    <input id="${finalPrefix}WEBSITE" value="https://bycoda.example">
    <input id="single-typeahead-entity-form-component-urn-li-fsu-pageCreationFormItem-INDUSTRY" value="Software Development">
    <select id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-SIZE"><option value="SIZE_1">0–1 employees</option></select>
    <select id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-TYPE"><option value="SELF_EMPLOYED">Self-employed</option></select>
    <input id="media-upload-form-component-urn-li-fsu-pageCreationFormItem-LOGO" type="file">
    <textarea id="multiline-text-form-component-urn-li-fsu-pageCreationFormItem-TAGLINE">Open-source workspace</textarea>
    <input id="${finalTermsId}" name="urn:li:fsu_pageCreationFormItem:TERMS_AND_CONDITIONS" type="checkbox">
    <label for="${finalTermsId}">I am authorized to create this Page and accept the LinkedIn Page Terms.</label>
    <a href="https://legal.linkedin.com/linkedin-pages-terms">Read LinkedIn Page Terms</a><button disabled>Create page</button>
  </form>`;
  const hooks: {
    beforeClick?: (selector: string) => void;
    afterAgreement?: () => void;
    mismatchReceipt?: boolean;
  } = {};
  const page = {
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    click: vi.fn(async (selector: string) => {
      hooks.beforeClick?.(selector);
      const el = window.document.querySelector(selector)!;
      if (el.closest(".global-nav__me")) {
        const button = el as HTMLButtonElement,
          opened = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!opened));
        window.document.querySelector<HTMLElement>(".global-nav__me-content")!.hidden = opened;
      } else if (el.id === finalTermsId) {
        (el as HTMLInputElement).checked = true;
        window.document.querySelector<HTMLButtonElement>("form button")!.disabled = false;
        hooks.afterAgreement?.();
      } else if (el.getAttribute("data-bycoda-registration-create") === "true") {
        window.happyDOM.setURL("https://www.linkedin.com/company/145372363/admin/dashboard/");
        window.document.body.innerHTML = navigation;
      } else throw new Error("Unexpected final registration action");
    }),
    goto: vi.fn(async (url: string) => {
      window.happyDOM.setURL(url);
      window.document.body.innerHTML = `${navigation}<input id="organization-name-field" value="${hooks.mismatchReceipt ? "Another Page" : "Bycoda"}"><input id="organization-public-url-field" value="bycoda">`;
    }),
  } as unknown as BrowserPage;
  const profile = {
    accountKind: "brand" as const,
    displayName: "Bycoda",
    username: "bycoda",
    category: "Software Development",
  };
  const legalClicks = () =>
    vi
      .mocked(page.click)
      .mock.calls.filter(
        ([selector]) => selector.includes(finalTermsId) || selector.includes("registration-create"),
      );
  return { window, page, profile, hooks, legalClicks };
}
describe("existing LinkedIn Page read-only resource contract", () => {
  it("reads only the numeric Page's persisted name, slug and current Me administrator", async () => {
    const f = finalRegistrationFixture();
    const beforeRead = vi.fn(async () => undefined);
    const result = await readExistingLinkedInPageRegistration(f.page, "145372363", beforeRead, 1);
    expect(result).toEqual({
      resourceId: "145372363",
      resourceUrl: "https://www.linkedin.com/company/145372363/",
      administrator: { id: "web:linkedin:in:fixture-admin", name: "Fixture administrator" },
      fields: { displayName: "Bycoda", username: "bycoda" },
    });
    expect(f.page.goto).toHaveBeenCalledExactlyOnceWith(
      "https://www.linkedin.com/company/145372363/admin/edit/?editPageActiveTab=info",
    );
    expect(beforeRead.mock.calls.length).toBeGreaterThan(3);
    expect(f.legalClicks()).toHaveLength(0);
  });
  it.each(["0", "-1", "1e6", "https://www.linkedin.com/company/145372363/", "145372363?secret=1"])(
    "rejects an arbitrary resource target before navigation: %s",
    async (resourceId) => {
      const f = finalRegistrationFixture(),
        guard = vi.fn(async () => undefined);
      await expect(
        readExistingLinkedInPageRegistration(f.page, resourceId, guard, 1),
      ).rejects.toThrow("numeric ID");
      expect(f.page.goto).not.toHaveBeenCalled();
      expect(guard).not.toHaveBeenCalled();
      expect(f.legalClicks()).toHaveLength(0);
    },
  );
  it("rejects a redirect to another resource and never clicks Create or terms", async () => {
    const f = finalRegistrationFixture(),
      go = vi.mocked(f.page.goto).getMockImplementation()!;
    vi.mocked(f.page.goto).mockImplementation(async (url) => {
      await go(url);
      f.window.happyDOM.setURL("https://www.linkedin.com/company/999/admin/edit/");
    });
    await expect(
      readExistingLinkedInPageRegistration(f.page, "145372363", async () => undefined, 1),
    ).rejects.toThrow("could not be verified");
    expect(f.legalClicks()).toHaveLength(0);
  });
  it("rechecks native authority before opening the Me card", async () => {
    const f = finalRegistrationFixture();
    let reads = 0;
    await expect(
      readExistingLinkedInPageRegistration(
        f.page,
        "145372363",
        async () => {
          if (++reads > 1) throw new Error("Owner revoked");
        },
        1,
      ),
    ).rejects.toThrow("Owner revoked");
    expect(f.page.click).not.toHaveBeenCalled();
  });
});

describe("exact owner-approved LinkedIn Page final DOM contract", () => {
  it("reviews all known fields, selected administrator and exact terms without accepting anything", async () => {
    const f = finalRegistrationFixture();
    const review = await reviewLinkedInPageRegistration(f.page, f.profile);
    expect(review.administrator).toEqual({
      id: "web:linkedin:in:fixture-admin",
      name: "Fixture administrator",
    });
    expect(review.fields).toMatchObject({
      displayName: "Bycoda",
      username: "bycoda",
      organizationSize: "0–1 employees",
      organizationType: "Self-employed",
    });
    expect(review.details).toEqual(
      expect.arrayContaining([
        { label: "Website", value: "https://bycoda.example" },
        { label: "Tagline", value: "Open-source workspace" },
      ]),
    );
    expect(review.terms.url).toBe("https://legal.linkedin.com/linkedin-pages-terms");
    expect(f.legalClicks()).toHaveLength(0);
    expect(
      f.window.document.querySelector<HTMLInputElement>(`[id="${finalTermsId}"]`)!.checked,
    ).toBe(false);
  });
  it.each(["extra", "logo", "secret", "terms", "selection"] as const)(
    "rejects unreviewable %s state without legal clicks",
    async (kind) => {
      const f = finalRegistrationFixture(),
        form = f.window.document.querySelector("form")!;
      if (kind === "extra")
        form.insertAdjacentHTML(
          "beforeend",
          '<input id="unknown-new-intent" value="not reviewed">',
        );
      if (kind === "logo") form.insertAdjacentHTML("beforeend", '<img src="blob:uploaded-logo">');
      if (kind === "secret") {
        form.insertAdjacentHTML("beforeend", '<input type="password">');
        Object.defineProperty(form.querySelector('input[type="password"]')!, "value", {
          get() {
            throw new Error("Secret values must never be read");
          },
        });
      }
      if (kind === "terms")
        form.querySelector("a")!.setAttribute("href", "https://evil.example/terms");
      if (kind === "selection") form.querySelector("select")!.value = "";
      await expect(reviewLinkedInPageRegistration(f.page, f.profile)).rejects.toThrow(
        "cannot be reviewed",
      );
      expect(f.legalClicks()).toHaveLength(0);
    },
  );
  it("creates once after revalidation, reopens the exact new resource and verifies its administrator", async () => {
    const f = finalRegistrationFixture(),
      review = await reviewLinkedInPageRegistration(f.page, f.profile);
    const guard = vi.fn(async () => undefined);
    await expect(
      submitLinkedInPageRegistration(f.page, f.profile, review, {
        beforeAction: guard,
        timeoutMs: 1,
      }),
    ).resolves.toEqual({
      resourceId: "145372363",
      resourceUrl: "https://www.linkedin.com/company/145372363/",
    });
    expect(f.legalClicks()).toHaveLength(2);
    expect(guard).toHaveBeenCalled();
  });
  it("binds a prechecked owner agreement and does not toggle it again", async () => {
    const f = finalRegistrationFixture();
    f.window.document.querySelector<HTMLInputElement>(`[id="${finalTermsId}"]`)!.checked = true;
    f.window.document.querySelector<HTMLButtonElement>("form button")!.disabled = false;
    const review = await reviewLinkedInPageRegistration(f.page, f.profile);
    expect(review.agreementChecked).toBe(true);
    await expect(
      submitLinkedInPageRegistration(f.page, f.profile, review, { timeoutMs: 1 }),
    ).resolves.toMatchObject({ resourceId: "145372363" });
    expect(f.legalClicks()).toHaveLength(1);
  });
  it("rejects a checkbox changed after review before any approval action", async () => {
    const f = finalRegistrationFixture(),
      review = await reviewLinkedInPageRegistration(f.page, f.profile);
    f.window.document.querySelector<HTMLInputElement>(`[id="${finalTermsId}"]`)!.checked = true;
    await expect(submitLinkedInPageRegistration(f.page, f.profile, review)).rejects.toThrow(
      "cannot be reviewed",
    );
    expect(f.legalClicks()).toHaveLength(0);
  });
  it.each(["admin", "field", "terms"] as const)(
    "rejects changed approved %s before the agreement action",
    async (kind) => {
      const f = finalRegistrationFixture(),
        review = await reviewLinkedInPageRegistration(f.page, f.profile);
      if (kind === "admin")
        f.window.document
          .querySelector(".global-nav__me-content header a")!
          .setAttribute("href", "/in/another-admin/");
      if (kind === "field")
        f.window.document.querySelector<HTMLInputElement>(`[id="${finalPrefix}WEBSITE"]`)!.value =
          "https://another.example";
      if (kind === "terms")
        f.window.document.querySelector("label")!.textContent = "Changed legal agreement";
      await expect(submitLinkedInPageRegistration(f.page, f.profile, review)).rejects.toThrow(
        "changed",
      );
      expect(f.legalClicks()).toHaveLength(0);
    },
  );
  it("does not click Create after the form changes during agreement acceptance", async () => {
    const f = finalRegistrationFixture(),
      review = await reviewLinkedInPageRegistration(f.page, f.profile);
    f.hooks.afterAgreement = () => {
      f.window.document.querySelector<HTMLInputElement>(`[id="${finalPrefix}WEBSITE"]`)!.value =
        "https://changed.example";
    };
    await expect(submitLinkedInPageRegistration(f.page, f.profile, review)).rejects.toThrow(
      "changed",
    );
    expect(f.legalClicks()).toHaveLength(1);
  });
  it("does not turn an unrelated created Page into a matching receipt", async () => {
    const f = finalRegistrationFixture(),
      review = await reviewLinkedInPageRegistration(f.page, f.profile);
    f.hooks.mismatchReceipt = true;
    await expect(
      submitLinkedInPageRegistration(f.page, f.profile, review, { timeoutMs: 1 }),
    ).rejects.toThrow("could not be verified");
    expect(f.legalClicks()).toHaveLength(2);
  });
});

// Reddit's live signup is gated by a Google reCAPTCHA "Prove your humanity" interstitial for
// automated profiles (observed 2026-11-15), so the form steps below are fixtures of the
// documented faceplate-text-input shadow-root layout, not an observed account creation.
describe("Reddit owner-assisted registration contracts", () => {
  const challenge =
    '<h1>Prove your humanity</h1><form><iframe src="https://www.google.com/recaptcha/api2/anchor?ar=1"></iframe></form>';
  function reddit(html: string, shadowInputs: Record<string, string> = {}) {
    const f = fixture("https://www.reddit.com/register/", html);
    for (const [name, attributes] of Object.entries(shadowInputs)) {
      const host = f.window.document.createElement("faceplate-text-input");
      host.setAttribute("name", name);
      host.attachShadow({ mode: "open" }).innerHTML = `<input ${attributes}>`;
      f.window.document.body.append(host);
    }
    const fill = vi.fn(async (selector: string, value: string) => {
      const host = f.window.document.querySelector(selector)!;
      const input = (host.shadowRoot ?? host).querySelector("input")!;
      if (input.type === "password" || input.autocomplete === "one-time-code")
        throw new Error("A secret field was touched.");
      input.value = value;
    });
    return { ...f, fill, page: { ...f.page, fill } satisfies BrowserPage };
  }
  const emailInput = 'name="email" type="text" autocomplete="email"';

  it("fills the owner email inside the shadow root and stops at Continue and the agreement", async () => {
    const f = reddit("<h1>Sign Up</h1>", { email: emailInput });
    expect(await inspectSocialRegistration(f.page, "reddit", {})).toMatchObject({
      status: "needs_fields",
      requiredFields: ["email"],
    });
    const state = await advanceSocialRegistration(f.page, "reddit", {
      email: "bycoda@example.com",
    });
    expect(state).toMatchObject({
      status: "awaiting_owner",
      step: "terms",
      blockers: ["terms"],
      filledFields: ["email"],
      canAdvance: false,
    });
    expect(f.fill).toHaveBeenCalledTimes(1);
    expect(f.click).not.toHaveBeenCalled();
    expect(
      f.window.document.querySelector("faceplate-text-input")!.shadowRoot!.querySelector("input")!
        .value,
    ).toBe("bycoda@example.com");
    expect(JSON.stringify(state)).not.toContain("bycoda@example.com");
  });
  it("fills only the username on the credentials step and leaves the password to the owner", async () => {
    const f = reddit("<h1>Create your username and password</h1>", {
      username: 'name="username" type="text"',
      password: 'name="password" type="password" autocomplete="new-password"',
    });
    const state = await advanceSocialRegistration(f.page, "reddit", {
      email: "bycoda@example.com",
      username: "bycoda_team",
    });
    expect(state).toMatchObject({ status: "awaiting_owner", filledFields: ["username"] });
    expect(state.blockers).toEqual(["password", "terms"]);
    expect(f.fill).toHaveBeenCalledTimes(1);
    expect(f.fill.mock.calls[0][1]).toBe("bycoda_team");
    expect(JSON.stringify(f.fill.mock.calls)).not.toMatch(/password/i);
  });
  it("preserves a different owner-typed email", async () => {
    const f = reddit("", { email: `${emailInput} value="other@example.com"` });
    const state = await advanceSocialRegistration(f.page, "reddit", {
      email: "bycoda@example.com",
    });
    expect(state.status).toBe("changed");
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("reports the reCAPTCHA interstitial and never fills through it", async () => {
    const f = reddit(challenge, { email: emailInput });
    const state = await advanceSocialRegistration(f.page, "reddit", {
      email: "bycoda@example.com",
    });
    expect(state).toMatchObject({ status: "awaiting_owner", step: "challenge" });
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("reports an email verification code step without typing a code", async () => {
    const f = reddit("<h1>Verify your email</h1>", {
      code: 'name="code" type="text" autocomplete="one-time-code"',
    });
    const state = await advanceSocialRegistration(f.page, "reddit", {
      email: "bycoda@example.com",
    });
    expect(state).toMatchObject({ status: "awaiting_owner", step: "verification" });
    expect(state.blockers).toContain("verification");
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("does not guess at an unknown Reddit layout or another path", async () => {
    const f = reddit("<h1>Sign Up</h1>");
    expect(
      await advanceSocialRegistration(f.page, "reddit", { email: "bycoda@example.com" }),
    ).toMatchObject({
      status: "unsupported",
    });
    const other = reddit("", { email: emailInput });
    other.window.location.href = "https://www.reddit.com/login/";
    expect((await inspectSocialRegistration(other.page, "reddit", {})).status).toBe("unsupported");
    const foreign = fixture("https://example.com/register/", "");
    expect((await inspectSocialRegistration(foreign.page, "reddit", {})).status).toBe(
      "unsupported",
    );
  });
});

// x.com answers headless Chrome with HTTP 403 (observed 2026-11-15), so the profile step below
// is a fixture of the remembered name/email/SELECTOR_n layout, not an observed account creation.
describe("X owner-assisted registration contracts", () => {
  const url = "https://x.com/i/flow/signup";
  const options = (count: number, extra = "") =>
    `<option value="">-</option>${Array.from({ length: count }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}${extra}`;
  const dates = `<select id="SELECTOR_1" aria-label="Month">${options(12)}</select>
    <select id="SELECTOR_2" aria-label="Day">${options(31)}</select>
    <select id="SELECTOR_3" aria-label="Year">${options(1, '<option value="1990">1990</option>')}</select>`;
  const profileForm = `<div role="dialog"><input name="name" type="text"><input name="email" type="text">${dates}
    <button data-testid="ocfSettingsListNextButton">Next</button></div>`;
  const owner = {
    displayName: "Fixture Owner",
    email: "bycoda@example.com",
    birthdate: "1990-04-07",
  };
  const value = (f: ReturnType<typeof fixture>, selector: string) =>
    f.window.document.querySelector<HTMLInputElement>(selector)!.value;

  it("asks for the three non-secret fields before touching the form", async () => {
    const f = fixture(url, profileForm);
    expect(await inspectSocialRegistration(f.page, "x", {})).toMatchObject({
      status: "needs_fields",
      step: "profile",
      requiredFields: ["displayName", "email", "birthdate"],
    });
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("fills name, email and birthdate then stops at terms without clicking Next", async () => {
    const f = fixture(url, profileForm);
    const state = await advanceSocialRegistration(f.page, "x", owner);
    expect(state).toMatchObject({
      status: "awaiting_owner",
      step: "terms",
      blockers: ["terms"],
      filledFields: ["displayName", "email", "birthdate"],
      canAdvance: false,
    });
    expect(value(f, 'input[name="name"]')).toBe("Fixture Owner");
    expect(value(f, 'input[name="email"]')).toBe("bycoda@example.com");
    expect([1, 2, 3].map((n) => value(f, `#SELECTOR_${n}`))).toEqual(["4", "7", "1990"]);
    expect(f.click).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).not.toContain("bycoda@example.com");
  });
  it("does not overwrite an owner birthdate or field choice", async () => {
    const f = fixture(url, profileForm);
    f.window.document.querySelector<HTMLSelectElement>("#SELECTOR_1")!.value = "9";
    const state = await advanceSocialRegistration(f.page, "x", owner);
    expect(state).toMatchObject({ status: "changed", step: "birthdate" });
    expect(value(f, "#SELECTOR_1")).toBe("9");
    const g = fixture(url, profileForm);
    g.window.document.querySelector<HTMLInputElement>('input[name="email"]')!.value =
      "other@example.com";
    expect(await advanceSocialRegistration(g.page, "x", owner)).toMatchObject({
      status: "changed",
      step: "profile",
    });
  });
  it("leaves the phone variant and the initial choice to the owner", async () => {
    const phone = fixture(url, `<input name="name"><input name="phone_number">${dates}`);
    expect((await inspectSocialRegistration(phone.page, "x", owner)).status).toBe("unsupported");
    const choice = fixture(url, '<div role="dialog"><button>Create account</button></div>');
    expect(await advanceSocialRegistration(choice.page, "x", owner)).toMatchObject({
      status: "unsupported",
    });
    expect(choice.click).not.toHaveBeenCalled();
  });
  it.each([
    [
      "Arkose challenge iframe",
      '<iframe src="https://client-api.arkoselabs.com/fc/gc/"></iframe>',
      "challenge",
    ],
    ["Authenticate heading", "<h1>Authenticate</h1>", "challenge"],
    ["suspicious login", "<h2>Suspicious login prevented</h2>", "challenge"],
    [
      "verification code input",
      '<h1>We sent you a code</h1><input name="verfication_code">',
      "verification",
    ],
    ["password", '<input name="password" type="password" autocomplete="new-password">', "password"],
  ])("reports %s without typing or clicking", async (_label, html, blocker) => {
    const f = fixture(url, html);
    const state = await advanceSocialRegistration(f.page, "x", owner);
    expect(state.status).toBe("awaiting_owner");
    expect(state.blockers).toContain(blocker);
    expect(f.fill).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });
  it("stops filling when a challenge appears over the profile form", async () => {
    const f = fixture(
      url,
      `${profileForm}<iframe src="https://client-api.arkoselabs.com/x"></iframe>`,
    );
    expect(await advanceSocialRegistration(f.page, "x", owner)).toMatchObject({
      status: "awaiting_owner",
      step: "challenge",
    });
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("ignores other origins and routes", async () => {
    const other = fixture("https://x.com/home", profileForm);
    expect((await inspectSocialRegistration(other.page, "x", {})).status).toBe("unsupported");
    const foreign = fixture("https://example.com/i/flow/signup", profileForm);
    expect((await inspectSocialRegistration(foreign.page, "x", {})).status).toBe("unsupported");
  });
});

describe("Google account creation for a YouTube signup", () => {
  // Markup observed live on 2026-11-15 (tr-TR, signed out); the reCAPTCHA anchor is always present
  // but hidden with visibility:hidden.
  const recaptcha =
    '<iframe src="https://www.google.com/recaptcha/enterprise/anchor?k=x" style="visibility:hidden"></iframe>';
  const signin = `<h1>Oturum açın</h1><input type="email" name="identifier" id="identifierId"><button>Sonraki</button>${recaptcha}`;
  const name = `<h1>Bir Google Hesabı Oluşturun</h1><input name="firstName" id="firstName"><input name="lastName" id="lastName"><button>Sonraki</button>${recaptcha}`;
  const months = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ];
  const birthday = `<h1>Temel bilgiler</h1><input type="tel" name="day" id="day"><input type="tel" name="year" id="year">
    <span id="c3">Ay</span><div role="combobox" aria-labelledby="c3 c4" aria-expanded="false" aria-controls="c6"></div>
    <ul role="listbox" aria-label="Ay" hidden>${months.map((month, index) => `<li role="option" data-value="${index + 1}" aria-selected="false">${month}</li>`).join("")}</ul>
    <span id="c9">Cinsiyet</span><div role="combobox" aria-labelledby="c9 c10"></div><button>Sonraki</button>${recaptcha}`;
  const owner = {
    accountKind: "brand" as const,
    givenName: "Fixture",
    familyName: "Owner",
    birthdate: "1990-03-05",
    email: "bycoda@example.com",
  };
  const googleFixture = (path: string, html: string) => {
    const f = fixture(`https://accounts.google.com${path}`, html);
    f.page.goto = vi.fn(async (target: string) => {
      expect(target).toMatch(
        /^https:\/\/accounts\.google\.com\/signup\/v2\/createaccount\?service=youtube&/,
      );
      f.window.location.href = "https://accounts.google.com/lifecycle/steps/signup/name";
      f.window.document.body.innerHTML = name;
    });
    f.click.mockImplementation(async (selector: string) => {
      const element = f.window.document.querySelector(selector)!;
      if (element.getAttribute("role") === "combobox") {
        f.window.document.querySelector<HTMLElement>('[role="listbox"]')!.hidden = false;
        return;
      }
      if (element.getAttribute("role") === "option") {
        element.setAttribute("aria-selected", "true");
        f.window.document.querySelector<HTMLElement>('[role="listbox"]')!.hidden = true;
        return;
      }
      throw new Error("Next or another control was clicked.");
    });
    return f;
  };

  it("never starts a new Google account until the owner entered its name", async () => {
    const f = googleFixture("/v3/signin/identifier", signin);
    const state = await advanceSocialRegistration(f.page, "youtube", { accountKind: "brand" });
    expect(state).toMatchObject({
      status: "needs_fields",
      requiredFields: ["givenName", "familyName"],
      blockers: [],
      canAdvance: false,
    });
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("opens Google signup on Continue and fills only the name step", async () => {
    const f = googleFixture("/v3/signin/identifier", signin);
    const state = await advanceSocialRegistration(f.page, "youtube", owner);
    expect(f.page.goto).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({
      status: "awaiting_owner",
      filledFields: ["givenName", "familyName"],
      canAdvance: false,
    });
    expect(f.window.document.querySelector<HTMLInputElement>("#firstName")!.value).toBe("Fixture");
    expect(f.window.document.querySelector<HTMLInputElement>("#lastName")!.value).toBe("Owner");
    expect(f.click).not.toHaveBeenCalled();
  });
  it("fills day, year and the month option, leaves gender and Next to the owner", async () => {
    const f = googleFixture("/lifecycle/steps/signup/birthdaygender", birthday);
    const state = await advanceSocialRegistration(f.page, "youtube", owner);
    expect(state).toMatchObject({
      status: "awaiting_owner",
      step: "birthdate",
      filledFields: ["birthdate"],
    });
    expect(f.window.document.querySelector<HTMLInputElement>("#day")!.value).toBe("5");
    expect(f.window.document.querySelector<HTMLInputElement>("#year")!.value).toBe("1990");
    expect(
      f.window.document
        .querySelector('[role="option"][aria-selected="true"]')!
        .getAttribute("data-value"),
    ).toBe("3");
    expect(f.click).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite a different owner birth month", async () => {
    const f = googleFixture("/lifecycle/steps/signup/birthdaygender", birthday);
    f.window.document.querySelector('[data-value="9"]')!.setAttribute("aria-selected", "true");
    expect(await advanceSocialRegistration(f.page, "youtube", owner)).toMatchObject({
      status: "changed",
      step: "birthdate",
    });
    expect(f.click).not.toHaveBeenCalled();
  });
  it("fills the owner's existing email and leaves the Gmail choice, password and codes in the window", async () => {
    const email = googleFixture(
      "/lifecycle/steps/signup/emailsignup",
      `<input type="email" name="Username" id="identifierId"><button>Sonraki</button>${recaptcha}`,
    );
    expect(await advanceSocialRegistration(email.page, "youtube", owner)).toMatchObject({
      status: "awaiting_owner",
      filledFields: ["email"],
    });
    expect(email.window.document.querySelector<HTMLInputElement>("#identifierId")!.value).toBe(
      "bycoda@example.com",
    );
    const gmail = googleFixture(
      "/lifecycle/steps/signup/username",
      '<input type="radio" name="usernameRadio" value="custom"><button>Sonraki</button>',
    );
    expect(await advanceSocialRegistration(gmail.page, "youtube", owner)).toMatchObject({
      status: "awaiting_owner",
      blockers: [],
      filledFields: [],
    });
    const password = googleFixture(
      "/lifecycle/steps/signup/password",
      '<input type="password" name="Passwd">',
    );
    expect(await advanceSocialRegistration(password.page, "youtube", owner)).toMatchObject({
      status: "awaiting_owner",
      step: "password",
    });
    expect(gmail.fill).not.toHaveBeenCalled();
    expect(password.fill).not.toHaveBeenCalled();
  });
  it("still reports a visible reCAPTCHA as a challenge", async () => {
    const f = googleFixture(
      "/lifecycle/steps/signup/name",
      name.replace('style="visibility:hidden"', ""),
    );
    expect(await advanceSocialRegistration(f.page, "youtube", owner)).toMatchObject({
      status: "awaiting_owner",
      step: "challenge",
    });
    expect(f.fill).not.toHaveBeenCalled();
  });
});
