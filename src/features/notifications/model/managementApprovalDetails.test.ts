import { describe, expect, it } from "vitest";
import {
  commitMessageParts,
  managementFields,
  parseManagementApprovalDetails,
} from "./managementApprovalDetails";

const valid = {
  kind: "management",
  action: "git.commit",
  project: { kind: "path", value: "G:\\repo" },
  input: { requestId: "r", expectedStatus: "a".repeat(64), message: "Fix login\n\nBody" },
};

describe("management approval details", () => {
  it("accepts only the exact native shape", () => {
    expect(parseManagementApprovalDetails(valid)).toEqual({
      action: "git.commit",
      project: { kind: "path", value: "G:\\repo" },
      input: valid.input,
    });
    expect(parseManagementApprovalDetails({ ...valid, notice: "Publishes commits." })?.notice).toBe(
      "Publishes commits.",
    );
    for (const broken of [
      { ...valid, kind: "inbox" },
      { ...valid, action: "" },
      { ...valid, project: { kind: "path" } },
      { ...valid, project: { kind: "other", value: "x" } },
      { ...valid, input: [] },
      { ...valid, notice: 3 },
      null,
    ])
      expect(parseManagementApprovalDetails(broken)).toBeUndefined();
    expect(
      parseManagementApprovalDetails({ ...valid, project: { kind: "application" } })?.project,
    ).toEqual({ kind: "application" });
  });

  it("leaves idempotency keys and revision guards to the exact text", () => {
    expect(
      managementFields({
        requestId: "r",
        operationId: "o",
        expectedStatus: "s",
        expectedRevision: 3,
        paths: ["a.ts", "b.ts"],
        expected: "kept",
        empty: null,
      }),
    ).toEqual([
      { key: "paths", value: '[\n  "a.ts",\n  "b.ts"\n]', multiline: true },
      { key: "expected", value: "kept", multiline: false },
    ]);
  });

  it("splits a commit message into subject and body", () => {
    expect(commitMessageParts("Fix login\n\nOwner sign-ins\nanswer alike")).toEqual({
      subject: "Fix login",
      body: "Owner sign-ins\nanswer alike",
    });
    expect(commitMessageParts("Only subject")).toEqual({ subject: "Only subject", body: "" });
  });
});
