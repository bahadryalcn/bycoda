// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { ProjectGitChangeRow } from "./ProjectGitChangeRow";

it("updates changed-file numerals with the mounted app locale", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const change = Object.freeze({
    files: 1234,
    additions: 4321,
    deletions: 0,
    detail: "+4,321",
    hasLines: true,
  });
  try {
    await act(async () => root.render(createElement(ProjectGitChangeRow, { change })));
    expect(host.textContent).toContain("1,234");
    await act(async () => {
      await setLanguagePreference("tr");
    });
    expect(host.textContent).toContain("1.234");
    expect(change.files).toBe(1234);
    expect(change.additions).toBe(4321);
  } finally {
    await act(async () => {
      root.unmount();
      await setLanguagePreference("en");
    });
    vi.unstubAllGlobals();
  }
});
