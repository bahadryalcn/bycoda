// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import type { ContactTagSubject } from "../model/socialContactTags";
import type { ContactTagResult } from "../model/socialSuggestions";
import { ContactTagDialog as Dialog } from "./ContactTagSuggestions";

const ContactTagDialog = withQueryClient(Dialog);
let container: HTMLDivElement, root: Root;
const request = vi.fn();
const onApplyImport = vi.fn();
const onClose = vi.fn();
const AGENT = { provider: "codex", model: "fixture-model" };
const account = (grants: string[] = ["read", "draft"]): SocialAccount =>
  ({
    id: "a",
    name: "Main account",
    platform: "x",
    grants: { p: grants },
  }) as unknown as SocialAccount;
const subjects: ContactTagSubject[] = [
  {
    ref: "1",
    accountId: "a",
    platformId: "ada",
    projectIds: ["p"],
    name: "Ada Press",
    tags: ["vip"],
  },
  { ref: "2", accountId: "a", platformId: "bo", projectIds: ["p"], name: "Bo Shop", tags: [] },
];
const answer: ContactTagResult = {
  accountId: "a",
  projectId: "p",
  proposals: [
    {
      ref: "1",
      name: "Ada Press",
      currentTags: ["vip"],
      tags: [
        { tag: "press", reason: "Press in the name.", isNew: true },
        { tag: "VIP", reason: "Already there.", isNew: false },
      ],
      segments: [{ id: "s", name: "Press list" }],
    },
    {
      ref: "2",
      name: "Bo Shop",
      currentTags: [],
      tags: [{ tag: "retail", reason: "Shop in the name.", isNew: true }],
      segments: [],
    },
  ],
  unchangedRefs: [],
  notes: [],
  agent: AGENT,
  draftOnly: true,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset().mockImplementation(async (action: string) => {
    if (action === "policy.get") return { effective: { agent: AGENT } };
    if (action === "contacts.suggestTags") return structuredClone(answer);
    return {};
  });
  onApplyImport.mockReset();
  onClose.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(mode: "import" | "contacts", accounts = [account()]) {
  await act(async () =>
    root.render(
      createElement(ContactTagDialog, {
        mode,
        subjects,
        client: { request } as unknown as SocialClient,
        accounts,
        projects: [{ id: "p", name: "Product", cwd: "/p" }],
        hostOnline: true,
        run: async (work: () => Promise<unknown>) => {
          try {
            await work();
            return true;
          } catch {
            return false;
          }
        },
        onApplyImport,
        onClose,
      }),
    ),
  );
  await act(async () => undefined);
}
const button = (label: string | RegExp) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("footer button")).find((item) =>
    typeof label === "string"
      ? item.textContent?.trim() === label
      : label.test(item.textContent ?? ""),
  )!;
const checkbox = (name: RegExp) =>
  Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
    (item) => name.test(item.getAttribute("aria-label") ?? ""),
  )!;
async function ask() {
  await act(async () => button("Suggest tags").click());
  await act(async () => undefined);
}

