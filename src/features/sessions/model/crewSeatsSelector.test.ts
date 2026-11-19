import { expect, it } from "vitest";
import type { Session } from "./session";
import { type CrewSeat, createCrewSeatsSelector, sameCrewSeats } from "./crewActivity";

const crewSession = (props: Partial<Session> = {}) =>
  ({ id: "lead", blocks: [], ...props }) as Session;
const other = (id: string, props: Partial<Session> = {}) =>
  ({ id, blocks: [], ...props }) as Session;
const worker = (id: string, props: Partial<Session> = {}) =>
  ({ id, blocks: [], orchestrationLeadId: "lead", busy: true, ...props }) as Session;

it("keeps the same seats while only unrelated sessions change", () => {
  const select = createCrewSeatsSelector();
  const crew = crewSession({ busy: true });
  const first = select("lead", [crew, other("x")]);
  const second = select("lead", [crew, other("x", { busy: true, title: "changed" })]);
  expect(second).toBe(first);
});

it("recomputes when the crew's own session changes identity", () => {
  const select = createCrewSeatsSelector();
  const before = select("lead", [crewSession({ busy: false })]);
  const after = select("lead", [crewSession({ busy: true })]);
  expect(after).not.toBe(before);
  expect(after[2].working).toBe(true);
  expect(before[2].working).toBe(false);
});

it("recomputes when a worker session it leads changes identity", () => {
  const select = createCrewSeatsSelector();
  const crew = crewSession({ busy: true });
  const before = select("lead", [crew, worker("w", { title: "Research" })]);
  const after = select("lead", [crew, worker("w", { title: "Review" })]);
  expect(after).not.toBe(before);
  expect(after.some((seat) => seat.name === "Review")).toBe(true);
  expect(after.some((seat) => seat.name === "Research")).toBe(false);
});

it("ignores a session led by another crew", () => {
  const select = createCrewSeatsSelector();
  const crew = crewSession({ busy: true });
  const first = select("lead", [crew, worker("w", { orchestrationLeadId: "elsewhere" })]);
  const second = select("lead", [crew, worker("w", { orchestrationLeadId: "elsewhere", busy: false })]);
  expect(second).toBe(first);
});

it("keeps the seats for an undefined session id whatever sessions change", () => {
  const select = createCrewSeatsSelector();
  const first = select(undefined, [other("x", { busy: true })]);
  const second = select(undefined, [other("y", { busy: true })]);
  expect(second).toBe(first);
});

it("compares seat tuples rather than identities", () => {
  const seats: CrewSeat[] = [
    { role: "lead", working: true, context: 0.2 },
    { role: "subagent", working: false, name: "Research" },
  ];
  expect(sameCrewSeats(seats, seats.map((seat) => ({ ...seat })))).toBe(true);
  expect(sameCrewSeats(seats, [seats[0], { ...seats[1], working: true }])).toBe(false);
  expect(sameCrewSeats(seats, [seats[0], { ...seats[1], name: "Review" }])).toBe(false);
  expect(sameCrewSeats(seats, [{ ...seats[0], context: 0.3 }, seats[1]])).toBe(false);
  expect(sameCrewSeats(seats, [seats[0]])).toBe(false);
});
