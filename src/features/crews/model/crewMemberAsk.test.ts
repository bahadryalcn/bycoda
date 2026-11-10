import { beforeEach, describe, expect, it, vi } from "vitest";

const remoteRequest = vi.fn();
vi.mock("../../connections/public/connections", () => ({
  remoteRequest: (...args: unknown[]) => remoteRequest(...args),
}));
import { askCrewMember } from "./crewMemberAsk";

const target = { machineId: "m", projectId: "p" };
const result = { taskId: "t", memberId: "dev", memberName: "Dev", reused: false };
const idOf = (call: number) =>
  (remoteRequest.mock.calls[call]![2] as { requestId: string }).requestId;

describe("askCrewMember", () => {
  beforeEach(() => remoteRequest.mockReset());

  it("sends the project and reuses the request ID after a failure", async () => {
    remoteRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(result);
    await expect(askCrewMember(target, { handle: "dev", prompt: "x" })).rejects.toThrow("offline");
    await askCrewMember(target, { handle: "dev", prompt: "x" });
    expect(idOf(1)).toBe(idOf(0));
    expect(remoteRequest.mock.calls[0]![1]).toBe("crews.member.ask");
    expect(remoteRequest.mock.calls[0]![2]).toMatchObject({ projectId: "p", handle: "dev" });
  });

  it("issues a fresh request ID after success or for a different payload", async () => {
    remoteRequest.mockResolvedValue(result);
    await askCrewMember(target, { handle: "dev", prompt: "x" });
    await askCrewMember(target, { handle: "dev", prompt: "x" });
    await askCrewMember(target, { handle: "dev", prompt: "y" });
    expect(new Set([idOf(0), idOf(1), idOf(2)]).size).toBe(3);
  });
});
