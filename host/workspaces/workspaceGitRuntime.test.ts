import { beforeEach, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
const runtime = vi.hoisted(() => ({
  calls: vi.fn(),
  failPush: false,
  head: undefined as undefined | Error,
}));
vi.mock("../git/git-exec-pool", () => ({
  hostGitExec: {
    exec: async (file: string, args: string[], options: unknown) => {
      runtime.calls(file, args, options);
      if (args.includes("--verify") && runtime.head) throw runtime.head;
      if (args.includes("rev-parse")) return { stdout: "upstream/topic\n", stderr: "" };
      if (args.includes("ls-files")) return { stdout: "tracked.txt\n", stderr: "" };
      if (runtime.failPush) throw Object.assign(new Error("timeout"), { killed: true, code: null });
      return { stdout: "", stderr: "" };
    },
  },
}));
import { hostGitAction } from "./workspace";
const poolFailure = (code: string | number, extra: object = {}) =>
  Object.assign(new Error(String(code)), { code, killed: false, signal: null, ...extra });
const ran = (command: string) =>
  runtime.calls.mock.calls.some((call) => (call[1] as string[]).includes(command));
beforeEach(() => {
  runtime.calls.mockClear();
  runtime.failPush = false;
  runtime.head = undefined;
});

it("gives push a network timeout and disables terminal prompting", async () => {
  await hostGitAction(tmpdir(), "push");
  const push = runtime.calls.mock.calls.find((call) => call[1].includes("push"))!;
  expect(push[2]).toMatchObject({
    timeout: 120_000,
    windowsHide: true,
    env: { GIT_TERMINAL_PROMPT: "0" },
    lane: "network",
  });
  const probe = runtime.calls.mock.calls.find((call) => call[1].includes("rev-parse"))!;
  expect(probe[2]).toMatchObject({ lane: "default" });
});
it("reports an explicit push timeout", async () => {
  runtime.failPush = true;
  await expect(hostGitAction(tmpdir(), "push")).rejects.toThrow(
    "git push timed out after 120 seconds",
  );
});

it.each([
  ["unstage", "a.txt"],
  ["unstageFiles", ["a.txt"]],
  ["unstageAll", undefined],
] as const)(
  "%s never removes index entries when the HEAD probe fails for a pool reason",
  async (action, input) => {
    for (const failure of [
      poolFailure("ETIMEDOUT"),
      poolFailure("ABORT_ERR", { name: "AbortError" }),
      poolFailure("EIO"),
      poolFailure("ECANCELED", { killed: true, signal: "SIGKILL" }),
      poolFailure("EAGAIN"),
      Object.assign(new Error("killed"), { code: null, killed: true, signal: "SIGTERM" }),
      // Not an exit code of git's own "not found" answer: corrupt or unreadable repository.
      poolFailure(128),
    ]) {
      runtime.head = failure;
      runtime.calls.mockClear();
      await expect(hostGitAction(tmpdir(), action, input)).rejects.toBeDefined();
      expect(ran("rm")).toBe(false);
      expect(ran("restore")).toBe(false);
    }
  },
);

it("unstages quietly only when Git reports that HEAD does not exist", async () => {
  runtime.head = poolFailure(1);
  await hostGitAction(tmpdir(), "unstageFiles", ["a.txt"]);
  const remove = runtime.calls.mock.calls.find((call) => call[1].includes("rm"))!;
  expect(remove[1]).toEqual(expect.arrayContaining(["--cached", "--quiet"]));
  expect(runtime.calls.mock.calls.find((call) => call[1].includes("--verify"))![1]).toContain(
    "--quiet",
  );
  runtime.calls.mockClear();
  await hostGitAction(tmpdir(), "unstageAll");
  const all = runtime.calls.mock.calls.find((call) => call[1].includes("rm"))!;
  expect(all[1]).toEqual(expect.arrayContaining(["--cached", "--quiet"]));
});
