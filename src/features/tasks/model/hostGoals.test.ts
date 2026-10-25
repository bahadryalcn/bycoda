import { describe, expect, it } from "vitest";
import { goalProgress, goalStateFromTasks, parseGoalPlan, parseHostGoal } from "./hostGoals";
import { parseHostTask, unfinishedDependencies, type TaskStatus } from "./hostTasks";

const PROJECTS = ["/work/app", "/work/api", "C:\\work\\site"];

const fenced = (value: unknown, info = "json") =>
  `Here is the plan.\n\n\`\`\`${info}\n${typeof value === "string" ? value : JSON.stringify(value)}\n\`\`\``;

const entry = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  project: "/work/app",
  title: `Do ${key}`,
  prompt: `Instructions for ${key}`,
  dependsOn: [],
  ...overrides,
});

const parse = (value: unknown, info?: string) => parseGoalPlan(fenced(value, info), PROJECTS);

describe("parseGoalPlan", () => {
  it("reads the tasks of the last json block", () => {
    const reply = [
      "An early draft:",
      fenced({ tasks: [entry("draft")] }),
      "And the final plan:",
      fenced({
        tasks: [
          entry("api", { project: "/work/api" }),
          entry("app", { dependsOn: ["api", "api"] }),
        ],
      }),
    ].join("\n\n");
    expect(parseGoalPlan(reply, PROJECTS)).toEqual({
      tasks: [
        {
          key: "api",
          project: "/work/api",
          title: "Do api",
          prompt: "Instructions for api",
          dependsOn: [],
        },
        {
          key: "app",
          project: "/work/app",
          title: "Do app",
          prompt: "Instructions for app",
          dependsOn: ["api"],
        },
      ],
    });
  });

  it("prefers a block marked json, and takes an unmarked one otherwise", () => {
    const reply = `${fenced({ tasks: [entry("marked")] })}\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    expect(parseGoalPlan(reply, PROJECTS).tasks[0].key).toBe("marked");
    expect(parse({ tasks: [entry("plain")] }, "").tasks[0].key).toBe("plain");
  });

  it("treats missing dependsOn as none and trims titles", () => {
    const { dependsOn, ...rest } = entry("one", { title: "  Do one  " });
    expect(parse({ tasks: [rest] }).tasks[0]).toMatchObject({
      title: "Do one",
      dependsOn: [],
    });
  });

  it("matches projects written with other slashes or case, to the listed path", () => {
    expect(parse({ tasks: [entry("a", { project: "C:/work/site/" })] }).tasks[0].project).toBe(
      "C:\\work\\site",
    );
    expect(parse({ tasks: [entry("a", { project: "/WORK/API" })] }).tasks[0].project).toBe(
      "/work/api",
    );
    // Ambiguous ignoring case: only an exact match counts.
    expect(() =>
      parseGoalPlan(fenced({ tasks: [entry("a", { project: "/x/A" })] }), ["/x/a", "/X/a"]),
    ).toThrow("not one of this goal’s projects");
  });

  it.each([
    ["no block", "I have no plan.", "The planner’s reply has no ```json block with the plan."],
    ["invalid JSON", fenced("{tasks: [}"), "The plan is not valid JSON:"],
    [
      "a list instead of an object",
      fenced([entry("a")]),
      "The plan must be an object with a “tasks” list.",
    ],
    ["no tasks list", fenced({ steps: [] }), "The plan must be an object with a “tasks” list."],
    ["an empty list", fenced({ tasks: [] }), "The plan has no tasks."],
    [
      "too many tasks",
      fenced({ tasks: Array.from({ length: 21 }, (_, i) => entry(`t${i}`)) }),
      "The plan has 21 tasks; at most 20 are allowed.",
    ],
    ["a task that is not an object", fenced({ tasks: ["a"] }), "Task 1 is not an object."],
    [
      "a missing key",
      fenced({ tasks: [entry("a"), { ...entry("b"), key: undefined }] }),
      "Task 2 needs a “key”",
    ],
    ["a key with spaces", fenced({ tasks: [entry("two words")] }), "Task 1 needs a “key”"],
    ["a duplicate key", fenced({ tasks: [entry("a"), entry("a")] }), "The key “a” is used twice."],
    ["no project", fenced({ tasks: [entry("a", { project: "" })] }), "Task “a” has no “project”."],
    [
      "a project not in the list",
      fenced({ tasks: [entry("a", { project: "/work/other" })] }),
      "Task “a” is for “/work/other”, which is not one of this goal’s projects.",
    ],
    [
      "no title",
      fenced({ tasks: [entry("a", { title: " " })] }),
      "Task “a” needs a “title” under 200 characters.",
    ],
    [
      "a long title",
      fenced({ tasks: [entry("a", { title: "x".repeat(201) })] }),
      "Task “a” needs a “title”",
    ],
    ["no prompt", fenced({ tasks: [entry("a", { prompt: "" })] }), "Task “a” has no “prompt”."],
    [
      "dependsOn that is not a list",
      fenced({ tasks: [entry("a", { dependsOn: "b" })] }),
      "Task “a”: “dependsOn” must be a list of task keys.",
    ],
    [
      "an unknown dependency",
      fenced({ tasks: [entry("a", { dependsOn: ["ghost"] })] }),
      "Task “a” depends on “ghost”, which is not in the plan.",
    ],
    [
      "a task depending on itself",
      fenced({ tasks: [entry("a", { dependsOn: ["a"] })] }),
      "The plan’s dependencies form a cycle: a → a.",
    ],
    [
      "a longer cycle",
      fenced({
        tasks: [
          entry("root"),
          entry("a", { dependsOn: ["root", "c"] }),
          entry("b", { dependsOn: ["a"] }),
          entry("c", { dependsOn: ["b"] }),
        ],
      }),
      "The plan’s dependencies form a cycle: a → c → b → a.",
    ],
  ])("refuses %s", (_, reply, error) => {
    expect(() => parseGoalPlan(reply, PROJECTS)).toThrow(error);
  });

  it("accepts a diamond of dependencies", () => {
    expect(
      parse({
        tasks: [
          entry("base"),
          entry("left", { dependsOn: ["base"] }),
          entry("right", { dependsOn: ["base"] }),
          entry("top", { dependsOn: ["left", "right"] }),
        ],
      }).tasks,
    ).toHaveLength(4);
  });

  it("accepts exactly 20 tasks", () => {
    expect(
      parse({ tasks: Array.from({ length: 20 }, (_, i) => entry(`t${i}`)) }).tasks,
    ).toHaveLength(20);
  });
});

