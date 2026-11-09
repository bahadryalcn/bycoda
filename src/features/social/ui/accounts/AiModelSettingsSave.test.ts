// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialPolicies } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AiModelSettings } from "./AiModelSettings";

// The app's model picker has its own tests; this stand-in only reports the owner's choices.
vi.mock("../../../sessions/public/ModelPicker", async () => {
  const { createElement: h } = await import("react");
  return {
    ModelPicker: (props: {
      harness: string;
      model: string;
      allowedHarnesses?: readonly string[];
      inheritChoice?: { label: string; selected: boolean; onSelect: () => void };
      onChange: (harness: string, model: string) => void;
    }) =>
      h(
        "div",
        { "data-model-picker": "" },
        h(
          "select",
          {
            "aria-label": "agent",
            value: props.inheritChoice?.selected ? "" : props.harness,
            onChange: (event: { target: { value: string } }) =>
              event.target.value
                ? props.onChange(event.target.value, "")
                : props.inheritChoice?.onSelect(),
          },
          h("option", { value: "" }, props.inheritChoice?.label),
          (props.allowedHarnesses ?? []).map((id) => h("option", { key: id, value: id }, id)),
        ),
        h("input", {
          "aria-label": "model",
          value: props.model,
          onChange: (event: { target: { value: string } }) =>
            props.onChange(props.harness, event.target.value),
        }),
      ),
  };
});

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.querySelectorAll('[role="listbox"]').forEach((node) => node.remove());
  element.remove();
});

const policies: SocialPolicies = {
  global: {
    agent: { provider: "antigravity", model: "owner-model" },
    maxContentCharacters: 500,
    maxCommentCharacters: 120,
  },
  platforms: {
    youtube: { agent: { provider: "codex", model: "yt-model" }, maxCommentCharacters: 90 },
  },
};

function mount(request: ReturnType<typeof vi.fn>, value: SocialPolicies = policies) {
  const onChanged = vi.fn();
  act(() =>
    root.render(
      createElement(AiModelSettings, {
        client: { request } as unknown as SocialClient,
        policies: value,
        onChanged,
      }),
    ),
  );
  return onChanged;
}

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

const agent = () => element.querySelector<HTMLSelectElement>('select[aria-label="agent"]')!;
const model = () => element.querySelector<HTMLInputElement>('input[aria-label="model"]')!;

async function pickAgent(value: string) {
  await act(async () => {
    agent().value = value;
    agent().dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("saves a platform's own model through the reviewed path and leaves the global model alone", async () => {
  const request = vi.fn(async () => policies);
  const onChanged = mount(request);
  await chooseScope("X");
  await pickAgent("codex");
  expect(request).toHaveBeenCalledExactlyOnceWith("policy.saveReviewed", {
    policies: {
      ...policies,
      platforms: { ...policies.platforms, x: { agent: { provider: "codex" } } },
    },
    expectedPolicies: policies,
    confirm: "UPDATE_SOCIAL_POLICY",
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("lets a platform follow the all-accounts model again without losing its other settings", async () => {
  const request = vi.fn(async () => policies);
  mount(request);
  await chooseScope("YouTube");
  expect(agent().value).toBe("codex");
  await pickAgent("");
  expect(request).toHaveBeenCalledExactlyOnceWith("policy.saveReviewed", {
    policies: { ...policies, platforms: { youtube: { maxCommentCharacters: 90 } } },
    expectedPolicies: policies,
    confirm: "UPDATE_SOCIAL_POLICY",
  });
});

it("removes a platform override completely when the model was its only setting", async () => {
  const only: SocialPolicies = {
    global: policies.global,
    platforms: { x: { agent: { provider: "codex", model: "x-model" } } },
  };
  const request = vi.fn(async () => only);
  mount(request, only);
  await chooseScope("X");
  await pickAgent("");
  const [, input] = request.mock.calls[0] as unknown as [string, { policies: SocialPolicies }];
  expect(input.policies.platforms).toEqual({});
  expect(input.policies.global).toEqual(policies.global);
});

it("names the model and keeps the limits when the all-accounts model is cleared", async () => {
  const request = vi.fn(async () => policies);
  mount(request);
  expect(model().value).toBe("owner-model");
  await pickAgent("");
  const [, input] = request.mock.calls[0] as unknown as [string, { policies: SocialPolicies }];
  expect(input.policies.global).toEqual({ maxContentCharacters: 500, maxCommentCharacters: 120 });
  expect(input.policies.platforms).toEqual(policies.platforms);
});

it("shows the failure and does not refresh when the Host refuses the model", async () => {
  const request = vi.fn(async () => {
    throw new Error("The settings changed on another computer.");
  });
  const onChanged = mount(request);
  await chooseScope("X");
  await pickAgent("codex");
  expect(element.textContent).toContain("The settings changed on another computer.");
  expect(onChanged).not.toHaveBeenCalled();
});

it("says a platform with no model of its own uses the all-accounts one", async () => {
  mount(vi.fn());
  await chooseScope("X");
  expect(element.textContent).toContain("AI uses this model to write replies, plans and reports.");
  expect(agent().value).toBe("");
  expect(element.textContent).toContain("Use the all-accounts model");
});

it("saves an explicit model name for the chosen agent in a platform scope", async () => {
  const request = vi.fn(async () => policies);
  mount(request);
  await chooseScope("X");
  await act(async () => {
    const input = model();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "explicit-model",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(request).toHaveBeenCalledTimes(1);
  const [action, input] = request.mock.calls[0] as unknown as [
    string,
    { policies: SocialPolicies },
  ];
  expect(action).toBe("policy.saveReviewed");
  expect(input.policies.platforms.x?.agent?.model).toBe("explicit-model");
  expect(input.policies.global).toEqual(policies.global);
});
