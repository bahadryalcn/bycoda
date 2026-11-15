import { expect, it, vi } from "vitest";
import type { Session } from "../../sessions";
import { queueEligible } from "./sharedLocalQueueModel";

const mocks = vi.hoisted(() => ({ binding: vi.fn() }));
vi.mock("./sessionExecutionBinding", () => ({ hostSessionBinding: mocks.binding }));

const session = (id: string) =>
  ({ id, cwd: "/repo", blocks: [{ id: "u", role: "user", text: "task" }] }) as Session;

it("keeps only the conversation with an unreadable owner out of shared queues", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.binding.mockImplementation(({ id }: { id: string }) => {
    if (id === "broken") throw new Error("The session owner has no durable record.");
    return undefined;
  });
  expect(queueEligible(session("broken"))).toBe(false);
  expect(queueEligible(session("broken"))).toBe(false);
  expect(queueEligible(session("fine"))).toBe(true);
  // Named once, not on every pass.
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
