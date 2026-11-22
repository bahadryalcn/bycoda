import { expect, it, vi } from "vitest";

vi.mock("./sessionOrganizationStore", () => ({ mutateSessionOrganization: vi.fn() }));

import {
  canOrganizeSessions,
  organizationFoldersForProject,
} from "./sessionOrganizationOperations";

it.each(["", "~"])("reports no organizable project for %j", (cwd) => {
  expect(canOrganizeSessions(cwd)).toBe(false);
});

it("accepts a real project path", () => {
  expect(canOrganizeSessions("/workspace/project")).toBe(true);
});

it("keeps a defensive error that is not the user-facing sentence", () => {
  expect(() => organizationFoldersForProject({ folders: {}, order: {} }, "~")).toThrow(
    "Open a project before organizing sessions.",
  );
});
