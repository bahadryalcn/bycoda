import { beforeEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({ request: vi.fn(), machine: vi.fn(), project: vi.fn() }));
vi.mock("../../connections/public/connections", () => ({
  remoteRequest: remote.request,
  remoteMachineFor: remote.machine,
}));
vi.mock("../../connections/public/remoteProjects", async (original) => ({
  ...(await original<typeof import("../../connections/public/remoteProjects")>()),
  remoteProjectFor: remote.project,
}));
vi.mock("../../../integrations/harness/core/textHarness", () => ({
  generateCommitMessage: vi.fn(),
  generatePrContent: vi.fn(),
}));
vi.mock("./gitGenerationPreferences", () => ({ resolveGitGenerationChoice: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({ gitRangeContext: vi.fn() }));
import {
  generateCommitMessage,
  generatePrContent,
  prContentFromCommits,
} from "./gitTextGeneration";
import { PrGenerationError } from "./prGenerationError";
import { resolveGitGenerationChoice } from "./gitGenerationPreferences";
import { gitRangeContext } from "../../../platform/tauri/fs";
import {
  generateCommitMessage as localCommit,
  generatePrContent as localPr,
} from "../../../integrations/harness/core/textHarness";

beforeEach(() => {
  vi.clearAllMocks();
  remote.machine.mockResolvedValue({ id: "machine" });
  remote.project.mockReturnValue({ projectId: "project" });
  remote.request.mockResolvedValue({ message: "Fix remote generation" });
});

it("uses the checkout's explicit commit model ahead of automatic routing", async () => {
  const choice = {
    harness: "claude" as const,
    model: "claude:opus-5-5",
    modelSettings: { effort: "high", fast: "true" },
  };
  vi.mocked(localCommit).mockResolvedValueOnce("Commit message");
  await expect(generateCommitMessage("/repo", "codex", undefined, choice)).resolves.toBe(
    "Commit message",
  );
  expect(resolveGitGenerationChoice).not.toHaveBeenCalled();
  expect(localCommit).toHaveBeenCalledWith("/repo", "codex", undefined, choice, undefined);
});

it("generates on the repository Host without entering the desktop provider", async () => {
  await expect(generateCommitMessage("remote://env/home/repo", "codex")).resolves.toBe(
    "Fix remote generation",
  );
  expect(remote.request).toHaveBeenCalledWith(
    "machine",
    "git.generateText",
    {
      projectId: "project",
      cwd: "/home/repo",
      kind: "commit",
      preferred: "codex",
    },
    false,
    true,
    "env",
  );
  expect(localCommit).not.toHaveBeenCalled();
});

it("routes PR generation to the same Host", async () => {
  const result = { title: "Fix", body: "Details", base: "main", head: "feature" };
  remote.request.mockResolvedValue(result);
  await expect(generatePrContent("remote://env/home/repo")).resolves.toEqual(result);
  expect(remote.request).toHaveBeenCalledWith(
    "machine",
    "git.generateText",
    expect.objectContaining({ kind: "pr" }),
    false,
    true,
    "env",
  );
});

// Issue #1369: cancelling stops the provider call, locally and on a Host.
it("hands the cancel signal to the local harness and to the Host request", async () => {
  const controller = new AbortController();
  vi.mocked(localPr).mockResolvedValueOnce(null);
  await generatePrContent("/repo", undefined, undefined, undefined, controller.signal);
  expect(vi.mocked(localPr).mock.calls[0]?.[4]).toBe(controller.signal);

  controller.abort();
  await expect(
    generatePrContent("remote://env/home/repo", undefined, undefined, undefined, controller.signal),
  ).rejects.toThrow();
  expect(remote.request).not.toHaveBeenCalled();
});

it("reports a failed PR generation without provider text, locally and on a Host", async () => {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.mocked(localPr).mockRejectedValueOnce(new Error("401 for account owner@example.com"));
  const local = await generatePrContent("/repo").catch((error: unknown) => error);
  expect(local).toBeInstanceOf(PrGenerationError);
  expect((local as Error).message).not.toContain("owner@example.com");
  remote.request.mockRejectedValueOnce(new Error("quota exceeded for sk-private"));
  const hosted = await generatePrContent("remote://env/home/repo").catch((error: unknown) => error);
  expect(hosted).toBeInstanceOf(PrGenerationError);
  expect((hosted as Error).message).not.toContain("sk-private");
  expect(gitRangeContext).not.toHaveBeenCalled();
});

it("builds the commit-summary text only on request", async () => {
  vi.mocked(gitRangeContext).mockResolvedValue({
    base: "main",
    head: "feature",
    commitSummary: "First change\nSecond\n",
    diffSummary: "",
    diffPatch: "",
  });
  await expect(prContentFromCommits("/repo")).resolves.toEqual({
    title: "First change",
    body: "First change\nSecond",
    base: "main",
    head: "feature",
  });
});

it("opens an unregistered remote checkout and keeps its explicit model/account on that Host", async () => {
  remote.project.mockReturnValue(undefined);
  remote.request
    .mockResolvedValueOnce({ id: "nested-project" })
    .mockResolvedValueOnce({ message: "Nested change" });
  const choice = {
    harness: "codex" as const,
    model: "codex:test",
    providerAccountId: "host-account",
    modelSettings: { effort: "low" },
  };
  await expect(
    generateCommitMessage("remote://env/home/repo/nested", undefined, undefined, choice),
  ).resolves.toBe("Nested change");
  expect(remote.request).toHaveBeenNthCalledWith(
    1,
    "machine",
    "projects.open",
    { cwd: "/home/repo/nested" },
    false,
    true,
    "env",
  );
  expect(remote.request).toHaveBeenNthCalledWith(
    2,
    "machine",
    "git.generateText",
    expect.objectContaining({ projectId: "nested-project", cwd: "/home/repo/nested", choice }),
    false,
    true,
    "env",
  );
  expect(localCommit).not.toHaveBeenCalled();
});

it("surfaces unsupported Host and malformed result errors without local fallback", async () => {
  remote.request.mockRejectedValueOnce(new Error("Unsupported host method"));
  await expect(generateCommitMessage("remote://env/home/repo")).rejects.toThrow(
    "Unsupported host method",
  );
  remote.request.mockResolvedValueOnce({ message: "" });
  await expect(generateCommitMessage("remote://env/home/repo")).rejects.toThrow();
  expect(localCommit).not.toHaveBeenCalled();
});

it("does not fall back to local execution when the machine is missing", async () => {
  remote.machine.mockResolvedValue(undefined);
  await expect(generateCommitMessage("remote://env/home/repo")).rejects.toThrow();
  expect(localCommit).not.toHaveBeenCalled();
});

it("does not dispatch an already cancelled request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    generateCommitMessage("remote://env/home/repo", undefined, controller.signal),
  ).rejects.toThrow();
  expect(remote.request).not.toHaveBeenCalled();
});

it("ignores a late Host result after cancellation", async () => {
  let finish!: (value: unknown) => void;
  remote.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = generateCommitMessage("remote://env/home/repo", undefined, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(remote.request).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  finish({ message: "Late result" });
});
