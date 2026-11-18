import { afterEach, describe, expect, it } from "vitest";
import type { SocialAccountRequest } from "../../../src/features/social/model/accountRequests";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SOCIAL_TOOLS } from "../../../src/features/social/model/socialTools";
import { fixture, runCleanups } from "../social-test-support";
import { accountRequestActions } from "./account-request-actions";

afterEach(runCleanups);

const ask = { platform: "x", reason: "Launch posts for the new site need an X account." };

describe("project account requests", () => {
  it("registers the request as a tool and keeps the owner decisions out of the tools", () => {
    expect(accountRequestActions["accounts.request"].tool).toBe(true);
    expect(SOCIAL_TOOLS).toContain("accounts.request");
    for (const name of [
      "accounts.requests.list",
      "accounts.requests.approve",
      "accounts.requests.dismiss",
    ]) {
      expect(accountRequestActions[name].ownerOnly).toBe(true);
      expect(accountRequestActions[name].tool).toBeUndefined();
      expect(SOCIAL_TOOLS).not.toContain(name as (typeof SOCIAL_TOOLS)[number]);
    }
  });

  it("files a pending request for the caller's own project and creates no account", async () => {
    const f = await fixture();
    const session = await f.session(f.a.id);
    const request = await f.call<SocialAccountRequest>(
      "accounts.request",
      { ...ask, projectId: f.a.id, suggestedName: "Acme", suggestedUsername: "@acme" },
      session.principal,
    );
    expect(request).toMatchObject({
      projectId: f.a.id,
      platform: "x",
      accountType: "member",
      status: "pending",
      suggestedUsername: "acme",
      requestedBy: { provider: "codex", sessionId: session.id },
    });
    expect(await f.call<SocialAccount[]>("accounts.list")).toHaveLength(0);
  });

  it("refuses another project, unknown platforms and unbounded text", async () => {
    const f = await fixture();
    const { principal } = await f.session(f.a.id);
    await expect(
      f.call("accounts.request", { ...ask, projectId: f.b.id }, principal),
    ).rejects.toThrow("another project");
    await expect(
      f.call("accounts.request", { ...ask, projectId: "missing" }, principal),
    ).rejects.toThrow();
    await expect(
      f.call("accounts.request", { ...ask, platform: "myspace", projectId: f.a.id }, principal),
    ).rejects.toThrow("Unsupported social platform");
    await expect(
      f.call("accounts.request", { ...ask, reason: "x".repeat(501), projectId: f.a.id }, principal),
    ).rejects.toThrow("Invalid reason");
    await expect(
      f.call("accounts.request", { ...ask, accountType: "page", projectId: f.a.id }, principal),
    ).rejects.toThrow("account type");
  });

  it("refuses when the project already has a connected granted account for the platform", async () => {
    const f = await fixture();
    await f.account("x", [f.a.id], "Existing X");
    const { principal } = await f.session(f.a.id);
    await expect(
      f.call("accounts.request", { ...ask, projectId: f.a.id }, principal),
    ).rejects.toThrow("already has a connected X account (Existing X)");
    // Another platform, and another project without a grant, are still open.
    await expect(
      f.call("accounts.request", { ...ask, platform: "reddit", projectId: f.a.id }, principal),
    ).resolves.toMatchObject({ platform: "reddit" });
    const other = await f.session(f.b.id);
    await expect(
      f.call("accounts.request", { ...ask, projectId: f.b.id }, other.principal),
    ).resolves.toMatchObject({ projectId: f.b.id });
  });

  it("returns the open request instead of filing a duplicate", async () => {
    const f = await fixture();
    const { principal } = await f.session(f.a.id);
    const first = await f.call<SocialAccountRequest>(
      "accounts.request",
      { ...ask, projectId: f.a.id },
      principal,
    );
    const again = await f.call<SocialAccountRequest>(
      "accounts.request",
      { ...ask, reason: "Another reason.", projectId: f.a.id },
      principal,
    );
    expect(again.id).toBe(first.id);
    const { items } = await f.call<{ items: SocialAccountRequest[] }>("accounts.requests.list");
    expect(items).toHaveLength(1);
    expect(items[0].projectName).toBe("A");
  });

  it("keeps listing, approving and dismissing owner-only", async () => {
    const f = await fixture();
    const { principal } = await f.session(f.a.id);
    const request = await f.call<SocialAccountRequest>(
      "accounts.request",
      { ...ask, projectId: f.a.id },
      principal,
    );
    for (const [action, input] of [
      ["accounts.requests.list", {}],
      ["accounts.requests.approve", { id: request.id, mode: "create" }],
      ["accounts.requests.dismiss", { id: request.id }],
    ] as const)
      await expect(f.call(action, input, principal)).rejects.toThrow("owner");
    expect(await f.call<SocialAccount[]>("accounts.list")).toHaveLength(0);
  });

  it("approves by creating a browser account granted to the project, then marks it fulfilled once connected", async () => {
    const f = await fixture();
    const { principal } = await f.session(f.a.id);
    const request = await f.call<SocialAccountRequest>(
      "accounts.request",
      { ...ask, projectId: f.a.id, suggestedName: "Acme X" },
      principal,
    );
    const approved = await f.call<{ request: SocialAccountRequest; accountId: string }>(
      "accounts.requests.approve",
      { id: request.id, mode: "create" },
    );
    expect(approved.request).toMatchObject({ status: "approved", mode: "create" });
    const account = (await f.call<SocialAccount[]>("accounts.list")).find(
      (item) => item.id === approved.accountId,
    )!;
    expect(account).toMatchObject({
      name: "Acme X",
      platform: "x",
      connection: "browser",
      connected: false,
    });
    expect(account.grants[f.a.id]).toEqual(["read", "draft"]);
    // Approving again is idempotent and creates no second account.
    await expect(
      f.call("accounts.requests.approve", { id: request.id, mode: "signin" }),
    ).resolves.toMatchObject({ accountId: approved.accountId });
    expect(await f.call<SocialAccount[]>("accounts.list")).toHaveLength(1);
    // The AI asking again gets the approved request, not a new one.
    await expect(
      f.call("accounts.request", { ...ask, projectId: f.a.id }, principal),
    ).resolves.toMatchObject({ id: request.id });

    await f.social.connectAccount(
      approved.accountId,
      { platformId: "x-acme", name: "Acme X", scopes: [], accessApproved: true },
      { accessToken: "synthetic-private-token", expiresAt: f.clock.value + 3600000 },
    );
    const { items } = await f.call<{ items: SocialAccountRequest[] }>("accounts.requests.list");
    expect(items[0]).toMatchObject({ id: request.id, status: "fulfilled" });
    await expect(f.call("accounts.requests.dismiss", { id: request.id })).rejects.toThrow(
      "no longer open",
    );
  });

  it("dismisses a pending request and lets the project ask again", async () => {
    const f = await fixture();
    const { principal } = await f.session(f.a.id);
    const request = await f.call<SocialAccountRequest>(
      "accounts.request",
      { ...ask, projectId: f.a.id },
      principal,
    );
    await expect(f.call("accounts.requests.dismiss", { id: request.id })).resolves.toMatchObject({
      status: "dismissed",
    });
    await expect(
      f.call("accounts.requests.approve", { id: request.id, mode: "create" }),
    ).rejects.toThrow("no longer open");
    const next = await f.call<SocialAccountRequest>(
      "accounts.request",
      { ...ask, projectId: f.a.id },
      principal,
    );
    expect(next.id).not.toBe(request.id);
    expect(next.status).toBe("pending");
  });

  it("lets LinkedIn projects request a Page even when they already have a member", async () => {
    const f = await fixture();
    await f.account("linkedin");
    const { principal } = await f.session(f.a.id);
    const request = await f.call<SocialAccountRequest>(
      "accounts.request",
      {
        platform: "linkedin",
        accountType: "organization",
        projectId: f.a.id,
        reason: "Company Page.",
      },
      principal,
    );
    await expect(
      f.call("linkedin.accounts.setupStatus", { id: request.id }, principal),
    ).resolves.toEqual({ status: "pending" });
    const { accountId } = await f.call<{ accountId: string }>("accounts.requests.approve", {
      id: request.id,
      mode: "create",
    });
    await f.social.store.db
      .prepare("INSERT INTO social_records(kind,id,value) VALUES('browser-workflow',?,?)")
      .run(
        "linkedin-signup",
        JSON.stringify({
          accountId,
          platform: "linkedin",
          intent: "signup",
          createdAt: f.clock.value,
          expiresAt: f.clock.value + 60_000,
          status: "awaiting_owner",
          registration: {
            status: "awaiting_owner",
            step: "challenge",
            blockers: ["challenge"],
            message: "Private screen message",
          },
        }),
      );
    const status = await f.call("linkedin.accounts.setupStatus", { id: request.id }, principal);
    expect(status).toEqual({
      status: "approved",
      mode: "create",
      accountId,
      connection: "needs_sign_in",
      signup: {
        status: "awaiting_owner",
        registrationStatus: "awaiting_owner",
        step: "challenge",
        blockers: ["challenge"],
      },
    });
    const other = await f.session(f.b.id);
    await expect(
      f.call("linkedin.accounts.setupStatus", { id: request.id }, other.principal),
    ).rejects.toThrow("Account request not found");
    await f.call("accounts.grants", { accountId, projectId: f.a.id, permissions: [] });
    await expect(
      f.call("linkedin.accounts.setupStatus", { id: request.id }, principal),
    ).rejects.toThrow("no permission");
  });

  it("reuses an existing LinkedIn account after owner approval of a reconnect request", async () => {
    const f = await fixture();
    const account = await f.account("linkedin");
    const original = await f.social.account(account.id);
    await f.call("accounts.disconnect", { accountId: account.id });
    const { principal } = await f.session(f.a.id);
    const input = {
      platform: "linkedin",
      projectId: f.a.id,
      accountId: account.id,
      reason: "Reconnect this profile.",
    };
    const request = await f.call<SocialAccountRequest>("accounts.request", input, principal);
    await expect(f.call("accounts.request", input, principal)).resolves.toMatchObject({
      id: request.id,
    });
    await expect(
      f.call("accounts.requests.approve", { id: request.id, mode: "create" }),
    ).rejects.toThrow("sign in");
    await expect(
      f.call("accounts.requests.approve", { id: request.id, mode: "signin" }),
    ).resolves.toMatchObject({ accountId: account.id });
    expect(await f.call<SocialAccount[]>("accounts.list")).toHaveLength(1);
    await expect(
      f.call("linkedin.accounts.setupStatus", { id: request.id }, principal),
    ).resolves.toMatchObject({ status: "approved", mode: "signin", connection: "needs_sign_in" });
    await f.social.connectAccount(
      account.id,
      {
        platformId: original.platformId,
        name: account.name,
        scopes: original.scopes,
        accessApproved: true,
      },
      { accessToken: "mock-credential", expiresAt: f.clock.value + 60_000 },
    );
    await expect(
      f.call("linkedin.accounts.setupStatus", { id: request.id }, principal),
    ).resolves.toMatchObject({ status: "fulfilled", mode: "signin", connection: "connected" });
  });
});
