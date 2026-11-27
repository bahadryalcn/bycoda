import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");
const source = read("src", "features", "settings", "ui", "TerminalSettings.tsx");

// Default shell by machine keeps one help channel: the ⓘ popover. The visible subline and the
// popover used to repeat the same rule, so the subline is gone and the popover says it once.
it("keeps Default shell by machine help in one info popover, not a visible subline", () => {
  expect(source).not.toMatch(/descriptionVisible/);
  expect(source).not.toMatch(/description=\{t\("Each machine uses its own shell/);
  expect(source).toMatch(/info=\{\s*<InfoPopover[^>]*label=\{t\("How it works"\)\}/);
});

it("states the open-terminal rule once in the shell popover", () => {
  expect(source.match(/A terminal already open keeps the shell it started with\./g)).toHaveLength(
    1,
  );
  expect(source).not.toMatch(/Applies to new commands on this host/);
  expect(source).not.toMatch(/in this computer's synced sessions/);
});

// OS guidance and the remote `!commands` difference are the facts the popover must keep.
it("keeps OS shell guidance and the remote !commands behavior in the popover", () => {
  expect(source).toMatch(/Automatic follows the system: PowerShell on Windows/);
  expect(source).toMatch(/`!commands` in this server's sessions run on the remote server/);
});

// The Code blocks toggle label already says what it does; its row carries no second sentence.
it("does not repeat the Code blocks toggle label as a row description", () => {
  expect(source).not.toMatch(/description=\{t\(\s*"When a code block you run/);
});

// Error and status feedback is not help copy and must survive the consolidation.
it("keeps save, discovery and status feedback on the shell rows", () => {
  expect(source).toMatch(/Could not save the terminal profile\. Select it again to retry\./);
  expect(source).toMatch(/Could not discover shells\. Use Look again to retry\./);
  expect(source).toMatch(/Looking for shells…/);
  expect(source).toMatch(/Asking the machine…/);
});

// Retired copy must not linger in any catalog: the removed strings are not referenced anymore.
it("drops the retired shell help strings from every locale catalog", () => {
  const retired = [
    "Applies to new commands on this host. Already open terminals keep their current shell.",
    "`!commands` in this computer's synced sessions run on this computer, using the shell selected here.",
    "Each machine uses its own shell, wherever you send the command from.",
    "When a code block you run from a chat finishes, its output is added to the message box for you to review and send.",
  ];
  const catalogs = [
    ...readdirSync(join("src", "shared", "i18n", "locales")).map((file) =>
      join("src", "shared", "i18n", "locales", file),
    ),
    join("src", "shared", "i18n", "tr-overrides.json"),
    join("src", "shared", "i18n", "en-overrides.json"),
  ];
  for (const file of catalogs) {
    const text = read(file);
    for (const key of retired) expect(text, file).not.toContain(JSON.stringify(key));
  }
});
