import { expect, it, vi } from "vitest";
import type { AssistantJob } from "../../../src/shared/model/host-contracts/assistant";
import { createAssistantProjectJob } from "./assistant-project-job";

type Deps = Parameters<typeof createAssistantProjectJob>[0];
type Input = Parameters<typeof createAssistantProjectJob>[1];

function fixture(existing: Partial<AssistantJob>[]) {
  const put = vi.fn(async (_table: string, value: object) => ({ ...value, id: "new" }));
  const deps = {
    store: { transaction: (work: () => unknown) => work() },
    repository: { byKey: async () => null, list: async () => existing, put },
    stamp: () => ({}),
    activity: async () => undefined,
    setRuntime: async () => undefined,
  } as unknown as Deps;
  const input = {
    op: "jobs.create",
    title: "Mini golf",
    request: "Build a mini golf game.",
    projectId: "project",
    idempotencyKey: "second-key",
  } as Input;
  return { deps, input, put };
}
const running = {
  id: "first",
  title: "Mini golf",
  request: "Build a mini golf game.",
  projectId: "project",
  projectIds: ["project"],
  status: "running",
} as Partial<AssistantJob>;

it("returns the active job instead of starting the same request twice in one project", async () => {
  const { deps, input, put } = fixture([running]);
  expect((await createAssistantProjectJob(deps, input, ["project"])).id).toBe("first");
  expect(put).not.toHaveBeenCalled();
});

it("starts a new job when the earlier identical one finished or targets another project", async () => {
  for (const other of [
    { ...running, status: "done" },
    { ...running, projectId: "other", projectIds: ["other"] },
  ]) {
    const { deps, input, put } = fixture([other as Partial<AssistantJob>]);
    expect((await createAssistantProjectJob(deps, input, ["project"])).id).toBe("new");
    expect(put).toHaveBeenCalledTimes(1);
  }
});
