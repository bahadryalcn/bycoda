import { describe, expect, it } from "vitest";
import {
  discordSaveInput,
  parseChannelIds,
  slackSaveInput,
  slackSignInSaveInput,
  teamsSaveInput,
} from "./chatAccountInputs";

describe("Discord channel IDs", () => {
  it("splits commas, spaces and new lines and drops duplicates", () => {
    expect(parseChannelIds(" 111111, 222222\n\n333333 111111,")).toEqual([
      "111111",
      "222222",
      "333333",
    ]);
    expect(parseChannelIds(" \n, ")).toEqual([]);
  });

  it("rejects non-numeric IDs and requires a token only for a new bot", () => {
    const invalid = discordSaveInput("bot-fixture", "123456, general");
    expect(invalid.ok).toBe(false);
    expect(!invalid.ok && invalid.error).toContain("general");
    expect(discordSaveInput("", "123456").ok).toBe(false);
    expect(discordSaveInput("", "123456", "acct-1")).toEqual({
      ok: true,
      input: { id: "acct-1", provider: "discord", config: { channelIds: ["123456"] } },
    });
    expect(discordSaveInput(" bot-fixture ", "123456")).toEqual({
      ok: true,
      input: {
        provider: "discord",
        config: { channelIds: ["123456"] },
        secret: { botToken: "bot-fixture" },
      },
    });
  });
});

describe("Slack and Teams inputs", () => {
  it("requires a Slack token and replaces it on the edited workspace", () => {
    expect(slackSaveInput("  ").ok).toBe(false);
    expect(slackSaveInput("xoxb-fixture", "acct-2")).toEqual({
      ok: true,
      input: { id: "acct-2", provider: "slack", config: {}, secret: { botToken: "xoxb-fixture" } },
    });
  });

  it("saves a Slack browser sign-in by handle without a secret", () => {
    expect(slackSignInSaveInput("").ok).toBe(false);
    expect(slackSignInSaveInput("browser-1")).toEqual({
      ok: true,
      input: { provider: "slack", config: {}, authHandle: "browser-1" },
    });
    expect(slackSignInSaveInput("browser-2", "acct-2")).toEqual({
      ok: true,
      input: { id: "acct-2", provider: "slack", config: {}, authHandle: "browser-2" },
    });
  });

  it("defaults the Teams tenant and attaches a finished sign-in", () => {
    expect(teamsSaveInput({ tenant: "", clientId: "" }, {}).ok).toBe(false);
    expect(teamsSaveInput({ tenant: " ", clientId: " app " }, { authHandle: "h" })).toEqual({
      ok: true,
      input: {
        provider: "teams",
        config: { tenant: "common", clientId: "app" },
        authHandle: "h",
      },
    });
  });
});
