import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  subscribe: vi.fn(),
  getSkillPolicy: vi.fn(),
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  getHarness: (id: string) =>
    id === "omp"
      ? {
          commands: {
            discover: vi.fn().mockResolvedValue([]),
            subscribe: mocks.subscribe,
            rawSlashCommands: true,
          },
        }
      : undefined,
}));

vi.mock("../../../platform/tauri/fs", () => ({
  createPath: vi.fn(),
  homeDir: vi.fn(),
  listSkills: mocks.listSkills,
  getSkillPolicy: mocks.getSkillPolicy,
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { invalidateSkills, loadSkills, peekSkills, subscribeSkills } from "./skills";

const ENTRY_LIMIT = 128;
const claude = (cwd: string) => ({ harness: "claude" as const, cwd });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function loadIdle(count: number, prefix: string): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await loadSkills(claude(`/${prefix}-${index}`));
  }
}

beforeEach(() => {
  invalidateSkills();
  mocks.listSkills.mockReset().mockResolvedValue([]);
  mocks.subscribe.mockReset();
  mocks.getSkillPolicy.mockReset().mockResolvedValue({ disabledNames: [], disabledPaths: [] });
});

describe("skill catalog cache bound", () => {
  it("evicts the least recently used idle entry past the limit", async () => {
    await loadIdle(ENTRY_LIMIT, "idle");
    expect(peekSkills(claude("/idle-0"))).not.toBeNull();

    // Touch the oldest entry so the next insert evicts its successor instead.
    await loadSkills(claude("/idle-0"));
    await loadIdle(2, "extra");

    expect(peekSkills(claude("/idle-0"))).not.toBeNull();
    expect(peekSkills(claude("/idle-1"))).toBeNull();
    expect(peekSkills(claude("/idle-2"))).toBeNull();
    expect(peekSkills(claude("/extra-1"))).not.toBeNull();
  });

  it("keeps a subscribed entry so its live update still publishes", async () => {
    const live = { harness: "omp" as const, cwd: "/live", sessionId: "live-session" };
    const onSkills = vi.fn();
    const stop = subscribeSkills(live, onSkills);
    const publish = mocks.subscribe.mock.calls[0]![1] as (
      commands: Array<{ name: string; invocation: string; source: string; description: string }>,
    ) => void;
    publish([{ name: "workflow", invocation: "workflow", source: "omp", description: "" }]);
    await vi.waitFor(() => expect(onSkills).toHaveBeenCalledTimes(1));

    await loadIdle(ENTRY_LIMIT + 2, "pressure");
    expect(peekSkills(live)).not.toBeNull();

    publish([
      { name: "workflow", invocation: "workflow", source: "omp", description: "" },
      { name: "review", invocation: "review", source: "omp", description: "" },
    ]);
    await vi.waitFor(() => expect(onSkills).toHaveBeenCalledTimes(2));
    expect(onSkills.mock.calls[1]![0]).toMatchObject([{ name: "workflow" }, { name: "review" }]);
    stop();
  });

  it("keeps an in-flight load so its result still lands", async () => {
    const pending = deferred<never[]>();
    mocks.listSkills.mockImplementation((cwd: string) =>
      cwd === "/pending" ? pending.promise : Promise.resolve([]),
    );
    const loading = loadSkills(claude("/pending"));

    await loadIdle(ENTRY_LIMIT + 2, "pressure");

    // An evicted entry would drop this write, leaving peek null.
    pending.resolve([]);
    await loading;
    expect(peekSkills(claude("/pending"))).not.toBeNull();
  });
});
