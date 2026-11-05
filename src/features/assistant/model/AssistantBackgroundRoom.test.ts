// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  enabled: true,
  host: "host",
  error: "",
  label: "main",
  request: vi.fn(),
  invoke: vi.fn(async (_command: string, _payload: { active: boolean }) => undefined),
}));
vi.mock("./assistantClient", () => ({
  useAssistantSnapshot: () => ({
    snapshot: { profile: { enabled: fixture.enabled, setupComplete: true } },
    environmentId: fixture.host,
    error: fixture.error,
  }),
  assistantRequest: fixture.request,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: fixture.label }) }));
import { AssistantBackgroundRoom } from "./AssistantBackgroundRoom";
import { useAssistantControlSource } from "./useAssistantControlSource";

it("registers the real global source while enabled and shares it with a visible Room", async () => {
  fixture.enabled = true;
  fixture.error = "";
  fixture.request.mockReset();
  fixture.invoke.mockClear();
  fixture.request.mockResolvedValue({ thread: { id: "room" } });
  const root = createRoot(document.createElement("div"));
  const Visible = () => {
    useAssistantControlSource("room", "host");
    return null;
  };
  try {
    await act(async () =>
      root.render(
        createElement("div", {}, createElement(AssistantBackgroundRoom), createElement(Visible)),
      ),
    );
    expect(fixture.request).toHaveBeenCalledWith({ op: "threads.open" }, "host");
    expect(
      fixture.invoke.mock.calls.filter(([, payload]) => (payload as { active: boolean }).active),
    ).toHaveLength(1);
    fixture.enabled = false;
    await act(async () =>
      root.render(
        createElement("div", {}, createElement(AssistantBackgroundRoom), createElement(Visible)),
      ),
    );
    expect(
      fixture.invoke.mock.calls.filter(([, payload]) => !(payload as { active: boolean }).active),
    ).toHaveLength(0);
    await act(async () => root.unmount());
    expect(
      fixture.invoke.mock.calls.filter(([, payload]) => !(payload as { active: boolean }).active),
    ).toHaveLength(1);
  } finally {
    fixture.enabled = true;
  }
});

it("ignores a late Room result after Assistant is disabled", async () => {
  fixture.enabled = true;
  fixture.error = "";
  fixture.request.mockReset();
  fixture.invoke.mockClear();
  let finish!: (value: unknown) => void;
  fixture.request.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(AssistantBackgroundRoom)));
  fixture.enabled = false;
  await act(async () => root.render(createElement(AssistantBackgroundRoom)));
  await act(async () => {
    finish({ thread: { id: "late-room" } });
  });
  expect(fixture.invoke).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  fixture.enabled = true;
});

it("never creates a background source from a secondary native window", async () => {
  fixture.enabled = true;
  fixture.error = "";
  fixture.label = "tool-window";
  fixture.request.mockReset();
  fixture.invoke.mockClear();
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(AssistantBackgroundRoom)));
    expect(fixture.request).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  } finally {
    fixture.label = "main";
  }
});

it("retries a failed canonical Room lookup without starting another provider turn", async () => {
  vi.useFakeTimers();
  fixture.enabled = true;
  fixture.error = "";
  fixture.label = "main";
  fixture.request.mockReset();
  fixture.invoke.mockClear();
  fixture.request
    .mockRejectedValueOnce(new Error("Host unavailable"))
    .mockResolvedValue({ thread: { id: "room-retry" } });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(AssistantBackgroundRoom)));
    expect(fixture.invoke).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fixture.invoke).toHaveBeenCalledWith(
      "control_assistant_source_v2",
      expect.objectContaining({ threadId: "room-retry", role: "background", active: true }),
    );
    expect(
      fixture.request.mock.calls.every(
        ([request]) => (request as { op: string }).op === "threads.open",
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  } finally {
    vi.useRealTimers();
  }
});
