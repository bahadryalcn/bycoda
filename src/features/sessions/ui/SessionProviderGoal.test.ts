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
const render = async (session: Pick<Session, "harness" | "providerSessionId" | "providerGoal">) =>
  act(async () => root.render(createElement(SessionProviderGoal, { session })));

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
  ["active", "Active"],
  ["paused", "Paused"],
  ["blocked", "Blocked"],
  ["usageLimited", "Usage limit reached"],
  ["budgetLimited", "Budget reached"],
  ["complete", "Completed"],
] satisfies Array<[SessionGoal["status"], string]>)(
  "shows the authoritative %s state without inventing progress or actions",
  async (status, label) => {
    await render({
      harness: "codex",
      providerSessionId: "native-conversation",
      providerGoal: goal(status),
    });
    expect(host.querySelector("[data-provider-goal]")?.getAttribute("data-provider-goal")).toBe(
      status,
    );
    expect(host.textContent).toContain("Codex Goal");
    expect(host.textContent).toContain(label);
    expect(host.textContent).toContain(goal().objective);
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector("button")).toBeNull();
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
  expect(host.textContent).toContain("Paused");
  expect(host.textContent).not.toContain("Active");
  expect(host.textContent).toContain(objective);
  await act(async () => setLanguagePreference("tr"));
  expect(host.textContent).toContain(objective);
  expect(host.textContent).not.toContain("Paused");
});
