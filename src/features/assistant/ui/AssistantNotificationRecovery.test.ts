// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../model/useAssistantControlSource", () => ({
  useAssistantControlSource: () => "registered",
}));
vi.mock("../../../shared/i18n", () => ({ t: (key: string) => key }));
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
  const container = document.createElement("div"),
    root = createRoot(container);
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
    [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(name))!;
  await act(async () => button("Project").click());
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
});
