// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { advisorModelName } from "../model/advisorModelName";
import { AdvisorRow } from "./AdvisorRow";
import { HARNESS_ICONS } from "../../../shared/ui/identity/HarnessIcon";
import { resetHarnessModelOverlays, setHarnessModels, type AgentModel } from "../model/models";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetHarnessModelOverlays();
  vi.unstubAllGlobals();
});

const advisor = (status: string, detail?: string): Block =>
  ({
    id: "adv",
    role: "tool",
    text: "advisor",
    tool: { callId: "adv", kind: "advisor", title: "advisor", status, detail },
  }) as Block;

it("names the advisor model from the conversation's selection", () => {
  expect(
    advisorModelName({ crossAdvisor: '{"harness":"claude","model":"claude:fable-5-2"}' }),
  ).toBe("Fable 5.2");
  expect(advisorModelName({ advisor: "fable" })).toBe("Fable");
  expect(advisorModelName({ advisor: "off" })).toBeUndefined();
  expect(advisorModelName(undefined)).toBeUndefined();
});

it("refreshes the advisor name when the live model catalog changes", () => {
  const settings = { crossAdvisor: '{"harness":"claude","model":"claude:advisor-fixture"}' };
  const publish = (name: string) =>
    act(() =>
      setHarnessModels("claude", [
        {
          id: "claude:advisor-fixture",
          nativeId: "advisor-fixture",
          harness: "claude",
          name,
        } as AgentModel,
      ]),
    );
  publish("Advisor first");
  act(() =>
    root.render(createElement(AdvisorRow, { block: advisor("pending"), modelSettings: settings })),
  );
  expect(container.textContent).toContain("Advisor · Advisor first");
  publish("Advisor updated");
  expect(container.textContent).toContain("Advisor · Advisor updated");
});

it("shows the advisor, its model and state, with the advice behind a disclosure", () => {
  const settings = { crossAdvisor: '{"harness":"claude","model":"claude:fable-5-2"}' };
  act(() =>
    root.render(createElement(AdvisorRow, { block: advisor("pending"), modelSettings: settings })),
  );
  expect(container.textContent).toContain("Advisor · Fable 5.2");
  expect(container.textContent).toContain("Thinking…");
  expect(container.querySelector("img")?.getAttribute("src")).toBe(HARNESS_ICONS.claude);
  expect(container.querySelector('[data-working-variant], [class*="sweep"]')).not.toBeNull();
  act(() =>
    root.render(
      createElement(AdvisorRow, {
        block: advisor("completed", "Check the migration order first."),
        modelSettings: settings,
      }),
    ),
  );
  // A finished advisor shows no status text: only a pending or failed state is worth saying.
  expect(container.textContent).not.toContain("Thinking…");
  expect(container.textContent).not.toContain("Failed");
  const details = container.querySelector("details")!;
  expect(details).not.toBeNull();
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("Check the migration order first.");
});

it("keeps long advice visible without a line clamp and updates it while pending", () => {
  const render = (status: string, detail: string) =>
    act(() => root.render(createElement(AdvisorRow, { block: advisor(status, detail) })));
  render("pending", "First observation.");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  act(() => container.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  render("pending", "First observation.\n\n**Check the schema.**");
  expect(container.textContent).toContain("Check the schema.");
  expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe(
    "Check the schema.",
  );
  render("completed", Array.from({ length: 30 }, (_, index) => `Advice line ${index}`).join("\n"));
  expect(details.open).toBe(true);
  expect(container.textContent).toContain("Advice line 29");
  expect(container.querySelector('[class*="clamp"]')).toBeNull();
  expect(container.querySelector('[class*="sweep"]')).toBeNull();
});

it("shows failure details and keeps advice collapsible", () => {
  act(() =>
    root.render(createElement(AdvisorRow, { block: advisor("failed", "Advisor unavailable.") })),
  );
  expect(container.textContent).toContain("Failed");
  expect(container.textContent).toContain("Advisor unavailable.");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  act(() => container.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  act(() => container.querySelector("summary")!.click());
  expect(details.open).toBe(false);
});
