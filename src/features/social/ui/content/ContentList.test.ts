// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialCampaign, SocialJob } from "../../model/social";
import type { SocialProgram } from "../../model/socialProgram";
import { ContentList, campaignState, type ContentListProps } from "./ContentList";

let element: HTMLDivElement;
let root: Root;

const accounts = [
  { id: "x1", platform: "x", name: "Studio X" },
  { id: "l1", platform: "linkedin", name: "Studio LinkedIn" },
] as unknown as SocialAccount[];

function campaign(
  id: string,
  name: string,
  accountId: string,
  patch: Partial<SocialCampaign> = {},
): SocialCampaign {
  return {
    id,
    name,
    projectIds: ["p1"],
    revision: 1,
    paused: false,
    createdAt: 1,
    variants: [{ accountId, text: name, media: [], scheduledAt: 1_800_000_000_000, factIds: [] }],
    ...patch,
  };
}

function job(
  campaignId: string,
  status: SocialJob["status"],
  scheduledAt: number,
  kind: SocialJob["kind"] = "publish",
): SocialJob {
  return {
    id: `${campaignId}-${status}-${scheduledAt}`,
    campaignId,
    kind,
    status,
    scheduledAt,
    accountId: "x1",
    payload: { text: "", media: [] },
  } as unknown as SocialJob;
}

const draftPost = campaign("c1", "Draft idea", "x1");
const queuedPost = campaign("c2", "Queued post", "x1");
const sentPost = campaign("c3", "Sent post", "l1");
const failedPost = campaign("c4", "Failed post", "l1");
const jobs = [job("c2", "queued", 10), job("c3", "succeeded", 10), job("c4", "failed", 10)];

function render(patch: Partial<ContentListProps> = {}) {
  const props: ContentListProps = {
    campaigns: [draftPost, queuedPost, sentPost, failedPost],
    jobs,
    accounts,
    programs: [],
    accountFilter: "",
    statusFilter: "all",
    onAccountFilter: vi.fn(),
    onStatusFilter: vi.fn(),
    onOpen: vi.fn(),
    ...patch,
  };
  act(() => root.render(createElement(ContentList, props)));
  return props;
}

const names = () =>
  [...element.querySelectorAll(".content-row-name")].map((item) => item.textContent);

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

describe("campaignState", () => {
  it("is the status of the newest publish job of that campaign", () => {
    const state = campaignState(queuedPost, [
      job("c2", "failed", 5),
      job("c2", "queued", 9),
      job("c3", "succeeded", 99),
    ]);
    expect(state).toBe("queued");
  });

  it("ignores replies and messages of the same campaign", () => {
    expect(
      campaignState(queuedPost, [job("c2", "succeeded", 50, "reply"), job("c2", "queued", 5)]),
    ).toBe("queued");
  });

  it("is Draft with no jobs, and Paused when a campaign without jobs is paused", () => {
    expect(campaignState(draftPost, [])).toBe("draft");
    expect(campaignState({ ...draftPost, paused: true }, [])).toBe("paused");
  });
});

describe("ContentList", () => {
  it("lists every saved post by name with its state", () => {
    render();
    expect(names()).toEqual(["Draft idea", "Queued post", "Sent post", "Failed post"]);
    const rows = [...element.querySelectorAll(".content-row")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("Draft");
    expect(rows[1]).toContain("Scheduled");
    expect(rows[2]).toContain("Sent");
    expect(rows[3]).toContain("Failed");
  });

  it.each([
    ["draft", ["Draft idea"]],
    ["scheduled", ["Queued post"]],
    ["sent", ["Sent post"]],
    ["failed", ["Failed post"]],
  ] as const)("filters by the %s status", (statusFilter, expected) => {
    render({ statusFilter });
    expect(names()).toEqual(expected);
  });

  it("treats a cancelled post as failed and a paused one as a draft", () => {
    render({
      statusFilter: "failed",
      campaigns: [queuedPost, { ...draftPost, id: "c5", name: "Paused idea", paused: true }],
      jobs: [job("c2", "cancelled", 10)],
    });
    expect(names()).toEqual(["Queued post"]);
    render({
      statusFilter: "draft",
      campaigns: [{ ...draftPost, id: "c5", name: "Paused idea", paused: true }],
      jobs: [],
    });
    expect(names()).toEqual(["Paused idea"]);
  });

  it("filters by account", () => {
    render({ accountFilter: "l1" });
    expect(names()).toEqual(["Sent post", "Failed post"]);
  });

  it("combines the account and status filters and says when nothing matches", () => {
    render({ accountFilter: "l1", statusFilter: "scheduled" });
    expect(names()).toEqual([]);
    expect(element.textContent).toContain("No posts match these filters.");
  });

  it("reports the chosen filters and the opened post", () => {
    const props = render();
    const status = element.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!;
    act(() => {
      status.value = "failed";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(props.onStatusFilter).toHaveBeenCalledWith("failed");
    const account = element.querySelector<HTMLSelectElement>('select[aria-label="Account"]')!;
    act(() => {
      account.value = "l1";
      account.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(props.onAccountFilter).toHaveBeenCalledWith("l1");
    act(() => element.querySelectorAll<HTMLButtonElement>(".content-row")[1]!.click());
    expect(props.onOpen).toHaveBeenCalledWith("c2");
  });

  it("shows repeating programs apart from posts, with their state", () => {
    const programs = [
      { id: "g1", name: "Weekly tip", enabled: true, cancelled: false },
      { id: "g2", name: "Monthly recap", enabled: false, cancelled: false },
      { id: "g3", name: "Old series", enabled: true, cancelled: true },
    ] as unknown as SocialProgram[];
    render({ programs });
    const section = element.querySelector(".content-programs")!;
    expect(section.textContent).toContain("Weekly tip");
    expect(section.textContent).toContain("Active");
    expect(section.textContent).toContain("Paused");
    expect(section.textContent).toContain("Cancelled");
    expect(section.querySelectorAll("button")).toHaveLength(0);
  });
});
