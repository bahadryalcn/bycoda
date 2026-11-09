// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AUTONOMY, type AutonomyPolicy } from "../../model/autonomy";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AUTONOMY_ACTIONS } from "./accountsModel";
import { AutonomySettings } from "./AutonomySettings";

const confirm = vi.hoisted(() => vi.fn(async (_request: unknown) => true));
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.querySelectorAll('[role="listbox"]').forEach((node) => node.remove());
  element.remove();
});

const account = { id: "a1", name: "Studio", platform: "x" } as unknown as SocialAccount;
const stored: AutonomyPolicy = {
  ...DEFAULT_AUTONOMY,
  accountId: "a1",
  updatedAt: 1,
  updatedBy: "owner",
};

function fakeClient(
  patch: { get?: ReturnType<typeof vi.fn>; request?: ReturnType<typeof vi.fn> } = {},
) {
  const get = patch.get ?? vi.fn(async () => stored);
  const request = patch.request ?? vi.fn(async () => stored);
  return { client: { autonomy: { get }, request } as unknown as SocialClient, get, request };
}

async function render(
  client: SocialClient,
  props: { disabled?: boolean; onChanged?: () => void } = {},
) {
  const onChanged = props.onChanged ?? vi.fn();
  await act(async () =>
    root.render(
      createElement(AutonomySettings, {
        client,
        account,
        disabled: props.disabled ?? false,
        onChanged,
      }),
    ),
  );
  await act(async () => undefined);
  return onChanged;
}

function button(text: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent === text);
}

function levelTrigger(action: string) {
  return element.querySelector<HTMLButtonElement>(`button[aria-label^="${action}: "]`);
}

async function chooseLevel(action: string, label: string) {
  await act(async () => levelTrigger(action)?.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes(label),
  );
  expect(option, `Missing level option: ${label}`).toBeTruthy();
  await act(async () => option?.click());
}

function typeInto(input: HTMLInputElement | undefined, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("reads the policy of this account and starts every action at Suggest only", async () => {
  const { client, get } = fakeClient();
  await render(client);
  expect(get).toHaveBeenCalledWith("a1");
  for (const label of [
    "Publishing",
    "Replies",
    "Comments",
    "Direct messages",
    "Email",
    "Outreach",
    "Audience collection",
    "Contact updates",
  ])
    expect(levelTrigger(label)?.getAttribute("aria-label")).toBe(`${label}: Suggest only`);
  expect(AUTONOMY_ACTIONS.every((action) => stored.levels[action] === "suggest")).toBe(true);
  expect(button("Save autonomy")?.disabled).toBe(true);
  expect(element.textContent).toContain("No changes to save.");
});

it("says plainly when the policy cannot be read and shows no editable levels", async () => {
  const { client } = fakeClient({
    get: vi.fn(async () => {
      throw new Error("offline");
    }),
  });
  await render(client);
  expect(element.textContent).toContain("The autonomy settings could not be read. Try again.");
  expect(levelTrigger("Publishing")).toBeNull();
  expect(button("Save autonomy")).toBeUndefined();
});

it("asks before an action becomes autonomous and leaves it at Suggest only when declined", async () => {
  confirm.mockResolvedValue(false);
  const { client, request } = fakeClient();
  await render(client);
  await chooseLevel("Replies", "Autonomous");
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(levelTrigger("Replies")?.getAttribute("aria-label")).toBe("Replies: Suggest only");
  expect(button("Save autonomy")?.disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("saves an accepted autonomous level only with the explicit ENABLE_AUTONOMY confirmation", async () => {
  const saved: AutonomyPolicy = {
    ...stored,
    version: 2,
    levels: { ...stored.levels, reply: "autonomous" },
  };
  const { client, request } = fakeClient({ request: vi.fn(async () => saved) });
  const onChanged = await render(client);
  await chooseLevel("Replies", "Autonomous");
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(levelTrigger("Replies")?.getAttribute("aria-label")).toBe("Replies: Autonomous");
  expect(request).not.toHaveBeenCalled();
  await act(async () => button("Save autonomy")?.click());
  expect(request).toHaveBeenCalledExactlyOnceWith("autonomy.set", {
    accountId: "a1",
    policy: {
      levels: { ...stored.levels, reply: "autonomous" },
      limits: DEFAULT_AUTONOMY.limits,
      workingHours: null,
    },
    confirm: "ENABLE_AUTONOMY",
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(button("Save autonomy")?.disabled).toBe(true);
});

it("does not ask and sends no autonomy confirmation when no level is autonomous", async () => {
  const saved: AutonomyPolicy = { ...stored, levels: { ...stored.levels, publish: "approve" } };
  const { client, request } = fakeClient({ request: vi.fn(async () => saved) });
  await render(client);
  await chooseLevel("Publishing", "Approve each");
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => button("Save autonomy")?.click());
  expect(request).toHaveBeenCalledTimes(1);
  const [action, input] = request.mock.calls[0] as unknown as [string, Record<string, unknown>];
  expect(action).toBe("autonomy.set");
  expect(input).not.toHaveProperty("confirm");
  expect((input.policy as { levels: Record<string, string> }).levels.publish).toBe("approve");
});

it("keeps an out-of-range daily limit from reaching the Host", async () => {
  const { client, request } = fakeClient();
  await render(client);
  typeInto(element.querySelector<HTMLInputElement>("input") ?? undefined, "1000001");
  await act(async () => button("Save autonomy")?.click());
  expect(request).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Daily limits must be whole numbers from 0 to 1000000.");
});

it("keeps invalid working hours from reaching the Host and names the problem", async () => {
  const { client, request } = fakeClient();
  await render(client);
  await act(async () => element.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
  // Eight daily-limit fields come first, then Time zone.
  const inputs = element.querySelectorAll<HTMLInputElement>("input");
  typeInto(inputs[AUTONOMY_ACTIONS.length], "Not/AZone");
  await act(async () => button("Save autonomy")?.click());
  expect(request).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Choose a valid time zone.");
});

it("sends working hours only when the owner switched them on", async () => {
  const { client, request } = fakeClient();
  await render(client);
  await act(async () => element.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
  await act(async () => button("Save autonomy")?.click());
  expect(request).toHaveBeenCalledTimes(1);
  const [, input] = request.mock.calls[0] as unknown as [
    string,
    { policy: { workingHours: unknown } },
  ];
  expect(input.policy.workingHours).toEqual({
    timeZone: expect.any(String),
    days: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "17:00",
  });
});

it("keeps the draft and shows the failure when the Host refuses the save", async () => {
  const { client } = fakeClient({
    request: vi.fn(async () => {
      throw new Error("The policy changed on another computer.");
    }),
  });
  const onChanged = await render(client);
  await chooseLevel("Comments", "Approve each");
  await act(async () => button("Save autonomy")?.click());
  expect(element.textContent).toContain("The policy changed on another computer.");
  expect(levelTrigger("Comments")?.getAttribute("aria-label")).toBe("Comments: Approve each");
  expect(onChanged).not.toHaveBeenCalled();
});

it("disables every control and says why while the Host is offline", async () => {
  const { client } = fakeClient();
  await render(client, { disabled: true });
  expect(levelTrigger("Publishing")?.disabled).toBe(true);
  expect(button("Save autonomy")?.disabled).toBe(true);
  expect(element.textContent).toContain("Connect to this computer to change this account.");
});
