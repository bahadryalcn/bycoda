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

const render = (props: Partial<Parameters<typeof McpCapabilityStatus>[0]>) =>
  renderToStaticMarkup(
    createElement(McpCapabilityStatus, { server, checking: false, failed: false, ...props }),
  );

it("does not treat a sign-in as a live connection", () => {
  const markup = render({});
  expect(markup).toContain('data-mcp-state="unknown"');
  expect(markup).toContain('aria-label="Signed in"');
});

it("clears a stale connected reading on refresh failure", () => {
  const markup = render({ server: { ...server, status: "Connected" }, failed: true });
  expect(markup).toContain('data-mcp-state="unknown"');
  expect(markup).toContain('aria-label="Unknown"');
});

it("clears stale sign-in readings after failed or ambiguous health checks", () => {
  for (const provenance of [{ failed: true }, { ambiguous: true }]) {
    const markup = render({
      server: { ...server, provider: "claude", auth: "signed_out", status: "Needs authentication" },
      ...provenance,
    });
    expect(markup).toContain('data-mcp-state="unknown"');
    expect(markup).toContain('aria-label="Unknown"');
  }
});

it("does not verify separate scopes from the same name-only CLI connection observation", () => {
  const markup = render({
    server: { ...server, provider: "claude", status: "Connected" },
    ambiguous: true,
  });
  expect(markup).toContain('data-mcp-state="unknown"');
});

it("marks connected, sign-in, failed and disabled rows", () => {
  expect(render({ server: { ...server, status: "√ Connected" } })).toContain(
    'data-mcp-state="connected"',
  );
  expect(render({ server: { ...server, auth: "signed_out", status: "Configured" } })).toContain(
    'data-mcp-state="sign-in"',
  );
  expect(
    render({ server: { ...server, transport: "stdio", status: "Failed to connect" } }),
  ).toContain('data-mcp-state="unavailable"');
  expect(render({ server: { ...server, enabled: false } })).toContain('data-mcp-state="off"');
});
