// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentStep, Block } from "../model/session";

const copy = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>());
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copy }));
vi.mock("../../../app/shell/GlassBackdrop", () => ({ GlassBackdrop: () => null }));
vi.mock("./AgentTranscript", () => ({ ActivityRow: () => null, agentStepBlock: () => null }));

import { SubagentSheet } from "./SubagentSheet";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  copy.mockReset();
  copy.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const reply = (id: string, text: string, round?: number): AgentStep => ({
  id,
  kind: "message",
  text,
  ...(round ? { round } : {}),
});
const sent = (
  id: string,
  text: string,
  input: NonNullable<AgentStep["input"]>,
  round?: number,
): AgentStep => ({ id, kind: "message", text, input, ...(round ? { round } : {}) });

function child(steps: AgentStep[], round = 4): Block {
  return {
    id: "delegated:child",
    role: "tool",
    text: "Child",
    tool: { kind: "subagent", status: "completed" },
    agentRun: { name: "Child", prompt: "Launch brief", steps, round },
  };
}

function render(block: Block, busy = false) {
  act(() =>
    root.render(
      createElement(
        "div",
        { "data-session-drop": "" },
        createElement(SubagentSheet, { block, busy, visible: true, onClose: vi.fn() }),
      ),
    ),
  );
}
const dialog = () => container.querySelector('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => (entry.getAttribute("aria-label") ?? entry.textContent)?.trim() === name,
  );

/** The pictured run: one reply per round, the latest only a short acknowledgement. */
const rounds: AgentStep[] = [
  reply("a1", "Answer to the brief", 1),
  sent("m2", "first queued message", { sender: "owner", mode: "queue", delivery: "accepted" }, 2),
  reply("a2", "Answer to queued one", 2),
  sent("m3", "second queued message", { mode: "queue", delivery: "submitted" }, 3),
  reply("a3", "Answer to queued two", 3),
  sent(
    "m4",
    "third queued message",
    {
      sender: "owner",
      mode: "queue",
      delivery: "failed",
      detail: "Host restarted before dispatch",
    },
    4,
  ),
  reply("a4", "2. sıradaki deneme mesajını aldım.", 4),
];

it("keeps every earlier round reachable beside the latest short answer", () => {
  render(child(rounds));
  const text = dialog().textContent ?? "";
  // "2." is read as a list marker by the Markdown renderer; the words stay.
  expect(text).toContain("sıradaki deneme mesajını aldım.");
  // Earlier rounds are on demand: closed, one control each, in order.
  const headers = [...dialog().querySelectorAll<HTMLElement>("[data-timeline-round]")];
  expect(headers.map((entry) => entry.dataset.timelineRound)).toEqual(["1", "2", "3", "4"]);
  // Only the recap of a closed round is shown; its messages mount on open.
  expect(dialog().querySelector("[data-timeline-input='m2']")).toBeNull();
  const second = dialog().querySelector<HTMLDetailsElement>("details[data-timeline-round='2']")!;
  act(() => {
    second.open = true;
    second.dispatchEvent(new Event("toggle"));
  });
  expect(dialog().textContent).toContain("first queued message");
  expect(dialog().textContent).toContain("Answer to queued one");
});

it("labels each incoming message with sender, mode and delivery state", () => {
  render(child(rounds));
  const latest = dialog().querySelector("[data-timeline-input='m4']")!;
  expect(latest.textContent).toContain("You");
  expect(latest.textContent).toContain("Queue");
  expect(latest.textContent).toContain("Failed");
  expect(latest.textContent).toContain("Host restarted before dispatch");
  expect(latest.textContent).toContain("third queued message");
  // Sender unknown: neutral label, no invented identity.
  const second = dialog().querySelector<HTMLDetailsElement>("details[data-timeline-round='3']")!;
  act(() => {
    second.open = true;
    second.dispatchEvent(new Event("toggle"));
  });
  const anonymous = dialog().querySelector("[data-timeline-input='m3']")!;
  expect(anonymous.textContent).toContain("Message");
  expect(anonymous.textContent).toContain("Submitted");
  // Submission is not reading.
  expect(anonymous.textContent).not.toMatch(/\bRead\b|\bSeen\b/);
});

