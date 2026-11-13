import { beforeEach, expect, it, vi } from "vitest";
import { createCodeTerminal } from "./codeTerminalController";

const mocks = vi.hoisted(() => ({
  host: vi.fn(),
  request: vi.fn(),
  profiles: vi.fn(),
  queue: vi.fn(),
  discard: vi.fn(),
  kill: vi.fn(),
}));
vi.mock("../../connections/public/hostFeatureClient", () => ({ featureHost: mocks.host }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../../platform/tauri/pty", () => ({ killPty: mocks.kill }));
vi.mock("../model/terminalProfiles", () => ({
  listTerminalProfiles: mocks.profiles,
  loadTerminalProfile: () => "bash",
}));
vi.mock("../model/terminalLaunchCommand", () => ({
  queueTerminalRun: mocks.queue,
  discardTerminalRun: mocks.discard,
}));

const options = {
  cwd: "C:/project/tree",
  projectCwd: "C:/project",
  native: false,
  command: "Write-Output 'hello'",
  shellKind: "powershell" as const,
  isCurrent: () => true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.host.mockResolvedValue({
    machine: { id: "machine", environmentId: "environment" },
    projectId: "project",
  });
});

it("waits for final output page after exit and pins reads to original machine", async () => {
  mocks.request
    .mockResolvedValueOnce({ writable: true, profiles: [{ id: "pwsh", kind: "pwsh" }] })
    .mockResolvedValueOnce({ id: "terminal", shell: "PowerShell" })
    .mockResolvedValueOnce({
      output: "first",
      cursor: 5,
      truncated: false,
      hasMore: true,
      terminal: { state: "exited", exitCode: 7 },
    })
    .mockResolvedValueOnce({
      output: "last",
      cursor: 9,
      truncated: false,
      hasMore: false,
      terminal: { state: "exited", exitCode: 7 },
    });
  const controller = createCodeTerminal(options);
  await controller.start();
  expect(controller.snapshot().phase).toBe("running");
  await controller.refresh();
  expect(controller.snapshot()).toMatchObject({
    phase: "exited",
    output: "firstlast",
    exitCode: 7,
  });
  expect(mocks.host).toHaveBeenCalledTimes(1);
  expect(
    mocks.request.mock.calls.every((args) => args[0] === "machine" && args[5] === "environment"),
  ).toBe(true);
  await controller.start();
  expect(mocks.request.mock.calls.filter((args) => args[1] === "terminals.create")).toHaveLength(1);
});

it("shares the initial output read with polling so chunks are never duplicated", async () => {
  let finishRead!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finishRead = resolve;
  });
  mocks.request
    .mockResolvedValueOnce({ writable: true, profiles: [] })
    .mockResolvedValueOnce({ id: "terminal", shell: "PowerShell" })
    .mockReturnValueOnce(pending);
  const controller = createCodeTerminal(options);
  const start = controller.start();
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
  const poll = controller.refresh();
  expect(mocks.request).toHaveBeenCalledTimes(3);
  finishRead({
    output: "once",
    cursor: 4,
    truncated: false,
    hasMore: false,
    terminal: { state: "exited", exitCode: 0 },
  });
  await Promise.all([start, poll]);
  expect(controller.snapshot().output).toBe("once");
});

it("never falls back to native or repeats an unknown Host creation", async () => {
  mocks.request
    .mockResolvedValueOnce({ writable: true, profiles: [{ id: "pwsh", kind: "pwsh" }] })
    .mockRejectedValueOnce(new Error("Connection lost"));
  const controller = createCodeTerminal(options);
  await controller.start();
  await controller.start();
  await controller.refresh();
  expect(controller.snapshot()).toMatchObject({ phase: "unknown", error: "Connection lost" });
  expect(mocks.queue).not.toHaveBeenCalled();
  expect(mocks.request.mock.calls.filter((args) => args[1] === "terminals.create")).toHaveLength(1);
  await controller.stop();
  expect(controller.snapshot().error).toContain("Terminal identity is unknown");
});

it("refuses stale conversation after asynchronous shell discovery", async () => {
  mocks.profiles.mockResolvedValue({
    profiles: [{ id: "pwsh", name: "PowerShell", kind: "pwsh" }],
  });
  const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  const controller = createCodeTerminal({ ...options, native: true, isCurrent });
  await controller.start();
  expect(mocks.queue).not.toHaveBeenCalled();
  expect(controller.snapshot().phase).toBe("unknown");
});

it("uses matching native shell and captures bounded output plus real exit", async () => {
  mocks.profiles.mockResolvedValue({
    profiles: [
      { id: "bash", name: "Bash", kind: "git-bash" },
      { id: "pwsh", name: "PowerShell", kind: "pwsh" },
    ],
  });
  const controller = createCodeTerminal({ ...options, native: true });
  await controller.start();
  const run = mocks.queue.mock.calls[0][1];
  expect(controller.snapshot().profile).toBe("pwsh");
  run.onOutput("x".repeat(40_000));
  run.onExit(2);
  expect(controller.snapshot()).toMatchObject({ phase: "exited", exitCode: 2, truncated: true });
  expect(controller.snapshot().output).toHaveLength(30_000);
  run.onOutput("🚀".repeat(20_000));
  expect(controller.snapshot().output).toBe("🚀".repeat(15_000));
  run.onOutput("a" + "\u0301".repeat(30_000));
  expect(controller.snapshot().output).toBe("");
});
