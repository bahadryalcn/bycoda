// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { fetchCheckDetails, fetchPrChecks, hasCheckDetails } from "./prChecks";
import { filterCodeHostScopes, readHiddenScopes, saveHiddenScopes } from "./codeHostScopes";
import { buildCiRepairRequest } from "./ciRepair";
import type { InboxItem } from "./githubTasks";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  localStorage.clear();
});
it("GitLab checks ve günlükleri dış URL yerine yapılandırılmış native referansla okur", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    headOid: "head",
    checks: [],
    instance: "https://git.example",
  });
  expect(await fetchPrChecks("gitlab", "", "group/repo", 7)).toMatchObject({
    provider: "gitlab",
    instance: "https://git.example",
  });
  expect(invoke).toHaveBeenLastCalledWith("gitlab_pr_checks", {
    repo: "group/repo",
    number: 7,
  });
  const check = {
    name: "tests",
    workflow: "CI",
    state: "fail" as const,
    url: "https://untrusted.example/log",
    startedAt: null,
    completedAt: null,
    provider: "gitlab" as const,
    instance: "https://git.example",
    detailsRef: { project: "12", jobId: "34" },
  };
  vi.mocked(invoke).mockResolvedValueOnce({
    steps: [],
    annotations: [],
    log: "failure",
  });
  expect(hasCheckDetails(check, "group/repo")).toBe(true);
  expect(await fetchCheckDetails("", "group/repo", check)).toMatchObject({
    log: "failure",
  });
  expect(invoke).toHaveBeenLastCalledWith("gitlab_check_details", {
    repo: "group/repo",
    project: "12",
    jobId: "34",
    expectedInstance: "https://git.example",
  });
});
it("Azure policy build detayını doğru komuta yollar ve referanssız URLyi takip etmez", async () => {
  const check = {
    name: "build",
    workflow: "policy",
    state: "fail" as const,
    url: "https://example.invalid",
    startedAt: null,
    completedAt: null,
    provider: "azuredevops" as const,
    instance: "https://dev.azure.com/org",
    detailsRef: { project: "p", buildId: "56" },
  };
  vi.mocked(invoke).mockResolvedValue({ steps: [], annotations: [] });
  await fetchCheckDetails("", "p/repo", check);
  expect(invoke).toHaveBeenLastCalledWith("azure_devops_check_details", {
    repo: "p/repo",
    project: "p",
    buildId: "56",
    expectedInstance: "https://dev.azure.com/org",
  });
  vi.mocked(invoke).mockClear();
  expect(await fetchCheckDetails("", "p/repo", { ...check, detailsRef: undefined })).toHaveProperty(
    "notice",
  );
  expect(invoke).not.toHaveBeenCalled();
});
it("Yerel checkout olmadan projeyi gizler ve tercihleri instance/provider bazında ayırır", () => {
  saveHiddenScopes("gitlab", "https://one.example/", ["1", "1"]);
  expect(readHiddenScopes("gitlab", "https://one.example")).toEqual(["1"]);
  expect(readHiddenScopes("gitlab", "https://two.example")).toEqual([]);
  expect(readHiddenScopes("azuredevops", "https://one.example")).toEqual([]);
  const item = {
    provider: "gitlab",
    repo: "group/repo",
    projectPath: "",
    kind: "pr",
  } as InboxItem;
  expect(
    filterCodeHostScopes(
      [item],
      "gitlab",
      {
        instance: "x",
        projects: [{ id: "1", path: "group/repo", name: "renamed" }],
      },
      ["1"],
    ),
  ).toEqual([]);
  expect(filterCodeHostScopes([item], "gitlab", { instance: "x", projects: [] }, ["1"])).toEqual([
    item,
  ]);
  expect(
    filterCodeHostScopes(
      [{ ...item, provider: "azuredevops", repo: "Team/repo" }],
      "azuredevops",
      { instance: "x", projects: [{ id: "1", path: "Team", name: "Team" }] },
      ["1"],
    ),
  ).toEqual([]);
});
it("Onarım bağlamında gerçek MR URLsi, provider kimliği ve sınırlı günlük kanıtı korunur", () => {
  const result = buildCiRepairRequest({
    provider: "gitlab",
    instance: "https://git.example",
    url: "https://git.example/g/r/-/merge_requests/9",
    repo: "g/r",
    number: 9,
    headOid: "head",
    evidence: [
      {
        name: "test",
        workflow: "CI",
        state: "fail",
        url: null,
        startedAt: null,
        completedAt: null,
        details: { steps: [], annotations: [], log: "failure\n".repeat(5000) },
      },
    ],
  });
  expect(result.target).toMatchObject({
    provider: "gitlab",
    instance: "https://git.example",
  });
  expect(result.prompt).toContain("https://git.example/g/r/-/merge_requests/9");
  expect(result.prompt).not.toContain("https://github.com/g/r");
  expect(result.prompt).toContain("failure");
  expect(result.prompt.length).toBeLessThanOrEqual(12000);
});

it("Instance origin normalize edilir, self-hosted base pathname case korunur", () => {
  saveHiddenScopes("gitlab", "https://GIT.example/GitLab/", ["12"]);
  expect(readHiddenScopes("gitlab", "https://git.example/GitLab")).toEqual(["12"]);
  expect(readHiddenScopes("gitlab", "https://git.example/gitlab/")).toEqual([]);
});
