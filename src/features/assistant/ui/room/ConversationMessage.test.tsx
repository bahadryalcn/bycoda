// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AssistantMessage } from "../../../../shared/model/host-contracts/assistant";
import { conversationMessageItem } from "./ConversationMessage";

it("shows a localized unavailable label for a missing linked job and keeps valid job links", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const onJob = vi.fn();
  const item = conversationMessageItem({
    message: {
      id: "message-1",
      version: 1,
      createdAt: Date.parse("2026-11-19T10:00:00Z"),
      updatedAt: Date.parse("2026-11-19T10:00:00Z"),
      threadId: "thread-1",
      role: "assistant",
      via: "text",
      text: "Done",
      jobIds: ["00000000-0000-4000-8000-000000000794", "live-job"],
    } satisfies AssistantMessage,
    authorName: "Assistant",
    jobs: [{ id: "live-job", title: "Live job" }],
    clearing: false,
    onJob,
    onDelete: vi.fn(),
  });
  const container = document.createElement("div"),
    root = createRoot(container);
  document.body.append(container);
  await act(async () => root.render(createElement("div", null, item.body)));

  const summary = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Jobs"),
  );
  expect(summary).toBeDefined();
  await act(async () => summary!.click());

  expect(container.textContent).toContain("Job unavailable");
  expect(container.textContent).not.toContain("00000000-0000-4000-8000-000000000794");

  const liveLink = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Live job",
  );
  expect(liveLink).toBeDefined();
  await act(async () => liveLink!.click());
  expect(onJob).toHaveBeenCalledWith("live-job");

  await act(async () => root.unmount());
  container.remove();
});
