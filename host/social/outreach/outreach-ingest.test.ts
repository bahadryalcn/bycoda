import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import type { SequenceEnrollment } from "../../../src/features/social/model/outreach";
import type {
  DecisionAnswer,
  DecisionErrorCode,
  DecisionService,
} from "../../decision-models/decision-types";
import { isOptOutText, onInbound } from "./outreach-ingest";
import { readStats } from "./outreach-pacing";
import { enrollmentId } from "./outreach-sequences";
import {
  audienceFixture,
  contactFor,
  NOW,
  personFor,
  sequenceWith,
  xAccount,
} from "./outreach-test-support";

let fixture: Awaited<ReturnType<typeof audienceFixture>>;
beforeEach(async () => {
  fixture = await audienceFixture();
});
afterEach(async () => {
  await fixture.cleanup();
});

const account = xAccount();
const contact = contactFor("contact-1", "acc-x", "fan-1");

function inbound(text: string, optedOut = false): SocialInbound {
  return {
    eventId: `evt-${text.length}-${optedOut}`,
    threadId: "thread-1",
    contactId: "contact-1",
    contactName: "Fan",
    kind: "message",
    text,
    at: NOW,
    ...(optedOut ? { optedOut: true } : {}),
  };
}

/** Two sequences with one active enrollment for p1 in each: a reply or an opt-out must reach both. */
async function setup() {
  const { audience } = fixture;
  await audience.putList({
    id: "list-1",
    name: "Leads",
    kind: "static",
    projectIds: ["proj-1"],
    createdAt: NOW,
  });
  const person = personFor("p1", "acc-x", "fan-1", "contact-1", { stage: "contacted" });
  await audience.putPerson(person);
  const enrollments: SequenceEnrollment[] = [];
  for (const sequenceId of ["seq-a", "seq-b"]) {
    const sequence = sequenceWith(
      [
        {
          id: "s1",
          channel: "dm",
          accountId: "acc-x",
          delayHours: 0,
          template: "Hi {name}",
          personalize: false,
        },
      ],
      { id: sequenceId },
    );
    await audience.putRecord("sequence", sequence.id, sequence);
    const enrollment: SequenceEnrollment = {
      id: enrollmentId(sequenceId, person.id),
      sequenceId,
      personId: person.id,
      stepIndex: 1,
      status: "active",
      nextAt: NOW + 86_400_000,
      updatedAt: NOW,
    };
    await audience.putEnrollment(enrollment);
    enrollments.push(enrollment);
  }
  return { audience, person, enrollments };
}

describe("onInbound: a reply ends the sequence", () => {
  it("moves every active enrollment of the person to replied and advances the stage", async () => {
    const { audience, person, enrollments } = await setup();
    await onInbound(
      { store: audience, now: NOW },
      account,
      [inbound("Thanks, tell me more")],
      [contact],
    );

    for (const enrollment of enrollments) {
      const stored = await audience.getEnrollment(enrollment.id);
      expect(stored).toMatchObject({ status: "replied" });
      // The store drops undefined fields on write, so the cleared nextAt is checked on its own.
      expect(stored?.nextAt).toBeUndefined();
    }
    expect((await audience.getPerson(person.id))?.stage).toBe("replied");
    expect((await readStats(audience, "seq-a")).replied).toBe(1);
    expect((await readStats(audience, "seq-b")).replied).toBe(1);
  });

  it("a repeated reply changes nothing more (no second count)", async () => {
    const { audience } = await setup();
    await onInbound({ store: audience, now: NOW }, account, [inbound("First reply")], [contact]);
    await onInbound({ store: audience, now: NOW }, account, [inbound("Second reply")], [contact]);
    expect((await readStats(audience, "seq-a")).replied).toBe(1);
  });

  // Each case runs in its own test: the fixture is per test, so counters from one case cannot leak into another.
  it("counts a positive reply when the sentiment model is confident", async () => {
    const { audience } = await setup();
    await onInbound(
      { store: audience, now: NOW, decisions: sentimentModel(answer(true, 0.92)) },
      account,
      [inbound("Yes, send the details")],
      [contact],
    );
    expect((await readStats(audience, "seq-a")).positive).toBe(1);
  });

  it("does not count a positive reply below the confidence threshold", async () => {
    const { audience } = await setup();
    await onInbound(
      { store: audience, now: NOW, decisions: sentimentModel(answer(true, 0.4)) },
      account,
      [inbound("maybe")],
      [contact],
    );
    expect((await readStats(audience, "seq-a")).positive).toBe(0);
  });

  it("does not count a positive reply when the model is unavailable", async () => {
    const { audience } = await setup();
    const unavailable: DecisionService = {
      decide: async () => ({
        answers: { positive: { error: "unavailable" } },
        sourceChain: [],
        durationMs: 0,
      }),
    };
    await onInbound(
      { store: audience, now: NOW, decisions: unavailable },
      account,
      [inbound("Yes please")],
      [contact],
    );
    expect((await readStats(audience, "seq-a")).positive).toBe(0);
    expect((await readStats(audience, "seq-a")).replied).toBe(1);
  });
});

/** One answer for the "positive" question, as a sentiment model would return it. */
function answer(value: boolean, confidence: number): DecisionAnswer {
  return { value, confidence, sourceId: "s", model: "m" };
}

function sentimentModel(result: DecisionAnswer | { error: DecisionErrorCode }): DecisionService {
  return {
    decide: async () => ({ answers: { positive: result }, sourceChain: [], durationMs: 0 }),
  };
}

describe("onInbound: opt-out suppresses the person", () => {
  it("writes an all-channel suppression, ends enrollments as suppressed, and is idempotent", async () => {
    const { audience, person } = await setup();
    await onInbound(
      { store: audience, now: NOW },
      account,
      [inbound("Lütfen istemiyorum")],
      [contact],
    );
    await onInbound(
      { store: audience, now: NOW },
      account,
      [inbound("Lütfen istemiyorum")],
      [contact],
    );

    const suppressions = await audience.findSuppressions({ personId: person.id });
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]).toMatchObject({ channel: "all", reason: "opt_out" });
    expect(await audience.getEnrollment(enrollmentId("seq-a", person.id))).toMatchObject({
      status: "suppressed",
    });
    expect((await audience.getPerson(person.id))?.stage).toBe("opted_out");
    expect((await readStats(audience, "seq-a")).optedOut).toBe(1);
  });

  it("the provider's own opt-out flag is honored too", async () => {
    const { audience, person } = await setup();
    await onInbound({ store: audience, now: NOW }, account, [inbound("ok", true)], [contact]);
    expect(await audience.findSuppressions({ personId: person.id })).toHaveLength(1);
  });

  it.each([
    ["stop", true],
    ["Stop!", true],
    ["unsubscribe me please", true],
    ["Abonelikten çık", true],
    ["İSTEMİYORUM", true],
    ["rahatsız etme", true],
    ["beni listeden çıkar", true],
    ["stop by your store on Monday", false],
    ["Thanks, I am interested", false],
  ])("opt-out wording %j is %s", (text, expected) => {
    expect(isOptOutText(text)).toBe(expected);
  });
});
