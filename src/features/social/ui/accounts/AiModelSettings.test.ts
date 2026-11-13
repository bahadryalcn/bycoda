// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialPolicies } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AiModelSettings } from "./AiModelSettings";

const picker = vi.hoisted(() => ({
  props: {} as {
    onSettingsChange?: (settings: Record<string, string>) => void;
    onChange?: (harness: string, model: string, accountId?: string) => void;
    values?: Record<string, string>;
    accountId?: string;
  },
}));

// The app's model picker has its own tests; here only the inherit choice and the saved agent matter.
vi.mock("../../../sessions/public/ModelPicker", () => ({
  ModelPicker: (
    props: typeof picker.props & { inheritChoice?: { label: string; selected: boolean } },
  ) => {
    picker.props = props;
    return createElement(
      "div",
      { "data-testid": "model-picker" },
      props.inheritChoice?.label ?? "no-inherit",
    );
  },
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

it("asks for a model and does not offer Do not use AI when no agent is set", () => {
  const policies: SocialPolicies = { global: {}, platforms: {} };
  act(() =>
    root.render(
      createElement(AiModelSettings, {
        client: { request: vi.fn() } as unknown as SocialClient,
        policies,
        onChanged: vi.fn(),
      }),
    ),
  );
  expect(element.querySelector('[data-testid="model-picker"]')?.textContent).toBe("Choose a model");
  expect(element.textContent).not.toContain("Do not use AI");
  expect(element.textContent).toContain("AI cannot write replies or plans until you do.");
});

it("explains what the saved agent does when one is set", () => {
  const policies: SocialPolicies = {
    global: { agent: { provider: "claude", model: "m" } },
    platforms: {},
  };
  act(() =>
    root.render(
      createElement(AiModelSettings, {
        client: { request: vi.fn() } as unknown as SocialClient,
        policies,
        onChanged: vi.fn(),
      }),
    ),
  );
  expect(element.textContent).toContain("AI uses this model to write replies, plans and reports.");
});

it("reads saved effort and account and persists settings through the reviewed policy write", async () => {
  const policies: SocialPolicies = {
    global: {
      agent: {
        provider: "codex",
        model: "gpt-6.1-sol",
        providerAccountId: "work",
        modelSettings: { reasoningEffort: "high" },
      },
    },
    platforms: {},
  };
  const request = vi.fn(async () => policies);
  act(() =>
    root.render(
      createElement(AiModelSettings, {
        client: { request } as unknown as SocialClient,
        policies,
        onChanged: vi.fn(),
      }),
    ),
  );
  expect(picker.props.values).toEqual({ reasoningEffort: "high" });
  expect(picker.props.accountId).toBe("work");
  await act(async () => picker.props.onSettingsChange?.({ reasoningEffort: "xhigh" }));
  expect(request).toHaveBeenCalledWith(
    "policy.saveReviewed",
    expect.objectContaining({
      expectedPolicies: policies,
      policies: {
        ...policies,
        global: {
          agent: { ...policies.global.agent, modelSettings: { reasoningEffort: "xhigh" } },
        },
      },
    }),
  );
});
