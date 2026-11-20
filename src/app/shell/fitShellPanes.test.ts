import { expect, it } from "vitest";

import { fitShellPanes } from "./fitShellPanes";

const both = { rail: true, sidebar: true };

it("keeps both stored panes when the main column still gets its minimum", () => {
  expect(fitShellPanes(800, both)).toEqual({ rail: true, sidebar: true, compactRailForced: false });
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
