import { describe, expect, it } from "vitest";
import { plannerPrompt, type HostGoal } from "./goal-prompts";

const projects = [{ name: "mini-golf", cwd: "/work/mini-golf", lead: true }];
const goal = (extra: Partial<HostGoal> = {}) =>
  ({
    id: "goal",
    title: "Mini golf",
    prompt: "Build a simple mini golf game that runs in the browser.",
    projectIds: ["project"],
    taskIds: [],
    isolate: false,
    ...extra,
  }) as HostGoal;

describe("plannerPrompt", () => {
  it("limits the plan to the requested scope and the fewest tasks", () => {
    const prompt = plannerPrompt(goal(), projects);
    expect(prompt).toContain("Plan exactly what the job asks");
    expect(prompt).toContain("do not add product scope the job does not ask for");
    expect(prompt).toContain("Use the fewest tasks that complete the job");
    expect(prompt).toContain("A job one agent can finish in a single run is one task");
  });

  it("keeps host-supplied worker rules out of task prompts", () => {
    const prompt = plannerPrompt(goal({ continueUntilDone: true }), projects);
    expect(prompt).toContain("Do not restate them in task prompts");
    // The host contract already carries the autonomy rule to every worker.
    expect(prompt).not.toContain("Carry that intent into every task");
  });
});
