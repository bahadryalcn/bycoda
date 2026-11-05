import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { callVisualConversationTool } from "./conversation-visual-tools";
import { validateConversationTool } from "./conversation-tools";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const root = () => {
  const path = mkdtempSync(join(tmpdir(), "bycoda-inline-"));
  roots.push(path);
  return path;
};
const allow = () => true;

it("publishes an immutable workspace snapshot and preview does not publish", async () => {
  const cwd = root();
  writeFileSync(join(cwd, "chart.html"), "<h1>Original</h1>");
  const input = { title: "Chart", path: "chart.html" };
  const preview = await callVisualConversationTool(
    cwd,
    "visuals.preview",
    input,
    allow,
    () => import("@playwright/test"),
  );
  expect(preview).not.toHaveProperty("bycodaInlineVisual");
  const published = await callVisualConversationTool(cwd, "visuals.render", input, allow);
  writeFileSync(join(cwd, "chart.html"), "<h1>Changed</h1>");
  expect(published).toMatchObject({
    bycodaInlineVisual: { html: "<h1>Original</h1>", title: "Chart", version: 1 },
  });
});

it("keeps workspace and authenticated session authority over file publication", async () => {
  const cwd = root(),
    other = root();
  writeFileSync(join(other, "private.html"), "secret");
  await expect(
    callVisualConversationTool(
      cwd,
      "visuals.render",
      { title: "Other", path: join(other, "private.html") },
      allow,
    ),
  ).rejects.toThrow();
  await expect(
    callVisualConversationTool(
      cwd,
      "visuals.render",
      { title: "Chart", html: "<h1>Chart</h1>" },
      () => false,
    ),
  ).rejects.toThrow("revoked");
  let checks = 0;
  await expect(
    callVisualConversationTool(
      cwd,
      "visuals.render",
      { title: "Chart", html: "<h1>Chart</h1>" },
      () => ++checks === 1,
    ),
  ).rejects.toThrow("revoked");
  expect(() =>
    validateConversationTool("visuals.render", {
      title: "Chart",
      html: "test",
      sessionId: "other",
    }),
  ).toThrow();
});

it("rejects ambiguous source and oversized JSON before a provider can truncate it", async () => {
  const cwd = root();
  await expect(
    callVisualConversationTool(
      cwd,
      "visuals.render",
      { title: "Chart", html: "html", path: "a.html" },
      allow,
    ),
  ).rejects.toThrow("exactly one");
  await expect(
    callVisualConversationTool(
      cwd,
      "visuals.render",
      { title: "Chart", html: '"'.repeat(2100) },
      allow,
    ),
  ).rejects.toThrow("4000");
});
