import { describe, expect, it } from "vitest";
import type { OwnerSecret } from "./secretsClient";
import { groupSecretsByProject } from "./secretsGroups";

const secret = (over: Partial<OwnerSecret>): OwnerSecret => ({
  secretRef: "r",
  projectId: "p1",
  name: "api",
  purpose: "",
  createdAt: 1,
  expiresAt: null,
  materialized: false,
  ...over,
});

describe("groupSecretsByProject", () => {
  it("groups by project, sorts projects by name and secrets newest first", () => {
    const groups = groupSecretsByProject(
      [
        secret({ secretRef: "a", projectId: "p2", createdAt: 5 }),
        secret({ secretRef: "b", projectId: "p1", createdAt: 1 }),
        secret({ secretRef: "c", projectId: "p1", createdAt: 9 }),
      ],
      new Map([
        ["p1", "Zeta"],
        ["p2", "Alpha"],
      ]),
    );
    expect(groups.map((group) => group.title)).toEqual(["Alpha", "Zeta"]);
    expect(groups[1].secrets.map((entry) => entry.secretRef)).toEqual(["c", "b"]);
  });

  it("falls back to the project id when the project is unknown", () => {
    expect(groupSecretsByProject([secret({ projectId: "gone" })], new Map())[0].title).toBe("gone");
  });
});
