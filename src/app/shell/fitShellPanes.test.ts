import { expect, it } from "vitest";

import { fitShellPanes } from "./fitShellPanes";

const both = { rail: true, sidebar: true };

it("keeps both stored panes while the conversation keeps a readable column", () => {
  expect(fitShellPanes(1024, both)).toEqual({ rail: true, sidebar: true, compactRailForced: false });
});

it("opens the session list beside the compact rail at 800 px instead of squeezing the conversation", () => {
  expect(fitShellPanes(800, both)).toEqual({ rail: false, sidebar: true, compactRailForced: true });
});

it("collapses the full rail before the sidebar when both no longer fit", () => {
  expect(fitShellPanes(640, both)).toEqual({ rail: false, sidebar: true, compactRailForced: true });
});

it("leaves only the compact rail at 200% zoom on the smallest window", () => {
  expect(fitShellPanes(400, both)).toEqual({
    rail: false,
    sidebar: false,
    compactRailForced: true,
  });
});

it("forces the compact rail when a sidebar is dropped with the rail already closed", () => {
  expect(fitShellPanes(400, { rail: false, sidebar: true })).toEqual({
    rail: false,
    sidebar: false,
    compactRailForced: true,
  });
});

it("keeps a lone rail while it fits and never forces anything for closed panes", () => {
  expect(fitShellPanes(540, { rail: true, sidebar: false }).rail).toBe(true);
  expect(fitShellPanes(400, { rail: false, sidebar: false }).compactRailForced).toBe(false);
});
