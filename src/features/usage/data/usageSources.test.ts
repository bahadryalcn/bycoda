import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/public/localSync", () => ({
  isLocalSyncMachine: (machine: { localHost?: boolean }) => !!machine.localHost,
}));

import { loadMachineUsage, otherUsageMachines } from "./usageSources";
import type { UsageRowsResult } from "../../../shared/model/host-contracts/usage-rows";

const row = {
  slot: 1_700_000_100,
  model: "m",
  project: "/p",
  input: 1,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  output: 2,
};
const result = (sinceMs: number): UsageRowsResult => ({
  environmentId: "env-office",
  sampledAt: 0,
  sinceMs,
  accounts: [
    { provider: "claude", accountId: "default", label: "Host default", rows: [row] },
    { provider: "codex", accountId: "work", label: "Work", rows: [] },
  ],
  coverage: { filesScanned: 1, truncated: false },
});

describe("usage across machines", () => {
  it("lists every saved Host except this computer once", () => {
    const machine = (id: string, environmentId: string, localHost = false) => ({
      id,
      name: id.toUpperCase(),
      endpoint: "",
      environmentId,
      localHost,
    });
    expect(
      otherUsageMachines([
        machine("here", "env-here", true),
        machine("office", "env-office"),
        machine("office-ssh", "env-office"),
        machine("lab", "env-lab"),
      ]),
    ).toEqual([
      { id: "office", label: "OFFICE" },
      { id: "lab", label: "LAB" },
    ]);
  });

  it("names accounts after their machine and marks a failing machine unavailable", async () => {
    const reads = await loadMachineUsage(
      [
        { id: "office", label: "Office" },
        { id: "lab", label: "Lab" },
      ],
      1_000,
      async (machineId, sinceMs) => {
        if (machineId === "lab") throw new Error("offline");
        return result(sinceMs + 5);
      },
    );
    expect(reads[1]).toEqual({ machine: { id: "lab", label: "Lab" }, status: "unavailable" });
    const office = reads[0];
    if (office.status !== "ok") throw new Error("expected office to answer");
    expect(office.sinceMs).toBe(1_005);
    expect(office.accounts.map(({ account }) => [account.provider, account.id])).toEqual([
      ["claude", "office/default"],
      ["codex", "office/work"],
    ]);
    expect(office.accounts[0].account.label).toBe("Office · Default account");
    expect(office.accounts[1].account.label).toBe("Office · Work");
    expect(office.accounts[0].rows).toEqual([row]);
  });
});
