import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SequenceEnrollment, SequenceStep } from "../../../src/features/social/model/outreach";
import type { SecretValueStore } from "../../secrets/secret-store";
import { enrollmentId } from "./outreach-sequences";
import { readStats, utcDayKey } from "./outreach-pacing";
import { runOutreachTick } from "./outreach-tick";
import { chooseVariant } from "./outreach-steps";
import {
  audienceFixture,
  contactFor,
  emailAccount,
  fakeService,
  NOW,
  personFor,
  sequenceWith,
  setAutonomy,
  xAccount,
} from "./outreach-test-support";

let fixture: Awaited<ReturnType<typeof audienceFixture>>;
beforeEach(async () => {
  fixture = await audienceFixture();
});
afterEach(async () => {
  await fixture.cleanup();
  vi.restoreAllMocks();
});

const dm = (
  id: string,
  template: string,
  delayHours = 0,
  extra: Partial<SequenceStep> = {},
): SequenceStep => ({
  id,
  channel: "dm",
  accountId: "acc-x",
  delayHours,
  template,
  personalize: false,
  ...extra,
});

/** One list, one sequence, one person (p1) with an active enrollment due now. */
async function setup(options: {
  steps: SequenceStep[];
  settings?: Record<string, string>;
  autonomy?: Record<string, "suggest" | "approve" | "autonomous">;
  personHandleAccount?: string;
  sequenceOverrides?: Parameters<typeof sequenceWith>[1];
  enrollmentOverrides?: Partial<SequenceEnrollment>;
  extraAccounts?: Parameters<typeof fakeService>[0]["accounts"];
  emails?: boolean;
}) {
  const { audience } = fixture;
  await audience.putList({
    id: "list-1",
    name: "Leads",
    kind: "static",
    projectIds: ["proj-1"],
    createdAt: NOW,
  });
  const sequence = sequenceWith(options.steps, options.sequenceOverrides);
  await audience.putRecord("sequence", sequence.id, sequence);
  const accountId = options.personHandleAccount ?? "acc-x";
  const person = personFor("p1", accountId, "fan-1", "contact-1", {
    ...(options.emails
      ? { emails: [{ address: "p1@example.org", source: "import", verified: true }] }
      : {}),
  });
  await audience.putPerson(person);
  const enrollment: SequenceEnrollment = {
    id: enrollmentId(sequence.id, person.id),
    sequenceId: sequence.id,
    personId: person.id,
    stepIndex: 0,
    status: "active",
    nextAt: NOW,
    updatedAt: NOW,
    ...options.enrollmentOverrides,
  };
  await audience.putEnrollment(enrollment);
  if (options.autonomy) await setAutonomy(audience, "acc-x", options.autonomy);
  const fake = fakeService({
    audience,
    settings: options.settings,
    accounts: options.extraAccounts ?? [xAccount()],
    contacts: [contactFor("contact-1", "acc-x", "fan-1")],
  });
  return { audience, sequence, person, enrollment, fake, id: enrollment.id };
}

