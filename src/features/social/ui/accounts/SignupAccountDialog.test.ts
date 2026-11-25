// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialBrowserWorkflow } from "../../model/socialBrowser";
import type { SocialClient } from "../../model/socialClient";
import { SignupAccountDialog } from "./SignupAccountDialog";

vi.mock("../../../../shared/ui/Modal", () => ({
  Modal: (props: {
    title: string;
    closeDisabled?: boolean;
    children: ReactNode;
    footer: ReactNode;
  }) =>
    createElement(
      "div",
      { role: "dialog", "aria-label": props.title },
      createElement("button", { disabled: props.closeDisabled, "aria-label": "Close dialog" }),
      props.children,
      props.footer,
    ),
  ModalActions: (props: { children: ReactNode }) => createElement("div", null, props.children),
}));

vi.mock("../../../../shared/ui/DatePicker", () => ({
  DatePicker: (props: { label: string; max?: string }) =>
    createElement("input", { "aria-label": props.label, "data-max": props.max }),
}));

let element: HTMLDivElement, root: Root;
beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const flow = (patch: Partial<SocialBrowserWorkflow> = {}): SocialBrowserWorkflow => ({
  id: "w1",
  accountId: "acc-1",
  platform: "reddit",
  intent: "signup",
  status: "awaiting_owner",
  createdAt: 1,
  updatedAt: 10,
  expiresAt: 99,
  outcome: "unverified",
  registration: {
    status: "needs_fields",
    step: "profile",
    blockers: ["verification", "challenge"],
    requiredFields: ["email", "username"],
    filledFields: [],
    canAdvance: false,
    message: "",
  },
  ...patch,
});

function setup(begin: SocialBrowserWorkflow = flow(), existingAccountId?: string) {
  const client = {
    request: vi.fn(async () => ({ id: "acc-1" })),
    browserWorkflowBegin: vi.fn(async () => begin),
    browserRegistrationAdvance: vi.fn(async () => flow({ updatedAt: 11 })),
    browserWorkflowStatus: vi.fn(async () => ({ available: true, reason: "", workflows: [] })),
    browserWorkflowCancel: vi.fn(async () => undefined),
  };
  const onClose = vi.fn();
  const onCreated = vi.fn();
  act(() =>
    root.render(
      createElement(SignupAccountDialog, {
        client: client as unknown as SocialClient,
        platform: begin.platform,
        accountType: "member",
        initialName: "Launch",
        projectIds: ["p1"],
        existingAccountId,
        onClose,
        onCreated,
      }),
    ),
  );
  return { client, onClose, onCreated };
}

const button = (text: string) =>
  [...element.querySelectorAll("button")].find((node) => node.textContent === text);
