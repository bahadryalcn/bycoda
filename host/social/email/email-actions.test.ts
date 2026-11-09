import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SocialActionContext, SocialActionSpec } from "../core/social-actions";
import type { SocialPrincipal } from "../social";
import {
  audienceFixture,
  emailAccount,
  fakeService,
  NOW,
  OWNER,
  personFor,
  xAccount,
} from "../outreach/outreach-test-support";
import type { SecretValueStore } from "../../secrets/secret-store";
import { emailActions } from "./email-actions";

let fixture: Awaited<ReturnType<typeof audienceFixture>>;
beforeEach(async () => {
  fixture = await audienceFixture();
});
afterEach(async () => {
  await fixture.cleanup();
});

/** In-memory vault with the same get/set/delete shape the host passes in. */
function memoryVault() {
  const values = new Map<string, string>();
  const vault: SecretValueStore = {
    get: async (ref) => values.get(ref),
    set: async (ref, value) => {
      values.set(ref, value);
    },
    delete: async (ref) => {
      values.delete(ref);
    },
  };
  return { vault, values };
}

function run(
  name: string,
  principal: SocialPrincipal,
  input: Record<string, unknown>,
  options: { settings?: Record<string, string>; vault?: SecretValueStore } = {},
) {
  const fake = fakeService({
    audience: fixture.audience,
    settings: options.settings,
    accounts: [xAccount()],
  });
  const ctx = {
    service: fake.service,
    store: fixture.audience,
    now: () => NOW,
    principal,
    operationId: "op-1",
    ...(options.vault ? { emailSecrets: options.vault } : {}),
  } as unknown as SocialActionContext;
  return (emailActions[name] as SocialActionSpec).run(ctx, input);
}

const validAccount = {
  kind: "resend",
  from: "hello@example.com",
  name: "Brand mail",
  unsubscribeUrl: "https://example.com/unsubscribe",
  secret: "re_test_key",
};

describe("email.accounts.save", () => {
  it("refuses an account without an HTTPS unsubscribe link", async () => {
    const { vault } = memoryVault();
    await expect(
      run("email.accounts.save", OWNER, { ...validAccount, unsubscribeUrl: undefined }, { vault }),
    ).rejects.toThrow("Invalid unsubscribe link.");
    await expect(
      run(
        "email.accounts.save",
        OWNER,
        { ...validAccount, unsubscribeUrl: "http://example.com/u" },
        { vault },
      ),
    ).rejects.toThrow("HTTPS");
  });

  it("stores the credentials in the vault and only the reference in the account record", async () => {
    const { vault, values } = memoryVault();
    const saved = (await run("email.accounts.save", OWNER, validAccount, { vault })) as Record<
      string,
      unknown
    >;
    expect(saved).toMatchObject({
      kind: "resend",
      from: "hello@example.com",
      unsubscribeUrl: "https://example.com/unsubscribe",
    });
    expect(JSON.stringify(saved)).not.toContain("re_test_key");
    expect(values.get(`outreach-email.${String(saved.id)}`)).toBe(
      JSON.stringify({ apiKey: "re_test_key" }),
    );
  });

  it("requires the owner principal (registry flag)", () => {
    expect(emailActions["email.accounts.save"]).toMatchObject({ ownerOnly: true });
    expect(emailActions["email.accounts.remove"]).toMatchObject({ ownerOnly: true });
  });

  it("does not expose the host vault when none is configured", async () => {
    await expect(run("email.accounts.save", OWNER, validAccount)).rejects.toThrow(
      "not available on this host",
    );
  });
});

describe("email.send", () => {
  const account = emailAccount();

  it("sends nothing while external sending is off", async () => {
    await fixture.audience.putRecord("email-account", account.id, account);
    await fixture.audience.putPerson(
      personFor("p1", "acc-x", "fan-1", "contact-1", {
        emails: [{ address: "p1@example.org", source: "import", verified: true }],
      }),
    );
    await expect(
      run(
        "email.send",
        OWNER,
        { emailAccountId: account.id, personId: "p1", subject: "Hi", body: "Body" },
        { settings: { sending: "false" } },
      ),
    ).rejects.toThrow("External sending is off");
  });

  it("refuses an AI caller unless email autonomy is autonomous for the account", async () => {
    await fixture.audience.putRecord("email-account", account.id, account);
    await fixture.audience.putPerson(
      personFor("p1", "acc-x", "fan-1", "contact-1", {
        emails: [{ address: "p1@example.org", source: "import", verified: true }],
      }),
    );
    const ai: SocialPrincipal = {
      kind: "external",
      actorId: "ai",
      provider: "assistant",
      projectId: "proj-1",
    };
    await expect(
      run("email.send", ai, {
        emailAccountId: account.id,
        personId: "p1",
        subject: "Hi",
        body: "Body",
      }),
    ).rejects.toThrow("Autonomous email is not enabled");
  });
});
