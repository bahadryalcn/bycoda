import { beforeEach, expect, it, vi } from "vitest";

const processApi = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("../src/shared/lib/processExecution.node", () => ({ execFileAsync: processApi.exec }));
import { hostGitIndex, invalidateHostGitIndex } from "./workspace";

beforeEach(() => {
  invalidateHostGitIndex();
  processApi.exec.mockReset();
  processApi.exec.mockImplementation(async (_exe: string, args: string[]) => {
    let stdout = "";
    if (args.includes("--is-inside-work-tree")) stdout = "true\n";
    else if (args.includes("status"))
      stdout = "## feature...origin/feature [ahead 1]\0 M file.txt\0";
    else if (args.includes("--numstat")) stdout = "2\t1\tfile.txt\0";
    else if (args.includes("--show-prefix")) stdout = "";
    else if (args.includes("--verify") && args.includes("HEAD")) stdout = "a".repeat(40);
    else if (args.includes("symbolic-ref") && args.includes("HEAD")) stdout = "feature\n";
    else if (args.includes("get-url")) stdout = "https://example.test/repo\n";
    else if (args.includes("@{upstream}")) stdout = "origin/feature\n";
    else if (args.includes("refs/remotes/origin/HEAD")) stdout = "origin/main\n";
    else if (args.includes("rev-list")) stdout = args.includes("--left-right") ? "0\t1\n" : "1\n";
    return { stdout, stderr: "" };
  });
});

it("reads file counts and branch identity without querying remote/ref synchronization", async () => {
  const result = await hostGitIndex("/repo", false);
  expect(result).toMatchObject({
    branch: "feature",
    additions: 2,
    deletions: 1,
    remote: null,
    upstream: null,
  });
  expect(result.files).toEqual([expect.objectContaining({ relative: "file.txt", unstaged: true })]);
  const commands = processApi.exec.mock.calls.map((call) => call[1] as string[]);
  expect(
    commands.some(
      (args) =>
        args.includes("remote") || args.includes("rev-list") || args.includes("for-each-ref"),
    ),
  ).toBe(false);
  expect(
    commands.some(
      (args) => args.includes("@{upstream}") || args.includes("refs/remotes/origin/HEAD"),
    ),
  ).toBe(false);
});

it("shares a full refresh with concurrent lightweight callers while retaining full metadata", async () => {
  const full = hostGitIndex("/repo");
  const files = hostGitIndex("/repo", false);
  expect(files).toBe(full);
  expect(await full).toMatchObject({
    remote: "origin",
    upstream: "origin/feature",
    defaultBranch: "main",
    ahead: 1,
  });
});

it("does not use a pending lightweight response to satisfy a full refresh", async () => {
  const files = hostGitIndex("/repo", false);
  const full = hostGitIndex("/repo");
  expect(full).not.toBe(files);
  expect(await files).toMatchObject({ remote: null });
  expect(await full).toMatchObject({ remote: "origin" });
});

it("does not reuse a pre-mutation refresh after invalidation", async () => {
  const before = hostGitIndex("/repo", false);
  invalidateHostGitIndex("/repo");
  const after = hostGitIndex("/repo", false);
  expect(after).not.toBe(before);
  await Promise.all([before, after]);
});

it("retains a slow files refresh after a later full refresh has completed", async () => {
  const execute = processApi.exec.getMockImplementation()!;
  let release!: (value: { stdout: string; stderr: string }) => void;
  const entered = Promise.withResolvers<void>();
  processApi.exec.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
        entered.resolve();
      }),
  );
  const files = hostGitIndex("/repo", false);
  // Ensure the delayed command belongs to the lightweight request even when
  // the Windows process-start gate changes which async request reaches Git first.
  await entered.promise;
  const full = hostGitIndex("/repo");
  await full;
  expect(hostGitIndex("/repo", false)).toBe(files);
  release(await execute("git", ["rev-parse", "--is-inside-work-tree"]));
  await files;
});
