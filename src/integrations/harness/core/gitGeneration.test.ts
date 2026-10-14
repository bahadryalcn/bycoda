import { beforeEach, describe, expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({
  gitStagedContext: vi.fn(),
  gitRangeContext: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => fs);
import { createGitTextGeneration } from "./gitGeneration";

beforeEach(() => {
  vi.clearAllMocks();
  fs.gitStagedContext.mockResolvedValue({ branch: "main", summary: "file", patch: "patch" });
  fs.gitRangeContext.mockResolvedValue({
    base: "main",
    head: "feature",
    commitSummary: "First change\nSecond",
    diffSummary: "file",
    diffPatch: "patch",
  });
});
describe("ortak Git metni üretimi", () => {
  it("commit hesabını çağrı anında seçer ve sağlayıcı timeoutunu korur", async () => {
    const run = vi.fn().mockResolvedValue('{"subject":"Fix file","body":""}');
    const account = vi.fn().mockReturnValue("current-account");
    const generation = createGitTextGeneration({
      run,
      timeoutMs: 90000,
      label: "Codex",
      commitAccount: account,
    });
    expect(await generation.generateCommitMessage("/p")).toContain("Fix file");
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: "current-account", timeoutMs: 90000 }),
    );
    expect(account).toHaveBeenCalledTimes(1);
  });
  it("iptal edilen commit için Git veya model çalıştırmaz", async () => {
    const run = vi.fn();
    const generation = createGitTextGeneration({ run, timeoutMs: 60000, label: "Cursor" });
    const controller = new AbortController();
    controller.abort();
    await expect(generation.generateCommitMessage("/p", controller.signal)).rejects.toThrow();
    expect(fs.gitStagedContext).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("PR model hatasında commit özetinden geri döner", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const account = vi.fn();
    const generation = createGitTextGeneration({
      run,
      timeoutMs: 60000,
      label: "Grok Build",
      commitAccount: account,
    });
    expect(await generation.generatePrContent("/p")).toEqual({
      title: "First change",
      body: "First change\nSecond",
      base: "main",
      head: "feature",
    });
    expect(account).not.toHaveBeenCalled();
    debug.mockRestore();
  });
  it("boş yanıtta sağlayıcıya özel hata metnini korur", async () => {
    const generation = createGitTextGeneration({
      run: async () => "",
      timeoutMs: 60000,
      label: "Grok Build",
    });
    await expect(generation.generateCommitMessage("/p")).rejects.toThrow(
      "Grok Build returned no text.",
    );
  });
});