describe("ContactTagDialog", () => {
  it("asks for one account and project, with the rows quoted as data and a request id", async () => {
    await mount("import");
    expect(document.body.textContent).toContain("sent to codex · fixture-model");
    await ask();
    const call = request.mock.calls.find(([action]) => action === "contacts.suggestTags")!;
    expect(call[1]).toEqual({
      accountId: "a",
      projectId: "p",
      rows: [
        { ref: "1", name: "Ada Press", platformId: "ada", tags: ["vip"] },
        { ref: "2", name: "Bo Shop", platformId: "bo", tags: [] },
      ],
    });
    expect(typeof call[2]).toBe("string");
    expect(document.body.textContent).toContain("Suggestions for 2 of 2 contacts");
    expect(document.body.textContent).toContain("Would also match: Press list");
    expect(document.body.textContent).toContain("Added to the import draft only");
  });

  it("keeps nothing until the owner chooses, flags an invalid edit and returns the kept tags to the import draft", async () => {
    await mount("import");
    await ask();
    expect(button(/^Add \d+ tags? to the import draft$/).disabled).toBe(true);
    // The duplicate of an existing tag cannot be kept.
    await act(async () => checkbox(/Keep tag VIP for Ada Press/).click());
    expect(document.body.textContent).toContain("The contact already has this tag.");
    expect(button(/^Add \d+ tags? to the import draft$/).disabled).toBe(true);
    await act(async () => checkbox(/Keep tag press for Ada Press/).click());
    await act(async () => checkbox(/Keep tag retail for Bo Shop/).click());
    expect(button("Add 2 tags to the import draft")).toBeTruthy();
    await act(async () => button("Add 2 tags to the import draft").click());
    expect(onApplyImport).toHaveBeenCalledWith({ "1": ["press"], "2": ["retail"] });
    expect(onClose).toHaveBeenCalled();
    // Import mode never writes anything: only the policy read and the suggestion call happened.
    expect(request.mock.calls.map(([action]) => action).sort()).toEqual([
      "contacts.suggestTags",
      "policy.get",
    ]);
  });

  it("keeps every valid suggestion and rejects one again", async () => {
    await mount("import");
    await ask();
    await act(async () => button("Keep all valid").click());
    expect(checkbox(/Keep tag press for Ada Press/).checked).toBe(true);
    // VIP duplicates an existing tag: it stays unkept.
    expect(checkbox(/Keep tag VIP for Ada Press/).checked).toBe(false);
    await act(async () => checkbox(/Keep tag retail for Bo Shop/).click());
    expect(button("Add 1 tag to the import draft")).toBeTruthy();
  });

  it("saves only the kept tags of saved contacts through the normal contact update", async () => {
    await mount("contacts");
    await ask();
    await act(async () => checkbox(/Keep tag press for Ada Press/).click());
    await act(async () => button("Save 1 tag").click());
    await act(async () => undefined);
    const saves = request.mock.calls.filter(([action]) => action === "contacts.upsert");
    expect(saves).toHaveLength(1);
    // Only identity and tags: consent, opt-out and eligibility are never part of the update.
    expect(saves[0][1]).toEqual({ accountId: "a", platformId: "ada", tags: ["vip", "press"] });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps failed contacts in the review and says what happened", async () => {
    request.mockImplementation(async (action: string, input: Record<string, unknown>) => {
      if (action === "policy.get") return { effective: { agent: AGENT } };
      if (action === "contacts.suggestTags") return structuredClone(answer);
      if (action === "contacts.upsert" && input.platformId === "bo")
        throw new Error("Host said no");
      return {};
    });
    await mount("contacts");
    await ask();
    await act(async () => button("Keep all valid").click());
    await act(async () => button("Save 2 tags").click());
    await act(async () => undefined);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Could not save: Host said no");
    expect(document.body.textContent).toContain("Some contacts could not be updated");
    // The saved contact is marked and cannot be saved twice; the failed one can be retried.
    expect(document.body.textContent).toContain("Saved");
    expect(button("Save 1 tag").disabled).toBe(false);
  });

  it("explains a missing draft grant and a missing text agent instead of asking", async () => {
    await mount("contacts", [account(["read"])]);
    expect(document.body.textContent).toContain(
      "Grant this account draft access to the project in Accounts first.",
    );
    expect(button("Suggest tags").disabled).toBe(true);
    expect(request.mock.calls.some(([action]) => action === "contacts.suggestTags")).toBe(false);
  });

  it("stops waiting without applying a late answer, and retries an error with the same request id", async () => {
    let release: (value: ContactTagResult) => void = () => undefined;
    request.mockImplementation(async (action: string) => {
      if (action === "policy.get") return { effective: { agent: AGENT } };
      return await new Promise<ContactTagResult>((resolve) => (release = resolve));
    });
    await mount("import");
    await act(async () => button("Suggest tags").click());
    await act(async () => button("Stop waiting").click());
    await act(async () => release(structuredClone(answer)));
    expect(document.body.textContent).not.toContain("Suggestions for");
    // An error leaves no receipt: the same ask reuses the id.
    request.mockImplementation(async (action: string) => {
      if (action === "policy.get") return { effective: { agent: AGENT } };
      throw new Error("Offline");
    });
    await act(async () => button("Suggest tags").click());
    await act(async () => undefined);
    expect(document.body.textContent).toContain("The AI could not suggest tags");
    await act(async () => button("Try again").click());
    await act(async () => undefined);
    const ids = request.mock.calls
      .filter(([action]) => action === "contacts.suggestTags")
      .map(([, , id]) => id as string);
    expect(ids).toHaveLength(3);
    expect(ids[2]).toBe(ids[1]);
    expect(ids[1]).not.toBe(ids[0]);
  });
});

describe("contact tag review limits", () => {
  it("never sends consent or eligibility fields in the suggestion request", async () => {
    await mount("import");
    await ask();
    const input = request.mock.calls.find(([action]) => action === "contacts.suggestTags")![1] as {
      rows: Record<string, unknown>[];
    };
    for (const row of input.rows)
      for (const key of ["consent", "optedOut", "replyEligible", "commentEligible"])
        expect(row).not.toHaveProperty(key);
  });
});
