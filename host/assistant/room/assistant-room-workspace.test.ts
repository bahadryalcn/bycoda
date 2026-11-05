import { expect, it } from "vitest";
import { validateRoomWorkspaceAction } from "./assistant-room-workspace";
it("requires exact operation identity, explicit target and nonempty submitted work", () => {
  expect(() =>
    validateRoomWorkspaceAction(
      "workspace.sessions.open",
      { requestId: "a", sessionId: "s", projectPath: "forged" },
      "a",
    ),
  ).toThrow();
  expect(() =>
    validateRoomWorkspaceAction("workspace.sessions.stop", { requestId: "a", sessionId: "s" }, "b"),
  ).toThrow("identity changed");
  expect(() =>
    validateRoomWorkspaceAction(
      "workspace.sessions.create",
      { requestId: "a", prompt: " ", submit: true },
      "a",
    ),
  ).toThrow();
  expect(validateRoomWorkspaceAction("workspace.sessions.create", { requestId: "a" }, "a")).toEqual(
    { requestId: "a" },
  );
});
it("retains the exact organization input for owner status", () => {
  const originalInput = {
    requestId: "original",
    expectedRevision: "a".repeat(64),
    change: { kind: "projectName", name: "Name" },
  };
  expect(validateRoomWorkspaceAction("organization.patch", originalInput, "original")).toEqual(
    originalInput,
  );
  expect(
    validateRoomWorkspaceAction(
      "workspace.operation.status",
      { operationId: "original", action: "organization.patch", originalInput },
      "status",
    ),
  ).toMatchObject({ originalInput });
  expect(() =>
    validateRoomWorkspaceAction(
      "workspace.operation.status",
      { operationId: "other", action: "organization.patch", originalInput },
      "status",
    ),
  ).toThrow("identity changed");
});
