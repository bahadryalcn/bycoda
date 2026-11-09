// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialPolicies } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { CharacterLimits } from "./CharacterLimits";

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

const policies: SocialPolicies = {
  global: { agent: { provider: "claude", model: "m" }, maxContentCharacters: 280 },
  platforms: {},
};

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function render(request: ReturnType<typeof vi.fn>) {
  const client = { request } as unknown as SocialClient;
  act(() => root.render(createElement(CharacterLimits, { client, policies, onChanged: vi.fn() })));
}

it("refuses an out-of-range limit locally and sends nothing", () => {
  const request = vi.fn(async () => ({}));
  render(request);
  const inputs = element.querySelectorAll<HTMLInputElement>("input");
  act(() => typeInto(inputs[1]!, "0"));
  act(() => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(request).not.toHaveBeenCalled();
  expect(element.textContent).toContain(
    "Character limits must be whole numbers between 1 and 20000; omit to inherit.",
  );
});

it("saves through the reviewed path and keeps the agent that is already set", async () => {
  const request = vi.fn(async () => policies);
  render(request);
  const inputs = element.querySelectorAll<HTMLInputElement>("input");
  act(() => typeInto(inputs[1]!, "500"));
  await act(async () => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(request).toHaveBeenCalledTimes(1);
  const [action, input] = request.mock.calls[0] as unknown as [string, Record<string, unknown>];
  expect(action).toBe("policy.saveReviewed");
  expect(input.confirm).toBe("UPDATE_SOCIAL_POLICY");
  expect(input.expectedPolicies).toEqual(policies);
  expect(input.policies).toEqual({
    global: {
      agent: { provider: "claude", model: "m" },
      maxContentCharacters: 280,
      maxCommentCharacters: 500,
    },
    platforms: {},
  });
});

const scoped: SocialPolicies = {
  global: {
    agent: { provider: "claude", model: "m" },
    maxContentCharacters: 500,
    maxCommentCharacters: 120,
    maxMessageCharacters: 300,
  },
  platforms: { youtube: { maxCommentCharacters: 90 } },
};

function mount(
  request: ReturnType<typeof vi.fn>,
  policiesValue: SocialPolicies,
  onChanged = vi.fn(),
) {
  const client = { request } as unknown as SocialClient;
  act(() =>
    root.render(createElement(CharacterLimits, { client, policies: policiesValue, onChanged })),
  );
  return onChanged;
}

const inputs = () => element.querySelectorAll<HTMLInputElement>("input");
const submit = () =>
  act(async () => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

async function chooseScope(label: string) {
  await act(async () =>
    element.querySelector<HTMLButtonElement>('button[aria-label^="Apply to: "]')?.click(),
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes(label),
  );
  expect(option, `Missing scope: ${label}`).toBeTruthy();
  await act(async () => option?.click());
}

it("shows the stored platform value and the inherited values of the other limits", async () => {
  mount(vi.fn(), scoped);
  expect(inputs()[1]?.value).toBe("120");
  await chooseScope("YouTube");
  expect(inputs()[1]?.value).toBe("90");
  expect(inputs()[0]?.value).toBe("");
  expect(inputs()[0]?.placeholder).toBe("500");
  expect(inputs()[2]?.placeholder).toBe("300");
});

it("saves a platform override without touching the global policy", async () => {
  const request = vi.fn(async () => scoped);
  const onChanged = mount(request, scoped);
  await chooseScope("YouTube");
  act(() => typeInto(inputs()[1]!, "80"));
  await submit();
  expect(request).toHaveBeenCalledExactlyOnceWith("policy.saveReviewed", {
    policies: { ...scoped, platforms: { youtube: { maxCommentCharacters: 80 } } },
    expectedPolicies: scoped,
    confirm: "UPDATE_SOCIAL_POLICY",
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("clearing the last platform override inherits the global values instead of saving zero or a copy", async () => {
  const request = vi.fn(async () => scoped);
  mount(request, scoped);
  await chooseScope("YouTube");
  act(() => typeInto(inputs()[1]!, ""));
  await submit();
  expect(request).toHaveBeenCalledExactlyOnceWith("policy.saveReviewed", {
    policies: { global: scoped.global, platforms: {} },
    expectedPolicies: scoped,
    confirm: "UPDATE_SOCIAL_POLICY",
  });
});

it("refuses fractional, oversized and non-numeric limits without sending anything", async () => {
  const request = vi.fn(async () => scoped);
  mount(request, scoped);
  for (const [value, message] of [
    ["1.5", "Enter a whole number."],
    ["abc", "Enter a whole number."],
    ["20001", "between 1 and 20000"],
  ] as const) {
    act(() => typeInto(inputs()[0]!, value));
    await submit();
    expect(element.textContent).toContain(message);
  }
  expect(request).not.toHaveBeenCalled();
});

it("sends one save for a double submit and refreshes once", async () => {
  let finish!: (value: SocialPolicies) => void;
  const request = vi.fn(
    () =>
      new Promise<SocialPolicies>((resolve) => {
        finish = resolve;
      }),
  );
  const onChanged = mount(request, scoped);
  act(() => typeInto(inputs()[2]!, "222"));
  await submit();
  await submit();
  expect(request).toHaveBeenCalledTimes(1);
  expect(onChanged).not.toHaveBeenCalled();
  await act(async () => finish(scoped));
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("keeps the edited values after a failed save and sends them again on retry", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("The Host is offline."))
    .mockResolvedValueOnce(scoped);
  const onChanged = mount(request, scoped);
  act(() => typeInto(inputs()[2]!, "222"));
  await submit();
  expect(element.textContent).toContain("The Host is offline.");
  expect(inputs()[2]?.value).toBe("222");
  expect(onChanged).not.toHaveBeenCalled();
  await submit();
  expect(request).toHaveBeenCalledTimes(2);
  const [, retried] = request.mock.calls[1] as unknown as [string, { policies: SocialPolicies }];
  expect(retried.policies.global.maxMessageCharacters).toBe(222);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("leaves an unset agent unset when an unrelated limit is saved", async () => {
  const noAgent: SocialPolicies = { global: { maxContentCharacters: 280 }, platforms: {} };
  const request = vi.fn(async () => noAgent);
  mount(request, noAgent);
  act(() => typeInto(inputs()[2]!, "250"));
  await submit();
  expect(request).toHaveBeenCalledExactlyOnceWith("policy.saveReviewed", {
    policies: { global: { maxContentCharacters: 280, maxMessageCharacters: 250 }, platforms: {} },
    expectedPolicies: noAgent,
    confirm: "UPDATE_SOCIAL_POLICY",
  });
});

it("follows the saved limits when the shown scope has no edits", () => {
  const request = vi.fn();
  mount(request, scoped);
  expect(inputs()[1]?.value).toBe("120");
  mount(request, { ...scoped, global: { ...scoped.global, maxCommentCharacters: 70 } });
  expect(inputs()[1]?.value).toBe("70");
});

it("keeps an unsaved edit when only another platform's policy changes", () => {
  const request = vi.fn();
  mount(request, scoped);
  act(() => typeInto(inputs()[2]!, "222"));
  mount(request, {
    ...scoped,
    platforms: { ...scoped.platforms, x: { maxContentCharacters: 90 } },
  });
  expect(inputs()[2]?.value).toBe("222");
});

it("keeps an unsaved edit when the shown scope's saved limits change", () => {
  const request = vi.fn();
  mount(request, scoped);
  act(() => typeInto(inputs()[2]!, "222"));
  mount(request, { ...scoped, global: { ...scoped.global, maxCommentCharacters: 70 } });
  expect(inputs()[2]?.value).toBe("222");
});
