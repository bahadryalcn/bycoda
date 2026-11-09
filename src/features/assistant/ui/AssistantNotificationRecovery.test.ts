// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../model/useAssistantControlSource", () => ({
  useAssistantControlSource: () => "registered",
}));
import { AssistantNotificationRecovery } from "./AssistantNotificationRecovery";

it("checks only the selected project's original notification status and never resends", async () => {
  const request = vi.fn(async (input: { op: string }) =>
    input.op === "threads.open"
      ? { thread: { id: "room" } }
      : {
          observationDeliveries: [
            {
              notificationId: "notice-1",
              projectId: "project",
              state: input.op === "observation.delivery.refresh" ? "accepted" : "unknown",
            },
          ],
        },
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div"),
    root = createRoot(container);
  document.body.append(container);
  await act(async () =>
    root.render(
      createElement(AssistantNotificationRecovery, {
        projects: [{ id: "project", name: "Project" }],
        environmentId: "host",
        request: request as never,
      }),
    ),
  );
  await act(async () => {
    const details = container.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes(name),
    )!;
  // One project picker and one check button, never one button per project.
  expect(button("Project")).toBeUndefined();
  expect(button("Check notifications").disabled).toBe(true);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
  );
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes("Project"),
  )!;
  await act(async () => option.click());
  expect(button("Check notifications").disabled).toBe(false);
  await act(async () => button("Check notifications").click());
  expect(container.textContent).toContain("notice-1");
  expect(container.textContent).toContain("Outcome unknown");
  await act(async () => button("Check original status").click());
  expect(container.textContent).toContain("Native queue accepted; display not confirmed");
  expect(request.mock.calls.map(([input]) => input.op)).toEqual([
    "threads.open",
    "observation.delivery.list",
    "observation.delivery.refresh",
  ]);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
