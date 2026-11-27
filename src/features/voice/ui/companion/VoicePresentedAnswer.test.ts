// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VoiceLiveResult } from "../../model/voiceLiveWork";
import { VoicePresentedResultSchema } from "../../model/voicePresentedResult";
import VoicePresentedAnswer from "./VoicePresentedAnswer";

let host: HTMLDivElement;
let root: Root;
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

type Props = Parameters<typeof VoicePresentedAnswer>[0];
const view = (input: unknown) => VoicePresentedResultSchema.parse(input);

const render = async (input: unknown, props: Partial<Props> = {}) =>
  act(async () =>
    root.render(
      createElement(VoicePresentedAnswer, {
        result: view(input),
        version: 1,
        onAction: async () => {},
        ...props,
      }),
    ),
  );

const buttons = () => [...host.querySelectorAll("button")];
const button = (name: string) =>
  buttons().find((item) => item.getAttribute("aria-label") === name || item.textContent === name);
const textbox = (label: string) =>
  [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].find(
    (input) =>
      input.getAttribute("aria-label") === label ||
      [...(input.labels ?? [])].some((item) => item.textContent?.includes(label)),
  )!;
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(prototype.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

/** A real flow: edit fields of several kinds, then press the button that reads them all. */
const usageForm = {
  title: "Open usage",
  summary: "Choose what to open.",
  blocks: [
    {
      type: "Card",
      title: "Filters",
      children: [
        {
          type: "Stack",
          direction: "row",
          children: [
            {
              type: "SegmentedControl",
              id: "metric",
              label: "Metric",
              options: [
                { value: "cost", label: "Cost" },
                { value: "tokens", label: "Tokens" },
              ],
            },
            { type: "NumberField", id: "months", label: "Months", value: 6, min: 1, max: 12 },
          ],
        },
        { type: "TextField", id: "project", label: "Project path" },
        { type: "Checkbox", id: "failedOnly", label: "Failed only" },
        {
          type: "Button",
          label: "Open Usage",
          variant: "primary",
          requires: ["project"],
          action: {
            action: "workspace.usage.open",
            projectPath: { $bind: "project" },
            input: {
              period: "monthly-history",
              metric: { $bind: "metric" },
              months: { $bind: "months" },
              filters: { failed: { $bind: "failedOnly" }, tags: ["a", { $bind: "metric" }] },
            },
          },
        },
      ],
    },
  ],
};

it("runs a composed form: input, choice, number and checkbox values reach the action", async () => {
  const onAction = vi.fn(async () => ({ status: "returned" as const, preview: "Total 42" }));
  await render(usageForm, { onAction });
  // A required field is empty, so the button waits for it.
  expect(button("Open Usage")!.getAttribute("aria-disabled")).toBe("true");
  await type(textbox("Project path"), "/work/a");
  expect(button("Open Usage")!.disabled).toBe(false);
  await act(async () => button("Tokens")!.click());
  await type(textbox("Months"), "8");
  await act(async () => host.querySelector<HTMLInputElement>("input[type='checkbox']")!.click());
  await act(async () => button("Open Usage")!.click());
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAction).toHaveBeenCalledWith({
    label: "Open Usage",
    action: "workspace.usage.open",
    projectPath: "/work/a",
    input: {
      period: "monthly-history",
      metric: "tokens",
      months: 8,
      filters: { failed: true, tags: ["a", "tokens"] },
    },
  });
  // The returned result is shown beside the button, as text.
  expect(host.textContent).toContain("Total 42");
  expect(host.querySelector("[data-voice-presented-version='1']")).not.toBeNull();
});

it("shows a refusal, then drops it once an input it used changes", async () => {
  const onAction = vi.fn(async () => {
    throw new Error("Usage is locked.");
  });
  await render(usageForm, { onAction });
  await type(textbox("Project path"), "/work/a");
  await act(async () => button("Open Usage")!.click());
  const alert = host.querySelector("[role='alert']");
  expect(alert?.textContent).toContain("Could not run this action.");
  expect(alert?.textContent).not.toContain("Usage is locked.");
  await act(async () => button("Details")!.click());
  expect(document.body.textContent).toContain("Usage is locked.");
  await type(textbox("Project path"), "/work/b");
  expect(host.querySelector("[role='alert']")).toBeNull();
  await act(async () => button("Open Usage")!.click());
  expect(onAction).toHaveBeenCalledTimes(2);
  expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ projectPath: "/work/b" }));
});

it("keeps what the owner typed when the same fields are shown again", async () => {
  await render(usageForm);
  await type(textbox("Project path"), "/work/a");
  await act(async () => button("Tokens")!.click());
  await render({ ...usageForm, title: "Updated" }, { version: 2 });
  expect(host.querySelector("[data-voice-presented-version='2']")).not.toBeNull();
  expect(textbox("Project path").value).toBe("/work/a");
  expect(
    button("Tokens")?.getAttribute("aria-pressed") ??
      button("Tokens")?.getAttribute("aria-checked"),
  ).toBe("true");
});

