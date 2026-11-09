import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
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
  const preview = await callVisualConversationTool(cwd, "visuals.preview", input, allow, {
    browser: {
      load: () => import("@playwright/test"),
      status: async () => ({ installed: true, installing: false }),
      setup: async () => {
        throw new Error("Installed runtime must not be set up again");
      },
    },
  });
  expect(preview).not.toHaveProperty("bycodaInlineVisual");
  expect(preview).toMatchObject({ width: 728, console: [] });
  const dataDir = root();
  const published = (await callVisualConversationTool(
    cwd,
    "visuals.render",
    { ...input, height: 200 },
    allow,
    { dataDir },
  )) as { bycodaInlineVisual: { id: string } };
  writeFileSync(join(cwd, "chart.html"), "<h1>Changed</h1>");
  const { id } = published.bycodaInlineVisual;
  expect(published.bycodaInlineVisual).toEqual({
    version: 2,
    id,
    title: "Chart",
    height: 200,
  });
  const body = readFileSync(join(dataDir, "inline-visuals", `${id}.json`), "utf8");
  expect(createHash("sha256").update(body).digest("hex")).toBe(id);
  expect(JSON.parse(body)).toMatchObject({
    html: "<h1>Original</h1>",
    title: "Chart",
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
      { title: "Chart", html: "x".repeat(512_001) },
      allow,
    ),
  ).rejects.toThrow("512000");
  await expect(
    callVisualConversationTool(cwd, "visuals.render", { title: "Chart", html: "<b>x</b>" }, allow),
  ).rejects.toThrow("storage is unavailable");
});

it("starts the one-time preview browser setup in the background and answers without waiting", async () => {
  let setups = 0;
  let finish: () => void = () => {};
  const browser = {
    load: async () => {
      throw new Error("Preview must not load a missing runtime");
    },
    status: async () => ({
      installed: false,
      installing: setups > 0,
      lastError: "npm missing",
    }),
    setup: () => {
      setups++;
      return new Promise<void>((done) => (finish = done));
    },
  };
  const result = await callVisualConversationTool(
    root(),
    "visuals.preview",
    { title: "Chart", html: "<b>x</b>" },
    allow,
    { browser },
  );
  expect(result).toMatchObject({
    ready: false,
    installing: true,
    previousError: "npm missing",
  });
  expect(setups).toBe(1);
  finish();
  await expect(
    callVisualConversationTool(
      root(),
      "visuals.preview",
      { title: "Chart", html: "<b>x</b>" },
      () => false,
      { browser },
    ),
  ).rejects.toThrow("revoked");
  expect(setups).toBe(1);
});
