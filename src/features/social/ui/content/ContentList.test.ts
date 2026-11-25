// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialCampaign, SocialJob } from "../../model/social";
import type { SocialProgram } from "../../model/socialProgram";
import {
  ContentList,
  campaignState,
  latestPublishJobs,
  type ContentListProps,
} from "./ContentList";

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
    accountId: ["c3", "c4"].includes(campaignId) ? "l1" : "x1",
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
    onReviewProgram: vi.fn(),
    ...patch,
  };
  act(() => root.render(createElement(ContentList, props)));
  return props;
}

const names = () =>
  [...element.querySelectorAll(".content-row-name")].map((item) => item.textContent);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

describe("campaignState", () => {
  it("is the status of the newest publish job of that campaign", () => {
    const state = campaignState(
      queuedPost,
      latestPublishJobs([
        job("c2", "failed", 5),
        job("c2", "queued", 9),
        job("c3", "succeeded", 99),
      ]),
    );
    expect(state).toBe("queued");
  });

  it("ignores replies and messages of the same campaign", () => {
    expect(
      campaignState(
        queuedPost,
        latestPublishJobs([job("c2", "succeeded", 50, "reply"), job("c2", "queued", 5)]),
      ),
    ).toBe("queued");
  });

  it("is Draft with no jobs, and Paused when a campaign without jobs is paused", () => {
    expect(campaignState(draftPost, latestPublishJobs([]))).toBe("draft");
    expect(campaignState({ ...draftPost, paused: true }, latestPublishJobs([]))).toBe("paused");
  });

  it("keeps the first loaded job when two publish jobs share the newest time", () => {
    const first = job("c2", "failed", 10);
    const second = job("c2", "queued", 10);
    expect(campaignState(queuedPost, latestPublishJobs([first, second]))).toBe("failed");
    expect(campaignState(queuedPost, latestPublishJobs([second, first]))).toBe("queued");
  });

  it("reads the newest job from a map built in one pass over many jobs", () => {
    const loaded = [
      job("c2", "succeeded", 1),
      job("c3", "failed", 2),
      job("c2", "queued", 30),
      job("c3", "review", 7),
      job("c2", "failed", 20),
    ];
    const latest = latestPublishJobs(loaded);
    expect(latest.get("c2")?.status).toBe("queued");
    expect(latest.get("c3")?.status).toBe("review");
    expect(campaignState(queuedPost, latest)).toBe("queued");
  });
});

describe("ContentList", () => {
  it("lists every saved post by name with its state", () => {
    render();
    expect(names()).toEqual(["Draft idea", "Queued post", "Sent post", "Failed post"]);
    const rows = [...element.querySelectorAll('.content-row-meta [role="img"]')];
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Draft",
      "Scheduled",
      "Sent",
      "Failed",
    ]);
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

  it("keeps cancelled posts out of Failed and paused posts in Draft", () => {
    render({
      statusFilter: "failed",
      campaigns: [queuedPost, { ...draftPost, id: "c5", name: "Paused idea", paused: true }],
      jobs: [job("c2", "cancelled", 10)],
    });
    expect(names()).toEqual([]);
    render({
      statusFilter: "cancelled",
      campaigns: [queuedPost],
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

  it("keeps review work discoverable under Needs review", () => {
    render({
      statusFilter: "review",
      campaigns: [queuedPost, sentPost],
      jobs: [job("c2", "review", 10), job("c3", "succeeded", 10)],
    });
    expect(names()).toEqual(["Queued post"]);
  });

  it("combines the account and status filters and says when nothing matches", () => {
    render({ accountFilter: "l1", statusFilter: "scheduled" });
    expect(names()).toEqual([]);
    expect(element.textContent).toContain("No posts match these filters.");
  });

  it("reports the chosen filters and the opened post", async () => {
    const props = render();
    const choose = async (label: string, option: string) => {
      await act(async () =>
        element.querySelector<HTMLButtonElement>('button[aria-label^="' + label + ':"]')!.click(),
      );
      const node = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
        item.textContent?.includes(option),
      );
      expect(node).toBeDefined();
      await act(async () => node!.click());
    };
    await choose("Status", "Failed");
    expect(props.onStatusFilter).toHaveBeenCalledWith("failed");
    await choose("Account", "Studio LinkedIn");
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
    expect(
      [...section.querySelectorAll('[role="img"]')].map((icon) => icon.getAttribute("aria-label")),
    ).toEqual(["Active", "Paused", "Cancelled"]);
    expect(section.querySelectorAll("button.content-row")).toHaveLength(3);
  });
});

it("opens the selected paused program for review", () => {
  const program = { id: "program-1", name: "Repeat launch", enabled: false } as SocialProgram;
  const onReviewProgram = vi.fn();
  render({ programs: [program], onReviewProgram });
  const review = [...element.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Repeat launch"),
  );
  expect(review).toBeDefined();
  act(() => review!.click());
  expect(onReviewProgram).toHaveBeenCalledWith(program);
});

it("filters a multi-account post by each matching job and displays mixed outcomes", () => {
  const campaign = {
    ...queuedPost,
    variants: [...queuedPost.variants, { ...queuedPost.variants[0]!, accountId: "l1" }],
  };
  const jobs = [job("c2", "failed", 10), { ...job("c2", "succeeded", 20), accountId: "l1" }];
  render({ campaigns: [campaign], jobs, accountFilter: "x1", statusFilter: "failed" });
  expect(names()).toEqual(["Queued post"]);
  expect(element.querySelector('.content-row-meta [aria-label="Failed"]')).not.toBeNull();
  expect(element.querySelector('.content-row-meta [aria-label="Sent"]')).toBeNull();
  render({ campaigns: [campaign], jobs });
  expect(element.querySelector('.content-row-meta [aria-label="Failed"]')).not.toBeNull();
  expect(element.querySelector('.content-row-meta [aria-label="Sent"]')).not.toBeNull();
});
