import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRequest: vi.fn(),
  runMachineCommand: vi.fn(),
  invalidateSkills: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mocks.remoteRequest }));
vi.mock("../../connections/model/remoteCommands", () => ({
  runMachineCommand: mocks.runMachineCommand,
}));
vi.mock("./skills", () => ({
  invalidateSkills: mocks.invalidateSkills,
  SKILLS_CHANGE_EVENT: "bycoda:skills-change",
}));
import { installRecommendedSkill, recommendedSkillInstallStatus } from "./skillInstallation";

const request = {
  requestId: "test-installation-request",
  skillId: "impeccable",
  scope: "user" as const,
  provider: "all" as const,
  cwd: "",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invoke.mockResolvedValue({ id: "local-host", environmentId: "local-machine" });
});

it("uses authenticated local Host and invalidates discovery only after verified installation", async () => {
  mocks.remoteRequest.mockResolvedValue({
    status: "installed",
    requestId: request.requestId,
    skillId: request.skillId,
  });
  expect((await installRecommendedSkill(request)).status).toBe("installed");
  expect(mocks.invoke).toHaveBeenCalledWith("local_host_connect");
  expect(mocks.remoteRequest).toHaveBeenCalledWith("local-host", "workspace.run", {
    command: "skill_catalog_install",
    args: request,
  });
  expect(mocks.invalidateSkills).toHaveBeenCalledOnce();
});

it("reconciles uncertain response with status instead of resending the install", async () => {
  mocks.remoteRequest.mockRejectedValueOnce(new Error("RPC_TIMEOUT")).mockResolvedValueOnce({
    status: "pending",
    requestId: request.requestId,
    skillId: request.skillId,
  });
  expect((await installRecommendedSkill(request)).status).toBe("pending");
  expect(mocks.remoteRequest.mock.calls.map((call) => call[2].command)).toEqual([
    "skill_catalog_install",
    "skill_catalog_install_status",
  ]);
  expect(mocks.invalidateSkills).not.toHaveBeenCalled();
});

it("keeps remote machine and request identity and never falls back to local installation", async () => {
  const selected = { ...request, cwd: "remote://machine-2/G:/project", scope: "project" as const };
  mocks.runMachineCommand.mockResolvedValue({
    status: "installed",
    requestId: request.requestId,
    skillId: request.skillId,
  });
  await installRecommendedSkill(selected);
  expect(mocks.runMachineCommand).toHaveBeenCalledWith(
    "machine-2",
    "skill_catalog_install",
    selected,
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.runMachineCommand.mockRejectedValue(new Error("offline"));
  await expect(installRecommendedSkill(selected)).rejects.toThrow("unknown");
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("status never starts an installation and absent local Host never reroutes to another machine", async () => {
  mocks.remoteRequest.mockResolvedValue({ status: "unknown" });
  await recommendedSkillInstallStatus(request);
  expect(mocks.remoteRequest).toHaveBeenCalledWith("local-host", "workspace.run", {
    command: "skill_catalog_install_status",
    args: request,
  });
  mocks.invoke.mockResolvedValue(null);
  await expect(recommendedSkillInstallStatus(request)).rejects.toThrow("not connected");
  expect(mocks.runMachineCommand).not.toHaveBeenCalled();
});
