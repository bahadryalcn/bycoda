// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { formatNumber } from "../../../shared/i18n";
import type { HostTask } from "../model/hostTasks";
import type { TaskRunBudgetUsage } from "../model/taskBudget";
import { AssistantTaskBadge } from "./AssistantTaskBadge";
import { TaskBudgetUsage } from "./TaskBudgetControls";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const usage = (patch: Partial<TaskRunBudgetUsage> = {}): TaskRunBudgetUsage => ({
  historyComplete: true,
  agentMinutes: 2,
  attempts: 3,
  completedRuns: 3,
  runningRuns: 0,
  reportedTokens: 1234567,
  tokens: 1234567,
  tokensComplete: true,
  unknownTokenRuns: 0,
  reportedCostUsd: null,
  ...patch,
});

it("formats the assistant follow-up count with the app locale", async () => {
  const task = {
    id: "task",
    assistantFollowups: { delivered: 1234567, unconfirmed: 0 },
  } as HostTask;
  await act(async () => root.render(createElement(AssistantTaskBadge, { task })));
  const text = container.textContent ?? "";
  expect(text).toContain(formatNumber(1234567));
  expect(text).not.toContain("1234567");
});

it("formats budget usage counts and tokens with the app locale", async () => {
  await act(async () =>
    root.render(createElement(TaskBudgetUsage, { usage: usage(), budget: undefined })),
  );
  const text = container.textContent ?? "";
  expect(text).toContain(
    formatNumber(2, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  );
  expect(text).toContain(formatNumber(1234567));
  expect(text).not.toContain("1234567");
});

it("formats the reported token figure in the unknown-total label", async () => {
  await act(async () =>
    root.render(
      createElement(TaskBudgetUsage, {
        usage: usage({ tokens: null, tokensComplete: false }),
      }),
    ),
  );
  const text = container.textContent ?? "";
  expect(text).toContain(formatNumber(1234567));
  expect(text).not.toContain("1234567");
});
