// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import type { SocialBrowserWorkflow } from "../model/socialBrowser";
import { SocialBrowserWorkspace } from "./SocialBrowserWorkspace";
import { SocialPanelActiveContext } from "./socialContext";

const status = vi.fn(),
  begin = vi.fn(),
  cancel = vi.fn(),
  advance = vi.fn(),
  finalReview = vi.fn(),
  finalSubmit = vi.fn(),
  reconcile = vi.fn(),
  monitoring = vi.fn();
const client = {
  browserWorkflowStatus: status,
  browserWorkflowBegin: begin,
  browserWorkflowCancel: cancel,
  browserRegistrationAdvance: advance,
  browserRegistrationReview: finalReview,
  browserRegistrationSubmit: finalSubmit,
  browserRegistrationReconcile: reconcile,
  monitoringStatus: monitoring,
} as unknown as SocialClient;
const Component = withQueryClient(SocialBrowserWorkspace);
let element: HTMLDivElement, root: Root;
const account = { id: "tiktok", platform: "tiktok" } as SocialAccount;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status.mockReset().mockResolvedValue({ available: true, reason: "Ready", workflows: [] });
  begin.mockReset().mockResolvedValue({ status: "awaiting_owner" });
  cancel.mockReset().mockResolvedValue(undefined);
  advance.mockReset().mockResolvedValue({ status: "awaiting_owner" });
  finalReview.mockReset();
  finalSubmit.mockReset();
  reconcile.mockReset().mockResolvedValue(undefined);
  monitoring.mockReset().mockResolvedValue({ status: "idle", pollingEnabled: false });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )!;
it("offers Page branding only for a connected LinkedIn browser organization", async () => {
  const page = {
    ...account,
    id: "page",
    platform: "linkedin",
    accountType: "organization",
    connection: "browser",
    connected: true,
  } as SocialAccount;
  await act(async () => root.render(createElement(Component, { account: page, client })));
  expect(element.textContent).toContain("LinkedIn Page profile");
  await act(async () =>
    root.render(createElement(Component, { account: { ...page, accountType: "member" }, client })),
  );
  expect(element.textContent).not.toContain("LinkedIn Page profile");
  await act(async () =>
    root.render(createElement(Component, { account: { ...page, connection: "api" }, client })),
  );
  expect(element.textContent).not.toContain("LinkedIn Page profile");
});
it("offers Facebook logo management only for a connected browser Page", async () => {
  const page = {
    ...account,
    id: "fb-page",
    platform: "facebook",
    accountType: "page",
    connection: "browser",
    connected: true,
  } as SocialAccount;
  await act(async () => root.render(createElement(Component, { account: page, client })));
  expect(element.textContent).toContain("Facebook Page profile image");
  for (const unsupported of [
    { ...page, accountType: "member" },
    { ...page, connection: "api" },
    { ...page, connected: false },
  ] as SocialAccount[]) {
    await act(async () => root.render(createElement(Component, { account: unsupported, client })));
    expect(element.textContent).not.toContain("Facebook Page profile image");
  }
});
it("shows the specific encrypted Chat setup blocker", async () => {
  monitoring.mockResolvedValue({
    status: "partial",
    pollingEnabled: true,
    accountActive: true,
    coverage: [{ channel: "messages", status: "unavailable", reason: "chat_setup_required" }],
  });
  await act(async () =>
    root.render(
      createElement(Component, {
        account: { ...account, platform: "x", connected: true },
        client,
      }),
    ),
  );
  await open();
  expect(element.textContent).toContain("access code setup");
});
async function open() {
  const details = element.querySelector("details")!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}
