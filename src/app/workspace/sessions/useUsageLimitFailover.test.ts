// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { UsageLimitFailoverDeps } from "./useUsageLimitFailover";
import { newSession, type HarnessId, type Session } from "../../../features/sessions/model/session";
import { RESUME_PROMPT } from "../../../features/sessions/model/inFlight";
import type { ProviderRateLimits } from "../../../features/providers/model/rateLimits";

const mode = vi.hoisted(() => ({ value: "account" as "off" | "account" | "order" }));
const quota = vi.hoisted(() => ({ used: {} as Record<string, number> }));
const order = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("../../../features/settings/public/settings", () => ({
  loadUsageLimitFailover: () => mode.value,
}));
vi.mock("../../../features/model-routing/public/helpers", () => ({
  loadLocalModelOrder: async () => order.value,
}));
vi.mock("../../../features/providers/model/rateLimitsCache", () => ({
  loadFreshRateLimits: async (_provider: string, accountId: string) =>
    ({
      provider: "claude",
      session: { usedPercent: quota.used[accountId] ?? 0, windowMinutes: 300, resetsAt: 1 },
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: 0,
      error: null,
      status: "ok",
    }) as ProviderRateLimits,
}));
vi.mock("../../../features/providers/model/providerAccounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  providerAccounts: () => [
    { id: "work", provider: "claude", label: "work", isDefault: true },
    { id: "bycoda", provider: "claude", label: "BYCODA" },
  ],
  providerAccountLabel: (_provider: string, id?: string) => id ?? "default",
}));

const { useUsageLimitFailover } = await import("./useUsageLimitFailover");

let root: Root;
let sessionsRef: { current: Session[] };
let deps: {
  enqueueHarnessEvent: Mock<UsageLimitFailoverDeps["enqueueHarnessEvent"]>;
  onModelChange: Mock<UsageLimitFailoverDeps["onModelChange"]>;
  onSubmit: Mock<UsageLimitFailoverDeps["onSubmit"]>;
};

const movingSessionIds = { current: new Set<string>() };
const windowTransferPendingRef = { current: false };
const flushHarnessEvents = () => undefined;

function Probe({ sessions }: { sessions: Session[] }) {
  useUsageLimitFailover({
    sessions,
    sessionsRef,
    movingSessionIds,
    windowTransferPendingRef,
    flushHarnessEvents,
    ...deps,
  });
  return null;
}

const render = (sessions: Session[]) => {
  sessionsRef.current = sessions;
  return act(async () => root.render(createElement(Probe, { sessions })));
};
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const statusTexts = () =>
  deps.enqueueHarnessEvent.mock.calls.map(([, event]) => (event as { text: string }).text);

const chat: Session = {
  ...newSession("claude", "/fixture"),
  model: "claude:claude-opus-5-5",
  providerAccountId: "work",
};
const limited: Session = { ...chat, usageLimit: { resetsAt: Date.now() + 60_000 } };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mode.value = "account";
  quota.used = {};
  order.value = undefined;
  sessionsRef = { current: [] };
  deps = {
    enqueueHarnessEvent: vi.fn(),
    // Applies the pick the way the session model action does.
    onModelChange: vi.fn(
      async (id: string, harness: HarnessId, model: string, accountId?: string) => {
        sessionsRef.current = sessionsRef.current.map((session) =>
          session.id === id
            ? { ...session, harness, model, providerAccountId: accountId, usageLimit: undefined }
            : session,
        );
      },
    ),
    onSubmit: vi.fn(),
  };
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useUsageLimitFailover", () => {
  it("moves a newly limited chat to another account and continues it", async () => {
    await render([chat]);
    await render([limited]);
    await settle();
    expect(deps.onModelChange).toHaveBeenCalledWith(
      chat.id,
      "claude",
      "claude:claude-opus-5-5",
      "bycoda",
    );
    expect(deps.onSubmit).toHaveBeenCalledWith(chat.id, RESUME_PROMPT);
    expect(statusTexts()).toEqual(["Usage limit reached. Continuing on bycoda · Claude Opus 5.5."]);
  });

  it("leaves limits restored at launch, a running turn and the off setting alone", async () => {
    await render([limited]);
    await settle();
    await render([{ ...chat, busy: true, usageLimit: { resetsAt: 1 } }]);
    await settle();
    mode.value = "off";
    await render([{ ...chat, usageLimit: { resetsAt: 2 } }]);
    await settle();
    expect(deps.onModelChange).not.toHaveBeenCalled();
    expect(deps.onSubmit).not.toHaveBeenCalled();
  });

  it("keeps waiting and says so when no other account has quota", async () => {
    quota.used = { bycoda: 100 };
    await render([chat]);
    await render([limited]);
    await settle();
    expect(deps.onModelChange).not.toHaveBeenCalled();
    expect(deps.onSubmit).not.toHaveBeenCalled();
    expect(statusTexts()).toEqual([
      "No other account has quota left. Waiting for the usage limit to reset.",
    ]);
  });

  it("follows the model order past the limited account", async () => {
    mode.value = "order";
    order.value = {
      entries: [
        {
          id: "a",
          harness: "claude",
          providerAccountId: "work",
          model: "claude:x",
          modelSettings: {},
          unknownLimit: "use",
        },
        {
          id: "b",
          harness: "codex",
          model: "codex:gpt-5.5",
          modelSettings: {},
          unknownLimit: "use",
        },
      ],
      statuses: [],
    };
    await render([chat]);
    await render([limited]);
    await settle();
    expect(deps.onModelChange).toHaveBeenCalledWith(chat.id, "codex", "codex:gpt-5.5", undefined);
    expect(deps.onSubmit).toHaveBeenCalledWith(chat.id, RESUME_PROMPT);
  });
});
