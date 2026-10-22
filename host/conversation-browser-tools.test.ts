import { describe, expect, it } from "vitest";
import { BROWSER_ANNOTATION_TOOLS } from "./conversation-browser-tools";
import { conversationToolCatalog, validateConversationTool } from "./conversation-tools";
import { runConversationMcp } from "./conversation-tools";
import { PassThrough } from "node:stream";

describe("conversation browser annotation catalog", () => {
  it("returns selected masked screenshots as MCP images alongside bounded selection metadata", async () => {
    for (const action of ["select", "read"]) {
      const input = new PassThrough(),
        output = new PassThrough();
      let raw = "";
      output.on("data", (chunk) => {
        raw += String(chunk);
      });
      const data = Buffer.alloc(128 * 1024, "a").toString("base64");
      const result = {
        navigationId: "navigation",
        annotationId: "selection",
        selection: {
          sessionId: "session",
          projectId: "project",
          trust: "untrusted-page-data",
          element: { tag: "button", text: "Save" },
          limitations: ["Private fields masked"],
          screenshot: { mimeType: "image/jpeg", data, width: 1280, height: 720 },
        },
      };
      const running = runConversationMcp(input, output, async () => result);
      input.end(
        JSON.stringify({
          id: 1,
          method: "tools/call",
          params: {
            name: `conversation_browser_annotation_${action}`,
            arguments: {
              leaseId: "lease",
              navigationId: "navigation",
              annotationId: "selection",
              ...(action === "select" ? { x: 50, y: 35 } : {}),
            },
          },
        }) + "\n",
      );
      await running;
      const content = JSON.parse(raw).result.content;
      expect(content[1]).toEqual({ type: "image", mimeType: "image/jpeg", data });
      expect(content[0].text.length).toBeLessThan(1000);
      expect(JSON.parse(content[0].text)).toMatchObject({
        selection: {
          trust: "untrusted-page-data",
          element: { text: "Save" },
          limitations: ["Private fields masked"],
          screenshot: { mimeType: "image/jpeg", width: 1280, height: 720 },
        },
      });
      expect(content[0].text).not.toContain(data);
      expect(result.selection.screenshot.data).toBe(data);
    }
  });
  it("exposes the six fixed actions with host-owned scope and correct read annotations", () => {
    const catalog = conversationToolCatalog();
    for (const action of Object.keys(BROWSER_ANNOTATION_TOOLS)) {
      const input = {
        leaseId: "lease",
        navigationId: "navigation",
        ...(action.endsWith(".start") ? {} : { annotationId: "selection" }),
        ...(action.endsWith(".hover") || action.endsWith(".select") ? { x: 50, y: 35 } : {}),
      };
      expect(() => validateConversationTool(action, input)).not.toThrow();
      expect(catalog.find((tool) => tool.action === action)?.annotations.readOnlyHint).toBe(
        action.endsWith(".read") || action.endsWith(".hover"),
      );
      for (const extra of [
        { sessionId: "other" },
        { projectId: "other" },
        { script: "document.cookie" },
        { selector: "input" },
      ])
        expect(() => validateConversationTool(action, { ...input, ...extra })).toThrow();
    }
  });
  it("requires current annotation identity and bounds selection coordinates", () => {
    for (const action of ["browser.annotation.hover", "browser.annotation.select"])
      for (const point of [
        { x: -1, y: 1 },
        { x: 1280, y: 1 },
        { x: 1, y: 720 },
        { x: Number.NaN, y: 1 },
      ])
        expect(() =>
          validateConversationTool(action, {
            leaseId: "lease",
            navigationId: "navigation",
            annotationId: "selection",
            ...point,
          }),
        ).toThrow();
    for (const action of [
      "browser.annotation.read",
      "browser.annotation.cancel",
      "browser.annotation.clear",
    ])
      expect(() =>
        validateConversationTool(action, { leaseId: "lease", navigationId: "navigation" }),
      ).toThrow();
  });
});
