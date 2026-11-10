import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrewDefinition, SavedCrewAgent } from "../../crews/public/mentions";

const request = vi.hoisted(() => vi.fn());
const capabilities = vi.hoisted(() => vi.fn());

vi.mock("../../connections/public/connections", () => ({ remoteRequest: request }));
vi.mock("../../automations/public/hostMachines", () => ({
  backgroundMachines: async () => [{ id: "host" }],
  backgroundMachineFor: (machines: unknown[]) => machines[0],
  machineCapabilities: capabilities,
  machineProjects: async () => [{ id: "p1", cwd: "/work/app" }],
}));
vi.mock("../../connections/public/remoteProjects", () => ({ parseRemotePath: () => undefined }));

import { delegateCrewMentions } from "./crewDelegation";

const dba = { id: "m1", name: "DBA", role: "specialist", handle: "dba" } as SavedCrewAgent;
const team = { id: "c1", name: "Data Team", agents: [dba] } as unknown as CrewDefinition;
const context = { sessionId: "s1", cwd: "/work/app", requestKey: "s1:turn-0" };

beforeEach(() => {
  request.mockReset();
  capabilities.mockReset();
  request.mockImplementation(async (_machine: string, method: string) => {
    if (method === "crews.list") return { agents: [dba], definitions: [team] };
    if (method === "crews.member.ask") return { taskId: "task-9" };
    if (method === "crews.start") return { id: "run-4" };
    throw new Error(`unexpected ${method}`);
  });
});

const calls = (method: string) => request.mock.calls.filter((call) => call[1] === method);

describe("delegateCrewMentions", () => {
  it("asks a mentioned member and a crew with stable request ids", async () => {
    capabilities.mockResolvedValue(["crews.v1", "crews.member.ask.v1"]);
    const notes = await delegateCrewMentions("@dba check @data-team plan", context);
    expect(notes).toEqual([
      "Delegated to @dba (task task-9); results will appear here.",
      "Delegated to @data-team (run run-4); results will appear here.",
    ]);
    expect(calls("crews.member.ask")[0]![2]).toEqual({
      projectId: "p1",
      requestId: "chat-mention:s1:turn-0:member:m1",
      memberId: "m1",
      prompt: "@dba check @data-team plan",
      parentSessionId: "s1",
    });
    expect(calls("crews.start")[0]![2]).toMatchObject({
      definitionId: "c1",
      newConversation: true,
      requestId: "chat-mention:s1:turn-0:crew:c1",
    });
    await delegateCrewMentions("@dba check @data-team plan", context);
    expect(calls("crews.member.ask")[1]![2]).toMatchObject({
      requestId: "chat-mention:s1:turn-0:member:m1",
    });
  });

  it("leaves a member mention as plain text without the Host capability", async () => {
    capabilities.mockResolvedValue(["crews.v1"]);
    expect(await delegateCrewMentions("@dba hello", context)).toEqual([]);
    expect(calls("crews.member.ask")).toHaveLength(0);
    expect(await delegateCrewMentions("@data-team hello", context)).toHaveLength(1);
  });

  it("does not call the Host for text without a resolved mention", async () => {
    capabilities.mockResolvedValue(["crews.v1", "crews.member.ask.v1"]);
    expect(await delegateCrewMentions("mail a@dba.com", context)).toEqual([]);
    expect(await delegateCrewMentions("@unknown hi", context)).toEqual([]);
    expect(calls("crews.member.ask")).toHaveLength(0);
    expect(calls("crews.start")).toHaveLength(0);
  });

  it("throws a readable error when a delegation fails and does not retry", async () => {
    capabilities.mockResolvedValue(["crews.v1", "crews.member.ask.v1"]);
    request.mockImplementation(async (_machine: string, method: string) => {
      if (method === "crews.list") return { agents: [dba], definitions: [team] };
      throw new Error("host busy");
    });
    await expect(delegateCrewMentions("@dba go", context)).rejects.toThrow(
      "Could not delegate to @dba: host busy",
    );
    expect(calls("crews.member.ask")).toHaveLength(1);
  });
});
