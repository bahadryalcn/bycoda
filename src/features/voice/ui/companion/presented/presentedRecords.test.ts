// @vitest-environment happy-dom
import { createParser } from "@openuidev/react-lang";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compilePresentedProgram } from "../../../model/voicePresentedProgram";
import { VoicePresentedResultSchema } from "../../../model/voicePresentedResult";
import VoicePresentedAnswer from "../VoicePresentedAnswer";
import { presentedLibrary } from "./presentedLibrary";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (
  input: unknown,
  onAction: (button: never) => Promise<void> = async () => {},
) =>
  act(async () =>
    root.render(
      createElement(VoicePresentedAnswer, {
        result: VoicePresentedResultSchema.parse(input),
        version: 1,
        onAction: onAction as never,
      }),
    ),
  );

const button = (name: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent === name)!;
const option = (name: string) =>
  [...host.querySelectorAll<HTMLElement>("[role='option']")].find((item) =>
    item.textContent?.includes(name),
  )!;

it("sends date, period, free-text and list values to an action as their own types", async () => {
  const onAction = vi.fn(async () => {});
  await render(
    {
      title: "Plan",
      blocks: [
        {
          type: "FieldGroup",
          legend: "When",
          children: [
            { type: "DateTimePicker", id: "at", label: "At", value: "2026-11-24T09:30" },
            {
              type: "DateRangePicker",
              id: "days",
              label: "Days",
              value: { start: "2026-11-01", end: "2026-11-24" },
            },
            {
              type: "DateTimeRangePicker",
              id: "window",
              label: "Window",
              value: { start: "2026-11-24T00:00", end: "2026-11-25T00:00" },
            },
          ],
        },
        {
          type: "Combobox",
          id: "branch",
          label: "Branch",
          value: "main",
          suggestions: [
            { value: "main", label: "main" },
            { value: "release", label: "release" },
          ],
        },
        {
          type: "RowList",
          id: "session",
          label: "Session",
          rows: [
            { value: "a", label: "Fix login", meta: "2h ago" },
            { value: "b", label: "Review notes", description: "Waiting for you" },
          ],
        },
        {
          type: "Button",
          label: "Go",
          requires: ["session"],
          action: {
            action: "workspace.usage.open",
            input: {
              at: { $bind: "at" },
              days: { $bind: "days" },
              window: { $bind: "window" },
              branch: { $bind: "branch" },
              session: { $bind: "session" },
            },
          },
        },
      ],
    },
    onAction,
  );
  // A list starts with nothing picked, so the button that needs a pick waits for one.
  expect(button("Go").disabled).toBe(true);
  expect(host.querySelector("fieldset legend")?.textContent).toBe("When");
  await act(async () => option("Review notes").click());
  expect(button("Go").disabled).toBe(false);
  await act(async () => button("Go").click());
  expect(onAction).toHaveBeenCalledWith({
    label: "Go",
    action: "workspace.usage.open",
    input: {
      at: "2026-11-24T09:30",
      days: { start: "2026-11-01", end: "2026-11-24" },
      window: { start: "2026-11-24T00:00", end: "2026-11-25T00:00" },
      branch: "main",
      session: "b",
    },
  });
});

it("holds a period back until it is set", async () => {
  const onAction = vi.fn(async () => {});
  await render(
    {
      title: "Period",
      blocks: [
        { type: "DateRangePicker", id: "days", label: "Days" },
        {
          type: "Button",
          label: "Open",
          requires: ["days"],
          action: { action: "workspace.usage.open", input: { days: { $bind: "days" } } },
        },
      ],
    },
    onAction,
  );
  expect(button("Open").disabled).toBe(true);
  expect(onAction).not.toHaveBeenCalled();
});

