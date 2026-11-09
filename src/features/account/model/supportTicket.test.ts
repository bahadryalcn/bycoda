import { AccountApiError } from "@bycoda/account-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  SUPPORT_BODY_MAX,
  SUPPORT_SUBJECT_MAX,
  submitSupportTicket,
  validateSupportDraft,
  type SupportDraft,
} from "./supportTicket";

const draft: SupportDraft = {
  subject: " Sync stuck ",
  body: "It never finishes.",
  category: "bug",
};
const api = (createSupportTicket: (arg: { body: unknown }) => Promise<unknown>) =>
  ({ createSupportTicket }) as never;

describe("support draft validation", () => {
  it("requires a subject and a message", () => {
    expect(validateSupportDraft({ ...draft, subject: "  ", body: "" })).toEqual([
      "subject-missing",
      "body-missing",
    ]);
    expect(validateSupportDraft(draft)).toEqual([]);
  });

  it("enforces the contract limits on trimmed text", () => {
    expect(
      validateSupportDraft({
        ...draft,
        subject: "x".repeat(SUPPORT_SUBJECT_MAX + 1),
        body: "y".repeat(SUPPORT_BODY_MAX + 1),
      }),
    ).toEqual(["subject-long", "body-long"]);
    expect(
      validateSupportDraft({ ...draft, subject: ` ${"x".repeat(SUPPORT_SUBJECT_MAX)} ` }),
    ).toEqual([]);
  });
});

describe("support ticket submit", () => {
  it("sends only subject, body and category and returns the reference", async () => {
    const create = vi.fn(async (_arg: { body: unknown }) => ({
      id: "tkt_1",
      createdAt: "2026-11-08T10:00:00Z",
    }));
    await expect(submitSupportTicket(api(create), draft)).resolves.toEqual({
      status: "sent",
      reference: "tkt_1",
    });
    expect(create).toHaveBeenCalledWith({
      body: { subject: "Sync stuck", body: "It never finishes.", category: "bug" },
    });
  });

  it("does not call the API for an invalid draft", async () => {
    const create = vi.fn(async (_arg: { body: unknown }) => ({}));
    const result = await submitSupportTicket(api(create), { ...draft, body: " " });
    expect(result).toEqual({ status: "invalid", issues: ["body-missing"] });
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a rate limit without treating it as a session failure", async () => {
    const onFailure = vi.fn();
    const create = async () => {
      throw new AccountApiError(429, "rate_limited", "slow down", "req_1");
    };
    await expect(submitSupportTicket(api(create), draft, onFailure)).resolves.toEqual({
      status: "rate-limited",
    });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("routes other failures to the controller and reports failed", async () => {
    const onFailure = vi.fn(async () => {
      throw new Error("again");
    });
    const create = async () => {
      throw new TypeError("network");
    };
    await expect(submitSupportTicket(api(create), draft, onFailure)).resolves.toEqual({
      status: "failed",
    });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