it("loads on disclosure, requires owner acknowledgement and tracks signup separately from connection", async () => {
  await act(async () => root.render(createElement(Component, { account, client })));
  expect(status).not.toHaveBeenCalled();
  await open();
  expect(status).toHaveBeenCalledWith("tiktok");
  expect(button("Open in browser").disabled).toBe(true);
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click(),
  );
  const signup = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (item) => item.textContent === "Sign up",
  )!;
  await act(async () => signup.click());
  expect(element.textContent).toContain("pauses at password");
  const acknowledgement = [...element.querySelectorAll("label")]
    .find((label) => label.textContent?.includes("Open a separate browser profile"))!
    .querySelector<HTMLInputElement>("input")!;
  await act(async () => acknowledgement.click());
  await act(async () => button("Open in browser").click());
  expect(begin).toHaveBeenCalledExactlyOnceWith("tiktok", "signup", undefined, {
    accountKind: "brand",
  });
  expect(element.textContent).not.toContain("hesap bağlandı");
});
it("shows interrupted work and gives an explicit retry without relaunching it", async () => {
  status.mockResolvedValue({
    available: true,
    workflows: [{ id: "old", intent: "signup", status: "interrupted" }],
  });
  await act(async () => root.render(createElement(Component, { account, client })));
  await open();
  expect(element.textContent).toContain("The host restarted; open it again");
  expect(begin).not.toHaveBeenCalled();
});
it("prevents another window while work is active and allows cancellation", async () => {
  status.mockResolvedValue({
    available: true,
    workflows: [{ id: "active", intent: "login", status: "awaiting_owner" }],
  });
  await act(async () => root.render(createElement(Component, { account, client })));
  await open();
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("Open in browser").disabled).toBe(true);
  await act(async () => button("Cancel action").click());
  expect(cancel).toHaveBeenCalledExactlyOnceWith("tiktok");
});
it("disables reads when the panel is inactive and exposes read failures with retry", async () => {
  const render = (active: boolean) =>
    createElement(
      SocialPanelActiveContext.Provider,
      { value: active },
      createElement(Component, { account, client }),
    );
  await act(async () => root.render(render(false)));
  await open();
  expect(status).not.toHaveBeenCalled();
  status.mockRejectedValue(new Error("Unavailable"));
  await act(async () => root.render(render(true)));
  expect(element.querySelector('[role="alert"]')?.textContent).toContain("host version");
  status.mockResolvedValue({ available: true, workflows: [] });
  await act(async () => button("Refresh status").click());
  expect(element.querySelector('[role="alert"]')).toBeNull();
});
it("distinguishes disabled polling from successful historical reads and refreshes partial channel status", async () => {
  monitoring.mockResolvedValue({ status: "healthy", pollingEnabled: false, accountActive: true });
  await act(async () =>
    root.render(createElement(Component, { account: { ...account, connected: true }, client })),
  );
  await open();
  expect(element.textContent).toContain("Off");
  expect(element.textContent).not.toContain("Last check succeeded");
  monitoring.mockResolvedValue({ status: "partial", pollingEnabled: true, accountActive: true });
  await act(async () => button("Refresh status").click());
  expect(element.textContent).toContain("some channels could not be read");
});
it("continues the exact active registration with only nonsecret profile fields", async () => {
  status.mockResolvedValue({
    available: true,
    workflows: [
      {
        id: "registration-1",
        accountId: account.id,
        intent: "signup",
        status: "awaiting_owner",
        updatedAt: 123,
        registration: {
          status: "awaiting_owner",
          step: "password",
          blockers: ["password", "verification"],
          requiredFields: ["birthdate"],
          filledFields: ["email"],
          canAdvance: false,
          message: "Complete the password and verification steps in the platform window.",
        },
      },
    ],
  });
  await act(async () => root.render(createElement(Component, { account, client })));
  await open();
  expect(element.textContent).toContain("Registration details");
  expect(element.querySelector('input[type="password"]')).toBeNull();
  const email = element.querySelector<HTMLInputElement>('input[type="email"]')!;
  const birthdate = element.querySelector<HTMLInputElement>('input[type="date"]')!;
  await act(async () => {
    for (const [field, value] of [
      [email, "fixture@example.com"],
      [birthdate, "1990-01-02"],
    ] as const) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => button("Continue registration automation").click());
  expect(advance).toHaveBeenCalledExactlyOnceWith("tiktok", "registration-1", 123, {
    accountKind: "brand",
    email: "fixture@example.com",
    birthdate: "1990-01-02",
  });
  expect(begin).not.toHaveBeenCalled();
});
it("clears registration details when the selected account changes", async () => {
  const active = {
    id: "registration-1",
    intent: "signup",
    status: "awaiting_owner",
    updatedAt: 123,
    registration: { message: "Waiting for fields" },
  };
  status.mockResolvedValue({ available: true, workflows: [active] });
  await act(async () => root.render(createElement(Component, { account, client })));
  await open();
  const email = element.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      email,
      "fixture@example.com",
    );
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(email.value).toBe("fixture@example.com");
  await act(async () =>
    root.render(createElement(Component, { account: { ...account, id: "other" }, client })),
  );
  expect(element.querySelector<HTMLInputElement>('input[type="email"]')?.value ?? "").toBe("");
  expect(advance).not.toHaveBeenCalled();
});

