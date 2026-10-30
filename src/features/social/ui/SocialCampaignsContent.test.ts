// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount, SocialCampaign, SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { Campaigns } from "./SocialCampaigns";
import { closeComposer } from "./socialShared";

vi.mock("./SocialPrograms", () => ({ SocialPrograms: () => null }));
vi.mock("./SocialAssistant", () => ({ SocialAssistant: () => null }));

const Component = withQueryClient(Campaigns);
let element: HTMLDivElement, root: Root;
const request = vi.fn();
const client = { request, tiktokCreator: vi.fn(), upload: vi.fn() } as unknown as SocialClient;
const projects = [{ id: "project", name: "Project", cwd: "G:/project" }];

const account: SocialAccount = {
  id: "account",
  platform: "x",
  name: "Brand account",
  connection: "oauth",
  connected: true,
  paused: false,
  accountType: "profile",
  platformId: "fixture",
  scopes: [],
  accessApproved: true,
  executorId: "host",
  createdAt: 1,
  grants: { project: ["read", "draft"] },
} as unknown as SocialAccount;
const campaign: SocialCampaign = {
  id: "campaign",
  name: "Saved campaign",
  projectIds: ["project"],
  variants: [
    { accountId: "account", text: "hello world", media: [], factIds: [], scheduledAt: 1_000 },
  ],
  revision: 1,
  paused: false,
  createdAt: 1,
};
const job = (status: string) => ({
  id: "job",
  operationId: "operation",
  dedupeKey: "dedupe",
  accountId: "account",
  projectIds: ["project"],
  provider: "x",
  campaignId: "campaign",
  kind: "publish",
  payload: { text: "hello world", media: [] },
  status,
  scheduledAt: 1_000,
  attempts: 0,
  createdAt: 1,
  updatedAt: 1,
});
const snapshot = (patch: Partial<SocialSnapshot> = {}) =>
  ({
    executorId: "host",
    hostOnline: true,
    sendingEnabled: true,
    stopped: false,
    pollingEnabled: false,
    programsSupported: true,
    accounts: [account],
    campaigns: [campaign],
    contacts: [],
    threads: [],
    segments: [],
    rules: [],
    jobs: [],
    drafts: [],
    profiles: [],
    capabilities: { account: [{ operation: "publish", status: "available" }] },
    ...patch,
  }) as unknown as SocialSnapshot;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset().mockImplementation(async (action: string) => {
    if (action === "programs.list") return [];
    if (action === "policy.get") return { effective: {} };
    return undefined;
  });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(value: SocialSnapshot, props: Record<string, unknown> = {}) {
  await act(async () =>
    root.render(
      createElement(Component, {
        client,
        snapshot: value,
        projects,
        initialProject: "project",
        run: async (work: () => Promise<unknown>) => {
          await work();
          return true;
        },
        ...props,
      } as never),
    ),
  );
}
const buttons = (scope: ParentNode = element) => [...scope.querySelectorAll("button")];
const button = (text: string, scope: ParentNode = element) =>
  buttons(scope).find((item) => item.textContent === text);
const click = async (text: string, scope: ParentNode = element) => {
  const target = button(text, scope);
  expect(target, text).toBeTruthy();
  await act(async () => target!.click());
};
const context = () => element.querySelector<HTMLElement>(".social-content-page .social-content-context")!;
const entries = () =>
  buttons(element.querySelector<HTMLElement>('[aria-label="Content entry"]')!).map((item) => ({
    label: item.textContent,
    pressed: item.getAttribute("aria-pressed"),
    disabled: item.disabled,
  }));
const composer = () => document.body.querySelector<HTMLElement>("[data-social-composer]")!;
async function setValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("offers write, brief and edit entries tied to the selected record", async () => {
  await render(snapshot());
  expect(entries()).toEqual([
    { label: "Write", pressed: "true", disabled: false },
    { label: "Generate from a brief", pressed: "false", disabled: false },
    { label: "Edit existing", pressed: "false", disabled: false },
  ]);
  // A new campaign is an explicit state; the saved record keeps its own detail header below.
  expect(context().dataset.entry).toBe("write");
  expect(context().textContent).toContain("New campaign");
  expect(element.querySelector(".social-content-detail h2")?.textContent).toBe("Saved campaign");

  await click("Edit existing");
  expect(context().dataset.entry).toBe("edit");
  expect(context().textContent).toContain("Editing Saved campaign");
  expect(composer().textContent).toContain("Editing Saved campaign");
  expect(composer().textContent).toContain("Revision 1");
  // New writing waits until the parked edit is saved or stopped.
  expect(entries()[0]).toEqual({ label: "Write", pressed: "false", disabled: true });
  expect(entries()[2]).toEqual({ label: "Edit existing", pressed: "true", disabled: false });

  // Reopening the parked edit keeps its unsaved changes instead of reloading the saved record.
  const name = composer().querySelector<HTMLInputElement>("input")!;
  await setValue(name, "Unsaved owner edit");
  await act(async () => closeComposer(composer().querySelector("form")!));
  await click("Generate from a brief");
  expect(context().dataset.entry).toBe("brief");
  expect(context().textContent).toContain("New recurring content");
  await click("Edit existing");
  expect(context().dataset.entry).toBe("edit");
  expect(composer().querySelector<HTMLInputElement>("input")!.value).toBe("Unsaved owner edit");
  expect(request).not.toHaveBeenCalledWith("campaigns.create", expect.anything());

  await click("Stop editing", composer());
  expect(context().dataset.entry).toBe("write");
  expect(entries()[0].disabled).toBe(false);
});

