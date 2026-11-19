// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { HostSession } from "../../connections/model/protocol";
vi.mock("../../connections/model/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => text,
}));
import { remoteRequest } from "../../connections/model/connections";
import { TaskSessionSheet } from "./TaskSessionSheet";
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("polls bounded previews by revision and keeps the current preview on unchanged responses", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const current = {
    revision: 7,
    status: "running",
    session: {
      title: "Task",
      blocks: [{ id: "reply", role: "assistant", text: "Retained preview" }],
    },
  } as HostSession;
  vi.mocked(remoteRequest).mockReset().mockResolvedValueOnce(current).mockResolvedValue(null);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (sessionId: string) =>
    act(async () =>
      root.render(
        createElement(TaskSessionSheet, {
          target: { machineId: "host", projectId: "project", cwd: "folder", sessionId },
          onClose: () => {},
          onOpen: () => {},
        }),
      ),
    );
  try {
    await render("first");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(remoteRequest).toHaveBeenCalledTimes(3);
    expect(remoteRequest).toHaveBeenLastCalledWith("host", "sessions.get", {
      sessionId: "first",
      preview: true,
      revision: 7,
    });
    expect(document.body.textContent).toContain("Retained preview");
    vi.mocked(remoteRequest).mockReturnValue(new Promise(() => {}));
    await render("second");
    expect(document.body.textContent).not.toContain("Retained preview");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

const runningSession = (revision = 1) =>
  ({
    revision,
    status: "running",
    session: { title: "Task", blocks: [{ id: "reply", role: "assistant", text: "Preview" }] },
  }) as HostSession;

async function mountSheet() {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(TaskSessionSheet, {
        target: { machineId: "host", projectId: "project", cwd: "folder", sessionId: "s" },
        onClose: () => {},
        onOpen: () => {},
      }),
    ),
  );
  return async () => {
    await act(async () => root.unmount());
    container.remove();
  };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

it("backs off after consecutive failures and an explicit retry reloads at once", async () => {
  vi.mocked(remoteRequest).mockReset().mockRejectedValue(new Error("boom"));
  const unmount = await mountSheet();
  try {
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    await advance(5999);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    await advance(11_999);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(remoteRequest).toHaveBeenCalledTimes(3);
    const retry = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    expect(remoteRequest).toHaveBeenCalledTimes(4);
  } finally {
    await unmount();
  }
});

it("stops polling once the session is no longer running", async () => {
  vi.mocked(remoteRequest)
    .mockReset()
    .mockResolvedValue({ ...runningSession(), status: "idle" } as HostSession);
  const unmount = await mountSheet();
  try {
    await advance(60_000);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
  } finally {
    await unmount();
  }
});

it("slows down while the window is hidden and refreshes when it is shown", async () => {
  setHidden(true);
  vi.mocked(remoteRequest).mockReset().mockResolvedValue(runningSession());
  const unmount = await mountSheet();
  try {
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    await advance(59_000);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    await act(async () => setHidden(false));
    expect(remoteRequest).toHaveBeenCalledTimes(3);
  } finally {
    await unmount();
    setHidden(false);
  }
});

it("shows one loading indicator while the session has not loaded", async () => {
  vi.mocked(remoteRequest).mockReset().mockReturnValue(new Promise(() => {}));
  const unmount = await mountSheet();
  try {
    await advance(LOADING_DELAY_MS + 1);
    expect(document.body.textContent?.split("Loading…").length).toBe(2);
  } finally {
    await unmount();
  }
});

it("stops polling after repeated failures and offers Retry only once it has stopped", async () => {
  vi.mocked(remoteRequest).mockReset().mockRejectedValue(new Error("boom"));
  const unmount = await mountSheet();
  const retryButton = () =>
    [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Retry");
  try {
    expect(retryButton()).toBeUndefined();
    // Attempts at 0, 6 s, 18 s, 42 s and 90 s; the fifth failure stops the poll.
    await advance(90_000);
    expect(remoteRequest).toHaveBeenCalledTimes(5);
    expect(retryButton()).toBeDefined();
    await advance(600_000);
    expect(remoteRequest).toHaveBeenCalledTimes(5);
    await act(async () => retryButton()?.click());
    expect(remoteRequest).toHaveBeenCalledTimes(6);
  } finally {
    await unmount();
  }
});

it("does not request again after unmount", async () => {
  vi.mocked(remoteRequest).mockReset().mockResolvedValue(runningSession());
  const unmount = await mountSheet();
  await unmount();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(remoteRequest).toHaveBeenCalledTimes(1);
});