describe("runOutreachTick: social steps", () => {
  it("sends a DM through the draft path as the sequence principal and advances the enrollment", async () => {
    const { audience, fake, id } = await setup({
      steps: [dm("s1", "Hi {name}"), dm("s2", "Follow up {name}", 24)],
      autonomy: { message: "autonomous" },
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });

    expect(fake.drafts).toHaveLength(1);
    expect(fake.drafts[0].action).toBe("messages.draft");
    expect(fake.drafts[0].input).toMatchObject({
      accountId: "acc-x",
      projectId: "proj-1",
      contactId: "contact-1",
      text: "Hi Person p1",
    });
    expect(fake.jobs[0].principal).toMatchObject({
      kind: "external",
      actorId: "sequence:seq-1",
      projectId: "proj-1",
    });
    expect(fake.jobs[0].plural).toBe("messages");
    const after = await audience.getEnrollment(id);
    expect(after).toMatchObject({
      stepIndex: 1,
      status: "active",
      lastJobId: "job-1",
      nextAt: NOW + 24 * 3_600_000,
    });
    expect((await readStats(audience, "seq-1")).sent).toBe(1);
  });

  it("finishes the enrollment after the last step", async () => {
    const { audience, fake, id } = await setup({
      steps: [dm("s1", "Hi {name}")],
      autonomy: { message: "autonomous" },
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    const finished = await audience.getEnrollment(id);
    expect(finished).toMatchObject({ status: "done", stepIndex: 1 });
    // The store drops undefined fields on write, so the cleared nextAt is checked on its own.
    expect(finished?.nextAt).toBeUndefined();
  });

  it.each([
    ["ai.stopped", { "ai.stopped": "true" }],
    ["stopped", { stopped: "true" }],
    ["sending off", { sending: "false" }],
  ])("sends nothing while %s", async (_label, settings) => {
    const { audience, fake, id } = await setup({
      steps: [dm("s1", "Hi {name}")],
      autonomy: { message: "autonomous" },
      settings: { sending: "true", ...settings },
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(0);
    expect(await audience.getEnrollment(id)).toMatchObject({ status: "active", stepIndex: 0 });
  });

  it("never picks up an enrollment that has replied", async () => {
    const { audience, fake } = await setup({
      steps: [dm("s1", "Hi {name}")],
      autonomy: { message: "autonomous" },
      enrollmentOverrides: { status: "replied" },
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(0);
  });

  it("suppressed recipients get no step and the enrollment ends as suppressed", async () => {
    const { audience, fake, id, person } = await setup({
      steps: [dm("s1", "Hi {name}")],
      autonomy: { message: "autonomous" },
    });
    await audience.putSuppression({
      id: "sup-1",
      personId: person.id,
      channel: "all",
      reason: "opt_out",
      source: "test",
      at: NOW,
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(0);
    expect(fake.jobs).toHaveLength(0);
    const suppressed = await audience.getEnrollment(id);
    expect(suppressed).toMatchObject({ status: "suppressed" });
    expect(suppressed?.nextAt).toBeUndefined();
  });

  it("personal WhatsApp accounts are blocked: the step fails with a reason and nothing is drafted", async () => {
    const { audience, fake, id } = await setup({
      steps: [dm("s1", "Hi {name}", 0, { channel: "whatsapp", accountId: "acc-wa" })],
      personHandleAccount: "acc-wa",
      autonomy: { message: "autonomous" },
      extraAccounts: [
        xAccount({
          id: "acc-wa",
          platform: "whatsapp",
          connection: "browser",
          accountType: "member",
        }),
      ],
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(0);
    expect(await audience.getEnrollment(id)).toMatchObject({ status: "failed" });
    expect(fake.aiActions).toEqual([
      expect.objectContaining({
        status: "failed",
        reason: expect.stringContaining("Personal WhatsApp"),
      }),
    ]);
  });

  it("an account at suggest level waits for the owner and sends nothing", async () => {
    const { audience, fake, id } = await setup({ steps: [dm("s1", "Hi {name}")] });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(0);
    expect(await audience.getEnrollment(id)).toMatchObject({
      status: "active",
      stepIndex: 0,
      nextAt: NOW + 3_600_000,
    });
  });

  it("a daily pacing cap defers the step to the next UTC day", async () => {
    const { audience, fake, id } = await setup({
      steps: [dm("s1", "Hi {name}")],
      autonomy: { message: "autonomous" },
      sequenceOverrides: { pacing: { perHour: 100, perDay: 1, warmupDays: 0 } },
    });
    await audience.incrementCounter("outreach", "outreach:seq-1", utcDayKey(NOW), 1);
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(0);
    expect(await audience.getEnrollment(id)).toMatchObject({
      stepIndex: 0,
      nextAt: Date.UTC(2026, 10, 8),
    });
  });
});

describe("runOutreachTick: personalization and variants", () => {
  it("uses the model text when personalization is on, and quotes recipient data as untrusted", async () => {
    const personalize = vi.fn(async (_prompt: string, _signal: AbortSignal) =>
      JSON.stringify({ text: "Custom line for you" }),
    );
    const { audience, fake } = await setup({
      steps: [dm("s1", "Hello", 0, { personalize: true })],
      autonomy: { message: "autonomous" },
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW, personalize });
    expect(fake.drafts[0].input.text).toBe("Custom line for you");
    const prompt = String(personalize.mock.calls[0][0]);
    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain(JSON.stringify("Person p1"));
  });

  it("without a model, a template with no {name} or {handle} fails instead of going to everyone as is", async () => {
    const { audience, fake, id } = await setup({
      steps: [dm("s1", "Hello there", 0, { personalize: true })],
      autonomy: { message: "autonomous" },
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts).toHaveLength(0);
    expect(await audience.getEnrollment(id)).toMatchObject({ status: "failed" });
  });

  it("without a model, a template with a {name} placeholder is filled per recipient", async () => {
    const { audience, fake } = await setup({
      steps: [dm("s1", "Hello {name}", 0, { personalize: true })],
      autonomy: { message: "autonomous" },
    });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fake.drafts[0].input.text).toBe("Hello Person p1");
  });

  it("A/B arms are chosen by hash: the same enrollment and step always get the same arm, and both arms occur", () => {
    const step: SequenceStep = {
      id: "s1",
      channel: "dm",
      accountId: "acc-x",
      delayHours: 0,
      template: "control",
      variants: [
        { id: "a", text: "variant a {name}" },
        { id: "b", text: "variant b {name}" },
      ],
      personalize: false,
    };
    expect(chooseVariant("enr-1", step)).toEqual(chooseVariant("enr-1", step));
    const seen = new Set<string | undefined>();
    for (let index = 0; index < 40; index++)
      seen.add(chooseVariant(`enr-${index}`, step).variantId);
    expect(seen).toEqual(new Set(["a", "b"]));
    expect(chooseVariant("enr-1", { ...step, variants: undefined }).template).toBe("control");
  });
});

describe("runOutreachTick: email steps", () => {
  const emailStep = (overrides: Partial<SequenceStep> = {}): SequenceStep => ({
    id: "e1",
    channel: "email",
    accountId: "mail-1",
    delayHours: 0,
    template: "Subject: Hello {name}\n\nBody for {name}",
    personalize: false,
    ...overrides,
  });
  const secrets: SecretValueStore = {
    get: async () => JSON.stringify({ apiKey: "re-key" }),
    set: async () => undefined,
    delete: async () => undefined,
  };

  it("delivers through the provider with the unsubscribe header and charges the email counter", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "re-1" }), { status: 200 }));
    const { audience, fake, id } = await setup({
      steps: [emailStep()],
      emails: true,
    });
    await audience.putRecord("email-account", "mail-1", emailAccount());
    await setAutonomy(audience, "mail-1", { email: "autonomous" });
    await runOutreachTick({
      service: fake.service,
      store: audience,
      now: NOW,
      emailSecrets: secrets,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.subject).toBe("Hello Person p1");
    expect(body.to).toEqual(["p1@example.org"]);
    expect(body.headers["List-Unsubscribe"]).toBe("<https://example.com/unsubscribe>");
    expect(await audience.getCounter("mail-1", "email", utcDayKey(NOW))).toBe(1);
    expect(await audience.getEnrollment(id)).toMatchObject({ status: "done" });
    expect((await audience.getPerson("p1"))?.stage).toBe("contacted");
  });

  it("an email account without an unsubscribe link sends nothing and the enrollment fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { audience, fake, id } = await setup({
      steps: [emailStep()],
      emails: true,
    });
    await audience.putRecord(
      "email-account",
      "mail-1",
      emailAccount({ unsubscribeUrl: undefined }),
    );
    await setAutonomy(audience, "mail-1", { email: "autonomous" });
    await runOutreachTick({
      service: fake.service,
      store: audience,
      now: NOW,
      emailSecrets: secrets,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await audience.getEnrollment(id)).toMatchObject({ status: "failed" });
  });

  it("a rate-limited provider keeps the step for a later retry and does not advance it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("slow down", { status: 429, headers: { "retry-after": "300" } }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { audience, fake, id } = await setup({
      steps: [emailStep()],
      emails: true,
    });
    await audience.putRecord("email-account", "mail-1", emailAccount());
    await setAutonomy(audience, "mail-1", { email: "autonomous" });
    await runOutreachTick({
      service: fake.service,
      store: audience,
      now: NOW,
      emailSecrets: secrets,
    });
    const after = await audience.getEnrollment(id);
    expect(after).toMatchObject({ status: "active", stepIndex: 0 });
    expect(after?.nextAt).toBeDefined();
  });

  it("without the host's email vault, email steps wait and nothing is sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { audience, fake, id } = await setup({
      steps: [emailStep()],
      emails: true,
    });
    await audience.putRecord("email-account", "mail-1", emailAccount());
    await setAutonomy(audience, "mail-1", { email: "autonomous" });
    await runOutreachTick({ service: fake.service, store: audience, now: NOW });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await audience.getEnrollment(id)).toMatchObject({ status: "active", stepIndex: 0 });
  });
});