it("disables editing without a selected saved campaign and hides the brief entry when unsupported", async () => {
  await render(snapshot({ campaigns: [], programsSupported: false }));
  expect(entries()).toEqual([
    { label: "Write", pressed: "true", disabled: false },
    { label: "Edit existing", pressed: "false", disabled: true },
  ]);
  expect(element.textContent).toContain("No campaigns yet");
});

it("blocks Edit existing for a campaign with scheduled posts", async () => {
  await render(
    snapshot({
      jobs: [job("queued")] as never,
    }),
  );
  expect(entries()[2].disabled).toBe(true);
});

const sections = () =>
  [...element.querySelectorAll<HTMLElement>(".social-content-detail > .social-content-block")].map(
    (item) => item.getAttribute("aria-label"),
  );
const nextLabel = () =>
  element.querySelector<HTMLElement>(".social-content-next-label strong")?.textContent;
const nextId = () => element.querySelector<HTMLElement>(".social-content-next")?.dataset.next;
const previewOf = (targets: { contentError?: string; approved: boolean }[]) => ({
  campaign,
  targets: targets.map((target) => ({
    accountId: "account",
    capability: { status: "available", reason: "Available" },
    ...target,
  })),
});

it("orders preview, check result, approval and one next step and walks the exact-revision flow", async () => {
  await render(snapshot({ policies: { global: { maxContentCharacters: 280 }, platforms: {} } as never }));
  expect(sections()).toEqual(["Content preview", "Check result", "Approval", "Next step"]);
  const post = element.querySelector<HTMLElement>(".social-preview")!;
  expect(post.textContent).toContain("Brand account");
  expect(post.querySelector(".social-message")?.textContent).toBe("hello world");
  expect(post.querySelector(".social-content-count")?.textContent).toBe("11 / 280");
  expect(nextLabel()).toBe("Check the account and content");
  expect(nextId()).toBe("check");
  expect(button("Schedule posts")!.disabled).toBe(true);

  // A flagged check leaves one next step: fix the issue.
  request.mockResolvedValueOnce(previewOf([{ contentError: "Too long for this account", approved: false }]));
  await click("Check account and content");
  expect(element.querySelector('[aria-label="Check result"]')?.textContent).toContain(
    "Too long for this account",
  );
  expect(element.querySelector('[aria-label="Check result"]')?.textContent).toContain("1 issue found");
  expect(nextLabel()).toBe("Fix 1 issue");
  expect(element.querySelector(".social-check input")).toBeNull();
  expect(button("Give publishing approval")!.disabled).toBe(true);

  // A clean check asks for approval of this exact revision.
  request.mockResolvedValueOnce(previewOf([{ approved: false }]));
  await click("Check account and content");
  expect(nextLabel()).toBe("Approve this revision");
  expect(button("Give publishing approval")!.disabled).toBe(true);
  await act(async () => element.querySelector<HTMLInputElement>(".social-check input")!.click());
  request.mockResolvedValueOnce(undefined).mockResolvedValueOnce(previewOf([{ approved: true }]));
  await click("Give publishing approval");
  expect(request).toHaveBeenCalledWith("campaigns.approveReviewed", {
    id: "campaign",
    expectedRevision: 1,
  });
  expect(request).not.toHaveBeenCalledWith("campaigns.schedule", expect.anything());
  expect(nextLabel()).toBe("Schedule posts");
  expect(nextId()).toBe("schedule");
  expect(button("Schedule posts")!.disabled).toBe(false);
  await click("Schedule posts");
  expect(request).toHaveBeenCalledWith("campaigns.schedule", { id: "campaign" });
});

it("turns the fix step into opening the parked edit of this record", async () => {
  await render(snapshot());
  request.mockResolvedValueOnce(previewOf([{ contentError: "Too long", approved: false }]));
  await click("Check account and content");
  await click("Fix 1 issue", element.querySelector(".social-content-next")!);
  expect(context().dataset.entry).toBe("edit");
  expect(composer().textContent).toContain("Editing Saved campaign");
});

it("says nothing is left to do for a fully sent campaign", async () => {
  await render(
    snapshot({
      jobs: [job("succeeded")] as never,
      campaignStates: { campaign: "succeeded" } as never,
    }),
  );
  expect(nextLabel()).toBe("Nothing to do - sent");
  expect(nextId()).toBe("done");
  expect(button("Schedule posts")!.disabled).toBe(true);
});

it("adds the variant for an account intent once per token, resolving it when the account arrives", async () => {
  const variants = () => composer().querySelectorAll("[data-content-account]").length;
  await render(snapshot({ accounts: [], campaigns: [] }), {
    accountIntent: { accountId: "account", token: 1 },
  });
  expect(variants()).toBe(0);
  // The account arrives after the intent: it is resolved without further user action.
  await render(snapshot({ campaigns: [] }), { accountIntent: { accountId: "account", token: 1 } });
  expect(variants()).toBe(1);
  expect(composer().textContent).toContain("Preparing for account: Brand account");
  // The owner removes it; the same token must not add it back.
  await click("Remove this account from the campaign", composer());
  expect(variants()).toBe(0);
  await render(snapshot({ campaigns: [], jobs: [] }), {
    accountIntent: { accountId: "account", token: 1 },
  });
  expect(variants()).toBe(0);
  // A new intent adds it again, without duplicating an existing variant.
  await render(snapshot({ campaigns: [] }), { accountIntent: { accountId: "account", token: 2 } });
  expect(variants()).toBe(1);
  await render(snapshot({ campaigns: [] }), { accountIntent: { accountId: "account", token: 3 } });
  expect(variants()).toBe(1);
});
