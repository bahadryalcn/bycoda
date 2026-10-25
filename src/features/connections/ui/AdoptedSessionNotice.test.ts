// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { AdoptedSessionNotice } from "./AdoptedSessionNotice";
import { newSession } from "../../sessions/model/session";
import { ADOPTED_RUNNING_REASON } from "../model/adoptedSessions";

it("shows host execution and queued waiting without hiding or replacing the composer", () => {
  const session = {
    ...newSession("codex", "/fake"),
    continuingElsewhere: true,
    queuedMessages: [{ id: "q", text: "waiting", attachments: [] }],
  };
  const html = renderToString(createElement(AdoptedSessionNotice, { session }));
  expect(html).toContain('role="status"');
  expect(html).toContain(ADOPTED_RUNNING_REASON);
  expect(html).toContain("Queue is waiting for the current turn to finish.");
});
it("does not leave a waiting notice after the mirrored host turn settles", () => {
  const session = newSession("codex", "/fake");
  expect(renderToString(createElement(AdoptedSessionNotice, { session }))).toBe("");
});
