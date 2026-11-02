import { expect, it } from "vitest";
import type { AssistantJob } from "../../../shared/model/host-contracts/assistant";
import { assistantJobTasksGoal } from "./assistantJobTasksReveal";
const target = {
  jobId: "job",
  goalId: "assistant-job",
  projectId: "a",
  projectIds: ["a", "b"],
  environmentId: "host-a",
};
const job = {
  id: "job",
  kind: "project",
  goalId: "assistant-job",
  projectId: "a",
  projectIds: ["a", "b"],
} as AssistantJob;
const goal = {
  id: "assistant-job",
  leadProjectId: "a",
  projectIds: ["b", "a"],
  status: "cancelled",
};
const projects = [
  { id: "a", path: "/visible-a" },
  { id: "b", path: "/visible-b" },
];
it("opens the retained canonical goal independently of approval or execution status", () => {
  expect(assistantJobTasksGoal(target, "host-a", job, [goal], projects, () => true)).toBe(goal);
});
it("refuses a replacement Host even when every record ID is cloned", () => {
  expect(() => assistantJobTasksGoal(target, "host-b", job, [goal], projects, () => true)).toThrow(
    "unavailable",
  );
});
it.each([
  { name: "deleted job", job: undefined, goals: [goal] },
  { name: "replaced job", job: { ...job, id: "other" }, goals: [goal] },
  { name: "moved job", job: { ...job, projectId: "b" }, goals: [goal] },
  { name: "changed participants", job: { ...job, projectIds: ["a"] }, goals: [goal] },
  { name: "changed goal participants", job, goals: [{ ...goal, projectIds: ["a"] }] },
  { name: "changed lead", job, goals: [{ ...goal, leadProjectId: "b" }] },
  { name: "missing goal", job, goals: [] },
  { name: "quick job", job: { ...job, kind: "quick" as const }, goals: [goal] },
])("refuses $name without opening another retained task set", ({ job: actual, goals }) => {
  expect(() =>
    assistantJobTasksGoal(target, "host-a", actual, goals, projects, () => true),
  ).toThrow("unavailable");
});
it("rechecks every participant's live privacy state, including nonlead projects", () => {
  expect(() =>
    assistantJobTasksGoal(target, "host-a", job, [goal], projects, (path) => path !== "/visible-b"),
  ).toThrow("unavailable");
  expect(() =>
    assistantJobTasksGoal(target, "host-a", job, [goal], projects.slice(0, 1), () => true),
  ).toThrow("unavailable");
});
