import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOCIAL_READ_ACTIONS } from "./socialActions";

const { remoteRequest } = vi.hoisted(() => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest }));

import { socialClient } from "./socialClient";

/** The params object of the last social.request call. */
function lastSocialPayload(): Record<string, unknown> {
  const call = remoteRequest.mock.calls.at(-1);
  expect(call?.[1]).toBe("social.request");
  return call?.[2] as Record<string, unknown>;
}

beforeEach(() => {
  remoteRequest.mockReset();
  remoteRequest.mockResolvedValue(undefined);
});

describe("socialClient request ids", () => {
  it.each(SOCIAL_READ_ACTIONS)("sends no requestId for read-only action %s", async (action) => {
    await socialClient("m1").request(action);
    const payload = lastSocialPayload();
    expect(payload.action).toBe(action);
    expect("requestId" in payload).toBe(false);
  });

  it("keeps the legacy read-only actions without a requestId", async () => {
    await socialClient("m1").request("thread.page", { threadId: "t1" });
    expect("requestId" in lastSocialPayload()).toBe(false);
  });

  it("forwards the caller's requestId on a write action", async () => {
    await socialClient("m1").people.update({ personId: "p1", patch: { notes: "x" } }, "req-1");
    const payload = lastSocialPayload();
    expect(payload).toEqual({
      action: "people.update",
      input: { personId: "p1", patch: { notes: "x" } },
      requestId: "req-1",
    });
  });

  it("generates a requestId for a write action when the caller gives none", async () => {
    await socialClient("m1").ai.stop();
    const payload = lastSocialPayload();
    expect(payload.action).toBe("ai.stop");
    expect(typeof payload.requestId).toBe("string");
    expect(String(payload.requestId).length).toBeGreaterThan(0);
  });

  it("sends the owner confirmation with people.delete", async () => {
    await socialClient("m1").people.delete("p1", "req-2");
    expect(lastSocialPayload()).toMatchObject({
      action: "people.delete",
      input: { personId: "p1", confirm: "DELETE_PERSON" },
      requestId: "req-2",
    });
  });

  it("sends the ids that the Host reads for lists and capture rules", async () => {
    await socialClient("m1").lists.delete("l1", "req-3");
    expect(lastSocialPayload()).toEqual({
      action: "lists.delete",
      input: { id: "l1" },
      requestId: "req-3",
    });
    await socialClient("m1").captureRules.delete("r1", "req-4");
    expect(lastSocialPayload()).toMatchObject({
      action: "captureRules.delete",
      input: { id: "r1" },
    });
    await socialClient("m1").captureRules.setEnabled({ id: "r1", enabled: false }, "req-5");
    expect(lastSocialPayload()).toMatchObject({
      action: "captureRules.setEnabled",
      input: { id: "r1", enabled: false },
    });
  });

  it("sends people.score as a write with a requestId", async () => {
    await socialClient("m1").people.score("p1", "req-6");
    expect(lastSocialPayload()).toEqual({
      action: "people.score",
      input: { personId: "p1" },
      requestId: "req-6",
    });
  });

  it("calls the live view methods as their own RPC methods", async () => {
    const client = socialClient("m1");
    await client.browserViewFrame("a1");
    await client.browserViewInput("a1", { type: "scroll", deltaY: 120 });
    expect(remoteRequest.mock.calls[0]?.[1]).toBe("social.browser.view.frame");
    expect(remoteRequest.mock.calls[0]?.[2]).toEqual({ accountId: "a1" });
    expect(remoteRequest.mock.calls[1]?.[1]).toBe("social.browser.view.input");
    expect(remoteRequest.mock.calls[1]?.[2]).toEqual({
      accountId: "a1",
      event: { type: "scroll", deltaY: 120 },
    });
  });
});
