// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const listSkills = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/fs", () => ({ listSkills }));

import { clearProviderSkillCandidates, loadProviderSkillCandidates } from "./skillCandidates";

const skill = (name: string) => ({ name }) as never;

beforeEach(() => {
  listSkills.mockReset();
  clearProviderSkillCandidates();
});

it("reads a provider's install candidates once per send burst, and again after a change", async () => {
  vi.useFakeTimers();
  try {
    listSkills.mockImplementation(async (_cwd: string, _disabled: unknown, provider?: string) => [
      skill(provider ? "eligible" : "inventory"),
    ]);
    const first = await loadProviderSkillCandidates("/work/a", "codex");
    expect(first).toEqual([skill("inventory"), skill("eligible")]);
    expect(await loadProviderSkillCandidates("/work/a", "codex")).toBe(first);
    expect(listSkills).toHaveBeenCalledTimes(2);

    // Another provider or folder is its own read.
    await loadProviderSkillCandidates("/work/a", "claude");
    await loadProviderSkillCandidates("/work/b", "codex");
    expect(listSkills).toHaveBeenCalledTimes(6);

    window.dispatchEvent(new Event("bycoda:skills-change"));
    await loadProviderSkillCandidates("/work/a", "codex");
    expect(listSkills).toHaveBeenCalledTimes(8);

    vi.advanceTimersByTime(30_001);
    await loadProviderSkillCandidates("/work/a", "codex");
    expect(listSkills).toHaveBeenCalledTimes(10);
  } finally {
    vi.useRealTimers();
  }
});

it("does not remember a failed candidate read", async () => {
  listSkills.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([skill("one")]);
  await expect(loadProviderSkillCandidates("/work/a", "codex")).rejects.toThrow("offline");
  expect(await loadProviderSkillCandidates("/work/a", "codex")).toEqual([
    skill("one"),
    skill("one"),
  ]);
});