it("keeps the newer action pending when a press from an older presentation finishes", async () => {
  const older = Promise.withResolvers<void>();
  const newer = Promise.withResolvers<void>();
  const onAction = vi.fn(() => newer.promise);
  await render(usageForm, { onAction: () => older.promise });
  await type(textbox("Project path"), "/work/a");
  await act(async () => button("Open Usage")!.click());
  await render({ ...usageForm, title: "Updated" }, { version: 2, onAction });
  await act(async () => button("Open Usage")!.click());
  expect(button("Open Usage")!.getAttribute("aria-disabled")).toBe("true");

  await act(async () => older.resolve());
  expect(button("Open Usage")!.getAttribute("aria-disabled")).toBe("true");
  await act(async () => button("Open Usage")!.click());
  expect(onAction).toHaveBeenCalledTimes(1);

  await act(async () => newer.resolve());
  expect(button("Open Usage")!.hasAttribute("aria-disabled")).toBe(false);
});

it("renders model text as plain text and copies the exact text", async () => {
  await render({
    title: "Release note",
    blocks: [
      { type: "Text", text: "Here is the <b>draft</b> you asked for." },
      {
        type: "CopyBlock",
        label: "Draft",
        text: "Line one\n  indented <script>alert(1)</script>\n",
      },
      { kind: "copy", label: "Command", text: "pnpm build" },
    ],
  });
  expect(host.textContent).toContain("Here is the <b>draft</b> you asked for.");
  expect(host.querySelector("b, script")).toBeNull();
  const copies = buttons().filter((item) => item.textContent?.includes("Copy"));
  expect(copies).toHaveLength(2);
  await act(async () => copies[0]!.click());
  expect(writeText).toHaveBeenCalledWith("Line one\n  indented <script>alert(1)</script>\n");
  await act(async () => copies[1]!.click());
  expect(writeText).toHaveBeenLastCalledWith("pnpm build");
});

it("draws data and status components from the values it was sent", async () => {
  await render({
    title: "Report",
    blocks: [
      { type: "Alert", tone: "warning", title: "Heads up", text: "One check failed." },
      {
        type: "StatRow",
        label: "Tests",
        items: [
          { label: "Passed", value: "42" },
          { label: "Failed", value: "1" },
        ],
      },
      {
        type: "Table",
        caption: "Packages",
        columns: ["Name", "Status"],
        rows: [
          ["web", "passed"],
          ["host", "failed"],
        ],
      },
      {
        type: "BarChart",
        label: "Tests",
        items: [
          { label: "Web", value: 8 },
          { label: "Host", value: 5 },
        ],
      },
      { type: "DescriptionList", items: [{ label: "Branch", value: "main" }] },
      { type: "Badge", text: "New" },
      { type: "Progress", value: 3, max: 4, label: "Packages" },
    ],
  });
  for (const text of [
    "Heads up",
    "One check failed.",
    "42",
    "web",
    "host",
    "main",
    "New",
    "Packages",
  ])
    expect(host.textContent).toContain(text);
  expect(host.querySelector("table")).not.toBeNull();
});

it("switches tabs without losing a field's value", async () => {
  await render({
    title: "Tabs",
    blocks: [
      {
        type: "Tabs",
        children: [
          {
            type: "Tab",
            label: "Edit",
            children: [{ type: "TextField", id: "name", label: "Name" }],
          },
          { type: "Tab", label: "Other", children: [{ type: "Text", text: "Second panel" }] },
        ],
      },
    ],
  });
  await type(textbox("Name"), "draft");
  await act(async () =>
    [...host.querySelectorAll<HTMLElement>("[role='tab']")]
      .find((tab) => tab.textContent === "Other")!
      .click(),
  );
  expect(host.textContent).toContain("Second panel");
  expect(host.querySelector("input")).toBeNull();
  await act(async () =>
    [...host.querySelectorAll<HTMLElement>("[role='tab']")]
      .find((tab) => tab.textContent === "Edit")!
      .click(),
  );
  expect(textbox("Name").value).toBe("draft");
});

const observed: VoiceLiveResult[] = [
  { kind: "tests", status: "done", passed: 41, failed: 1, skipped: 0 },
  {
    kind: "actions",
    status: "failed",
    actions: [{ id: "a1", name: "workspace.usage.open", status: "failed" }],
  },
];

it("draws only observed results, and says when one was not observed", async () => {
  await render(
    {
      title: "Observed",
      blocks: [
        { type: "TestResult" },
        { type: "CheckResult", kind: "build" },
        { type: "VoiceActions" },
      ],
    },
    { observed },
  );
  expect(host.textContent).toContain("41");
  expect(host.textContent).toContain("Not observed in this turn.");
  expect(host.textContent).toContain("Voice actions");
});

it("composes the work results with their shared filter and row selection", async () => {
  await render(
    {
      title: "Work",
      blocks: [
        {
          type: "WorkResults",
          children: [
            {
              type: "WorkStatusCounts",
              children: [
                { type: "WorkStatusFilter", filter: "all" },
                { type: "WorkStatusFilter", filter: "failed" },
              ],
            },
            { type: "WorkResultTable", sort: "activity" },
          ],
        },
      ],
    },
    { observed },
  );
  expect(host.querySelector("table")).not.toBeNull();
  expect(host.textContent).toContain("Test run");
  await act(async () => button("Failed · 1")!.click());
  expect(host.textContent).not.toContain("Test run");
  expect(host.textContent).toContain("Voice actions");
});
