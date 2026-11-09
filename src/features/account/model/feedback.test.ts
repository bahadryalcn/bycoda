import { AccountApiError } from "@bycoda/account-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_FEEDBACK_DRAFT,
  FEEDBACK_MESSAGE_MAX,
  submitFeedback,
  validateFeedbackDraft,
  type FeedbackDraft,
} from "./feedback";

const draft: FeedbackDraft = { ...EMPTY_FEEDBACK_DRAFT, message: " Dark mode please " };
const info = {
  appVersion: "1.2.3",
  platform: "windows",
  osVersion: "11",
  channel: "stable",
} as const;
const make = () => {
  type Send = (input: { body: unknown }) => Promise<{ id: string; createdAt: string }>;
  const sendFeedback = vi.fn<Send>(async () => ({ id: "fb_1", createdAt: "x" }));
  const sendAnonymousFeedback = vi.fn<Send>(async () => ({ id: "fb_2", createdAt: "x" }));
  return { sendFeedback, sendAnonymousFeedback };
};
const deps = () => ({ deviceInfo: vi.fn(async () => ({ ...info })) });

describe("feedback validation", () => {
  it("requires a message within the limit", () => {
    expect(validateFeedbackDraft({ ...draft, message: "  " })).toEqual(["message-missing"]);
    expect(
      validateFeedbackDraft({ ...draft, message: "x".repeat(FEEDBACK_MESSAGE_MAX + 1) }),
    ).toEqual(["message-long"]);
    expect(validateFeedbackDraft(draft)).toEqual([]);
  });
});

describe("submitFeedback", () => {
  it("uses the account route when signed in and sends no context by default", async () => {
    const api = make();
    const d = deps();
    const result = await submitFeedback(api as never, draft, true, d);
    expect(result).toEqual({ status: "sent", reference: "fb_1" });
    expect(api.sendAnonymousFeedback).not.toHaveBeenCalled();
    expect(d.deviceInfo).not.toHaveBeenCalled();
    expect(api.sendFeedback.mock.calls[0]![0].body).toEqual({
      kind: "idea",
      message: "Dark mode please",
    });
  });

  it("uses the anonymous route for guests and attaches only the ticked context and rating", async () => {
    const api = make();
    const result = await submitFeedback(
      api as never,
      { ...draft, rating: 4, includeContext: true },
      false,
      deps(),
    );
    expect(result).toEqual({ status: "sent", reference: "fb_2" });
    expect(api.sendAnonymousFeedback.mock.calls[0]![0].body).toEqual({
      kind: "idea",
      message: "Dark mode please",
      rating: 4,
      context: info,
    });
  });

  it("does not call the API for an invalid draft", async () => {
    const api = make();
    expect(await submitFeedback(api as never, { ...draft, message: "" }, true, deps())).toEqual({
      status: "invalid",
      issues: ["message-missing"],
    });
    expect(api.sendFeedback).not.toHaveBeenCalled();
  });

  it("maps a rate limit and reports other failures", async () => {
    const limited = {
      sendFeedback: async () => {
        throw new AccountApiError(429, "rate_limited", "slow");
      },
    };
    expect(await submitFeedback(limited as never, draft, true, deps())).toEqual({
      status: "rate-limited",
    });
    const onFailure = vi.fn();
    const broken = {
      sendFeedback: async () => {
        throw new Error("down");
      },
    };
    expect(await submitFeedback(broken as never, draft, true, { ...deps(), onFailure })).toEqual({
      status: "failed",
    });
    expect(onFailure).toHaveBeenCalledOnce();
  });
  it("sends the linked logs after the receipt and never lets them change the result", async () => {
    const api = make();
    const sendLogs = vi.fn(async () => "failed" as const);
    const result = await submitFeedback(api as never, { ...draft, attachLogs: true }, true, {
      ...deps(),
      sendLogs,
    });
    expect(result).toEqual({ status: "sent", reference: "fb_1", logs: "failed" });
    expect(sendLogs).toHaveBeenCalledWith({ feedbackId: "fb_1", note: "Dark mode please" });

    const throwing = await submitFeedback(api as never, { ...draft, attachLogs: true }, true, {
      ...deps(),
      sendLogs: async () => {
        throw new Error("boom");
      },
    });
    expect(throwing).toMatchObject({ status: "sent", logs: "failed" });

    const unticked = vi.fn(async () => "sent" as const);
    await submitFeedback(api as never, draft, true, { ...deps(), sendLogs: unticked });
    expect(unticked).not.toHaveBeenCalled();
  });
});
