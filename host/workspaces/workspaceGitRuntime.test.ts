import { beforeEach, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
const runtime = vi.hoisted(() => ({ calls: vi.fn(), failPush: false }));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: (error: unknown, result: string, stderr: string) => void,
  ) => {
    runtime.calls(file, args, options);
    if (args.includes("rev-parse")) callback(null, "upstream/topic\n", "");
    else if (runtime.failPush)
      callback(Object.assign(new Error("timeout"), { killed: true }), "", "");
    else callback(null, "", "");
  },
}));
import { hostGitAction } from "./workspace";
beforeEach(() => {
  runtime.calls.mockClear();
  runtime.failPush = false;
});

it("gives push a network timeout and disables terminal prompting", async () => {
  await hostGitAction(tmpdir(), "push");
  const push = runtime.calls.mock.calls.find((call) => call[1].includes("push"))!;
  expect(push[2]).toMatchObject({
    timeout: 120_000,
    windowsHide: true,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
});
it("reports an explicit push timeout", async () => {
  runtime.failPush = true;
  await expect(hostGitAction(tmpdir(), "push")).rejects.toThrow(
    "git push timed out after 120 seconds",
  );
});
