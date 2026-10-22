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