it("keeps an opened earlier round open while later steps stream in", () => {
  render(child(rounds));
  const first = () =>
    dialog().querySelector<HTMLDetailsElement>("details[data-timeline-round='1']")!;
  act(() => {
    first().open = true;
    first().dispatchEvent(new Event("toggle"));
  });
  const before = first();
  render(child([...rounds, reply("a4b", "streamed later", 4)], 4), true);
  expect(first()).toBe(before);
  expect(first().open).toBe(true);
  expect(dialog().textContent).toContain("streamed later");
  expect(dialog().textContent).toContain("Answer to the brief");
});

it("shows sent text verbatim and renders replies as Markdown", () => {
  render(
    child(
      [
        sent("m1", "**not bold** `x`\nsecond line çğış", { sender: "owner", mode: "steer" }, 1),
        reply("a1", "**bold reply**", 1),
      ],
      1,
    ),
  );
  const input = dialog().querySelector("[data-timeline-input='m1']")!;
  expect(input.querySelector("strong")).toBeNull();
  expect(input.textContent).toContain("**not bold** `x`");
  expect(input.textContent).toContain("second line çğış");
  const replyRow = dialog().querySelector("[data-timeline-message='a1']")!;
  expect(replyRow.textContent).toContain("bold reply");
  expect(replyRow.textContent).not.toContain("**");
});

it("copies a message in full and the whole transcript through every round", async () => {
  const long = "line\n".repeat(80) + "tail";
  render(
    child([
      reply("a1", "first answer", 1),
      sent("m2", long, { sender: "owner", mode: "steer", delivery: "accepted" }, 2),
      reply("a2", "second answer", 2),
    ]),
  );
  await act(async () => button("Copy message")?.click());
  expect(copy).toHaveBeenLastCalledWith(long);
  await act(async () => button("Copy transcript")?.click());
  const markdown = copy.mock.calls.at(-1)![0];
  for (const part of ["Launch brief", "first answer", "tail", "second answer", "Round 2"])
    expect(markdown).toContain(part);
  expect(markdown.indexOf("first answer")).toBeLessThan(markdown.indexOf("second answer"));
  expect(markdown).toMatch(/You[^\n]*steer[^\n]*accepted/i);
});

it("shows a single-round run as before, without round controls", () => {
  render(child([reply("a1", "only answer")], 1));
  expect(dialog().querySelector("[data-timeline-round]")).toBeNull();
  expect(dialog().textContent).toContain("only answer");
});

it("renders a message split across steps as separate rows, never merging by guess", () => {
  // Trace for `Mes` / `ajları`: two provider items stay two steps, so the sheet cannot
  // know they are one message. Fragments must be joined where the identity is known.
  render(child([reply("item-1", "Mes", 1), reply("item-2", "ajları", 1)], 1));
  const rows = dialog().querySelectorAll("[data-timeline-message]");
  expect(rows).toHaveLength(2);
});

it("shows Needs input only while the child runs, never from elapsed time", () => {
  const base = child([reply("a1", "Working")], 1);
  const block = { ...base, id: "native-child", tool: { ...base.tool, status: "in_progress" } };
  const withInput = (busy: boolean, needsInput: boolean) =>
    act(() =>
      root.render(
        createElement(
          "div",
          { "data-session-drop": "" },
          createElement(SubagentSheet, {
            block,
            busy,
            needsInput,
            visible: true,
            onClose: vi.fn(),
          }),
        ),
      ),
    );
  withInput(true, true);
  expect(dialog().textContent).toContain("Needs input");
  withInput(false, true);
  expect(dialog().textContent).not.toContain("Needs input");
  withInput(true, false);
  expect(dialog().textContent).not.toContain("Needs input");
});

it("shows the mode the Host used beside the requested one", () => {
  render(
    child(
      [
        sent("m1", "a", { sender: "owner", mode: "auto", effectiveMode: "steer" }, 1),
        sent("m2", "b", { sender: "owner", mode: "queue", effectiveMode: "queue" }, 1),
      ],
      1,
    ),
  );
  expect(dialog().querySelector("[data-timeline-input='m1']")?.textContent).toContain(
    "Auto · Steer",
  );
  const plain = dialog().querySelector("[data-timeline-input='m2']")?.textContent ?? "";
  expect(plain).toContain("Queue");
  expect(plain).not.toContain("Queue · Queue");
});
