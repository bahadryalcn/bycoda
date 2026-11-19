import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SequenceStep } from "../../../src/features/social/model/outreach";
import { enrollmentId } from "./outreach-sequences";
import { readStats } from "./outreach-pacing";
import { runOutreachTick } from "./outreach-tick";
import {
  audienceFixture,
  contactFor,
  fakeService,
  NOW,
  personFor,
  sequenceWith,
  setAutonomy,
  xAccount,
} from "./outreach-test-support";

const HOUR = 3_600_000;

let fixture: Awaited<ReturnType<typeof audienceFixture>>;
beforeEach(async () => {
  fixture = await audienceFixture();
});
afterEach(async () => {
  await fixture.cleanup();
  vi.restoreAllMocks();
});

const dm = (id: string, template: string, delayHours = 0): SequenceStep => ({
  id,
  channel: "dm",
  accountId: "acc-x",
  delayHours,
  template,
  personalize: false,
});

/** One sequence on one account with `count` enrollments, all due at NOW. */
async function setupMany(count: number, steps: SequenceStep[]) {
  const { audience } = fixture;
  await audience.putList({
    id: "list-1",
    name: "Leads",
    kind: "static",
    projectIds: ["proj-1"],
    createdAt: NOW,
  });
  const sequence = sequenceWith(steps);
  await audience.putRecord("sequence", sequence.id, sequence);
  const contacts = [];
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const person = personFor(`p${index}`, "acc-x", `fan-${index}`, `contact-${index}`);
    await audience.putPerson(person);
    contacts.push(contactFor(`contact-${index}`, "acc-x", `fan-${index}`));
    const id = enrollmentId(sequence.id, person.id);
    ids.push(id);
    await audience.putEnrollment({
      id,
      sequenceId: sequence.id,
      personId: person.id,
      stepIndex: 0,
      status: "active",
      nextAt: NOW,
      updatedAt: NOW,
    });
  }
  await setAutonomy(audience, "acc-x", { message: "autonomous" });
  const fake = fakeService({ audience, accounts: [xAccount()], contacts });
  return { audience, fake, ids };
}

describe("runOutreachTick: long ticks", () => {
  it("reads the clock again for every enrollment, so later ones do not schedule from a stale instant", async () => {
    const { audience, fake, ids } = await setupMany(2, [
      dm("s1", "Hi {name}"),
      dm("s2", "Again {name}", 24),
    ]);
    let reads = 0;
    // Read 0 is the due query; every later read belongs to the next enrollment, an hour on.
    await runOutreachTick({
      service: fake.service,
      store: audience,
      now: () => NOW + reads++ * HOUR,
    });

    const nextAt = (
      await Promise.all(ids.map(async (id) => (await audience.getEnrollment(id))?.nextAt))
    ).sort((a, b) => Number(a) - Number(b));
    expect(nextAt).toEqual([NOW + HOUR + 24 * HOUR, NOW + 2 * HOUR + 24 * HOUR]);
  });

  it("stops starting enrollments once the time budget is spent and finishes them next tick without repeating a step", async () => {
    const { audience, fake, ids } = await setupMany(3, [dm("s1", "Hi {name}")]);
    let clock = 0;
    // Start reads 0; each enrollment check reads 10 s later: two fit the 25 s budget, the third does not.
    const monotonic = () => (clock += 10_000) - 10_000;
    await runOutreachTick({
      service: fake.service,
      store: audience,
      now: NOW,
      budgetMs: 25_000,
      monotonic,
    });

    expect(fake.drafts).toHaveLength(2);
    const statuses = await Promise.all(ids.map(async (id) => (await audience.getEnrollment(id))?.status));
    expect(statuses.filter((status) => status === "active")).toHaveLength(1);

    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(3);
    expect(new Set(fake.drafts.map((draft) => draft.input.contactId)).size).toBe(3);
    expect((await readStats(audience, "seq-1")).sent).toBe(3);
  });

  it("stops before the next enrollment when the Host is stopping", async () => {
    const { audience, fake } = await setupMany(3, [dm("s1", "Hi {name}")]);
    let started = 0;
    await runOutreachTick({
      service: fake.service,
      store: audience,
      now: NOW,
      shouldStop: () => started++ >= 1,
    });
    expect(fake.drafts).toHaveLength(1);
  });

  it("honors a stop switch turned on while earlier enrollments of the same tick were running", async () => {
    const { audience, fake, ids } = await setupMany(3, [dm("s1", "Hi {name}")]);
    const createDraft = fake.service.createDraft.bind(fake.service);
    fake.service.createDraft = async (...args) => {
      fake.settings["ai.stopped"] = "true";
      return await createDraft(...args);
    };
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });

    expect(fake.drafts).toHaveLength(1);
    const statuses = await Promise.all(ids.map(async (id) => (await audience.getEnrollment(id))?.status));
    expect(statuses.filter((status) => status === "active")).toHaveLength(2);
  });

  it("keeps the per-sequence hourly quota exact across one long tick", async () => {
    const { audience, fake } = await setupMany(3, [dm("s1", "Hi {name}")]);
    await audience.putRecord(
      "sequence",
      "seq-1",
      sequenceWith([dm("s1", "Hi {name}")], { pacing: { perHour: 2, perDay: 100, warmupDays: 0 } }),
    );
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(2);
    expect((await readStats(audience, "seq-1")).sent).toBe(2);
  });
});
