import { vi } from "vitest";
import { HostTerminals } from "../terminals/terminals";
import type { HostTerminal } from "../../src/shared/model/host-contracts/terminals";

/** Keep transport reads and the indexed activity probe on the same simulated process. */
export function mockWorkspaceTerminal(terminal: HostTerminal, workspacePath: string): () => void {
  const list = vi.spyOn(HostTerminals.prototype, "list").mockImplementation((id) => ({
    terminals: id === terminal.projectId ? [terminal] : [],
    writable: true,
    profiles: [],
  }));
  const activity = vi
    .spyOn(HostTerminals.prototype, "runningInWorkspace")
    .mockImplementation((root) =>
      root === workspacePath && terminal.state === "running" ? [terminal] : [],
    );
  const write = vi.spyOn(HostTerminals.prototype, "write").mockResolvedValue({ accepted: true });
  const read = vi.spyOn(HostTerminals.prototype, "read").mockImplementation(() => ({
    terminal,
    cursor: 1,
    output: "done",
    truncated: false,
    hasMore: false,
  }));
  return () => {
    list.mockRestore();
    activity.mockRestore();
    write.mockRestore();
    read.mockRestore();
  };
}
