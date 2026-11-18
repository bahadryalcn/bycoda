import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { BrowserSendLimiter } from "../browser/limiter";
import type { SocialPrincipal, SocialService } from "../social";
import { linkedinBrowserRecipe } from "../social-browser-linkedin";
import { account, fixture } from "../social-browser-publishing-test-support";
import {
  parseLinkedInBrowserManagement,
  runLinkedInBrowserManagement,
} from "./linkedin-browser-management";

const principal: SocialPrincipal = { kind: "owner", actorId: "fixture", provider: "owner" };
const targetId = "web:linkedin:in:ada-example";
const member = {
  ...account("linkedin", "web:linkedin:in:bycoda-owner"),
  executorId: "test-host",
};
const mutation = {
  accountId: member.id,
  operation: "network.write",
  kind: "invite",
  targetId,
  requestId: "8a353137-149a-4fc5-95b2-d2097151cd2c",
  confirm: "CONFIRM_LINKEDIN_BROWSER_WRITE",
};

function setup() {
  const settings = new Map<string, string>([["sending", "true"]]);
  const current = { ...member };
  const service = {
    accountForBrowserManagement: vi.fn(async () => current),
    connectionReviewEpoch: vi.fn(async () => "epoch-1"),
    store: {
      environmentId: current.executorId,
      db: { checkAuthorization: vi.fn(async () => undefined) },
    },
    setting: vi.fn(async (key: string) => settings.get(key)),
    setSetting: vi.fn(async (key: string, value: string) => void settings.set(key, value)),
    assertSendable: vi.fn(async () => undefined),
  };
  const limiter = { reserve: vi.fn(async () => undefined), record: vi.fn(async () => undefined) };
  const dom = fixture(
    linkedinBrowserRecipe,
    current,
    readFileSync(new URL("../fixtures/linkedin/profile-connectable.html", import.meta.url), "utf8"),
  );
  const run = (raw: Record<string, unknown> = mutation) =>
    runLinkedInBrowserManagement(
      service as unknown as SocialService,
      principal,
      parseLinkedInBrowserManagement(raw),
      {
        async withLinkedInBrowser(_account, verify, use) {
          await verify();
          return use(dom.ctx, limiter as unknown as BrowserSendLimiter);
        },
      },
      () => undefined,
    );
  return { current, settings, limiter, dom, run, service };
}

it("requires an exact confirmed request and a canonical recipient", () => {
  expect(() => parseLinkedInBrowserManagement({ ...mutation, confirm: undefined })).toThrow();
  expect(() => parseLinkedInBrowserManagement({ ...mutation, accountType: "member" })).toThrow();
  expect(() =>
    parseLinkedInBrowserManagement({
      ...mutation,
      targetId: "https://www.linkedin.com/in/ada-example/",
    }),
  ).toThrow();
  expect(() =>
    parseLinkedInBrowserManagement({ ...mutation, targetId: "web:linkedin:in:ADA-example" }),
  ).toThrow();
});

it("refuses OAuth fallback, remote executor and disabled sending before navigation", async () => {
  const f = setup();
  f.current.connection = "oauth";
  await expect(f.run()).rejects.toMatchObject({ code: "denied" });
  f.current.connection = "browser";
  f.current.executorId = "other-host";
  await expect(f.run()).rejects.toMatchObject({ code: "denied" });
  f.current.executorId = "test-host";
  f.settings.set("sending", "false");
  await expect(f.run()).rejects.toMatchObject({ code: "denied" });
  expect(f.dom.page.goto).not.toHaveBeenCalled();
});

it("runs the shared suppression gate at submit before charging or clicking", async () => {
  const f = setup();
  f.service.assertSendable.mockRejectedValueOnce(new SocialPlatformError("denied"));
  await expect(f.run()).rejects.toMatchObject({ code: "denied" });
  expect(f.service.assertSendable).toHaveBeenCalledWith(
    { platform: "linkedin", platformId: targetId },
    "dm",
  );
  expect(f.service.setSetting).not.toHaveBeenCalled();
  expect(f.limiter.record).not.toHaveBeenCalled();
  expect(f.dom.page.click).not.toHaveBeenCalled();
});

it("journals before a lost acknowledgement and refuses the same request on every subsequent call", async () => {
  const f = setup();
  await expect(f.run()).rejects.toMatchObject({ code: "unknown" });
  expect(f.service.setSetting).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/^linkedin\.browser\.attempt:/),
    "submitted",
  );
  expect(f.service.setSetting.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(f.dom.page.click).mock.invocationCallOrder[0]!,
  );
  await expect(f.run()).rejects.toMatchObject({ code: "unknown" });
  expect(f.dom.page.click).toHaveBeenCalledTimes(1);
});