const field = (label: string) => {
  const found = [...element.querySelectorAll("label")].find((node) =>
    node.textContent?.trim().startsWith(label),
  );
  return document.getElementById(found?.htmlFor ?? "") as HTMLInputElement;
};
function type(label: string, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field(label), value);
    field(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () =>
  act(async () => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

it.each([
  ["reddit", "rate_limit", "Reddit reached its email sign-up limit. Try again later."],
  [
    "reddit",
    "network_blocked",
    "Reddit blocked browser access for network security. Try again later.",
  ],
  ["tiktok", "rate_limit", "TikTok reached its sign-up attempt limit. Try again later."],
] as const)(
  "shows %s's %s warning and keeps the stop action available",
  async (platform, step, message) => {
    const { client } = setup(
      flow({
        platform,
        registration: {
          status: "awaiting_owner",
          step,
          blockers: [],
          requiredFields: [],
          filledFields: ["email"],
          canAdvance: false,
          message,
        },
      }),
    );
    await submit();
    expect(element.querySelector('[role="status"][data-tone="warning"]')?.textContent).toBe(
      message,
    );
    expect(element.textContent).not.toContain("Waiting for you");
    expect(button("Continue")).toBeUndefined();
    expect(button("Stop signup")?.disabled).toBe(false);
    expect(client.browserRegistrationAdvance).not.toHaveBeenCalled();
  },
);

it("creates the browser account, opens signup without secrets and shows the owner steps", async () => {
  const { client } = setup();
  await submit();
  expect(client.request).toHaveBeenCalledExactlyOnceWith("accounts.create", {
    platform: "reddit",
    name: "Launch",
    accountType: "member",
    connection: "browser",
    projectIds: ["p1"],
  });
  expect(client.browserWorkflowBegin).toHaveBeenCalledWith("acc-1", "signup", undefined, {
    accountKind: "person",
  });
  expect(element.textContent).toContain("Waiting for you");
  expect(element.textContent).toContain("Enter the verification code");
  expect(element.textContent).toContain("Solve the security check");
  expect(element.querySelector('input[type="password"]')).toBeNull();
  expect(element.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')?.disabled).toBe(
    true,
  );
  expect(button("Stop signup")?.disabled).toBe(false);
});

it("collects only the required fields, keeps the draft and advances with them", async () => {
  const { client } = setup();
  await submit();
  expect(field("Email address")).toBeTruthy();
  expect(field("Username")).toBeTruthy();
  expect(button("Continue")?.getAttribute("aria-disabled")).toBe("true");
  type("Email address", "ada@example.com");
  type("Username", "ada_l");
  expect(field("Email address").value).toBe("ada@example.com");
  await act(async () => button("Continue")?.click());
  expect(client.browserRegistrationAdvance).toHaveBeenCalledWith("acc-1", "w1", 10, {
    accountKind: "person",
    email: "ada@example.com",
    username: "ada_l",
  });
});

it("shows the next action in the platform window without opening Details", async () => {
  const message = "Choose a sign-up method in X, then select Continue here.";
  setup(
    flow({
      platform: "x",
      registration: {
        status: "awaiting_owner",
        step: "method",
        blockers: [],
        requiredFields: [],
        filledFields: [],
        canAdvance: false,
        message,
      },
    }),
  );
  await submit();
  expect(element.textContent).toContain(message);
  expect(button("Continue")?.disabled).toBe(false);
});

it("names only the observed provider action when the Host reports verification", async () => {
  const { client } = setup(
    flow({
      registration: {
        status: "awaiting_owner",
        step: "verification",
        blockers: ["verification"],
        requiredFields: [],
        filledFields: ["email"],
        canAdvance: false,
        message:
          "This step requires a password, verification or agreement action in the platform window. Resume afterwards; registration remains unverified.",
      },
    }),
  );
  await submit();
  expect(element.textContent).toContain(
    "Complete the steps below in the platform window. Then select Continue here.",
  );
  expect(element.textContent).toContain("Enter the verification code");
  expect(element.textContent).not.toMatch(/password|agreement|Accept the terms/i);
  expect(button("Continue")?.disabled).toBe(false);
  expect(client.browserRegistrationAdvance).not.toHaveBeenCalled();
});

it("hands over to the account sign-in once the window is closed", async () => {
  const { onCreated } = setup(flow({ status: "window_closed" }));
  await submit();
  await act(async () => button("Continue to sign-in")?.click());
  expect(onCreated).toHaveBeenCalledExactlyOnceWith("acc-1");
});

it("cancels a live window before leaving for the account", async () => {
  const { client, onCreated } = setup();
  await submit();
  await act(async () => button("Stop signup")?.click());
  expect(client.browserWorkflowCancel).toHaveBeenCalledWith("acc-1");
  expect(onCreated).toHaveBeenCalledWith("acc-1");
});

it("reuses the created record when starting again after an expired window", async () => {
  const { client } = setup(flow({ status: "expired" }));
  await submit();
  expect(element.textContent).toContain("Expired");
  await submit();
  expect(client.request).toHaveBeenCalledTimes(1);
  expect(client.browserWorkflowBegin).toHaveBeenCalledTimes(2);
});

it("shows the Host failure and keeps the name when signup cannot start", async () => {
  const { client, onCreated } = setup();
  client.browserWorkflowBegin.mockRejectedValueOnce(new Error("Chrome or Edge is unavailable."));
  await submit();
  const alert = element.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("The signup could not be started. Try again.");
  expect(document.body.textContent).not.toContain("Chrome or Edge is unavailable.");
  act(() => alert?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click());
  expect(document.body.querySelector('[aria-label="Error details"]')?.textContent).toBe(
    "Chrome or Edge is unavailable.",
  );
  expect(field("Name").value).toBe("Launch");
  expect(onCreated).not.toHaveBeenCalled();
});

it("opens signup for an account the Host already created without creating another", async () => {
  const { client } = setup(flow(), "acc-9");
  expect(field("Name")).toBeNull();
  await submit();
  expect(client.request).not.toHaveBeenCalled();
  expect(client.browserWorkflowBegin).toHaveBeenCalledWith(
    "acc-9",
    "signup",
    undefined,
    expect.anything(),
  );
});

// Regression for #569: the birth date ceiling is the owner's local calendar day, not the UTC day,
// so it holds in both directions from UTC (east after local midnight, west in the evening).
const birthdateMax = async (local: Date) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(local);
  try {
    setup(
      {
        ...flow(),
        registration: { ...flow().registration!, requiredFields: ["birthdate"], blockers: [] },
      },
      "acc-9",
    );
    await submit();
    return element.querySelector("input[data-max]")?.getAttribute("data-max");
  } finally {
    vi.useRealTimers();
  }
};

it("bounds the birth date by the owner's local day just after local midnight", async () => {
  expect(await birthdateMax(new Date(2026, 10, 19, 0, 30))).toBe("2026-11-19");
});

it("bounds the birth date by the owner's local day late in the local evening", async () => {
  expect(await birthdateMax(new Date(2026, 10, 19, 23, 30))).toBe("2026-11-19");
});
