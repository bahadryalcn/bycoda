// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDecisionModelsSettings } from "../../../decision-models";
import { SocialFirstRun } from "./SocialFirstRun";

// The card is stubbed: this test covers when the offer shows and how "Not now" is remembered.
vi.mock("../../../decision-models", () => ({
  decisionModelsClient: vi.fn(() => ({})),
  openDecisionModelsSettings: vi.fn(),
  DecisionModelsFirstRunCard: (props: { onDismiss: () => void; onOpenSettings: () => void }) =>
    createElement(
      "div",
      { "data-first-run": "" },
      createElement("button", { type: "button", onClick: props.onDismiss }, "Not now"),
      createElement("button", { type: "button", onClick: props.onOpenSettings }, "Set up"),
    ),
}));

const KEY = "bycoda.social.decisionFirstRunDismissed";
let element: HTMLDivElement, root: Root;

function render(props: { machineId: string }) {
  act(() => root.render(createElement(SocialFirstRun, props)));
}

function card(): Element | null {
  return element.querySelector("[data-first-run]");
}

beforeEach(() => {
  localStorage.clear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

it("shows the offer without any caller-supplied Settings callback", () => {
  render({ machineId: "m1" });
  expect(card()).not.toBeNull();
});

it("stays hidden without a Host", () => {
  render({ machineId: "" });
  expect(card()).toBeNull();
});

it("shows the offer until the owner chooses Not now, then keeps it hidden", () => {
  render({ machineId: "m1" });
  expect(card()).not.toBeNull();
  act(() => element.querySelector("button")?.click());
  expect(card()).toBeNull();
  expect(localStorage.getItem(KEY)).toBe("1");
  act(() => root.unmount());
  root = createRoot(element);
  render({ machineId: "m1" });
  expect(card()).toBeNull();
});

it("opens Providers > Decision models from Set up", () => {
  vi.mocked(openDecisionModelsSettings).mockClear();
  render({ machineId: "m1" });
  act(() => element.querySelectorAll("button")[1]?.click());
  expect(openDecisionModelsSettings).toHaveBeenCalledTimes(1);
  expect(card()).not.toBeNull();
});
