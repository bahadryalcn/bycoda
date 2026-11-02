// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type {
  AssistantNotification,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import { AssistantNotificationDelivery } from "./assistantNotifications";
const notification: AssistantNotification = {
  id: "event-one",
  kind: "job.done",
  title: "Finished",
  body: "A job finished",
  createdAt: 1,
  eligible: true,
  deferredReason: null,
  projectId: "project-one",
};
const snapshot = {
  profile: { enabled: true, setupComplete: true },
  notifications: [notification],
} as AssistantSnapshot;
beforeEach(() => localStorage.clear());
function fixture() {
  const request = vi.fn(async () => ({ ok: true })),
    deliver = vi.fn(async () => true),
    lead = vi.fn(async () => true),
    projectPath = vi.fn(async () => "/work/app"),
    current = vi.fn(async () => notification);
  const ports = { request, deliver, lead, projectPath, current, storage: localStorage };
  return { ...ports, ports, pump: new AssistantNotificationDelivery(ports) };
}
it("retries only acknowledgement after native success, including a new bridge instance", async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error("Host disconnected"));
  await f.pump.check(snapshot);
  expect(f.deliver).toHaveBeenCalledOnce();
  const restarted = new AssistantNotificationDelivery(f.ports);
  await restarted.check(snapshot);
  expect(f.deliver).toHaveBeenCalledOnce();
  expect(f.request).toHaveBeenCalledTimes(2);
});
it("leaves native suppression and deferred events unacknowledged", async () => {
  const f = fixture();
  f.deliver.mockResolvedValue(false);
  await f.pump.check(snapshot);
  expect(f.request).not.toHaveBeenCalled();
  await f.pump.check({
    ...snapshot,
    notifications: [{ ...notification, eligible: false, deferredReason: "dnd" }],
  });
  expect(f.deliver).toHaveBeenCalledOnce();
});
it("rechecks current Host eligibility, project identity and lead ownership before delivery", async () => {
  const f = fixture();
  f.current.mockResolvedValueOnce({ ...notification, eligible: false, deferredReason: "quiet" });
  await f.pump.check(snapshot);
  expect(f.deliver).not.toHaveBeenCalled();
  f.projectPath.mockResolvedValueOnce(undefined!);
  await f.pump.check(snapshot);
  expect(f.deliver).not.toHaveBeenCalled();
  f.lead.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await f.pump.check(snapshot);
  expect(f.deliver).not.toHaveBeenCalled();
});
it("serializes overlapping checks while actual native delivery is pending", async () => {
  const f = fixture();
  let finish!: (value: boolean) => void;
  f.deliver.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = f.pump.check(snapshot);
  await vi.waitFor(() => expect(f.deliver).toHaveBeenCalledOnce());
  await f.pump.check(snapshot);
  expect(f.deliver).toHaveBeenCalledOnce();
  finish(true);
  await first;
  expect(f.request).toHaveBeenCalledWith({ op: "notifications.ack", id: "event-one" });
});
it("resolves every contributing project and does not deliver a partial or unknown private summary", async () => {
  const f = fixture();
  const multi = { ...notification, projectIds: ["project-one", "project-two"] };
  f.current.mockResolvedValue(multi);
  f.projectPath.mockImplementation(async (id) => (id === "project-one" ? "/one" : "/two"));
  await f.pump.check({ ...snapshot, notifications: [multi] });
  expect(f.deliver).toHaveBeenCalledWith(multi, "/one", ["/one", "/two"]);
  const missing = fixture();
  missing.current.mockResolvedValue(multi);
  missing.projectPath.mockResolvedValue(undefined!);
  await missing.pump.check({ ...snapshot, notifications: [multi] });
  expect(missing.deliver).not.toHaveBeenCalled();
  const legacy = fixture();
  const summary = { ...notification, kind: "briefing.ready" as const, projectId: undefined };
  legacy.current.mockResolvedValue(summary);
  await legacy.pump.check({ ...snapshot, notifications: [summary] });
  expect(legacy.deliver).not.toHaveBeenCalled();
});
