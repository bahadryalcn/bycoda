import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SocialActionContext, SocialActionSpec } from "../core/social-actions";
import type { SocialPrincipal } from "../social";
import { outreachActions } from "./outreach-actions";
import { enrollmentId } from "./outreach-sequences";
import {
  audienceFixture,
  emailAccount,
  fakeService,
  NOW,
  OWNER,
  personFor,
  sequenceWith,
  setAutonomy,
  xAccount,
} from "./outreach-test-support";
import { readStats } from "./outreach-pacing";

let fixture: Awaited<ReturnType<typeof audienceFixture>>;
beforeEach(async () => {
  fixture = await audienceFixture();
});
afterEach(async () => {
  await fixture.cleanup();
});

const AI: SocialPrincipal = {
  kind: "external",
  actorId: "ai-agent",
  provider: "assistant",
  projectId: "proj-1",
};

function run(
  name: string,
  principal: SocialPrincipal,
  input: Record<string, unknown>,
  extra: { settings?: Record<string, string>; accounts?: ReturnType<typeof xAccount>[] } = {},
) {
  const fake = fakeService({
    audience: fixture.audience,
    settings: extra.settings,
    accounts: extra.accounts ?? [xAccount()],
  });
  const ctx = {
    service: fake.service,
    store: fixture.audience,
    now: () => NOW,
    principal,
    operationId: "op-1",
  } as unknown as SocialActionContext;
  const spec = outreachActions[name] as SocialActionSpec;
  return spec.run(ctx, input);
}

async function leadsList(personIds: string[]) {
  await fixture.audience.putList({
    id: "list-1",
    name: "Leads",
    kind: "static",
    projectIds: ["proj-1"],
    createdAt: NOW,
  });
  await fixture.audience.addMembers("list-1", personIds, { source: "test", at: NOW });
}

describe("sequences.start", () => {
  it("enrolls members once, marks suppressed people, and keeps the warm-up anchor across restarts", async () => {
    const { audience } = fixture;
    await audience.putPerson(personFor("p1", "acc-x", "fan-1", "contact-1"));
    await audience.putPerson(personFor("p2", "acc-x", "fan-2", "contact-2"));
    await leadsList(["p1", "p2"]);
    await audience.putSuppression({
      id: "sup-p2",
      personId: "p2",
      channel: "all",
      reason: "opt_out",
      source: "test",
      at: NOW,
    });
    const sequence = sequenceWith(
      [
        {
          id: "s1",
          channel: "dm",
          accountId: "acc-x",
          delayHours: 2,
          template: "Hi {name}",
          personalize: false,
        },
      ],
      { status: "draft" },
    );
    await audience.putRecord("sequence", sequence.id, sequence);

    const first = (await run("sequences.start", OWNER, { sequenceId: "seq-1" })) as {
      enrolled: number;
      sequence: { status: string };
    };
    expect(first.enrolled).toBe(2);
    expect(first.sequence.status).toBe("active");
    expect(await audience.getEnrollment(enrollmentId("seq-1", "p1"))).toMatchObject({
      status: "active",
      nextAt: NOW + 2 * 3_600_000,
    });
    expect(await audience.getEnrollment(enrollmentId("seq-1", "p2"))).toMatchObject({
      status: "suppressed",
    });

    const anchor = await audience.getSetting("outreach.started:seq-1");
    await run("sequences.pause", OWNER, { sequenceId: "seq-1" });
    const restarted = (await run("sequences.start", OWNER, { sequenceId: "seq-1" })) as {
      enrolled: number;
    };
    expect(restarted.enrolled).toBe(0);
    expect(await audience.getSetting("outreach.started:seq-1")).toBe(anchor);
  });

  it("refuses a non-owner unless outreach is autonomous for the account", async () => {
    const { audience } = fixture;
    await audience.putPerson(personFor("p1", "acc-x", "fan-1", "contact-1"));
    await leadsList(["p1"]);
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
      { status: "draft" },
    );
    await audience.putRecord("sequence", sequence.id, sequence);

    await expect(run("sequences.start", AI, { sequenceId: "seq-1" })).rejects.toThrow("autonomous");
    await setAutonomy(audience, "acc-x", { outreach: "autonomous" });
    await expect(run("sequences.start", AI, { sequenceId: "seq-1" })).resolves.toMatchObject({
      enrolled: 1,
    });
  });

  it("refuses to start an email step whose account has no unsubscribe link", async () => {
    const { audience } = fixture;
    await audience.putPerson(personFor("p1", "acc-x", "fan-1", "contact-1"));
    await leadsList(["p1"]);
    await audience.putRecord(
      "email-account",
      "mail-1",
      emailAccount({ unsubscribeUrl: undefined }),
    );
    const sequence = sequenceWith(
      [
        {
          id: "s1",
          channel: "email",
          accountId: "mail-1",
          delayHours: 0,
          template: "Subject: Hi\n\nBody",
          personalize: false,
        },
      ],
      { status: "draft" },
    );
    await audience.putRecord("sequence", sequence.id, sequence);

    await expect(run("sequences.start", OWNER, { sequenceId: "seq-1" })).rejects.toThrow(
      "unsubscribe link",
    );
    expect((await audience.listEnrollments({ sequenceId: "seq-1" })).items).toHaveLength(0);
  });

  it("refuses a list that no project owns", async () => {
    const { audience } = fixture;
    await audience.putList({
      id: "list-1",
      name: "Loose",
      kind: "static",
      projectIds: [],
      createdAt: NOW,
    });
    const sequence = sequenceWith(
      [
        {
          id: "s1",
          channel: "dm",
          accountId: "acc-x",
          delayHours: 0,
          template: "Hi",
          personalize: false,
        },
      ],
      { status: "draft" },
    );
    await audience.putRecord("sequence", sequence.id, sequence);
    await expect(run("sequences.start", OWNER, { sequenceId: "seq-1" })).rejects.toThrow("project");
  });
});

