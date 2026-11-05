import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { McpCapabilityStatus } from "./McpCapabilityStatus";

const server = {
  provider: "codex" as const,
  name: "docs",
  scope: "user" as const,
  configPath: "/fixture/config",
  transport: "http",
  status: "Signed in",
  auth: "signed_in" as const,
};

it("keeps configuration, credentials, connection and activity independent", () => {
  const markup = renderToStaticMarkup(
    createElement(McpCapabilityStatus, { server, checking: false, failed: false }),
  );
  expect(markup).toContain('data-capability-axis="permission" data-state="enabled"');
  expect(markup).toContain('data-capability-axis="readiness" data-state="unknown"');
  expect(markup).toContain('data-capability-axis="activity" data-state="unknown"');
});

it("clears stale connected reading on refresh failure", () => {
  const markup = renderToStaticMarkup(
    createElement(McpCapabilityStatus, {
      server: { ...server, status: "Connected" },
      checking: false,
      failed: true,
    }),
  );
  expect(markup).toContain('data-capability-axis="readiness" data-state="unknown"');
  expect(markup).not.toContain('data-capability-axis="readiness" data-state="ready"');
});

it("does not verify separate scopes from the same name-only CLI connection observation", () => {
  const markup = renderToStaticMarkup(
    createElement(McpCapabilityStatus, {
      server: { ...server, provider: "claude", status: "Connected" },
      checking: false,
      failed: false,
      ambiguous: true,
    }),
  );
  expect(markup).toContain('data-capability-axis="readiness" data-state="unknown"');
});
