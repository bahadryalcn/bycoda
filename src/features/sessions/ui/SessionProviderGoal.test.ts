// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import type { Session } from "../model/session";
import type { SessionGoal } from "../model/providerGoal";
import { SessionProviderGoal } from "./SessionProviderGoal";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLanguagePreference("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setLanguagePreference("en");
  vi.unstubAllGlobals();
});

const goal = (status: SessionGoal["status"] = "active"): SessionGoal => ({
  provider: "codex",
  providerSessionId: "native-conversation",
  objective: "Finish the approved implementation",
  status,
});
const render = async (
  session: Pick<Session, "harness" | "providerSessionId" | "providerGoal" | "busy">,
  onCommand = vi.fn(() => true),
) => act(async () => root.render(createElement(SessionProviderGoal, { session, onCommand })));

it.each([
  null,
  true,
  "active",
  [],
  { ...goal(), objective: undefined },
  { ...goal(), objective: 42 },
  { ...goal(), objective: {} },
  { ...goal(), objective: "" },
  { ...goal(), objective: " \n\t" },
  { ...goal(), status: "running" },
  { ...goal(), status: "toString" },
  { ...goal(), status: null },
  { ...goal(), providerSessionId: 42 },
  { ...goal(), providerSessionId: "" },
  { ...goal(), providerSessionId: undefined },
  { ...goal(), provider: "claude" },
  { ...goal(), tokensUsed: -1 },
  { ...goal(), tokensUsed: "12" },
  { ...goal(), tokenBudget: Infinity },
  { ...goal(), timeUsedSeconds: NaN },
])("hides malformed remote goal JSON without inferring a state: %j", async (value) => {
  // Remote Session extensions are open JSON despite the local Session type.
  await render({
    harness: "codex",
    providerSessionId:
      typeof value === "object" && value && "providerSessionId" in value
        ? (value.providerSessionId as string)
        : "native-conversation",
    providerGoal: value as SessionGoal,
  });
  expect(host.textContent).toBe("");
  expect(host.querySelector("[data-provider-goal]")).toBeNull();
});

it.each([
  { harness: "codex", providerSessionId: "native-conversation" },
  { harness: "claude", providerSessionId: "native-conversation", providerGoal: goal() },
  { harness: "codex", providerSessionId: "different-conversation", providerGoal: goal() },
  { harness: "codex", providerGoal: goal() },
] satisfies Array<Pick<Session, "harness" | "providerSessionId" | "providerGoal">>)(
  "hides absent or differently owned native goals: %j",
  async (session) => {
    await render(session);
    expect(host.textContent).toBe("");
    expect(host.querySelector("[data-provider-goal]")).toBeNull();
  },
);

it.each([
  ["active", "Goal set"],
  ["paused", "Goal paused"],
  ["blocked", "Goal blocked"],
  ["usageLimited", "Goal hit a usage limit"],
  ["budgetLimited", "Goal reached its token budget"],
  ["complete", "Goal complete"],
] satisfies Array<[SessionGoal["status"], string]>)(
  "shows the authoritative %s state with owner controls",
  async (status, label) => {
    await render({
      harness: "codex",
      providerSessionId: "native-conversation",
      providerGoal: goal(status),
    });
    expect(host.querySelector("[data-provider-goal]")?.getAttribute("data-provider-goal")).toBe(
      status,
    );
    expect(host.textContent).toContain(label);
    expect(host.textContent).toContain(goal().objective);
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.textContent).toContain("Clear goal");
  },
);

it("retains complete Turkish, RTL and emoji objective text and updates native state in place", async () => {
  const objective = "Hesapları ve seçili modeli doğrula 👨‍👩‍👧‍👦 مرحبا ".repeat(120);
  await render({
    harness: "codex",
    providerSessionId: "native-conversation",
    providerGoal: { ...goal(), objective },
  });
  expect(host.textContent).toContain(objective);
  await render({
    harness: "codex",
    providerSessionId: "native-conversation",
    providerGoal: { ...goal("paused"), objective },
  });
  expect(host.textContent).toContain("Goal paused");
  expect(host.textContent).not.toContain("Goal set");
  expect(host.textContent).toContain(objective);
  await act(async () => setLanguagePreference("tr"));
  expect(host.textContent).toContain(objective);
  expect(host.textContent).not.toContain("Goal paused");
});

it("resumes and clears the exact goal through owner actions", async () => {
  const onCommand = vi.fn(() => true);
  await render(
    { harness: "codex", providerSessionId: "native-conversation", providerGoal: goal("blocked") },
    onCommand,
  );
  const buttons = [...host.querySelectorAll("button")];
  await act(async () =>
    buttons.find((button) => button.textContent?.includes("Resume goal"))!.click(),
  );
  expect(onCommand).toHaveBeenCalledExactlyOnceWith("/goal resume");
  await act(async () =>
    buttons.find((button) => button.textContent?.includes("Clear goal"))!.click(),
  );
  expect(onCommand).toHaveBeenLastCalledWith("/goal clear");
});

it("shows native usage and keeps goal state separate from current work", async () => {
  await render({
    harness: "codex",
    providerSessionId: "native-conversation",
    busy: true,
    providerGoal: { ...goal("blocked"), tokensUsed: 1200, tokenBudget: 5000, timeUsedSeconds: 90 },
  });
  expect(host.textContent).toContain("Goal blocked");
  expect(host.textContent).toContain("1,200 / 5,000 tokens");
  expect(host.textContent).toContain("1m 30s");
  expect(host.textContent).not.toContain("Resume goal");
  expect(host.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
});

it("reports refused goal commands without changing the provider state", async () => {
  await render(
    { harness: "codex", providerSessionId: "native-conversation", providerGoal: goal("blocked") },
    vi.fn(() => false),
  );
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Goal action was not sent. Try again when the conversation is ready.",
  );
  expect(host.getElementsByTagName("button").length).toBeGreaterThan(0);
  expect(host.textContent).toContain("Goal blocked");
});

it("distinguishes pursuing work from an idle goal and formats unbudgeted usage", async () => {
  await render({
    harness: "codex",
    providerSessionId: "native-conversation",
    busy: true,
    providerGoal: { ...goal(), tokensUsed: 123, tokenBudget: null, timeUsedSeconds: 12 },
  });
  expect(host.textContent).toContain("Pursuing goal");
  expect(host.textContent).toContain("123 tokens");
  expect(host.textContent).not.toContain(" / ");
  expect(host.textContent).not.toContain("Goal set");
});

it("preserves permission blockers for both goal actions", async () => {
  const onCommand = vi.fn(() => true);
  await act(async () =>
    root.render(
      createElement(SessionProviderGoal, {
        session: {
          harness: "codex",
          providerSessionId: "native-conversation",
          providerGoal: goal("paused"),
        },
        blockedReason: "Owner approval required",
        onCommand,
      }),
    ),
  );
  for (const button of host.querySelectorAll<HTMLButtonElement>("button")) {
    await act(async () => button.click());
  }
  expect(onCommand).not.toHaveBeenCalled();
});
