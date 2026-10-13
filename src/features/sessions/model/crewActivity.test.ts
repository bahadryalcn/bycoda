import { expect, it } from "vitest";
import type { Block, Session } from "./session";
import {
  CREW_AGE_THRESHOLDS,
  crewAge,
  crewSeats,
  isAdvisorBlock,
  previewCrewSeats,
} from "./crewActivity";
const session = (props: Partial<Session> = {}) => ({ id: "s", blocks: [], ...props }) as Session;
const standing = (seats: ReturnType<typeof crewSeats>) =>
  seats.flatMap((seat, id) => (seat.working ? [id] : []));
const user: Block = { id: "u", role: "user", text: "go" };
const advisor = (status: string, streaming = false): Block => ({
  id: "adv",
  role: "tool",
  text: "advisor",
  tool: { callId: "srv1", kind: "advisor", title: "advisor", status },
  streaming,
});
const agentBlock = (id: string): Block =>
  ({
    id,
    role: "tool",
    text: "Agent",
    tool: { callId: id, kind: "agent", title: "Agent", status: "in_progress" },
    agentRun: { steps: [] },
  }) as unknown as Block;

it("seats the lead, advisor and subagents at fixed places, six seats minimum", () => {
  const seats = crewSeats("s", [session()]);
  expect(seats).toHaveLength(6);
  expect(seats.map((seat) => seat.role)).toEqual([
    "subagent",
    "subagent",
    "lead",
    "advisor",
    "subagent",
    "subagent",
  ]);
  expect(standing(seats)).toEqual([]);
  expect(crewSeats(undefined, [session({ busy: true })]).some((seat) => seat.working)).toBe(false);
  expect(crewSeats("missing", [session({ busy: true })]).some((seat) => seat.working)).toBe(false);
});
it("stands the lead alone when a session works without helpers", () => {
  expect(standing(crewSeats("s", [session({ busy: true })]))).toEqual([2]);
  expect(standing(crewSeats("s", [session({ continuingElsewhere: true })]))).toEqual([2]);
});
it("fills subagent seats 0,1,4,5 then guests from seat 6, including every background agent", () => {
  expect(
    standing(
      crewSeats("s", [
        session({ busy: true, backgroundAgents: 4, backgroundTasks: ["a", "b", "c", "d"] }),
      ]),
    ),
  ).toEqual([0, 1, 2, 4, 5]);
  const seats = crewSeats("s", [session({ busy: true, backgroundAgents: 10 })]);
  expect(seats).toHaveLength(12);
  expect(standing(seats)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(seats.slice(6).every((seat) => seat.role === "subagent")).toBe(true);
});
it("counts running subagent blocks once per call", () => {
  const blocks = [user, agentBlock("a"), agentBlock("b")];
  expect(standing(crewSeats("s", [session({ busy: true, blocks })]))).toEqual([0, 1, 2]);
});
it("does not count internal worker sessions twice", () => {
  const sessions = [
    session({ id: "lead", busy: true, backgroundAgents: 7 }),
    ...Array.from({ length: 7 }, (_, i) =>
      session({ id: `worker-${i}`, busy: true, orchestrationLeadId: "lead" }),
    ),
  ];
  expect(standing(crewSeats("lead", sessions))).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
});
it("keeps workers standing after their lead becomes idle, with the lead seated", () => {
  expect(
    standing(
      crewSeats("lead", [
        session({ id: "lead" }),
        session({ id: "worker", busy: true, orchestrationLeadId: "lead" }),
      ]),
    ),
  ).toEqual([0]);
});
it("does not stand for idle background commands or completed agents", () => {
  expect(
    standing(
      crewSeats("s", [session({ busy: true, backgroundTasks: ["server"], backgroundAgents: 0 })]),
    ),
  ).toEqual([]);
  expect(standing(crewSeats("s", [session({ busy: false, backgroundAgents: 4 })]))).toEqual([]);
});
it("keeps sessions apart: a busy team never makes an idle session's crew work", () => {
  const sessions = [
    session({ id: "team", busy: true, backgroundAgents: 5 }),
    session({ id: "quiet" }),
    session({ id: "other-worker", busy: true, orchestrationLeadId: "team" }),
  ];
  expect(standing(crewSeats("quiet", sessions))).toEqual([]);
  expect(crewSeats("quiet", sessions)).toHaveLength(6);
  expect(standing(crewSeats("team", sessions))).toEqual([0, 1, 2, 4, 5, 6]);
});
it("stands the advisor only while its server tool call is pending in a busy session", () => {
  const pending = [user, advisor("pending", true)];
  expect(standing(crewSeats("s", [session({ busy: true, blocks: pending })]))).toEqual([2, 3]);
  expect(
    standing(crewSeats("s", [session({ busy: true, blocks: [user, advisor("completed")] })])),
  ).toEqual([2]);
  expect(standing(crewSeats("s", [session({ busy: false, blocks: pending })]))).toEqual([]);
  // A previous turn's unresolved advisor call does not carry over.
  expect(
    standing(
      crewSeats("s", [
        session({ busy: true, blocks: [user, advisor("pending", true), { ...user, id: "u2" }] }),
      ]),
    ),
  ).toEqual([2]);
  expect(isAdvisorBlock(advisor("pending"))).toBe(true);
  expect(isAdvisorBlock({ ...user })).toBe(false);
});
it("does not treat advisor interjection notes as work", () => {
  const note: Block = {
    id: "n",
    role: "system",
    text: "Looks risky",
    interjection: { customType: "advisor" },
  } as Block;
  expect(standing(crewSeats("s", [session({ busy: true, blocks: [user, note] })]))).toEqual([2]);
});
it("previews fill lead, advisor, then subagents", () => {
  expect(standing(previewCrewSeats(2))).toEqual([2, 3]);
  expect(standing(previewCrewSeats(7))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(previewCrewSeats(12)).toHaveLength(12);
});

it("ages from baby to uncle by context fill, and treats unknown context as an uncle", () => {
  expect(crewAge(0)).toEqual({ stage: 0, growth: 0 });
  expect(crewAge(CREW_AGE_THRESHOLDS[0] / 100).stage).toBe(1);
  expect(crewAge(CREW_AGE_THRESHOLDS[1] / 100).stage).toBe(2);
  expect(crewAge(CREW_AGE_THRESHOLDS[2] / 100).stage).toBe(3);
  expect(crewAge(1)).toEqual({ stage: 3, growth: 1 });
  expect(crewAge(undefined)).toEqual({ stage: 3, growth: 1 });
  expect(crewAge(Number.NaN).stage).toBe(3);
  const mid = crewAge((CREW_AGE_THRESHOLDS[0] + CREW_AGE_THRESHOLDS[1]) / 200);
  expect(mid.stage).toBe(1);
  expect(mid.growth).toBeCloseTo(0.5);
});
it("gives used crew members their context and leaves unused seats at zero", () => {
  const withUsage = (id: string, used?: number): Block => {
    const block = agentBlock(id);
    return used === undefined
      ? block
      : { ...block, tool: { ...block.tool!, agentContext: { used } } };
  };
  const blocks = [
    user,
    advisor("completed"),
    withUsage("a", 20_000),
    withUsage("b", 180_000),
    withUsage("c"),
  ];
  const seats = crewSeats("s", [
    session({ busy: true, blocks, context: { used: 100_000, window: 200_000 } }),
  ]);
  expect(seats[0].name).toBeUndefined();
  expect(seats[2].context).toBeCloseTo(0.5);
  expect(seats[3].context).toBeCloseTo(0.5);
  expect(seats[0].context).toBeCloseTo(0.1);
  expect(seats[1].context).toBeCloseTo(0.9);
  // No reading yet: the subagent shares the lead's age instead of staying a baby.
  expect(seats[4].context).toBeCloseTo(0.5);
  expect(seats[5].context).toBe(0);
});
it("uses worker sessions' own context when they outnumber transcript rows", () => {
  const seats = crewSeats("lead", [
    session({ id: "lead", busy: true, context: { used: 10_000, window: 100_000 } }),
    session({
      id: "w1",
      busy: true,
      orchestrationLeadId: "lead",
      context: { used: 70_000, window: 100_000 },
    }),
  ]);
  expect(seats[0].context).toBeCloseTo(0.7);
  expect(seats[2].context).toBeCloseTo(0.1);
});
it("starts everyone as a baby after the first message even before context arrives", () => {
  const seats = crewSeats("s", [
    session({ busy: true, blocks: [user, agentBlock("a")], context: { used: 5_000 } }),
  ]);
  expect(seats.every((seat) => seat.context === 0)).toBe(true);
});

it("keeps only untouched sessions as uncles, including an unsent draft", () => {
  for (const current of [session(), session({ blocks: [{ ...user, draft: true }] })]) {
    expect(crewSeats("s", [current]).every((seat) => crewAge(seat.context).stage === 3)).toBe(true);
  }
  const started = crewSeats("s", [session({ blocks: [user] })]);
  expect(started.every((seat) => crewAge(seat.context).stage === 0)).toBe(true);
});

it("does not age unused helpers or an unused advisor with the lead", () => {
  const seats = crewSeats("s", [
    session({ blocks: [user], context: { used: 180_000, window: 200_000 } }),
  ]);
  expect(seats.map((seat) => crewAge(seat.context).stage)).toEqual([0, 0, 3, 0, 0, 0]);
  const compacted = crewSeats("s", [
    session({ blocks: [user], context: { used: 10_000, window: 200_000 } }),
  ]);
  expect(compacted.every((seat) => crewAge(seat.context).stage === 0)).toBe(true);
});

it("pairs each delegated name with its own age and running seat", () => {
  const named = (id: string, name: string, used: number, status: string): Block => ({
    ...agentBlock(id),
    agentRun: { name, steps: [] },
    tool: { ...agentBlock(id).tool!, status, agentContext: { used } },
  });
  const current = session({
    busy: true,
    context: { used: 100_000, window: 200_000 },
    blocks: [
      user,
      named("review", "Reviewer", 180_000, "completed"),
      named("design", "Designer", 20_000, "in_progress"),
    ],
  });
  const seats = crewSeats("s", [current]);
  expect(seats[0]).toMatchObject({ name: "Designer", working: true, context: 0.1 });
  expect(seats[1]).toMatchObject({ name: "Reviewer", working: false, context: 0.9 });
  current.blocks[2] = named("design", "UX Designer", 20_000, "in_progress");
  expect(crewSeats("s", [current])[0].name).toBe("UX Designer");
});

it("labels orchestration workers from their assigned titles", () => {
  const seats = crewSeats("lead", [
    session({ id: "lead", blocks: [user] }),
    session({
      id: "worker",
      title: "Designer",
      busy: true,
      orchestrationLeadId: "lead",
      context: { used: 70_000, window: 100_000 },
    }),
  ]);
  expect(seats[0]).toMatchObject({ name: "Designer", context: 0.7, working: true });
  expect(crewSeats("s", [session({ blocks: [user] })])[0].name).toBeUndefined();
});
