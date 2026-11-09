// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialPolicies } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AiModelSettings } from "./AiModelSettings";

// The app's model picker has its own tests; here only the inherit choice and the saved agent matter.
vi.mock("../../../sessions/public/ModelPicker", () => ({
  ModelPicker: (props: { inheritChoice?: { label: string; selected: boolean } }) =>
    createElement(
      "div",
      { "data-testid": "model-picker" },
      props.inheritChoice?.label ?? "no-inherit",
    ),
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
