import { expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { createVoiceController, type VoiceControllerPorts } from "./voiceController";

const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("./voiceToolClient", () => ({ callVoiceTool: mock.call, discoverVoiceTools: vi.fn() }));
vi.mock("./voiceDraftContext", () => ({
  readVoiceDraftContext: vi.fn(),
  readVoiceDraftAttachment: vi.fn(),
}));

const a = { id: "a", title: "Alpha", cwd: "/a", blocks: [] } as unknown as Session;

it("delivers a screenshot through the image port before the result returns", async () => {
  const order: string[] = [];
  const image = vi.fn(() => {
    order.push("image");
    return { accepted: true };
  });
  const ports: VoiceControllerPorts = {
    getScope: () => "session",
    getProjects: () => [{ path: "/a" }],
    getSessions: () => [a],
    getProjectPath: () => "/a",
    getTargetId: () => "a",
    workspace: { tools: [], execute: vi.fn() },
    image,
  } as unknown as VoiceControllerPorts;
  const controller = createVoiceController(() => ports);
  controller.captureTurn();
  mock.call.mockResolvedValue({
    screenshot: { app: "x", mimeType: "image/png", data: "QUJD", width: 2, height: 2 },
  });
  const result = await controller.execute("app_tool_call", {
    family: "conversation",
    action: "desktop.screenshot",
    input: {},
    requestId: "shot",
  });
  order.push("result");
  expect(order).toEqual(["image", "result"]);
  expect(image).toHaveBeenCalledWith("data:image/png;base64,QUJD");
  expect(result).toMatchObject({ imageDelivered: true });
  expect(JSON.stringify(result)).not.toContain("QUJD");
});
