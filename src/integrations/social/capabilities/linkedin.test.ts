import { describe, expect, it } from "vitest";
import { browserOperations } from "../browserCapabilities";
import { linkedinCapabilities } from "./linkedin";

describe("LinkedIn capability map", () => {
  const org = linkedinCapabilities("organization").api;
  const member = linkedinCapabilities("member").api;

  it("marks implemented API operations as supported only for the matching account type", () => {
    expect(org.publish.unsupported).toBeFalsy();
    expect(org.media.unsupported).toBeFalsy();
    expect(org["audience.collect"].unsupported).toBeFalsy();
    expect(member.publish.unsupported).toBeFalsy();
    expect(member.media.unsupported).toBe(true);
    expect(member["audience.collect"].unsupported).toBe(true);
  });

  it("leaves operations neither API nor browser implements as not supported", () => {
    for (const operation of ["search", "webhook", "analytics", "delete", "profile.read"] as const) {
      expect(org[operation].unsupported).toBe(true);
      expect(member[operation].unsupported).toBe(true);
    }
    for (const operation of ["search", "webhook"] as const)
      expect(browserOperations({ platform: "linkedin", accountType: "member" })).not.toContain(
        operation,
      );
  });

  it("keeps inbox operations API-unsupported and browser-only for member accounts", () => {
    expect(org["inbox.read"].unsupported).toBe(true);
    expect(member["inbox.read"].unsupported).toBe(true);
    expect(browserOperations({ platform: "linkedin", accountType: "member" })).toEqual(
      expect.arrayContaining(["inbox.read", "message.reply", "message.start"]),
    );
    expect(browserOperations({ platform: "linkedin", accountType: "organization" })).not.toContain(
      "inbox.read",
    );
  });

  it("carries no AI-exclusion wording in its requirement reasons", () => {
    for (const row of [...Object.values(org), ...Object.values(member)])
      expect(row.reason).not.toMatch(/\bAI\b|artificial|generation/i);
  });
});
