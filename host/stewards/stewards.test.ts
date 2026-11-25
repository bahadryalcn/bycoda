import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanups, setup as setupEngine } from "../engine-support/engine.test-support";
import { HostAutomations } from "../automations/automations";
import { projectScanAutomationId } from "../automations/steward-migration";
import { HostTasks } from "../tasks/tasks";
import { HostStewards, openLimitSkip } from "./stewards";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const reply = (proposals: unknown) =>
  `Here is what I found.\n\n\`\`\`json\n${JSON.stringify({ proposals })}\n\`\`\``;

async function setup() {
  const f = await setupEngine("claude");
  const clock = { now: new Date("2026-10-05T08:00:00").getTime() };
  const tasks = new HostTasks(f.store, f.engine, () => clock.now);
  const automations = new HostAutomations(f.store, f.engine, () => clock.now);
  automations.bindTasks(tasks);
  const stewards = new HostStewards(f.store, f.engine, tasks, () => clock.now);
  await stewards.bindAutomations(automations);
  cleanups.push(async () => {
    for (const turn of f.turns) turn.finish();
    await stewards.close();
    await automations.close();
    await tasks.idle();
  });
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "steward",
    projectId: f.project.id,
    enabled: true,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    isolate: false,
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    focus: "follow docs/ROADMAP.md",
    ...overrides,
  });
  const steward = async (id = "steward") =>
    (await stewards.list()).find((entry) => entry.id === id)!;
  const taskInput = (overrides: Record<string, unknown> = {}) => ({
    id: "existing",
    title: "Existing work",
    prompt: "Do the thing",
    projectId: f.project.id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    status: "todo",
    ...overrides,
  });
  /** What the automation does when a project-scan run finishes: hand the
   * agent's last reply to the steward, which turns it into to-do tasks. */
  const complete = async (text: string, id = "steward") => {
    await f.engine.command({
      type: "send",
      commandId: `scan-${f.turns.length}`,
      sessionId: f.id,
      text: "Scan",
    });
    await f.waitForTurnStart(f.turns.length + 1);
    const turn = f.turns.at(-1)!;
    turn.input.onEvent({ type: "message.delta", text });
    turn.input.onEvent({ type: "message.completed" });
    turn.finish();
    await vi.waitFor(async () => expect((await f.store.session(f.id)).status).toBe("idle"), {
      timeout: 30000,
    });
    await automations.projectScan!.completed(id, f.id);
  };
  return { ...f, clock, tasks, automations, stewards, input, steward, taskInput, complete };
}