it("prepares and continues the exact LinkedIn Page profile and clears its public fields when accounts change", async () => {
  const linkedIn = { ...account, id: "linkedin-brand", platform: "linkedin" } as SocialAccount;
  let started = false;
  const active = {
    id: "linkedin-page-registration",
    accountId: linkedIn.id,
    intent: "signup",
    status: "awaiting_owner",
    updatedAt: 456,
    registration: { message: "Page fields prepared; final creation remains unverified." },
  };
  status.mockImplementation(async (id: string) => ({
    available: true,
    workflows: started && id === linkedIn.id ? [active] : [],
  }));
  begin.mockImplementation(async () => {
    started = true;
    return active;
  });
  await act(async () => root.render(createElement(Component, { account: linkedIn, client })));
  await open();
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click(),
  );
  await act(async () =>
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((item) => item.textContent === "Sign up")!
      .click(),
  );
  const field = (label: string) => {
    const item = [...element.querySelectorAll<HTMLLabelElement>("label")].find(
      (item) => item.textContent?.trim() === label,
    )!;
    return element.querySelector<HTMLInputElement>(`#${CSS.escape(item.htmlFor)}`)!;
  };
  const fill = async (label: string, value: string) => {
    await act(async () => {
      const input = field(label);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await fill("Registration email", "brand@example.test");
  await fill("Page name", "Bycoda");
  await fill("Username", "bycodaofficial");
  await fill("Page category", "Software Development");
  const acknowledgement = [...element.querySelectorAll("label")]
    .find((label) => label.textContent?.includes("Open a separate browser profile"))!
    .querySelector<HTMLInputElement>("input")!;
  await act(async () => acknowledgement.click());
  await act(async () => button("Open in browser").click());
  expect(begin).toHaveBeenCalledExactlyOnceWith(linkedIn.id, "signup", undefined, {
    accountKind: "brand",
    email: "brand@example.test",
    displayName: "Bycoda",
    username: "bycodaofficial",
    category: "Software Development",
  });
  await fill("Page name", "Bycoda Software");
  await fill("Username", "bycoda");
  await act(async () => button("Continue registration automation").click());
  expect(advance).toHaveBeenCalledExactlyOnceWith(linkedIn.id, active.id, 456, {
    accountKind: "brand",
    email: "brand@example.test",
    displayName: "Bycoda Software",
    username: "bycoda",
    category: "Software Development",
  });
  expect(
    element.querySelector('input[type="password"],input[autocomplete="one-time-code"]'),
  ).toBeNull();
  await act(async () =>
    root.render(
      createElement(Component, { account: { ...linkedIn, id: "linkedin-other" }, client }),
    ),
  );
  for (const label of ["Registration email", "Page name", "Username", "Page category"])
    expect(field(label).value).toBe("");
  expect(button("Open in browser").disabled).toBe(true);
  expect(advance).toHaveBeenCalledOnce();
});

it("offers mobile setup guidance instead of a non-working WhatsApp registration", async () => {
  await act(async () =>
    root.render(
      createElement(Component, { account: { ...account, platform: "whatsapp" }, client }),
    ),
  );
  await open();
  expect(element.textContent).toContain("mobile app");
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click(),
  );
  expect(
    [...document.body.querySelectorAll('[role="option"]')].some(
      (item) => item.textContent === "Sign up",
    ),
  ).toBe(false);
});

it("keeps a retained unresolved Page attempt recoverable even when newer login history is first", async () => {
  const page = {
    ...account,
    id: "page",
    platform: "linkedin",
    accountType: "organization",
    connection: "browser",
    connected: false,
  } as SocialAccount;
  const retained: SocialBrowserWorkflow = {
    id: "held-page-attempt",
    accountId: "page",
    platform: "linkedin",
    intent: "signup",
    status: "interrupted",
    outcome: "unverified",
    createdAt: 1,
    updatedAt: 5,
    expiresAt: 2,
    registrationSubmission: {
      id: "held-submission",
      state: "unknown",
      attemptedAt: 2,
      expectedResourceDigest: "b".repeat(64),
    },
  };
  const recent: SocialBrowserWorkflow = {
    ...retained,
    id: "recent-login",
    intent: "login",
    status: "awaiting_owner",
    createdAt: 40,
    updatedAt: 40,
    expiresAt: Date.now() + 100000,
    registrationSubmission: undefined,
  };
  const history = Array.from({ length: 20 }, (_, index): SocialBrowserWorkflow => ({
    ...recent,
    id: `older-login-${index}`,
    status: "window_closed",
    createdAt: 39 - index,
    updatedAt: 39 - index,
  }));
  status.mockResolvedValue({
    available: true,
    reason: "Ready",
    workflows: [recent, ...history, retained],
  });
  await act(async () => root.render(createElement(Component, { account: page, client })));
  await open();
  expect(element.textContent).toContain("automatic resubmission is held");
  expect(button("Review final Page creation")).toBeUndefined();
  expect(button("Create Page")).toBeUndefined();
  const input = element.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "145372363",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Verify existing Page").click());
  expect(reconcile).toHaveBeenCalledExactlyOnceWith("page", "held-page-attempt", 5, "145372363");
  expect(finalReview).not.toHaveBeenCalled();
  expect(finalSubmit).not.toHaveBeenCalled();
  expect(begin).not.toHaveBeenCalled();
  expect(advance).not.toHaveBeenCalled();
});
it("does not replace an older legacy unknown Page hold with new creation controls after a newer login", async () => {
  const page = {
    ...account,
    id: "page",
    platform: "linkedin",
    accountType: "organization",
    connection: "browser",
    connected: false,
  } as SocialAccount;
  const held: SocialBrowserWorkflow = {
    id: "legacy-attempt",
    accountId: "page",
    platform: "linkedin",
    intent: "signup",
    status: "interrupted",
    outcome: "unverified",
    createdAt: 1,
    updatedAt: 5,
    expiresAt: 2,
    registrationSubmission: { id: "old-submission", state: "unknown", attemptedAt: 2 },
  };
  status.mockResolvedValue({
    available: true,
    reason: "Ready",
    workflows: [
      {
        ...held,
        id: "new-login",
        intent: "login",
        status: "window_closed",
        registrationSubmission: undefined,
      },
      held,
    ],
  });
  await act(async () => root.render(createElement(Component, { account: page, client })));
  await open();
  expect(element.textContent).toContain("automatic resubmission is held");
  expect(button("Verify existing Page")).toBeUndefined();
  expect(button("Review final Page creation")).toBeUndefined();
  expect(finalReview).not.toHaveBeenCalled();
  expect(finalSubmit).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
});
