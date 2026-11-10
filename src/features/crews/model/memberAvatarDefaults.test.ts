import { describe, expect, it } from "vitest";
import type { HostModelCatalog } from "../../connections/model/protocol";
import { createDefaultCrew } from "./crewDefaults";
import { DEFAULT_MEMBER_AVATARS } from "./memberAvatarDefaults";
import {
  AVATAR_ACCESSORY,
  AVATAR_FACE,
  AVATAR_HEADWEAR,
  AVATAR_OUTFIT,
  AVATAR_PALETTE_COUNT,
  type MemberAvatarTraits,
} from "./memberAvatarTraits";

describe("DEFAULT_MEMBER_AVATARS", () => {
  const catalog = {
    models: { codex: [{ id: "m", name: "Model M", harness: "codex" }] },
    errors: {},
  } as unknown as HostModelCatalog;
  const defaultIds = createDefaultCrew(catalog, 0)!.agents.map((agent) => agent.id);
  const entries = Object.entries(DEFAULT_MEMBER_AVATARS);

  it("has one complete look for each of the 17 default members", () => {
    expect(entries).toHaveLength(17);
    for (const [, look] of entries) {
      const traits = look as MemberAvatarTraits;
      expect(AVATAR_HEADWEAR).toContain(traits.headwear);
      expect(AVATAR_FACE).toContain(traits.face);
      expect(typeof traits.glasses).toBe("boolean");
      expect(AVATAR_OUTFIT).toContain(traits.outfit);
      expect(Number.isInteger(traits.palette)).toBe(true);
      expect(traits.palette).toBeGreaterThanOrEqual(0);
      expect(traits.palette).toBeLessThan(AVATAR_PALETTE_COUNT);
      expect(AVATAR_ACCESSORY).toContain(traits.accessory);
    }
  });

  it("gives every member a distinct signature", () => {
    const signatures = entries.map(([, t]) =>
      [t!.headwear, t!.face, t!.glasses, t!.outfit, t!.palette].join("|"),
    );
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("keys every look by a seeded default member id", () => {
    expect(defaultIds).toHaveLength(17);
    for (const key of Object.keys(DEFAULT_MEMBER_AVATARS)) {
      expect(defaultIds).toContain(key);
    }
  });
});
