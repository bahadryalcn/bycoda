import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { finishWithFindings } from "./owner-completion";
import { hasShellPhysicalOwner } from "../execution/shell-ownership";
import { sessionRunState } from "../sessions/sessionRuns";
import { completeWithFindings } from "./recovery";

vi.mock("../execution/shell-ownership", () => ({ hasShellPhysicalOwner: vi.fn() }));
vi.mock("../sessions/sessionRuns", () => ({ sessionRunState: vi.fn() }));
vi.mock("./recovery", () => ({ completeWithFindings: vi.fn() }));

const task = {
  id: "task",
  updatedAt: 12,
  status: "blocked",
  sessionId: "worker",
  runId: "run",
  error: "Review failed: Defect remains",
  verification: { review: { verdict: "fail", note: "Defect remains" } },
} as HostTask;

function fixture() {
  return {
    ready: Promise.resolve(),
    transaction: async <T>(work: () => Promise<T>) => work(),
    store: { db: { checkAuthorization: vi.fn() } },
    find: vi.fn(async () => task),
    jobs: new Map(),
    delivering: new Set(),
    now: () => 20,
  } as unknown as TaskContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasShellPhysicalOwner).mockResolvedValue(false);
  vi.mocked(sessionRunState).mockResolvedValue({ state: "finished", status: "succeeded" });
  vi.mocked(completeWithFindings).mockResolvedValue(task);
});

describe("owner finish with findings", () => {
  it("uses the canonical findings path with the failed result intact", async () => {
    const context = fixture();
    await finishWithFindings(context, task.id, 12);
    expect(context.store.db.checkAuthorization).toHaveBeenCalled();
    expect(completeWithFindings).toHaveBeenCalledWith(context, task, task.error, 20, "limit");
    expect(task.verification?.review?.verdict).toBe("fail");
  });

  it("rejects a result changed since the owner saw it", async () => {
    await expect(finishWithFindings(fixture(), task.id, 11)).rejects.toThrow("Task changed");
    expect(completeWithFindings).not.toHaveBeenCalled();
  });

  it("refuses retained command ownership and provider activity", async () => {
    vi.mocked(hasShellPhysicalOwner).mockResolvedValue(true);
    await expect(finishWithFindings(fixture(), task.id, 12)).rejects.toThrow("still active");
    vi.mocked(hasShellPhysicalOwner).mockResolvedValue(false);
    vi.mocked(sessionRunState).mockResolvedValue({ state: "running", needsInput: false });
    await expect(finishWithFindings(fixture(), task.id, 12)).rejects.toThrow("not proven stopped");
    expect(completeWithFindings).not.toHaveBeenCalled();
  });

  it("rejects revoked authority before any completion effect", async () => {
    const context = fixture();
    vi.mocked(context.store.db.checkAuthorization).mockRejectedValue(new Error("revoked"));
    await expect(finishWithFindings(context, task.id, 12)).rejects.toThrow("revoked");
    expect(completeWithFindings).not.toHaveBeenCalled();
  });
});
