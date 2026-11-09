import { describe, expect, it } from "vitest";
import { avatarInitials } from "./SocialAvatar";

describe("avatarInitials", () => {
  it("takes the first letters of the first and last word", () => {
    expect(avatarInitials("Fixture Person A")).toBe("FA");
    expect(avatarInitials("ada lovelace")).toBe("AL");
  });

  it("uses one letter for a single word or handle", () => {
    expect(avatarInitials("@fixture_brand")).toBe("FB");
    expect(avatarInitials("@fixture")).toBe("F");
    expect(avatarInitials("Ömer")).toBe("Ö");
  });

  it("falls back to a question mark for an empty name", () => {
    expect(avatarInitials("   ")).toBe("?");
    expect(avatarInitials("")).toBe("?");
  });
});