describe("host stewards", () => {
  it("accepts only one concurrent edit of the same configuration", async () => {
    const f = await setup();
    const opening = await f.stewards.save(f.input({ enabled: false }));
    const results = await Promise.allSettled([
      f.stewards.save({ ...opening, focus: "First", expectedConfiguration: opening }),
      f.stewards.save({ ...opening, focus: "Second", expectedConfiguration: opening }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
  });
  it("rejects stale configuration edits and toggles while preserving newer steward focus", async () => {
    const { stewards, input } = await setup();
    const opening = await stewards.save(input({ enabled: false }));
    const newer = await stewards.save({
      ...opening,
      focus: "Newer focus",
      expectedConfiguration: opening,
    });
    await expect(
      stewards.save({ ...opening, model: "claude:other", expectedConfiguration: opening }),
    ).rejects.toThrow("Configuration changed in another client");
    await expect(
      stewards.save({ ...opening, enabled: true, expectedConfiguration: opening }),
    ).rejects.toThrow("Configuration changed in another client");
    expect((await stewards.list())[0]).toMatchObject({
      focus: "Newer focus",
      updatedAt: newer.updatedAt,
    });
    expect(
      await stewards.save({ ...newer, model: "claude:other", expectedConfiguration: newer }),
    ).toMatchObject({ focus: "Newer focus", model: "claude:other", enabled: false });
  });
  it("increments the configuration revision for same-clock saves", async () => {
    const { stewards, input } = await setup();
    const first = await stewards.save(input());
    const second = await stewards.save(input({ focus: "new focus" }));
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });
  it("allows one steward per project", async () => {
    const { stewards, input } = await setup();
    await stewards.save(input());
    await expect(stewards.save(input({ id: "second" }))).rejects.toThrow(
      "This project already has a steward.",
    );
    expect((await stewards.save(input({ focus: "new focus" }))).focus).toBe("new focus");
  });
  it("keeps declined titles and last run across an edit", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    await tasks.save(taskInput({ id: "mine", source: "steward", stewardId: "steward" }));
    await stewards.decline("mine");
    await stewards.save(input({ maxOpen: 3 }));
    expect(await steward()).toMatchObject({ declined: ["existing work"], maxOpen: 3 });
  });
  it("runs through its project-scan automation", async () => {
    const { stewards, automations, input } = await setup();
    await stewards.save(input());
    await stewards.runNow("steward");
    expect(await automations.runs(projectScanAutomationId("steward"))).toHaveLength(1);
  });
  it("stopRun cancels the project-scan automation's current run", async () => {
    const { stewards, automations, input } = await setup();
    await stewards.save(input());
    await expect(stewards.stopRun("steward")).rejects.toThrow("no active run");
    await stewards.runNow("steward");
    const [run] = await automations.runs(projectScanAutomationId("steward"));
    expect(await stewards.stopRun("steward")).toMatchObject({
      requested: true,
      run: { id: run.id, status: "cancelled" },
    });
    expect((await automations.runs(projectScanAutomationId("steward")))[0].status).toBe(
      "cancelled",
    );
    await expect(stewards.stopRun("steward")).rejects.toThrow("no active run");
  });
  it("deletes the steward with its automation but keeps its proposals", async () => {
    const { stewards, tasks, automations, input, taskInput } = await setup();
    await stewards.save(input());
    await tasks.save(taskInput({ source: "steward", stewardId: "steward" }));
    await stewards.delete("steward");
    expect(await stewards.list()).toEqual([]);
    expect(await automations.list()).toEqual([]);
    expect(await tasks.list()).toHaveLength(1);
  });
});

describe("steward proposals", () => {
  it("turns a scan reply into to-do tasks", async () => {
    const { stewards, tasks, project, input, complete, steward } = await setup();
    await stewards.save(input());
    await complete(
      reply([
        { title: "Add retry tests", description: "In src/retry.ts cover backoff." },
        { title: "Fix flaky login", description: "Seen in auth.test.ts." },
      ]),
    );
    expect(await steward()).toMatchObject({ lastProposed: 2 });
    const created = await tasks.list();
    expect(created.map((task) => task.title)).toEqual(["Add retry tests", "Fix flaky login"]);
    expect(created[0]).toMatchObject({
      status: "todo",
      source: "steward",
      stewardId: "steward",
      projectId: project.id,
      harness: "claude",
      model: "claude:test",
      prompt: "In src/retry.ts cover backoff.",
    });
  });
  it("queues proposals when the steward starts them automatically", async () => {
    const { stewards, tasks, input, complete } = await setup();
    await stewards.save(input({ autoStart: true }));
    await complete(reply([{ title: "Do it", description: "Specific work." }]));
    expect(await tasks.list()).toMatchObject([
      { title: "Do it", status: "queued", source: "steward" },
    ]);
  });
  it("keeps at most maxProposals", async () => {
    const { stewards, tasks, input, complete } = await setup();
    await stewards.save(input({ maxProposals: 2 }));
    await complete(
      reply([
        { title: "One", description: "a" },
        { title: "Two", description: "b" },
        { title: "Three", description: "c" },
      ]),
    );
    expect((await tasks.list()).map((task) => task.title)).toEqual(["One", "Two"]);
  });
  it("leaves out proposals that match open, done or declined work", async () => {
    const { stewards, tasks, input, taskInput, complete } = await setup();
    await stewards.save(input({ maxProposals: 10 }));
    await tasks.save(taskInput({ id: "open", title: "Add  Retry Tests." }));
    await tasks.save(taskInput({ id: "done", title: "Fix the login" }));
    await tasks.move("done", "done");
    await tasks.save(
      taskInput({ id: "mine", title: "Rename module", source: "steward", stewardId: "steward" }),
    );
    await stewards.decline("mine");
    await complete(
      reply([
        { title: "add retry tests", description: "dup of open" },
        { title: "  Fix the login!! ", description: "dup of done" },
        { title: "RENAME   module", description: "declined" },
        { title: "Brand new idea", description: "keep" },
        { title: "brand new idea.", description: "dup within the reply" },
      ]),
    );
    expect(
      (await tasks.list()).filter((task) => task.source === "steward").map((task) => task.title),
    ).toEqual(["Brand new idea"]);
  });
  it("rejects a reply with no usable proposals", async () => {
    const { stewards, tasks, input, complete } = await setup();
    await stewards.save(input());
    await expect(complete("I looked around but forgot the json block.")).rejects.toThrow("json");
    expect(await tasks.list()).toEqual([]);
    await expect(complete("```json\n{not json\n```")).rejects.toThrow("not valid JSON");
  });
  it("creates nothing when the steward proposes nothing", async () => {
    const { stewards, tasks, input, complete, steward } = await setup();
    await stewards.save(input());
    await complete(reply([]));
    expect(await steward()).toMatchObject({ lastProposed: 0 });
    expect(await tasks.list()).toEqual([]);
  });
  it("suspends the steward automatic merge preference for new tasks", async () => {
    const { stewards, tasks, input, complete } = await setup();
    await stewards.save(input({ autoMerge: true }));
    await complete(reply([{ title: "Do it", description: "Specific work." }]));
    expect((await tasks.list())[0].autoMerge).not.toBe(true);
  });
  it("leaves autoMerge off by default", async () => {
    const { stewards, tasks, input, complete } = await setup();
    await stewards.save(input());
    await complete(reply([{ title: "Do it", description: "Specific work." }]));
    expect((await tasks.list())[0].autoMerge).toBeUndefined();
  });
  it("skips the scan while maxOpen proposals wait", async () => {
    const { stewards, automations, tasks, input, taskInput } = await setup();
    await stewards.save(input({ maxOpen: 2 }));
    for (const id of ["a", "b"])
      await tasks.save(
        taskInput({ id, title: `Open ${id}`, source: "steward", stewardId: "steward" }),
      );
    await expect(automations.projectScan!.prepare("steward")).rejects.toThrow(openLimitSkip(2));
  });
  it("puts the read-only rule, focus and existing titles in the prompt", async () => {
    const { stewards, automations, tasks, input, taskInput } = await setup();
    await stewards.save(input());
    await tasks.save(taskInput({ id: "o", title: "Open item" }));
    await tasks.save(taskInput({ id: "d", title: "Finished item" }));
    await tasks.move("d", "done");
    await tasks.save(
      taskInput({ id: "x", title: "Declined idea", source: "steward", stewardId: "steward" }),
    );
    await stewards.decline("x");
    const prompt = await automations.projectScan!.prepare("steward");
    expect(prompt).toContain("follow docs/ROADMAP.md");
    expect(prompt).toContain("must NOT modify, create or delete");
    expect(prompt).toContain("read-only commands only");
    expect(prompt).toContain("- Open item");
    expect(prompt).toContain("- Finished item");
    expect(prompt).toContain("- declined idea");
    expect(prompt).toContain("at most 5");
    expect(prompt).toContain('{"proposals":[');
  });
});

describe("declining suggestions", () => {
  it("keeps a proposal and its suppression list when dependent work prevents declining", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    await tasks.save(
      taskInput({
        id: "protected-proposal",
        title: "Keep me",
        source: "steward",
        stewardId: "steward",
      }),
    );
    await tasks.save(taskInput({ id: "dependent-proposal", dependsOn: ["protected-proposal"] }));
    await expect(stewards.decline("protected-proposal")).rejects.toThrow("depend");
    expect(await tasks.get("protected-proposal")).toBeTruthy();
    expect((await steward()).declined).not.toContain("keep me");
  });
  it("declines a to-do suggestion: deletes it and remembers its title", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    await tasks.save(
      taskInput({
        id: "mine",
        title: "  Rename   Module. ",
        source: "steward",
        stewardId: "steward",
      }),
    );
    await stewards.decline("mine");
    expect(await tasks.get("mine")).toBeUndefined();
    expect((await steward()).declined).toEqual(["rename module"]);
  });
  it("only declines to-do steward suggestions", async () => {
    const { stewards, tasks, input, taskInput } = await setup();
    await stewards.save(input());
    await tasks.save(taskInput({ id: "manual" }));
    await tasks.save(
      taskInput({ id: "queued", source: "steward", stewardId: "steward", status: "queued" }),
    );
    await expect(stewards.decline("manual")).rejects.toThrow("Only a to-do suggestion");
    await expect(stewards.decline("queued")).rejects.toThrow("Only a to-do suggestion");
    await expect(stewards.decline("missing")).rejects.toThrow("Task not found");
  });
  it("caps the declined list at 200 titles", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    for (let index = 0; index < 202; index++) {
      await tasks.save(
        taskInput({
          id: `t${index}`,
          title: `Idea ${index}`,
          source: "steward",
          stewardId: "steward",
        }),
      );
      await stewards.decline(`t${index}`);
    }
    expect((await steward()).declined).toHaveLength(200);
    expect((await steward()).declined.at(-1)).toBe("idea 201");
    expect((await steward()).declined).not.toContain("idea 0");
  });
});
