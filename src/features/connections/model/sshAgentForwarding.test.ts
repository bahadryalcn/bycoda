import { expect, it, vi } from "vitest";
import { createReviewedAgentLaunch, type AgentForwardingReview } from "./sshAgentForwarding";

const ticket = (extra: Partial<AgentForwardingReview> = {}): AgentForwardingReview => ({
  reviewId: "10000000-0000-4000-8000-000000000001",
  endpointFingerprint: "a".repeat(64),
  expiresAt: 31000,
  agentAvailable: true,
  summary: { host: "host.test", user: "alice", port: 22, jumpHosts: [] },
  ...extra,
});
it("requires explicit review then consumes before launch, sending no client enable boolean", async () => {
  let finish!: () => void;
  const launch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = createReviewedAgentLaunch(
    { review: async () => ticket(), launch },
    () => 1000,
  );
  const target = { connectionId: "server" };
  await expect(controller.approveAndLaunch(target, ticket().reviewId)).rejects.toThrow();
  await controller.review(target);
  expect(launch).not.toHaveBeenCalled();
  const pending = controller.approveAndLaunch(target, ticket().reviewId);
  await expect(controller.approveAndLaunch(target, ticket().reviewId)).rejects.toThrow();
  expect(launch).toHaveBeenCalledExactlyOnceWith({ reviewId: ticket().reviewId });
  finish();
  await pending;
});
it("invalidates approval on target edits, expiration, cancellation and absent agent", async () => {
  let clock = 1000;
  const launch = vi.fn();
  const controller = createReviewedAgentLaunch(
    { review: async () => ticket(), launch },
    () => clock,
  );
  const first = { endpoint: { host: "host.test", user: "alice", port: 22 } };
  await controller.review(first);
  await expect(
    controller.approveAndLaunch(
      { endpoint: { ...first.endpoint, user: "bob" } },
      ticket().reviewId,
    ),
  ).rejects.toThrow();
  await controller.review(first);
  clock = 31000;
  await expect(controller.approveAndLaunch(first, ticket().reviewId)).rejects.toThrow();
  clock = 1000;
  await controller.review(first);
  controller.invalidate();
  await expect(controller.approveAndLaunch(first, ticket().reviewId)).rejects.toThrow();
  const unavailable = createReviewedAgentLaunch(
    { review: async () => ticket({ agentAvailable: false }), launch },
    () => clock,
  );
  await unavailable.review(first);
  await expect(unavailable.approveAndLaunch(first, ticket().reviewId)).rejects.toThrow();
  expect(launch).not.toHaveBeenCalled();
});
it("discards late cancelled review responses and fails closed for jumps or malformed fingerprints", async () => {
  let resolve!: (review: AgentForwardingReview) => void;
  const launch = vi.fn();
  const controller = createReviewedAgentLaunch(
    {
      review: () =>
        new Promise((done) => {
          resolve = done;
        }),
      launch,
    },
    () => 1000,
  );
  const request = controller.review({ connectionId: "server" });
  controller.invalidate();
  resolve(ticket());
  await expect(request).rejects.toThrow("cancelled");
  for (const invalid of [
    ticket({ endpointFingerprint: "not bound" }),
    ticket({ summary: { host: "target", port: 22, jumpHosts: ["hop"] } }),
  ]) {
    const blocked = createReviewedAgentLaunch({ review: async () => invalid, launch }, () => 1000);
    await expect(blocked.review({ connectionId: "server" })).rejects.toThrow();
  }
  expect(launch).not.toHaveBeenCalled();
});
it("requires a fresh review after failed native spawn, with no saved approval state", async () => {
  const launch = vi.fn().mockRejectedValue(new Error("native target changed"));
  const controller = createReviewedAgentLaunch(
    { review: async () => ticket(), launch },
    () => 1000,
  );
  await controller.review({ connectionId: "server" });
  await expect(
    controller.approveAndLaunch({ connectionId: "server" }, ticket().reviewId),
  ).rejects.toThrow("native target changed");
  await expect(
    controller.approveAndLaunch({ connectionId: "server" }, ticket().reviewId),
  ).rejects.toThrow("Review this SSH target");
  expect(launch).toHaveBeenCalledTimes(1);
});
