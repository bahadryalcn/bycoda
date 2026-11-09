import { describe, expect, it } from "vitest";
import {
  ENABLED_MESSAGING_PROVIDERS,
  isMessagingProviderEnabled,
  isPausedMessagingProvider,
} from "./messagingProviders";

describe("messaging provider switch", () => {
  it("offers email and Slack and pauses Discord and Teams", () => {
    expect(ENABLED_MESSAGING_PROVIDERS).toEqual(["email", "slack"]);
    expect(isMessagingProviderEnabled("slack")).toBe(true);
    expect(isMessagingProviderEnabled("discord")).toBe(false);
    expect(isPausedMessagingProvider("discord")).toBe(true);
    expect(isPausedMessagingProvider("teams")).toBe(true);
  });

  it("never treats other integration ids as paused messaging providers", () => {
    expect(isPausedMessagingProvider("email")).toBe(false);
    expect(isPausedMessagingProvider("github")).toBe(false);
    expect(isPausedMessagingProvider("toString")).toBe(false);
  });
});