it("draws records, meters and badges from the values it was sent", async () => {
  await render({
    title: "Run",
    blocks: [
      {
        type: "Timeline",
        label: "Run history",
        events: [
          { at: "2026-11-24T09:00:00Z", title: "started the build", actor: "Arif" },
          {
            at: "2026-11-24T09:04:00Z",
            title: "build passed",
            tone: "success",
            detail: "42 tests",
          },
        ],
      },
      { type: "StepStrip", label: "3 of 4 steps done", steps: ["done", "done", "failed", "done"] },
      {
        type: "UsageMeter",
        label: "Monthly budget",
        limit: 100,
        unit: "USD",
        segments: [
          { label: "Chat", value: 30 },
          { label: "Voice", value: 12 },
        ],
      },
      {
        type: "ActivityHeatmap",
        label: "Runs per day",
        period: "November",
        unit: { one: "run", other: "runs" },
        days: [
          { date: "2026-11-24", count: 5 },
          { date: "2026-11-23", count: 2 },
        ],
      },
      { type: "JsonViewer", label: "Result", data: { passed: 42, failed: ["a", "b"] } },
      { type: "StatusBadge", status: "failed", text: "Failed · 3" },
      { type: "ShortcutKeys", keys: "Ctrl+Shift+P" },
      { type: "ClampText", text: "A long note the owner can expand.", lines: 2 },
    ],
  });
  for (const text of [
    "started the build",
    "Arif",
    "build passed",
    "3 of 4 steps done",
    "Monthly budget",
    "7 runs · November",
    "58.0 USD",
    "passed",
    "Failed · 3",
    "A long note the owner can expand.",
  ])
    expect(host.textContent, text).toContain(text);
  expect(host.querySelector("[role='tree']")).not.toBeNull();
  expect(host.querySelector("[role='img'][aria-label]")?.getAttribute("aria-label")).toMatch(
    /ctrl|control/i,
  );
});

it("opens only a plain https link and shows where it goes", async () => {
  await render({
    title: "Links",
    blocks: [{ type: "Link", label: "Release notes", url: "https://example.com/notes?x=1" }],
  });
  const link = host.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://example.com/notes?x=1");
  expect(link.textContent).toBe("Release notes");
  expect(host.textContent).toContain("example.com");
  expect(link.hasAttribute("target")).toBe(false);
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "mailto:a@b.c",
    "https://user:pw@example.com",
    "https://",
  ])
    expect(
      VoicePresentedResultSchema.safeParse({
        title: "x",
        blocks: [{ type: "Link", label: "x", url }],
      }).success,
      url,
    ).toBe(false);
});

it("shows model text in the new components as plain text only", async () => {
  const hostile = "<img src=x onerror=1><script>2</script>";
  await render({
    title: "Hostile",
    blocks: [
      {
        type: "Timeline",
        label: hostile,
        events: [{ at: "2026-11-24T09:00:00Z", title: hostile, detail: hostile }],
      },
      { type: "FieldGroup", legend: hostile, description: hostile, children: [] },
      { type: "StatusBadge", status: "done", text: hostile },
      { type: "ClampText", text: hostile },
      { type: "JsonViewer", label: "Data", data: { [hostile]: hostile } },
      {
        type: "Combobox",
        id: "x",
        label: hostile,
        suggestions: [{ value: hostile, label: hostile }],
      },
    ],
  });
  expect(host.querySelector("script, img")).toBeNull();
  expect(host.textContent).toContain(hostile);
});

it("never lets model data become program source, even as nested JSON", () => {
  const hostile = 'x") \n$boom = "y"\nroot = Evil("z" // @present(0, {})';
  const { program } = compilePresentedProgram(
    VoicePresentedResultSchema.parse({
      title: "Data",
      blocks: [
        {
          type: "JsonViewer",
          label: hostile,
          data: { [hostile]: [hostile, { n: -1.5, ok: null }] },
        },
        {
          type: "Timeline",
          label: hostile,
          events: [{ at: "2026-11-24T09:00:00Z", title: hostile }],
        },
        { type: "Link", label: hostile, url: "https://example.com/a?b=%22)%0A" },
      ],
    }),
  );
  const result = createParser(presentedLibrary.toJSONSchema(), "PresentedAnswer").parse(program);
  expect(result.meta.errors).toEqual([]);
  expect(program.split("\n")).toHaveLength(4);
});

it("keeps free text typed into a Combobox exactly as typed", async () => {
  const onAction = vi.fn(async () => {});
  await render(
    {
      title: "Branch",
      blocks: [
        {
          type: "Combobox",
          id: "branch",
          label: "Branch",
          suggestions: [{ value: "main", label: "main" }],
        },
        {
          type: "Button",
          label: "Go",
          requires: ["branch"],
          action: { action: "workspace.usage.open", input: { branch: { $bind: "branch" } } },
        },
      ],
    },
    onAction,
  );
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "feature/<x>",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await act(async () => button("Go").click());
  expect(onAction).toHaveBeenCalledWith(
    expect.objectContaining({ input: { branch: "feature/<x>" } }),
  );
});
