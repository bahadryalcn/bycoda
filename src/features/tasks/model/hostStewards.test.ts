import { describe, expect, it } from "vitest";
import { normalizeStewardTitle, parseHostSteward, parseStewardProposals } from "./hostStewards";
import { parseHostTask } from "./hostTasks";

const steward = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  projectId: "p1",
  harness: "claude",
  model: "claude:test",
  runtimeMode: "auto",
  scheduleKind: "daily",
  minute: 0,
  time: "09:00",
  dayOfWeek: 1,
  ...overrides,
});

const fenced = (value: unknown, info = "json") =>
  `Notes.\n\n\`\`\`${info}\n${typeof value === "string" ? value : JSON.stringify(value)}\n\`\`\``;

describe("parseHostSteward", () => {
  it("fills in the defaults", () => {
    expect(parseHostSteward(steward())).toMatchObject({
      enabled: true,
      focus: "",
      maxProposals: 5,
      maxOpen: 10,
      autoStart: false,
      modelSettings: {},
    });
  });

  it("keeps what it was given, trimming the focus", () => {
    expect(
      parseHostSteward(
        steward({
          focus: "  find bugs ",
          maxProposals: 10,
          maxOpen: 30,
          autoStart: true,
          enabled: false,
        }),
      ),
    ).toMatchObject({
      focus: "find bugs",
      maxProposals: 10,
      maxOpen: 30,
      autoStart: true,
      enabled: false,
    });
  });

  it.each([
    [{ maxProposals: 0 }],
    [{ maxProposals: 11 }],
    [{ maxOpen: 0 }],
    [{ maxOpen: 31 }],
    [{ maxOpen: 1.5 }],
    [{ autoStart: "yes" }],
    [{ scheduleKind: "monthly" }],
    [{ time: "9am" }],
    [{ harness: "nope" }],
    [{ id: "bad id" }],
    [{ focus: 5 }],
  ])("rejects %j", (overrides) => {
    expect(() => parseHostSteward(steward(overrides))).toThrow();
  });
});

describe("normalizeStewardTitle", () => {
  it("lowercases, collapses whitespace and trims punctuation", () => {
    expect(normalizeStewardTitle("  Add   Retry\tTests!! ")).toBe("add retry tests");
    expect(normalizeStewardTitle("“Fix: the (login)”.")).toBe("fix: the (login");
    expect(normalizeStewardTitle("...")).toBe("");
  });
});

describe("parseStewardProposals", () => {
  it("reads the proposals of the last json block", () => {
    const text = [
      fenced({ proposals: [{ title: "Draft", description: "x" }] }),
      "Final answer:",
      fenced({
        proposals: [{ title: " One ", description: " does a " }, { title: "Two" }],
      }),
    ].join("\n");
    expect(parseStewardProposals(text, 5)).toEqual([
      { title: "One", description: "does a" },
      { title: "Two", description: "" },
    ]);
  });

  it("accepts a bare list and an unmarked block", () => {
    expect(parseStewardProposals(fenced([{ title: "A", description: "a" }], ""), 5)).toEqual([
      { title: "A", description: "a" },
    ]);
  });

  it("drops entries without a title and keeps at most max", () => {
    const text = fenced({
      proposals: [
        { description: "no title" },
        42,
        { title: "A", description: "a" },
        { title: "B", description: "b" },
        { title: "C", description: "c" },
      ],
    });
    expect(parseStewardProposals(text, 2).map((p) => p.title)).toEqual(["A", "B"]);
  });

  it("allows an empty list", () => {
    expect(parseStewardProposals(fenced({ proposals: [] }), 5)).toEqual([]);
  });

  it("throws on a missing block, bad JSON, a wrong shape or no usable entry", () => {
    expect(() => parseStewardProposals("no block", 5)).toThrow("no ```json");
    expect(() => parseStewardProposals(fenced("{oops"), 5)).toThrow("not valid JSON");
    expect(() => parseStewardProposals(fenced({ tasks: [] }), 5)).toThrow("proposals");
    expect(() => parseStewardProposals(fenced({ proposals: [{ description: "x" }] }), 5)).toThrow(
      "usable title",
    );
  });
});

describe("task source", () => {
  const task = (overrides: Record<string, unknown> = {}) => ({
    id: "t1",
    title: "Task",
    prompt: "Do it",
    projectId: "p1",
    harness: "claude",
    model: "claude:test",
    runtimeMode: "auto",
    ...overrides,
  });

  it("accepts a source and steward, and leaves them out when absent", () => {
    expect(parseHostTask(task())).not.toHaveProperty("source");
    expect(parseHostTask(task({ source: "steward", stewardId: "s1" }))).toMatchObject({
      source: "steward",
      stewardId: "s1",
    });
  });

  it("rejects an unknown source", () => {
    expect(() => parseHostTask(task({ source: "robot" }))).toThrow("Invalid task source");
    expect(() => parseHostTask(task({ stewardId: "bad id" }))).toThrow("Invalid task steward");
  });
});
