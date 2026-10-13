import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SessionAgentIdentity } from "./SessionAgentIdentity";

it("names the running harness and model independently of composer selection", () => {
  const markup = renderToStaticMarkup(
    createElement(SessionAgentIdentity, {
      harness: "claude",
      model: "claude:opus-5",
      accountId: "default",
      running: true,
      showAccount: true,
    }),
  );
  expect(markup).toContain("Running agent");
  expect(markup).toContain("Claude Code");
  expect(markup).toContain("Default account");
  expect(markup).toContain("bg-green-500");
});
