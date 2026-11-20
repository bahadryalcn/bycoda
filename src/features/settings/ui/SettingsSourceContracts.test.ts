import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const ui = (file: string) => read("src", "features", "settings", "ui", file);

// #1014: the running activity window has one owner for its height.
it("keeps one height rule for the live activity window", () => {
  const index = read("src", "styles", "index.css");
  const controls = read("src", "features", "sessions", "ui", "chat-controls.css");
  expect(controls).not.toContain("zen-phase-summary");
  expect(index.match(/\.zen-phase-body > \.zen-phase-live \{\s*max-height:/g)).toHaveLength(1);
});

// #1020: provider account stores are never serialised on render.
it("subscribes to provider accounts through the raw storage revision", () => {
  for (const file of ["ProviderAccountsSettings.tsx", "ProviderSettings.tsx"]) {
    const source = ui(file);
    expect(source).not.toMatch(/JSON\.stringify\([^)]*providerAccounts/);
    expect(source).toContain("providerAccountsStorageRevision");
  }
});

// #1026: option detail lives in the option labels and one popover, not in stacked paragraphs.
it("drops the repeated MCP Add server and Session startup help", () => {
  const add = ui("McpAddServer.tsx");
  expect(add).not.toContain("Saves configuration. Refresh to check status.");
  expect(add).not.toContain("(optional for an mcpServers block)");
  expect(add).not.toContain("Only this project, in your personal settings.");
  expect(ui("McpSettings.tsx")).not.toMatch(/\]\.join\(" "\)/);
});

// #1027: one help channel per row.
it("keeps one help channel on the Taskbar and Delivery time rows", () => {
  const source = ui("NotificationsSettings.tsx");
  expect(source.match(/Taskbar badges and flashing are available only on Windows/g)).toHaveLength(
    1,
  );
  expect(source.match(/local clock/g)).toHaveLength(1);
});

// #1033: the reveal observer has a deadline, so a missing anchor cannot keep it alive.
it("bounds the Settings reveal observer with a lookup deadline", () => {
  const source = ui("SettingsView.tsx");
  expect(source).toMatch(/REVEAL_LOOKUP_MS = \d+/);
  expect(source).toMatch(/setTimeout\(\(\) => observer\.disconnect\(\), REVEAL_LOOKUP_MS\)/);
});