describe("sequences.save", () => {
  const steps = (channel: string, accountId: string, template = "Hi {name}") => [
    { channel, accountId, delayHours: 0, template, personalize: false },
  ];

  it("refuses personal WhatsApp (browser) accounts as steps", async () => {
    await leadsList([]);
    await expect(
      run(
        "sequences.save",
        OWNER,
        {
          name: "Wa",
          listId: "list-1",
          steps: steps("whatsapp", "acc-wa"),
          pacing: { perHour: 5, perDay: 20, warmupDays: 0 },
        },
        {
          accounts: [
            xAccount({
              id: "acc-wa",
              platform: "whatsapp",
              connection: "browser",
              accountType: "member",
            }),
          ],
        },
      ),
    ).rejects.toThrow("Personal WhatsApp");
  });

  it("refuses an email step from an account without an unsubscribe link", async () => {
    await leadsList([]);
    await fixture.audience.putRecord(
      "email-account",
      "mail-1",
      emailAccount({ unsubscribeUrl: undefined }),
    );
    await expect(
      run("sequences.save", OWNER, {
        name: "Mail",
        listId: "list-1",
        steps: steps("email", "mail-1", "Subject: Hi\n\nBody"),
        pacing: { perHour: 5, perDay: 20, warmupDays: 0 },
      }),
    ).rejects.toThrow("Add an unsubscribe link to this email account before sending.");
  });

  it("refuses an email step without a subject line and body", async () => {
    await leadsList([]);
    await fixture.audience.putRecord("email-account", "mail-1", emailAccount());
    await expect(
      run("sequences.save", OWNER, {
        name: "Mail",
        listId: "list-1",
        steps: steps("email", "mail-1", "Subject only"),
        pacing: { perHour: 5, perDay: 20, warmupDays: 0 },
      }),
    ).rejects.toThrow("Email steps need a subject line and a body.");
  });

  it("saves a draft and keeps stopOnReply on", async () => {
    await leadsList([]);
    const saved = (await run("sequences.save", OWNER, {
      name: "Intro",
      listId: "list-1",
      steps: steps("dm", "acc-x"),
      pacing: { perHour: 5, perDay: 20, warmupDays: 3 },
    })) as { status: string; stopOnReply: boolean };
    expect(saved).toMatchObject({ status: "draft", stopOnReply: true });
  });

  it("refuses to edit a running sequence", async () => {
    await leadsList([]);
    const sequence = sequenceWith([
      {
        id: "s1",
        channel: "dm",
        accountId: "acc-x",
        delayHours: 0,
        template: "Hi",
        personalize: false,
      },
    ]);
    await fixture.audience.putRecord("sequence", sequence.id, sequence);
    await expect(
      run("sequences.save", OWNER, {
        id: "seq-1",
        name: "Edit",
        listId: "list-1",
        steps: steps("dm", "acc-x"),
        pacing: { perHour: 5, perDay: 20, warmupDays: 0 },
      }),
    ).rejects.toThrow("Pause the sequence before editing it.");
  });
});

describe("suppressions and stats", () => {
  it("suppressions.add accepts a platform:platformId handle and an AI caller may add one", async () => {
    await fixture.audience.putPerson(personFor("p1", "acc-x", "fan-1", "contact-1"));
    const row = (await run("suppressions.add", AI, {
      handle: "x:fan-9",
      channel: "dm",
      reason: "manual",
    })) as {
      handle: { platform: string; platformId: string };
      channel: string;
      reason: string;
    };
    expect(row).toMatchObject({
      handle: { platform: "x", platformId: "fan-9" },
      channel: "dm",
      reason: "manual",
    });
    await expect(run("suppressions.add", AI, { handle: "not-a-handle" })).rejects.toThrow(
      "platform:platformId",
    );
  });

  it("suppressions.remove is owner-only at the registry level", () => {
    expect(outreachActions["suppressions.remove"]).toMatchObject({ ownerOnly: true });
    expect(outreachActions["suppressions.add"]).toMatchObject({ ownerOnly: false, tool: true });
  });

  it("sequences.stats totals every sequence when no id is given", async () => {
    const step = [
      {
        id: "s1",
        channel: "dm" as const,
        accountId: "acc-x",
        delayHours: 0,
        template: "Hi",
        personalize: false,
      },
    ];
    await fixture.audience.putRecord("sequence", "seq-a", sequenceWith(step, { id: "seq-a" }));
    await fixture.audience.putRecord("sequence", "seq-b", sequenceWith(step, { id: "seq-b" }));
    await fixture.audience.incrementCounter("outreach", "outreach-stat:seq-a:sent", "total", 3);
    await fixture.audience.incrementCounter("outreach", "outreach-stat:seq-b:sent", "total", 2);
    expect(await readStats(fixture.audience, "seq-a")).toMatchObject({ sent: 3 });
    expect(await run("sequences.stats", OWNER, {})).toMatchObject({ sent: 5, replied: 0 });
  });
});