describe("parseHostGoal", () => {
  it("validates and preserves continuous execution without changing legacy defaults", () => {
    const input = {
      id: "goal",
      title: "Complete report",
      prompt: "Finish all sections",
      projectIds: ["project"],
      leadProjectId: "project",
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      verifyDefaults: { review: true },
      approvePlan: false,
    };
    expect(parseHostGoal({ ...input, continueUntilDone: true }).continueUntilDone).toBe(true);
    expect(parseHostGoal(input).continueUntilDone).toBeUndefined();
    expect(() => parseHostGoal({ ...input, continueUntilDone: 1 })).toThrow("Invalid goal options");
  });
  const goal = (overrides: Record<string, unknown> = {}) => ({
    id: "goal",
    title: " Launch ",
    prompt: "Ship it",
    projectIds: ["app", "api", "app"],
    leadProjectId: "app",
    harness: "claude",
    model: "claude:test",
    runtimeMode: "auto",
    ...overrides,
  });

  it("fills in defaults and drops duplicate projects", () => {
    expect(parseHostGoal(goal())).toEqual({
      id: "goal",
      title: "Launch",
      prompt: "Ship it",
      projectIds: ["app", "api"],
      leadProjectId: "app",
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      verifyDefaults: { review: true },
      approvePlan: false,
    });
  });

  it("opts new goals into final review without trusting caller-supplied results", () => {
    const parsed = parseHostGoal(
      goal({
        finalReview: true,
        finalAcceptance: { status: "passed", taskFingerprint: "forged" },
      }),
    );
    expect(parsed.finalReview).toBe(true);
    expect(parsed).not.toHaveProperty("finalAcceptance");
    expect(parseHostGoal(goal()).finalReview).toBeUndefined();
    expect(() => parseHostGoal(goal({ finalReview: "yes" }))).toThrow("Invalid goal options");
    expect(parseHostGoal(goal({ budget: { maxAttempts: 3 } })).budget).toEqual({
      maxAttempts: 3,
      warningPercent: 80,
    });
    expect(() => parseHostGoal(goal({ budget: { maxTokens: -1 } }))).toThrow(
      "Invalid run budget limit",
    );
  });

  it("keeps check commands for the goal's projects only", () => {
    expect(
      parseHostGoal(
        goal({
          approvePlan: true,
          verifyDefaults: {
            review: false,
            verifyCommand: { api: " npm test ", app: "  " },
          },
        }),
      ),
    ).toMatchObject({
      approvePlan: true,
      verifyDefaults: { review: false, verifyCommand: { api: "npm test" } },
    });
    expect(() =>
      parseHostGoal(goal({ verifyDefaults: { verifyCommand: { other: "x" } } })),
    ).toThrow("Invalid check command");
  });

  it.each([
    [{ projectIds: [] }, "Choose at least one project for this goal."],
    [
      {
        projectIds: Array.from({ length: 9 }, (_, i) => `p${i}`),
        leadProjectId: "p0",
      },
      "A goal can span at most 8 projects.",
    ],
    [{ leadProjectId: "elsewhere" }, "The lead project must be one of the goal’s projects."],
    [{ title: "" }, "Goal title is required"],
    [{ prompt: " " }, "Describe the job for this goal."],
    [{ harness: "nope" }, "Invalid goal agent"],
    [{ approvePlan: "yes" }, "Invalid goal options"],
  ])("refuses %o", (overrides, error) => {
    expect(() => parseHostGoal(goal(overrides))).toThrow(error);
  });
});

