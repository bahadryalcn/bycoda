// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiPlan } from "../../model/socialActions";
import type { StepResult } from "./commandModel";
import { PlanSteps, type PlanStepsProps } from "./PlanSteps";

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

const plan: AiPlan = {
  planId: "plan-1",
  steps: [
    {
      id: "s1",
      action: "replies.send",
      input: {},
      summary: "Reply to the pricing question",
      needsApproval: true,
      reason: "Replies go out under your name.",
    },
    { id: "s2", action: "lists.list", input: {}, summary: "Show lists", needsApproval: false },
    {
      id: "s3",
      action: "messages.send",
      input: {},
      summary: "Message the new follower",
      needsApproval: true,
    },
  ],
};

function render(props: Partial<PlanStepsProps> = {}) {
  const onApprove = vi.fn();
  const onRun = vi.fn();
  act(() =>
    root.render(
      createElement(PlanSteps, {
        plan,
        results: {},
        approved: [],
        busy: false,
        onApprove,
        onRun,
        ...props,
      }),
    ),
  );
  return { onApprove, onRun };
}

const buttonLabels = () =>
  [...element.querySelectorAll("button")].map((b) => b.textContent?.trim());
const button = (text: string) =>
  [...element.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const steps = () => [...element.querySelectorAll<HTMLElement>(".command-step")];
const statusOf = (index: number) =>
  steps()[index]?.querySelector(".command-step-status")?.textContent;

it("lists the steps in order with what the Host will do with each", () => {
  render();
  expect(steps().map((step) => step.querySelector(".command-step-summary")?.textContent)).toEqual([
    "Reply to the pricing question",
    "Show lists",
    "Message the new follower",
  ]);
  expect([0, 1, 2].map(statusOf)).toEqual([
    "Needs your approval",
    "Will run automatically",
    "Needs your approval",
  ]);
});

it("offers Approve only on steps that still need it and approves that one step", () => {
  const { onApprove } = render();
  expect(steps()[0]?.querySelector("button")?.textContent).toBe("Approve");
  expect(steps()[1]?.querySelector("button")?.textContent).toBe("Technical details");
  const approve = [...steps()[2]!.querySelectorAll("button")].find(
    (b) => b.textContent === "Approve",
  );
  act(() => approve?.click());
  expect(onApprove).toHaveBeenCalledExactlyOnceWith(["s3"]);
});

it("approves every pending step at once and hides the button when none are pending", () => {
  const { onApprove } = render();
  act(() => button("Approve all")?.click());
  expect(onApprove).toHaveBeenCalledExactlyOnceWith(["s1", "s3"]);
  render({ approved: ["s1", "s3"] });
  expect(button("Approve all")).toBeUndefined();
  expect(button("Approve")).toBeUndefined();
  expect(statusOf(0)).toBe("Approved");
  expect(statusOf(2)).toBe("Approved");
});

it("leaves a step that is already approved out of Approve all", () => {
  const { onApprove } = render({ approved: ["s1"] });
  expect(statusOf(0)).toBe("Approved");
  act(() => button("Approve all")?.click());
  expect(onApprove).toHaveBeenCalledExactlyOnceWith(["s3"]);
});

it("runs the plan only when Run plan is pressed", () => {
  const { onRun } = render();
  expect(onRun).not.toHaveBeenCalled();
  act(() => button("Run plan")?.click());
  expect(onRun).toHaveBeenCalledTimes(1);
});

it("blocks a second run and a bulk approve while the plan is running", () => {
  const { onApprove, onRun } = render({ busy: true });
  expect(button("Run plan")?.getAttribute("aria-busy")).toBe("true");
  act(() => button("Run plan")?.click());
  expect(onRun).not.toHaveBeenCalled();
  expect(button("Approve all")?.disabled).toBe(true);
  act(() => button("Approve all")?.click());
  expect(onApprove).not.toHaveBeenCalled();
});

it("shows why a step needs approval before the run, and the Host message after it", () => {
  render();
  expect(steps()[0]?.textContent).toContain("Replies go out under your name.");
  const results: Record<string, StepResult> = {
    s1: { stepId: "s1", status: "blocked", message: "The account is paused." },
    s2: { stepId: "s2", status: "done" },
    s3: { stepId: "s3", status: "failed", message: "Rate limited." },
  };
  render({ results, approved: ["s1", "s3"] });
  expect([0, 1, 2].map(statusOf)).toEqual(["Blocked", "Done", "Failed"]);
  expect(steps()[0]?.textContent).toContain("The account is paused.");
  expect(steps()[0]?.textContent).not.toContain("Replies go out under your name.");
  expect(steps()[2]?.textContent).toContain("Rate limited.");
});

it("stops asking for approval once a step has finished", () => {
  const { onApprove } = render({ results: { s1: { stepId: "s1", status: "done" } } });
  expect(buttonLabels().filter((label) => label === "Approve")).toHaveLength(1);
  act(() => button("Approve all")?.click());
  expect(onApprove).toHaveBeenCalledExactlyOnceWith(["s3"]);
});

it("keeps the action name behind Technical details", () => {
  render();
  expect(element.querySelector("code")).toBeNull();
  const toggle = steps()[0]!.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  act(() => toggle?.click());
  expect(steps()[0]?.querySelector("code")?.textContent).toBe("replies.send");
});
