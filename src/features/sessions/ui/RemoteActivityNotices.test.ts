import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { RemoteActivityNotices } from "./RemoteActivityNotices";
import {
  dismissRemoteActivityNotice,
  getRemoteActivityNotices,
  noteRemoteActivity,
  type RemoteActivityKind,
} from "../model/remoteActivityNotice";

afterEach(() => getRemoteActivityNotices().forEach(dismissRemoteActivityNotice));

const actions: [RemoteActivityKind, string][] = [
  ["deleted", "Delete conversations"],
  ["archived", "Archive conversations"],
  ["stopped", "Stop conversations"],
  ["takenOver", "Take over conversations"],
  ["approved", "Answer approval requests"],
  ["answered", "Answer questions"],
  ["inbox", "Inbox changes"],
  ["worktreeChanged", "Worktree changes"],
  ["settingsChanged", "Workspace settings changes"],
];

it.each(actions)(
  "names device, action and failed count when every remote %s attempt fails",
  (kind, label) => {
    const scope = kind === "inbox" ? "inbox" : { cwd: "/work/long-project" };
    for (let attempt = 0; attempt < 2; attempt++)
      noteRemoteActivity({ kind, scope, device: "Uzun tablet / مساحة العمل 👩🏽‍💻", ok: false });
    const html = renderToStaticMarkup(
      createElement(
        RemoteActivityNotices,
        kind === "inbox" ? { inbox: true } : { cwd: "/work/long-project" },
      ),
    );
    expect(html).toContain("Uzun tablet / مساحة العمل 👩🏽‍💻");
    expect(html).toContain(label);
    expect(html).toContain("2 could not be completed.");
    expect(getRemoteActivityNotices()[0]).toMatchObject({ done: 0, failed: 2 });
  },
);

it("retains the existing completed and failed counts for a partially successful action", () => {
  noteRemoteActivity({ kind: "deleted", scope: { cwd: "/work" }, device: "Tablet" });
  noteRemoteActivity({ kind: "deleted", scope: { cwd: "/work" }, device: "Tablet", ok: false });
  const html = renderToStaticMarkup(createElement(RemoteActivityNotices, { cwd: "/work" }));
  expect(html).toContain("Tablet deleted 1 conversation.");
  expect(html).toContain("1 could not be completed.");
  expect(html).not.toContain("Delete conversations:");
});
