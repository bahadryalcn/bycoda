import { expect, it } from "vitest";
import { sanitizeServerTerminalRestore } from "./serverTerminalRestore";
const tab = { tabId: "restore:one", serverId: "canonical-one" };
it("projects only canonical references and UI tab identity without any launch or secret state", () => {
  const extra = {
    endpoint: { host: "private" },
    identityFile: "key",
    command: "secret",
    input: "password",
    output: "data",
    name: "private-name",
    shellIntegration: "bash",
    quick: true,
  };
  expect(
    sanitizeServerTerminalRestore({
      version: 1,
      enabled: true,
      tabs: [{ ...tab, ...extra }],
      activeTabId: tab.tabId,
      ...extra,
    }),
  ).toEqual({ version: 1, enabled: true, tabs: [tab], activeTabId: tab.tabId });
});
it.each([
  undefined,
  null,
  {},
  { version: 2, enabled: true, tabs: [] },
  { version: 1, enabled: false, tabs: [tab] },
  { version: 1, enabled: true, tabs: [tab, tab] },
  { version: 1, enabled: true, tabs: [{ ...tab, serverId: "bad\nID" }] },
  { version: 1, enabled: true, tabs: [{ ...tab, tabId: "../invalid" }] },
  { version: 1, enabled: true, tabs: [tab], activeTabId: "missing" },
  {
    version: 1,
    enabled: true,
    tabs: Array.from({ length: 33 }, (_, i) => ({ ...tab, tabId: `tab:${i}` })),
  },
])("fails closed for malformed or disabled restore %j", (value) => {
  expect(sanitizeServerTerminalRestore(value)).toBeUndefined();
});
it("preserves order, distinct tabs for one server, and the bounded opt-in empty state", () => {
  const tabs = Array.from({ length: 32 }, (_, i) => ({ ...tab, tabId: `tab:${i}` }));
  expect(sanitizeServerTerminalRestore({ version: 1, enabled: true, tabs })?.tabs).toEqual(tabs);
  expect(sanitizeServerTerminalRestore({ version: 1, enabled: true, tabs: [] })).toEqual({
    version: 1,
    enabled: true,
    tabs: [],
  });
});
