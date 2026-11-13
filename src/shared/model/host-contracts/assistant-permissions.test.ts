import { describe, expect, it } from "vitest";
import { AssistantProfilePatchSchema } from "./assistant-profile";
import { AssistantResponseValidationSchema } from "./assistant";
import { assistantProfileDefaults } from "../../../../host/assistant/profile-defaults";

describe("assistant permission profile mirrors", () => {
  it("accepts legacy profiles without upgrading their authority", () => {
    const { permissionLevel, permissionProjectIds, criticalExclusions, ...legacy } =
      assistantProfileDefaults;
    expect(permissionLevel).toBeUndefined();
    expect(
      AssistantResponseValidationSchema.parse({ profile: legacy }).profile?.permissionLevel,
    ).toBeUndefined();
    expect(permissionProjectIds).toEqual([]);
    expect(criticalExclusions).toContain("spend");
  });

  it("requires explicit known levels, exclusions and bounded project identifiers", () => {
    expect(
      AssistantProfilePatchSchema.parse({ permissionLevel: "projects", permissionProjectIds: [] }),
    ).toEqual({ permissionLevel: "projects", permissionProjectIds: [] });
    expect(AssistantProfilePatchSchema.safeParse({ permissionLevel: "full" }).success).toBe(false);
    expect(AssistantProfilePatchSchema.safeParse({ permissionProjectIds: [""] }).success).toBe(
      false,
    );
    expect(AssistantProfilePatchSchema.safeParse({ criticalExclusions: ["unknown"] }).success).toBe(
      false,
    );
    expect(AssistantProfilePatchSchema.safeParse({ nativeGrant: true }).success).toBe(false);
  });
});
