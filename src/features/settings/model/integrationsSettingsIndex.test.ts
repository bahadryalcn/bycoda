// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { loadSettingsSection, searchSettings, settingsSectionForAnchor } from "./settings";

beforeEach(() => localStorage.clear());

it("opens Integrations for provider anchors and the retired Inbox section", () => {
  expect(settingsSectionForAnchor("inbox", "github")).toBe("integrations");
  expect(settingsSectionForAnchor("inbox")).toBe("integrations");
  expect(settingsSectionForAnchor(undefined, "email")).toBe("integrations");
  localStorage.setItem("bycoda.settingsSection", "inbox");
  expect(loadSettingsSection()).toBe("integrations");
});

it("finds messaging accounts by provider and protocol words", () => {
  for (const query of ["gmail", "imap", "slack"]) {
    expect(searchSettings(query)[0]?.section, query).toBe("integrations");
  }
});

it("does not offer paused messaging providers", () => {
  for (const query of ["discord", "microsoft teams"]) {
    const ids = searchSettings(query).map((result) => result.settingId);
    expect(ids, query).not.toContain("discord");
    expect(ids, query).not.toContain("teams");
  }
});
