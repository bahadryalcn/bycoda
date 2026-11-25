import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { moderateFacebookComment, sendFacebookPrivateReply } from "./facebook-engagement";

describe("Facebook Page engagement", () => {
  it.each([
    ["hide", "/v25.0/12_34", "POST", { is_hidden: true }],
    ["unhide", "/v25.0/12_34", "POST", { is_hidden: false }],
    ["delete", "/v25.0/12_34", "DELETE", undefined],
    ["like", "/v25.0/12_34/likes", "POST", undefined],
    ["unlike", "/v25.0/12_34/likes", "DELETE", undefined],
  ] as const)("dispatches %s to the exact Graph comment", async (action, path, method, body) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
    await moderateFacebookComment(new SocialHttp(fetcher), "v25.0", "token", "12_34", action);
    const [raw, options] = fetcher.mock.calls[0];
    expect(new URL(String(raw)).pathname).toBe(path);
    expect(options?.method).toBe(method);
    expect(options?.body && JSON.parse(String(options.body))).toEqual(body);
  });

  const now = Date.parse("2026-11-18T12:00:00Z");
  function privateReply(created: string, allowed: boolean, author = "456") {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: "12_34",
          from: { id: author },
          created_time: created,
          can_reply_privately: allowed,
        }),
      )
      .mockImplementationOnce(async () => Response.json({ message_id: "m_1" }));
    const gate = vi.fn(async () => {});
    const send = () =>
      sendFacebookPrivateReply(
        new SocialHttp(fetcher),
        "v25.0",
        "123",
        "token",
        "12_34",
        "456",
        "Thank you",
        () => now,
        gate,
      );
    return { fetcher, gate, send };
  }

  it("rechecks the send gate and addresses the verified comment once", async () => {
    const { fetcher, gate, send } = privateReply("2026-11-17T12:00:00Z", true);
    await expect(send()).resolves.toEqual({ platformId: "m_1" });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[1][0]).toBe("https://graph.facebook.com/v25.0/123/messages");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      recipient: { comment_id: "12_34" },
      message: { text: "Thank you" },
    });
  });

  it.each([
    ["2026-11-11T12:00:00Z", true, "456"],
    ["2026-11-17T12:00:00Z", false, "456"],
    ["2026-11-17T12:00:00Z", true, "999"],
  ] as const)(
    "refuses an ineligible private reply before submit",
    async (created, allowed, author) => {
      const { fetcher, gate, send } = privateReply(created, allowed, author);
      await expect(send()).rejects.toMatchObject({
        detail: { reasonCode: "facebook.private_reply_unavailable" },
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(gate).not.toHaveBeenCalled();
    },
  );

  it("does not submit when the send gate rejects", async () => {
    const { fetcher, gate, send } = privateReply("2026-11-17T12:00:00Z", true);
    gate.mockRejectedValueOnce(new Error("Recipient is suppressed"));
    await expect(send()).rejects.toThrow("suppressed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
