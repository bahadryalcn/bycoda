import { describe, expect, it } from "vitest";
import { validateConversationTool, conversationToolCatalog } from "./conversation-tools";
import { deviceActionArgs } from "./device-host";
import type { DeviceAction } from "../src/features/devices/types";

describe("advertised device actions match executable arguments", () => {
  const accepted: DeviceAction[] = [
    { type: "type", text: "x".repeat(4096) },
    { type: "type", text: "line one\nline two" },
    { type: "press", x: 0, y: 20000 },
    { type: "swipe", x: 20000, y: 0, endX: 0, endY: 20000 },
    { type: "openApp", app: "  com.example.app  " },
    { type: "openApp", app: "a".repeat(256) },
    { type: "pressElement", label: "Open" },
    { type: "waitForText", text: "Ready", timeoutMs: 120000 },
    { type: "home" },
    { type: "snapshot" },
  ];
  const rejected: DeviceAction[] = [
    { type: "type", text: "x".repeat(4097) },
    { type: "type", text: "" },
    { type: "type", text: "--help" },
    { type: "type", text: "null\0byte" },
    { type: "press", x: 1.5, y: 2 },
    { type: "press", x: 20001, y: 2 },
    { type: "swipe", x: 20001, y: 2, endX: 3, endY: 4 },
    { type: "swipe", x: 0, y: 2, endX: 3, endY: 4.5 },
    { type: "openApp", app: "a".repeat(257) },
    { type: "openApp", app: "   " },
    { type: "openApp", app: "  --help " },
    { type: "openApp", app: "com.example\napp" },
    { type: "openApp", app: "\ncom.example.app" },
    { type: "openApp", app: "com.example.app\n" },
    { type: "pressElement", label: "   " },
    { type: "pressElement", label: "Open\nApp" },
    { type: "pressElement", label: "Open\n" },
    { type: "waitForText", text: "--help" },
    { type: "waitForText", text: "Ready\n" },
    { type: "waitForText", text: "   " },
    { type: "waitForText", text: "Ready", timeoutMs: 120001 },
  ];
  for (const [index, action] of accepted.entries()) {
    it(`accepts supported action ${index}: ${action.type}`, () => {
      expect(() =>
        validateConversationTool("devices.action", { deviceId: "phone", action }),
      ).not.toThrow();
      expect(() => deviceActionArgs(action)).not.toThrow();
    });
  }
  for (const [index, action] of rejected.entries()) {
    it(`rejects unsupported action ${index}: ${action.type} before execution`, () => {
      expect(() =>
        validateConversationTool("devices.action", { deviceId: "phone", action }),
      ).toThrow("integer coordinates in 0..20000");
      expect(() => deviceActionArgs(action)).toThrow();
    });
  }
  it("advertises the coordinate and text limits to MCP and CLI consumers", () => {
    const schema = conversationToolCatalog().find(
      ({ action }) => action === "devices.action",
    )!.inputSchema;
    expect(JSON.stringify(schema)).toContain('"maximum":20000');
    expect(JSON.stringify(schema)).toContain('"maxLength":4096');
  });
});