describe("goal progress", () => {
  it("matches array and shared-index results for cross-goal chains and deleted dependencies", () => {
    const all = [
      { id: "blocked", title: "Blocked", status: "blocked" as const },
      { id: "external", title: "External", status: "queued" as const, dependsOn: ["blocked"] },
      { id: "own", title: "Own", status: "queued" as const, dependsOn: ["external"] },
    ];
    const goal = { taskIds: ["blocked", "own", "deleted"] };
    const index = new Map(all.map((task) => [task.id, task]));
    expect(goalStateFromTasks(goal, all)).toEqual({
      status: "blocked",
      error: "1 of 2 tasks blocked: Blocked",
    });
    expect(goalStateFromTasks(goal, index)).toEqual(goalStateFromTasks(goal, all));
    index.delete("external");
    expect(goalStateFromTasks(goal, index)).toEqual({ status: "running" });
    expect(goalStateFromTasks(goal, [...index.values()])).toEqual({ status: "running" });
  });

  const task = (id: string, status: TaskStatus, dependsOn?: string[]) => ({
    id,
    title: `Do ${id}`,
    status,
    ...(dependsOn ? { dependsOn } : {}),
  });
  const state = (...tasks: ReturnType<typeof task>[]) =>
    goalStateFromTasks({ taskIds: tasks.map((entry) => entry.id) }, tasks);

  it("is done when every task is done", () => {
    expect(state(task("a", "done"), task("b", "done"))).toEqual({
      status: "done",
    });
  });

  it("keeps running while anything can still move", () => {
    expect(state(task("a", "running"), task("b", "queued", ["a"]))).toEqual({
      status: "running",
    });
    // An unrelated task still runs beside a blocked one.
    expect(state(task("a", "blocked"), task("b", "running")).status).toBe("running");
    // A task in review waits only for the owner.
    expect(state(task("a", "blocked"), task("b", "review")).status).toBe("running");
    // A queued task whose dependencies are fine can still start.
    expect(state(task("a", "blocked"), task("b", "done"), task("c", "queued", ["b"])).status).toBe(
      "running",
    );
  });

  it("is blocked when every unfinished task waits on a blocked one", () => {
    expect(
      state(
        task("a", "blocked"),
        task("b", "queued", ["a"]),
        task("c", "queued", ["b"]),
        task("d", "done"),
      ),
    ).toEqual({ status: "blocked", error: "1 of 4 tasks blocked: Do a" });
    expect(state(task("a", "blocked"), task("b", "blocked"))).toEqual({
      status: "blocked",
      error: "2 of 2 tasks blocked: Do a, Do b",
    });
  });

  it("counts done tasks, leaving out deleted ones", () => {
    expect(
      goalProgress({ taskIds: ["a", "b", "gone"] }, [task("a", "done"), task("b", "queued")]),
    ).toEqual({ done: 1, total: 2 });
    expect(goalStateFromTasks({ taskIds: ["gone"] }, [])).toMatchObject({
      status: "blocked",
    });
  });
});

describe("task dependencies", () => {
  it("lists the dependencies that are not done, ignoring deleted ones", () => {
    const tasks = [
      { id: "a", status: "done" as const },
      { id: "b", status: "review" as const },
    ];
    expect(unfinishedDependencies({ dependsOn: ["a", "b", "gone"] }, tasks)).toEqual([tasks[1]]);
    expect(unfinishedDependencies({}, tasks)).toEqual([]);
  });

  it("validates a task's goal and dependencies", () => {
    const base = {
      id: "t1",
      title: "Task",
      prompt: "Do it",
      projectId: "p",
      harness: "claude",
      model: "claude:test",
      runtimeMode: "auto",
    };
    expect(parseHostTask({ ...base, goalId: "g", dependsOn: ["a", "a", "b"] })).toMatchObject({
      goalId: "g",
      dependsOn: ["a", "b"],
    });
    expect(parseHostTask(base)).not.toHaveProperty("dependsOn");
    expect(() => parseHostTask({ ...base, dependsOn: ["t1"] })).toThrow(
      "Invalid task dependencies",
    );
    expect(() => parseHostTask({ ...base, goalId: "bad id" })).toThrow("Invalid task goal");
  });
});
