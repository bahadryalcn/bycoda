// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { recordRemoteCapabilities, remoteRequest } from "./connections";
import { DESKTOP_CONTROL_RECEIPTS_CAPABILITY } from "./desktopControlCapability";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it.each(["cancel", "approve", "answer"])(
  "refuses unsupported desktop %s before native dispatch with the original command identity",
  async (type) => {
    const environment = `unsupported-${type}`;
    recordRemoteCapabilities(environment, []);
    await expect(
      remoteRequest(
        "machine",
        "commands.dispatch",
        {
          type,
          runId: "desktop",
          commandId: "original",
          sessionId: "session",
        },
        false,
        false,
        environment,
      ),
    ).rejects.toMatchObject({
      code: "RPC_WS_UNSUPPORTED",
      uncertain: false,
      commandId: "original",
    });
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("does not gate Host-owned controls on the desktop protocol", async () => {
  recordRemoteCapabilities("host-owned", []);
  vi.mocked(invoke).mockResolvedValue({ commandId: "stop", revision: 4 });
  await expect(
    remoteRequest(
      "machine",
      "commands.dispatch",
      {
        type: "cancel",
        runId: "host-run",
        commandId: "stop",
        sessionId: "session",
      },
      false,
      false,
      "host-owned",
    ),
  ).resolves.toMatchObject({ commandId: "stop" });
  expect(invoke).toHaveBeenCalledOnce();
});

it("freezes the original desktop payload across capability admission", async () => {
  recordRemoteCapabilities("supported-desktop", [DESKTOP_CONTROL_RECEIPTS_CAPABILITY]);
  vi.mocked(invoke).mockResolvedValue({ commandId: "answer", revision: 5 });
  const command = {
    type: "answer",
    runId: "desktop",
    commandId: "answer",
    sessionId: "session",
    reply: { kind: "answered", answers: { question: "original" } },
  };
  const pending = remoteRequest(
    "machine",
    "commands.dispatch",
    command,
    false,
    false,
    "supported-desktop",
  );
  command.commandId = "replacement";
  command.reply.answers.question = "changed";
  await pending;
  expect(invoke).toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({
      expectedEnvironmentId: "supported-desktop",
      params: expect.objectContaining({
        commandId: "answer",
        reply: { kind: "answered", answers: { question: "original" } },
      }),
    }),
  );
});
