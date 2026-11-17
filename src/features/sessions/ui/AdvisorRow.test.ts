// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { advisorModelName } from "../model/claudeAdvisor";
import { AdvisorRow } from "./AdvisorRow";

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

it("shows the advisor, its model and state, with the advice behind a disclosure", () => {
  const settings = { crossAdvisor: '{"harness":"claude","model":"claude:fable-5-2"}' };
  act(() =>
    root.render(createElement(AdvisorRow, { block: advisor("pending"), modelSettings: settings })),
  );
  expect(container.textContent).toContain("Advisor · Fable 5.2");
  expect(container.textContent).toContain("Thinking…");
  act(() =>
    root.render(
      createElement(AdvisorRow, {
        block: advisor("completed", "Check the migration order first."),
        modelSettings: settings,
      }),
    ),
  );
  expect(container.textContent).toContain("Done");
  const details = container.querySelector("details")!;
  expect(details).not.toBeNull();
  expect(details.textContent).toContain("Check the migration order first.");
});
