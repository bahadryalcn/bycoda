import { expect, it } from "vitest";
import { validateRoomOrganization } from "./assistant-room-organization";

it("binds an organization write to its request and rejects injected target identity", () => {
  const input = { requestId: "original", expectedRevision: "a".repeat(64), change: { kind: "projectName", name: "Name" } };
  expect(validateRoomOrganization("projects.organization.patch", input, "original")).toEqual(input);
  expect(() => validateRoomOrganization("projects.organization.patch", input, "other")).toThrow("identity changed");
  expect(() => validateRoomOrganization("projects.organization.patch", { ...input, cwd: "/foreign" }, "original")).toThrow();
  expect(() => validateRoomOrganization("projects.organization.read", { projectId: "forged" }, "r")).toThrow();
});
