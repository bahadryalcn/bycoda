// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useRemoteOutboxIssues, type OutboxIssue } from "./remoteOutbox";

it("keeps the issues array stable until an outbox entry actually changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const root = createRoot(document.createElement("div"));
  let issues!: OutboxIssue[];
  function Owner() {
    issues = useRemoteOutboxIssues("project", "env");
    return null;
  }
  try {
    await act(async () => root.render(createElement(Owner)));
    const initial = issues;
    await act(async () => root.render(createElement(Owner)));
    expect(issues).toBe(initial);
    localStorage.setItem('bycoda.remote-command.v1:["project","env"]:invalid', "malformed");
    await act(async () => window.dispatchEvent(new Event("bycoda:remote-outbox-change")));
    expect(issues).not.toBe(initial);
    expect(issues).toHaveLength(1);
    const changed = issues;
    await act(async () => window.dispatchEvent(new Event("bycoda:remote-outbox-change")));
    expect(issues).toBe(changed);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
