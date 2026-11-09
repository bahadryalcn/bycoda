import { expect, it } from "vitest";
import type { Capability, SocialOperation } from "../../model/social";
import { capabilityReasonText, needsConnection, operationText } from "./capabilityText";

const OPERATIONS: SocialOperation[] = [
  "publish",
  "media",
  "comments.read",
  "reply",
  "comment",
  "inbox.read",
  "message.reply",
  "message.start",
  "search",
  "webhook",
  "poll",
  "delete",
  "analytics",
  "audience.collect",
  "profile.read",
];

type Row = Pick<Capability, "status" | "reasonCode">;

it("names every operation in plain words, never by its raw key", () => {
  const names = OPERATIONS.map(operationText);
  for (const [index, operation] of OPERATIONS.entries()) {
    expect(names[index]).toBeTruthy();
    expect(names[index]).not.toBe(operation);
    expect(names[index]).not.toContain(".");
  }
  expect(new Set(names).size).toBe(OPERATIONS.length);
});

it.each<[Row, boolean]>([
  [{ status: "expired", reasonCode: "anything" }, true],
  [{ status: "unsupported", reasonCode: "browser.reconnect" }, true],
  [{ status: "unsupported", reasonCode: "browser.session_expired" }, true],
  [{ status: "unsupported", reasonCode: "api.token_expired" }, true],
  [{ status: "unsupported", reasonCode: "linkedin.message.api_required" }, true],
  [{ status: "unsupported", reasonCode: "unsupported.platform" }, false],
  [{ status: "pending", reasonCode: "x.webhook.external_setup" }, false],
  [{ status: "available", reasonCode: "api.ready" }, false],
])("decides whether %j is fixed by connecting", (row, expected) => {
  expect(needsConnection(row)).toBe(expected);
});

it.each<[Row, string]>([
  [{ status: "available", reasonCode: "browser.ready" }, "Ready"],
  [{ status: "available", reasonCode: "some.new.code" }, "Ready"],
  [{ status: "pending", reasonCode: "some.new.code" }, "Checking…"],
  [{ status: "expired", reasonCode: "some.new.code" }, "Connection needed"],
  [{ status: "unsupported", reasonCode: "some.new.code" }, "Not available yet"],
])("falls back to the status for an unknown reason code: %j", (row, text) => {
  expect(capabilityReasonText(row)).toBe(text);
  expect(capabilityReasonText(row)).not.toContain(row.reasonCode);
});
