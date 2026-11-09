// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAcceptedQueueDeparture } from "./useAcceptedQueueDeparture";
import type { DeliveryProgress } from "../model/deliveryProgress";
import type { QueuedMessage } from "../model/session";

const row: QueuedMessage = { id: "one", text: "First", attachments: [] };
const pending: DeliveryProgress = {
  operationId: 1,
  messageId: "one",
  stage: "preparing",
  startedAt: 1,
};
function Fixture({ rows, progress }: { rows: QueuedMessage[]; progress?: DeliveryProgress }) {
  const departure = useAcceptedQueueDeparture(rows, progress);
  return createElement("div", { "data-count": rows.length }, departure?.id ?? "");
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("animates only the accepted removed row, then cleans up", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = async (rows: QueuedMessage[], progress?: DeliveryProgress) =>
    act(async () => root.render(createElement(Fixture, { rows, progress })));
  await render([row], pending);
  await render([], { ...pending, stage: "accepted" });
  expect(container.firstElementChild?.getAttribute("data-count")).toBe("0");
  expect(container.textContent).toBe("one");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
  });
  expect(container.textContent).toBe("");
  await act(async () => root.unmount());
});
it("does not animate deletion, review discard, or a remounted acceptance", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(Fixture, { rows: [row], progress: pending })));
  await act(async () => root.render(createElement(Fixture, { rows: [], progress: pending })));
  expect(container.textContent).toBe("");
  await act(async () =>
    root.render(createElement(Fixture, { rows: [], progress: { ...pending, stage: "accepted" } })),
  );
  expect(container.textContent).toBe("");
  await act(async () =>
    root.render(
      createElement(Fixture, {
        rows: [],
        progress: { ...pending, stage: "accepted", noticeOnly: true },
      }),
    ),
  );
  expect(container.textContent).toBe("");
  await act(async () => root.unmount());
  const next = createRoot(container);
  await act(async () =>
    next.render(createElement(Fixture, { rows: [], progress: { ...pending, stage: "accepted" } })),
  );
  expect(container.textContent).toBe("");
  await act(async () => next.unmount());
});
